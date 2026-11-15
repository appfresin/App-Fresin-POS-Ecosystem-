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
  const serverKey = Deno.env.get("MIDTRANS_SERVER_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey || !serverKey) return json({ error: "Server not configured" }, 500);

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!await validSignature(payload, serverKey)) return json({ error: "Invalid signature" }, 403);

  const midtransOrderId = String(payload.order_id || "").trim();
  const transactionStatus = String(payload.transaction_status || "").trim();
  const fraudStatus = String(payload.fraud_status || "").trim();
  const grossAmount = Math.round(Number(payload.gross_amount || 0));
  if (!midtransOrderId || !transactionStatus) return json({ error: "Invalid notification" }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id,order_number,grand_total,customer_order_type,pickup_time,payment_status")
    .eq("payment_reference", midtransOrderId)
    .maybeSingle();
  if (orderError) {
    console.error("webhook order lookup failed", orderError);
    return json({ error: "Order lookup failed" }, 500);
  }
  if (!order?.id) return json({ ok: true, ignored: "order_not_found" });

  const expectedAmount = Math.round(Number(order.grand_total || 0));
  if (expectedAmount && grossAmount && expectedAmount !== grossAmount) {
    console.error("midtrans amount mismatch", { midtransOrderId, expectedAmount, grossAmount });
    return json({ error: "Amount mismatch" }, 400);
  }

  const paid = transactionStatus === "settlement" || (transactionStatus === "capture" && fraudStatus === "accept");
  const expired = transactionStatus === "expire";
  const denied = transactionStatus === "deny" || transactionStatus === "cancel" || transactionStatus === "failure";
  const now = new Date().toISOString();

  if (paid) {
    const customerStatus = customerPaidStatus(order);
    const { error: updateError } = await admin.from("orders").update({
      payment_status: "Lunas",
      confirmed_at: now,
      payment_provider: "midtrans",
      payment_gateway_transaction_id: String(payload.transaction_id || ""),
      payment_gateway_status: transactionStatus,
      payment_gateway_payload: sanitizeGatewayPayload(payload),
      customer_order_status: customerStatus,
      status: customerStatus === "PREPARING" ? "Sedang Disiapkan" : "Pesanan Baru",
    }).eq("id", order.id);
    if (updateError) {
      console.error("paid order update failed", updateError);
      return json({ error: "Failed to update order" }, 500);
    }
    await replacePayment(admin, order.id, grossAmount || expectedAmount, payload, now);
    return json({ ok: true, status: "paid" });
  }

  if (expired || denied) {
    const cancelledAt = now;
    const { error: updateError } = await admin.from("orders").update({
      customer_order_status: "PAYMENT_EXPIRED",
      status: "Dibatalkan",
      cancelled_at: cancelledAt,
      cancel_reason: expired ? "Pembayaran Midtrans kedaluwarsa." : "Pembayaran Midtrans gagal atau ditolak.",
      payment_gateway_transaction_id: String(payload.transaction_id || ""),
      payment_gateway_status: transactionStatus,
      payment_gateway_payload: sanitizeGatewayPayload(payload),
    }).eq("id", order.id);
    if (updateError) {
      console.error("expired order update failed", updateError);
      return json({ error: "Failed to cancel order" }, 500);
    }
    await admin.rpc("restore_limited_stock_commit", { p_order_number: order.order_number }).catch((error) => {
      console.error("stock restore rpc failed", error);
    });
    return json({ ok: true, status: expired ? "expired" : "failed" });
  }

  const { error: updateError } = await admin.from("orders").update({
    payment_gateway_transaction_id: String(payload.transaction_id || ""),
    payment_gateway_status: transactionStatus,
    payment_gateway_payload: sanitizeGatewayPayload(payload),
  }).eq("id", order.id);
  if (updateError) console.error("pending status update failed", updateError);
  return json({ ok: true, status: transactionStatus });
});

function customerPaidStatus(order: { customer_order_type?: string; pickup_time?: string }) {
  if (String(order.customer_order_type || "") === "DELIVERY") return "SEARCHING_DRIVER";
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
      provider: "midtrans",
      transaction_id: String(payload.transaction_id || ""),
      issuer: String(payload.issuer || payload.acquirer || ""),
    },
    paid_at: paidAt,
  };
  let { error } = await admin.from("payments").insert(paymentPayload);
  if (error && String(error.message || "").includes("payment_breakdown")) {
    const { payment_breakdown: _paymentBreakdown, ...compatiblePayload } = paymentPayload;
    const retry = await admin.from("payments").insert(compatiblePayload);
    error = retry.error;
  }
  if (error) console.error("payment insert failed", error);
}

async function validSignature(payload: Record<string, unknown>, serverKey: string) {
  const signature = String(payload.signature_key || "");
  const source = `${payload.order_id || ""}${payload.status_code || ""}${payload.gross_amount || ""}${serverKey}`;
  const digest = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(source));
  const expected = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return signature && timingSafeEqual(signature, expected);
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
  const { signature_key: _signatureKey, ...safe } = result;
  return safe;
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
