import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CreatePaymentPayload = {
  publicOrderToken?: string;
  orderNumber?: string;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const serverKey = Deno.env.get("MIDTRANS_SERVER_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey || !serverKey) return json({ error: "Midtrans belum dikonfigurasi." }, 500);

  let payload: CreatePaymentPayload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const publicOrderToken = String(payload.publicOrderToken || "").trim();
  const orderNumber = String(payload.orderNumber || "").trim();
  if (!publicOrderToken && !orderNumber) return json({ error: "Order tidak valid." }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey);
  let query = admin
    .from("orders")
    .select("id,order_number,customer_name,grand_total,payment_status,payment_provider,payment_reference,payment_gateway_transaction_id,payment_gateway_status,payment_qr_url,payment_expiry_time,payment_gateway_payload,public_order_token,customer_phone,customer_order_type");
  query = publicOrderToken ? query.eq("public_order_token", publicOrderToken) : query.eq("order_number", orderNumber);
  const { data: order, error: orderError } = await query.maybeSingle();
  if (orderError) {
    console.error("order lookup failed", orderError);
    return json({ error: "Gagal membaca order." }, 500);
  }
  if (!order?.id) return json({ error: "Order tidak ditemukan." }, 404);

  const amount = Math.round(Number(order.grand_total || 0));
  if (!Number.isFinite(amount) || amount <= 0) return json({ error: "Total pembayaran tidak valid." }, 400);
  if (String(order.payment_status || "").toLowerCase() === "lunas") {
    return json({
      ok: true,
      paid: true,
      orderNumber: order.order_number,
      amount,
      reference: order.payment_reference || "",
      qrUrl: order.payment_qr_url || "",
    });
  }
  if (order.payment_reference && order.payment_qr_url) {
    return json({
      ok: true,
      orderNumber: order.order_number,
      amount,
      reference: order.payment_reference,
      transactionId: order.payment_gateway_transaction_id || "",
      transactionStatus: order.payment_gateway_status || "pending",
      qrUrl: order.payment_qr_url,
      expiryTime: order.payment_expiry_time || null,
    });
  }

  const midtransOrderId = `FRESIN-${order.order_number}-${String(order.public_order_token || order.id).slice(0, 10)}`;
  const body = {
    payment_type: "qris",
    transaction_details: {
      order_id: midtransOrderId,
      gross_amount: amount,
    },
    customer_details: {
      first_name: String(order.customer_name || "Customer").slice(0, 64),
      phone: String(order.customer_phone || "").slice(0, 32),
    },
    qris: {
      acquirer: String(Deno.env.get("MIDTRANS_QRIS_ACQUIRER") || "gopay"),
    },
  };
  const response = await fetch(`${midtransBaseUrl()}/v2/charge`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Authorization": `Basic ${btoa(`${serverKey}:`)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("midtrans charge failed", response.status, result);
    return json({ error: "Gagal membuat QRIS Midtrans.", detail: publicMidtransMessage(result) }, 502);
  }

  const qrUrl = qrisActionUrl(result);
  if (!qrUrl) return json({ error: "Midtrans tidak mengembalikan QR code." }, 502);
  const expiryTime = expiryIso(result.expiry_time || result.expiryTime || "");
  const updatePayload = {
    payment_provider: "midtrans",
    payment_reference: midtransOrderId,
    payment_gateway_transaction_id: result.transaction_id || "",
    payment_gateway_status: result.transaction_status || "pending",
    payment_qr_url: qrUrl,
    payment_expiry_time: expiryTime,
    payment_gateway_payload: sanitizeGatewayPayload(result),
  };
  const { error: updateError } = await admin.from("orders").update(updatePayload).eq("id", order.id);
  if (updateError) {
    console.error("payment metadata update failed", updateError);
    return json({ error: "QR berhasil dibuat, tetapi gagal menyimpan metadata." }, 500);
  }

  return json({
    ok: true,
    orderNumber: order.order_number,
    amount,
    reference: midtransOrderId,
    transactionId: result.transaction_id || "",
    transactionStatus: result.transaction_status || "pending",
    qrUrl,
    expiryTime,
  });
});

function midtransBaseUrl() {
  return String(Deno.env.get("MIDTRANS_IS_PRODUCTION") || "").toLowerCase() === "true"
    ? "https://api.midtrans.com"
    : "https://api.sandbox.midtrans.com";
}

function qrisActionUrl(result: Record<string, unknown>) {
  const actions = Array.isArray(result.actions) ? result.actions as Array<Record<string, unknown>> : [];
  const v2 = actions.find((action) => action.name === "generate-qr-code-v2");
  const v1 = actions.find((action) => action.name === "generate-qr-code");
  return String((v2 || v1)?.url || "");
}

function expiryIso(value: unknown) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function sanitizeGatewayPayload(result: Record<string, unknown>) {
  const { signature_key: _signatureKey, ...safe } = result;
  return safe;
}

function publicMidtransMessage(result: Record<string, unknown>) {
  return String(result.status_message || result.validation_messages || "").slice(0, 180);
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
