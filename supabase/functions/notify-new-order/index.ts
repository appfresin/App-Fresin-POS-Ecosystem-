import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyDriverOrder } from "./driver-push.mjs";

const ORDER_CATEGORY_LOOKUP_ATTEMPTS = 16;
const ORDER_CATEGORY_LOOKUP_DELAY_MS = 200;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type NotifyPayload = {
  internal?: boolean;
  eventType?: string;
  orderId?: string;
  orderNumber?: string;
  source?: string;
  table?: string;
  customer?: string;
  target?: string;
  scopeKey?: string;
  title?: string;
  body?: string;
  tone?: string;
  orderCategories?: unknown;
  reminderIntervalSeconds?: number | string;
  revisionAt?: string;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server not configured" }, 500);

  let payload: NotifyPayload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const internalSecret = Deno.env.get("KASIRIN_PUSH_INTERNAL_SECRET") || "";
  const requestSecret = request.headers.get("x-kasirin-push-secret") || "";
  const isInternal = Boolean(internalSecret && requestSecret && timingSafeEqual(requestSecret, internalSecret));
  if (!isInternal) {
    const authHeader = request.headers.get("authorization") || "";
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") || "", {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Unauthorized" }, 401);
  }

  if (payload.target === "driver") {
    if (!isInternal) return json({ error: "Internal driver event required" }, 403);
    const admin = createClient(supabaseUrl, serviceRoleKey);
    let accessToken = "";
    const result = await notifyDriverOrder(admin, payload, async (token: string, data: Record<string, string>, ttl: number) => {
      if (!accessToken) accessToken = await getAccessToken();
      const projectId = Deno.env.get("FIREBASE_PROJECT_ID") || serviceAccount().project_id;
      return sendFcm(projectId, accessToken, token, data, ttl);
    });
    return json(result, result.status || 200);
  }
  const eventType = normalizeEventType(payload.eventType);
  const targets = targetList(payload.target);
  const scopeKey = normalizeScopeKey(payload.scopeKey);
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: tokens, error: tokenError } = await admin
    .from("device_push_tokens")
    .select("id,fcm_token,target,kitchen_categories")
    .eq("is_active", true)
    .eq("scope_key", scopeKey)
    .in("target", targets);
  if (tokenError) {
    console.error("token lookup failed", tokenError);
    return json({ error: "Failed to load device tokens" }, 500);
  }

  const orderCategories = await resolveOrderCategories(admin, payload);
  const dedupedTokens = [...new Map((tokens || [])
    .filter((row) => tokenMatchesOrderCategories(row, orderCategories))
    .map((row) => [row.fcm_token, row])).values()];
  if (!dedupedTokens.length) {
    await logNotification(admin, payload, eventType, 0, 0, "no_tokens");
    return json({ ok: true, sent: 0, failed: 0 });
  }

  const accessToken = await getAccessToken();
  const projectId = Deno.env.get("FIREBASE_PROJECT_ID") || serviceAccount().project_id;
  if (!projectId) return json({ error: "Firebase project not configured" }, 500);

  const title = payload.title || (eventType === "additional_order" ? "Pesanan tambahan masuk" : "Pesanan baru masuk");
  const body = payload.body || buildBody(payload, eventType);
  const reminderIntervalSeconds = await resolveReminderIntervalSeconds(admin, payload);
  let sent = 0;
  let failed = 0;

  for (const row of dedupedTokens) {
    const result = await sendFcm(projectId, accessToken, row.fcm_token, {
      event_type: eventType,
      order_id: String(payload.orderId || ""),
      order_number: String(payload.orderNumber || ""),
      source: String(payload.source || ""),
      table: String(payload.table || ""),
      customer: String(payload.customer || ""),
      target: String(row.target || payload.target || "all"),
      scope_key: scopeKey,
      route: row.target === "dapur" ? "kitchen" : "orders",
      tone: String(payload.tone || "bell"),
      order_categories: orderCategories.join("|"),
      reminder_interval_seconds: String(reminderIntervalSeconds),
      title,
      body,
    });

    if (result.ok) {
      sent += 1;
    } else {
      failed += 1;
      if (result.status === 404 || result.status === 400) {
        await admin.from("device_push_tokens").update({
          is_active: false,
          updated_at: new Date().toISOString(),
        }).eq("id", row.id);
      }
    }
  }

  await logNotification(admin, payload, eventType, sent, failed, "");
  return json({ ok: true, sent, failed });
});

function normalizeEventType(value: unknown): "new_order" | "additional_order" {
  return String(value || "new_order") === "additional_order" ? "additional_order" : "new_order";
}

function targetList(value: unknown) {
  const target = String(value || "all").toLowerCase();
  if (target === "kasir") return ["all", "kasir"];
  if (target === "dapur") return ["all", "dapur"];
  return ["all", "kasir", "dapur"];
}

function normalizeScopeKey(value: unknown) {
  return String(value || "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "default";
}

function normalizeCategoryList(value: unknown) {
  const source = Array.isArray(value) ? value : String(value || "").split(/[,\n|]+/);
  const seen = new Set<string>();
  return source
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 80);
}

function tokenMatchesOrderCategories(row: { target?: string; kitchen_categories?: unknown }, orderCategories: string[]) {
  const filters = normalizeCategoryList(row.kitchen_categories);
  if (!filters.length) return true;
  if (!orderCategories.length) return false;
  const orderKeys = new Set(orderCategories.map((category) => category.toLowerCase()));
  return filters.some((category) => orderKeys.has(category.toLowerCase()));
}

async function resolveOrderCategories(admin: ReturnType<typeof createClient>, payload: NotifyPayload) {
  const direct = normalizeCategoryList(payload.orderCategories);
  if (direct.length) return direct;
  const orderId = String(payload.orderId || "").trim();
  if (!orderId) return [];
  for (let attempt = 0; attempt < ORDER_CATEGORY_LOOKUP_ATTEMPTS; attempt += 1) {
    const { data, error } = await admin
      .from("order_items")
      .select("variant_data")
      .eq("order_id", orderId);
    if (error) {
      console.error("order category lookup failed", error);
      return [];
    }
    const categories = normalizeCategoryList((data || []).map((item) => {
      const variantData = item.variant_data as { category?: unknown; productCategory?: unknown } | null;
      return variantData?.category || variantData?.productCategory || "";
    }));
    if (categories.length || attempt === ORDER_CATEGORY_LOOKUP_ATTEMPTS - 1) return categories;
    await new Promise((resolve) => setTimeout(resolve, ORDER_CATEGORY_LOOKUP_DELAY_MS));
  }
  return [];
}

function buildBody(payload: NotifyPayload, eventType: string) {
  const orderNumber = payload.orderNumber ? `#${payload.orderNumber}` : "baru";
  const table = payload.table ? ` meja ${payload.table}` : "";
  const customer = payload.customer ? ` - ${payload.customer}` : "";
  return eventType === "additional_order"
    ? `Tambahan pesanan ${orderNumber}${table}${customer}.`
    : `Pesanan ${orderNumber}${table}${customer}.`;
}

async function resolveReminderIntervalSeconds(admin: ReturnType<typeof createClient>, payload: NotifyPayload) {
  const direct = normalizeReminderIntervalSeconds(payload.reminderIntervalSeconds);
  if (direct) return direct;

  const { data, error } = await admin
    .from("store_settings")
    .select("self_order_settings,updated_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("store settings lookup failed", error);
    return 180;
  }

  const settings = data?.self_order_settings as { notifications?: { reminderIntervalSeconds?: unknown } } | null;
  return normalizeReminderIntervalSeconds(settings?.notifications?.reminderIntervalSeconds) || 180;
}

function normalizeReminderIntervalSeconds(value: unknown) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.max(10, Math.min(3600, Math.round(seconds)));
}

async function sendFcm(projectId: string, accessToken: string, token: string, data: Record<string, string>, ttlSeconds = 3600) {
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({
      message: {
        token,
        data,
        android: {
          priority: "HIGH",
          ttl: `${ttlSeconds}s`,
        },
      },
    }),
  });
  if (!response.ok) console.error("FCM send failed", response.status, await response.text());
  return { ok: response.ok, status: response.status };
}

async function getAccessToken() {
  const account = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${base64Url(signature)}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`OAuth token request failed: ${response.status}`);
  const data = await response.json();
  return data.access_token as string;
}

function serviceAccount() {
  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured");
  const account = JSON.parse(raw);
  account.private_key = String(account.private_key || "").replace(/\\n/g, "\n");
  return account;
}

function pemToArrayBuffer(pem: string) {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function base64Url(value: string | ArrayBuffer) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = "";
  bytes.forEach((byte) => binary += String.fromCharCode(byte));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function timingSafeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let mismatch = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    mismatch |= leftBytes[index] ^ rightBytes[index];
  }
  return mismatch === 0;
}

async function logNotification(admin: ReturnType<typeof createClient>, payload: NotifyPayload, eventType: string, sent: number, failed: number, error: string) {
  await admin.from("push_notification_logs").insert({
    order_id: payload.orderId || null,
    order_number: payload.orderNumber || "",
    event_type: eventType,
    target: payload.target || "all",
    sent_count: sent,
    failed_count: failed,
    error,
  });
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
