// Native driver devices use their own authenticated registration, separate from POS tokens.
export async function notifyDriverOrder(
  admin,
  payload,
  send,
  now = Date.now(),
) {
  if (!/^[0-9a-f-]{36}$/i.test(String(payload.orderId || "")))
    return { error: "Invalid order", status: 400 };
  const { data: order, error } = await admin
    .from("orders")
    .select(
      "id,order_number,customer_order_type,customer_order_status,status,payment_status,payment_provider,driver_id,driver_name,driver_phone,cancelled_at,ready_at,updated_at,created_at",
    )
    .eq("id", payload.orderId)
    .maybeSingle();
  if (error) return { error: "Order lookup failed", status: 500 };
  if (!order || order.customer_order_type !== "DELIVERY")
    return { ok: true, sent: 0 };
  const revision = Date.parse(order.updated_at || order.created_at),
    expires = revision + 300000;
  const offered =
    order.customer_order_status === "SEARCHING_DRIVER" &&
    !order.driver_id &&
    !order.driver_name &&
    !order.driver_phone &&
    !order.cancelled_at &&
    !["Dibatalkan", "Batal"].includes(order.status) &&
    (order.payment_provider === "courier_cash" ||
      order.payment_status === "Lunas") &&
    expires > now;
  // Delayed webhooks always reflect current database truth, never resurrect an accepted offer.
  const readyEvent = ["driver_ready", "driver_ready_clear"].includes(payload.eventType);
  const ready = Boolean(order.driver_id) && !order.cancelled_at
    && !["Dibatalkan", "Batal"].includes(order.status)
    && !["PICKED_UP", "DELIVERING", "COMPLETED", "CANCELLED", "NO_DRIVER_AVAILABLE"].includes(order.customer_order_status)
    && (Boolean(order.ready_at) || ["Selesai", "Siap diambil"].includes(order.status));
  if (readyEvent && !order.driver_id) return { ok: true, sent: 0 };
  const event = readyEvent ? (ready ? "driver_ready" : "driver_ready_clear") : offered ? "driver_offer" : "driver_cancel";
  let deviceQuery = admin
    .from("driver_push_devices")
    .select("id,driver_id,fcm_token")
    .eq("enabled", true);
  if (readyEvent) deviceQuery = deviceQuery.eq("driver_id", order.driver_id);
  const { data: devices, error: deviceError } = await deviceQuery.gt("expires_at", new Date(now).toISOString());
  if (deviceError) return { error: "Driver token lookup failed", status: 500 };
  let sent = 0,
    failed = 0;
  const seen = new Set(),
    allowed = new Map();
  for (const device of devices || []) {
    if (readyEvent && device.driver_id !== order.driver_id) continue;
    if (seen.has(device.fcm_token)) continue;
    if (!allowed.has(device.driver_id)) {
      const result = await admin.rpc("driver_push_staff_active", {
        p_driver_id: device.driver_id,
      });
      allowed.set(device.driver_id, !result.error && result.data === true);
    }
    if (!allowed.get(device.driver_id)) continue;
    seen.add(device.fcm_token);
    let result;
    try {
      result = await send(
        device.fcm_token,
        {
          target: "driver",
          route: "driver",
          event_type: event,
          order_id: order.id,
          order_number: String(order.order_number || ""),
          revision_ms: String(Number.isFinite(revision) ? revision : now),
          expires_at_ms: String(Number.isFinite(expires) ? expires : now),
          title:
            event === "driver_ready" ? "Pesanan siap dijemput" : event === "driver_ready_clear" ? "Status pesanan diperbarui" : event === "driver_offer"
              ? "Pesanan delivery baru"
              : "Tawaran pesanan berakhir",
          body:
            event === "driver_ready" ? `Pesanan ${order.order_number || ""} selesai disiapkan dapur. Silakan jemput ke outlet.`
              : event === "driver_ready_clear" ? "Pesanan sudah diantar atau tidak tersedia lagi." : event === "driver_offer"
              ? `Pesanan ${order.order_number || "baru"} menunggu driver.`
              : "Pesanan sudah diterima atau tidak tersedia lagi.",
        },
        readyEvent ? 600 : event === "driver_offer"
          ? Math.max(1, Math.min(300, Math.ceil((expires - now) / 1000)))
          : 300,
      );
    } catch {
      failed++;
      continue;
    }
    if (result.ok) sent++;
    else {
      failed++;
      if (result.status === 404)
        await admin
          .from("driver_push_devices")
          .update({ enabled: false })
          .eq("id", device.id);
    }
  }
  return { ok: true, sent, failed };
}
