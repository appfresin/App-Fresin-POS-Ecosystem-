import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RegisterPayload = {
  token?: string;
  platform?: string;
  target?: string;
  scopeKey?: string;
  deviceName?: string;
  appVersion?: string;
  enabled?: boolean;
  kitchenCategories?: unknown;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server not configured" }, 500);

  const anonKey = Deno.env.get("KASIRIN_PUBLIC_ANON_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  const authHeader = request.headers.get("authorization") || "";
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") || "", {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  const requestApiKey = request.headers.get("apikey") || "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  const isAnonProjectRequest = Boolean(anonKey && requestApiKey === anonKey && bearerToken === anonKey);
  if ((userError || !userData.user) && !isAnonProjectRequest) return json({ error: "Unauthorized" }, 401);

  let payload: RegisterPayload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const token = String(payload.token || "").trim();
  if (!token || token.length < 32 || token.length > 4096) return json({ error: "Invalid token" }, 400);

  const target = normalizeTarget(payload.target);
  const scopeKey = normalizeScopeKey(payload.scopeKey);
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const row = {
    user_id: userData.user?.id || null,
    fcm_token: token,
    platform: String(payload.platform || "android").slice(0, 32),
    scope_key: scopeKey,
    target,
    device_name: String(payload.deviceName || "Kasirin Android").slice(0, 120),
    app_version: String(payload.appVersion || "").slice(0, 32),
    kitchen_categories: normalizeCategoryList(payload.kitchenCategories),
    is_active: payload.enabled !== false,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin
    .from("device_push_tokens")
    .upsert(row, { onConflict: "fcm_token" });
  if (error) {
    console.error("register-device-token failed", error);
    return json({ error: "Failed to register token" }, 500);
  }

  return json({ ok: true, target, scopeKey });
});

function normalizeTarget(value: unknown): "all" | "kasir" | "dapur" {
  const target = String(value || "all").toLowerCase();
  return target === "kasir" || target === "dapur" ? target : "all";
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

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
