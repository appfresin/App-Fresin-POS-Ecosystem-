import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const merchantCode = Deno.env.get("DUITKU_MERCHANT_CODE") || "";
  const merchantKey = Deno.env.get("DUITKU_MERCHANT_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey || !merchantCode || !merchantKey) return json({ error: "Server not configured" }, 500);

  let payload: Record<string, unknown>;
  try {
    payload = await parseDuitkuPayload(request);
  } catch {
    return json({ error: "Invalid notification" }, 400);
  }

  if (String(payload.merchantCode || "") !== merchantCode) return json({ error: "Invalid merchant" }, 403);
  if (!await validSignature(payload, merchantKey)) return json({ error: "Invalid signature" }, 403);

  const merchantOrderId = String(payload.merchantOrderId || "").trim();
  const resultCode = String(payload.resultCode || "").trim();
  const amount = Math.round(Number(payload.amount || 0));
  if (!merchantOrderId || !resultCode) return json({ error: "Invalid notification" }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id,order_number,subtotal,discount,tax_amount,service_fee,delivery_fee,grand_total,customer_order_type,customer_order_status,pickup_time,payment_status")
    .eq("payment_reference", merchantOrderId)
    .maybeSingle();
  if (orderError) {
    console.error("duitku webhook order lookup failed", orderError);
    return json({ error: "Order lookup failed" }, 500);
  }
  if (!order?.id) return json({ ok: true, ignored: "order_not_found" });

  const expectedAmount = orderPaymentAmount(order);
  if (expectedAmount && amount && expectedAmount !== amount) {
    console.error("duitku amount mismatch", { merchantOrderId, expectedAmount, amount });
    return json({ error: "Amount mismatch" }, 400);
  }

  const paid = resultCode === "00";
  const failed = resultCode === "01" || resultCode === "02";
  const now = new Date().toISOString();

  if (paid) {
    const customerStatus = customerPaidStatus(order);
    const { error: updateError } = await admin.from("orders").update({
      payment_status: "Lunas",
      confirmed_at: now,
      payment_provider: "duitku",
      grand_total: amount || expectedAmount,
      payment_gateway_transaction_id: String(payload.reference || ""),
      payment_gateway_status: resultCode,
      payment_gateway_payload: sanitizeGatewayPayload(payload),
      customer_order_status: customerStatus,
      status: customerStatus === "PREPARING" ? "Sedang Disiapkan" : "Pesanan Baru",
    }).eq("id", order.id);
    if (updateError) {
      console.error("duitku paid order update failed", updateError);
      return json({ error: "Failed to update order" }, 500);
    }
    await replacePayment(admin, order.id, amount || expectedAmount, payload, now);
    return json({ ok: true, status: "paid" });
  }

  if (failed) {
    const { error: updateError } = await admin.from("orders").update({
      customer_order_status: "PAYMENT_EXPIRED",
      status: "Dibatalkan",
      cancelled_at: now,
      cancel_reason: "Pembayaran Duitku gagal atau kedaluwarsa.",
      payment_gateway_transaction_id: String(payload.reference || ""),
      payment_gateway_status: resultCode,
      payment_gateway_payload: sanitizeGatewayPayload(payload),
    }).eq("id", order.id);
    if (updateError) {
      console.error("duitku failed order update failed", updateError);
      return json({ error: "Failed to cancel order" }, 500);
    }
    await admin.rpc("restore_limited_stock_commit", { p_order_number: order.order_number }).catch((error) => {
      console.error("stock restore rpc failed", error);
    });
    return json({ ok: true, status: "failed" });
  }

  const { error: updateError } = await admin.from("orders").update({
    payment_gateway_transaction_id: String(payload.reference || ""),
    payment_gateway_status: resultCode,
    payment_gateway_payload: sanitizeGatewayPayload(payload),
  }).eq("id", order.id);
  if (updateError) console.error("duitku pending status update failed", updateError);
  return json({ ok: true, status: resultCode || "pending" });
});

async function parseDuitkuPayload(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return await request.json();
  const formData = await request.formData();
  return Object.fromEntries(Array.from(formData.entries()).map(([key, value]) => [key, String(value)]));
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

function customerPaidStatus(order: { customer_order_type?: string; customer_order_status?: string; pickup_time?: string }) {
  if (String(order.customer_order_type || "") === "DELIVERY") {
    const current = String(order.customer_order_status || "");
    if (["DRIVER_ASSIGNED", "PREPARING", "READY_FOR_PICKUP", "PICKED_UP", "DELIVERING", "COMPLETED"].includes(current)) return current;
    return "SEARCHING_DRIVER";
  }
  return String(order.pickup_time || "").toLowerCase() === "secepatnya" ? "PREPARING" : "SCHEDULED";
}

async function replacePayment(admin: ReturnType<typeof createClient>, orderId: string, amount: number, payload: Record<string, unknown>, paidAt: string) {
  await admin.from("payments").delete().eq("order_id", orderId);
  const paymentPayload = {
    order_id: orderId,
    method: "QRIS",
    amount,
    received_amount: amount,
    change_amount: 0,
    payment_breakdown: {
      QRIS: amount,
      provider: "duitku",
      transaction_id: String(payload.reference || ""),
      issuer: String(payload.paymentCode || payload.publisherOrderId || ""),
    },
    paid_at: paidAt,
  };
  let { error } = await admin.from("payments").insert(paymentPayload);
  if (error && String(error.message || "").includes("payment_breakdown")) {
    const { payment_breakdown: _paymentBreakdown, ...compatiblePayload } = paymentPayload;
    const retry = await admin.from("payments").insert(compatiblePayload);
    error = retry.error;
  }
  if (error) console.error("duitku payment insert failed", error);
}

async function validSignature(payload: Record<string, unknown>, merchantKey: string) {
  const signature = String(payload.signature || "");
  const merchantCode = String(payload.merchantCode || "");
  const amount = String(payload.amount || "");
  const merchantOrderId = String(payload.merchantOrderId || "");
  // Duitku callback signature: HMAC_SHA256(merchantCode + amount + merchantOrderId, merchantKey).
  const signatureSource = merchantCode + amount + merchantOrderId;
  const expected = await hmacSha256Hex(merchantKey, signatureSource);
  return signature && timingSafeEqual(signature, expected);
}

async function hmacSha256Hex(secret: string, source: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(source));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
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

function sanitizeGatewayPayload(result: Record<string, unknown>) {
  const { signature: _signature, ...safe } = result;
  return safe;
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

