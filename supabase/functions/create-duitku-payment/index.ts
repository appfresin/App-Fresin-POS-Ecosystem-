import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CreatePaymentPayload = {
  publicOrderToken?: string;
  orderNumber?: string;
  returnUrl?: string;
};

type GatewayPayload = Record<string, unknown> & { paymentUrl?: string; payment_url?: string };

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const merchantCode = Deno.env.get("DUITKU_MERCHANT_CODE") || "";
  const merchantKey = Deno.env.get("DUITKU_MERCHANT_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey || !merchantCode || !merchantKey) {
    return json({ error: "Duitku sandbox belum dikonfigurasi." }, 500);
  }

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
    .select("id,order_number,customer_name,subtotal,discount,tax_amount,service_fee,delivery_fee,grand_total,payment_status,payment_provider,payment_reference,payment_gateway_transaction_id,payment_gateway_status,payment_qr_url,payment_expiry_time,payment_gateway_payload,public_order_token,customer_phone,customer_order_type,delivery_address,delivery_note");
  query = publicOrderToken ? query.eq("public_order_token", publicOrderToken) : query.eq("order_number", orderNumber);
  const { data: order, error: orderError } = await query.maybeSingle();
  if (orderError) {
    console.error("duitku order lookup failed", orderError);
    return json({ error: "Gagal membaca order." }, 500);
  }
  if (!order?.id) return json({ error: "Order tidak ditemukan." }, 404);
  if (["cash_at_outlet", "courier_cash"].includes(String(order.payment_provider || ""))) {
    return json({ error: "Pesanan ini menggunakan pembayaran langsung, bukan Duitku." }, 409);
  }

  const amount = orderPaymentAmount(order);
  if (!Number.isFinite(amount) || amount <= 0) return json({ error: "Total pembayaran tidak valid." }, 400);

  const existingPayload = objectPayload(order.payment_gateway_payload);
  const existingPaymentUrl = duitkuPaymentUrl(existingPayload);
  const existingPaymentAmount = paymentPayloadAmount(existingPayload);
  if (String(order.payment_status || "").toLowerCase() === "lunas") {
    return json({
      ok: true,
      paid: true,
      provider: "duitku",
      orderNumber: order.order_number,
      amount,
      reference: order.payment_reference || "",
      transactionId: order.payment_gateway_transaction_id || "",
      transactionStatus: order.payment_gateway_status || "00",
      paymentUrl: existingPaymentUrl,
      qrUrl: order.payment_qr_url || "",
      expiryTime: order.payment_expiry_time || null,
    });
  }
  if (order.payment_provider === "duitku" && order.payment_reference && existingPaymentUrl && existingPaymentAmount === amount) {
    await admin.from("orders").update({ grand_total: amount }).eq("id", order.id);
    return json({
      ok: true,
      provider: "duitku",
      orderNumber: order.order_number,
      amount,
      reference: order.payment_reference,
      transactionId: order.payment_gateway_transaction_id || "",
      transactionStatus: order.payment_gateway_status || "pending",
      paymentUrl: existingPaymentUrl,
      qrUrl: order.payment_qr_url || "",
      expiryTime: order.payment_expiry_time || null,
    });
  }

  const duitkuOrderId = `FRESIN-${order.order_number}-${String(order.public_order_token || order.id).slice(0, 10)}-${Date.now().toString(36).slice(-5)}`;
  const expiryPeriod = Math.max(1, Math.min(1440, Number(Deno.env.get("DUITKU_EXPIRY_PERIOD_MINUTES") || 30)));
  const invoiceBody = {
    paymentAmount: amount,
    merchantOrderId: duitkuOrderId,
    productDetails: `Pesanan Fresin ${order.order_number}`,
    email: customerEmail(),
    phoneNumber: String(order.customer_phone || "").slice(0, 20),
    customerVaName: String(order.customer_name || "Customer Fresin").slice(0, 50),
    callbackUrl: callbackUrl(supabaseUrl),
    returnUrl: returnUrl(request, payload.returnUrl),
    paymentMethod: String(Deno.env.get("DUITKU_PAYMENT_METHOD") || "SP").trim(),
    expiryPeriod,
    customerDetail: {
      firstName: String(order.customer_name || "Customer").slice(0, 50),
      phoneNumber: String(order.customer_phone || "").slice(0, 20),
      email: customerEmail(),
      billingAddress: {
        firstName: String(order.customer_name || "Customer").slice(0, 50),
        address: String(order.delivery_address || order.delivery_note || "Sigli").slice(0, 255),
        phone: String(order.customer_phone || "").slice(0, 20),
        countryCode: "ID",
      },
    },
  };

  const timestamp = String(Date.now());
  // Duitku POP header signature: HMAC_SHA256(merchantCode + timestamp, merchantKey).
  const signatureSource = merchantCode + timestamp;
  const signature = await hmacSha256Hex(merchantKey, signatureSource);
  const response = await fetch(duitkuCreateInvoiceUrl(), {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "x-duitku-timestamp": timestamp,
      "x-duitku-signature": signature,
      "x-duitku-merchantcode": merchantCode,
    },
    body: JSON.stringify(invoiceBody),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !duitkuPaymentUrl(result)) {
    console.error("duitku create invoice failed", response.status, result);
    return json({ error: "Gagal membuat pembayaran Duitku.", detail: publicDuitkuMessage(result) }, 502);
  }

  const expiryTime = new Date(Date.now() + expiryPeriod * 60 * 1000).toISOString();
  const gatewayPayload = sanitizeGatewayPayload({ ...result, paymentUrl: duitkuPaymentUrl(result), paymentMethod: invoiceBody.paymentMethod, paymentAmount: amount });
  const updatePayload = {
    payment_provider: "duitku",
    payment_reference: duitkuOrderId,
    payment_gateway_transaction_id: String(result.reference || ""),
    payment_gateway_status: String(result.statusCode || "01"),
    payment_qr_url: "",
    payment_expiry_time: expiryTime,
    payment_gateway_payload: gatewayPayload,
    grand_total: amount,
  };
  const { error: updateError } = await admin.from("orders").update(updatePayload).eq("id", order.id);
  if (updateError) {
    console.error("duitku metadata update failed", updateError);
    return json({ error: "Pembayaran berhasil dibuat, tetapi gagal menyimpan metadata." }, 500);
  }

  return json({
    ok: true,
    provider: "duitku",
    orderNumber: order.order_number,
    amount,
    reference: duitkuOrderId,
    transactionId: String(result.reference || ""),
    transactionStatus: String(result.statusCode || "01"),
    paymentUrl: duitkuPaymentUrl(result),
    qrUrl: "",
    expiryTime,
  });
});

function duitkuCreateInvoiceUrl() {
  return String(Deno.env.get("DUITKU_IS_PRODUCTION") || "").toLowerCase() === "true"
    ? "https://api-prod.duitku.com/api/merchant/createInvoice"
    : "https://api-sandbox.duitku.com/api/merchant/createInvoice";
}

function callbackUrl(supabaseUrl: string) {
  return String(Deno.env.get("DUITKU_CALLBACK_URL") || "https://www.fresin.id/duitku/callback").trim();
}

function returnUrl(request: Request, explicitUrl?: string) {
  return String(
    explicitUrl ||
    Deno.env.get("DUITKU_RETURN_URL") ||
    request.headers.get("referer") ||
    request.headers.get("origin") ||
    "https://fresin.id/"
  ).slice(0, 255);
}

function customerEmail() {
  return String(Deno.env.get("DUITKU_CUSTOMER_EMAIL_FALLBACK") || "fresin.indonesia@gmail.com").trim();
}

function orderPaymentAmount(order: Record<string, unknown>) {
  const subtotal = Number(order.subtotal || 0);
  const discount = Number(order.discount || 0);
  const tax = Number(order.tax_amount || 0);
  const serviceFee = Number(order.service_fee || 0);
  const deliveryFee = Number(order.delivery_fee || 0);
  const componentTotal = subtotal - discount + tax + serviceFee + deliveryFee;
  const storedTotal = Number(order.grand_total || 0);
  return Math.round(Math.max(storedTotal, componentTotal));
}

function objectPayload(value: unknown): GatewayPayload {
  return value && typeof value === "object" && !Array.isArray(value) ? value as GatewayPayload : {};
}

function paymentPayloadAmount(payload: GatewayPayload) {
  const amount = Number(payload.paymentAmount || payload.amount || 0);
  return Number.isFinite(amount) ? Math.round(amount) : 0;
}

function duitkuPaymentUrl(result: unknown) {
  const data = objectPayload(result);
  return String(data.paymentUrl || data.payment_url || "").trim();
}

async function hmacSha256Hex(secret: string, source: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(source));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sanitizeGatewayPayload(result: Record<string, unknown>) {
  const { signature: _signature, ...safe } = result;
  return safe;
}

function publicDuitkuMessage(result: Record<string, unknown>) {
  return String(result.statusMessage || result.Message || result.message || "").slice(0, 180);
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

