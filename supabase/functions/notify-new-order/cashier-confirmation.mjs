export const CONFIRMATION_CATEGORY = "__confirmation__";

export function orderNeedsCashierConfirmation(order = {}) {
  const status = String(order.status || "").trim().toLowerCase();
  const mode = String(order.customerOrderType || order.orderMode || order.customer_order_type || "").toUpperCase();
  const type = String(order.type || "").trim().toLowerCase();
  const source = String(order.source || "").trim().toLowerCase();
  const progress = String(order.customerOrderStatus || order.customer_order_status || "").toUpperCase();
  if (status !== "pesanan baru" || order.confirmedAt || order.confirmed_at || order.cancelledAt || order.cancelled_at
    || order.preparedAt || order.prepared_at || order.readyAt || order.ready_at
    || ["SCHEDULED", "SEARCHING_DRIVER", "NO_DRIVER_AVAILABLE", "CANCELLED", "COMPLETED"].includes(progress)) return false;
  if (mode === "DELIVERY" || type === "delivery") {
    return Boolean(order.driverId || order.driver_id)
      && ["WAITING_ACCEPTANCE", "WAITING_CASHIER", "WAITING_CONFIRMATION"].includes(progress);
  }
  const provider = String(order.paymentProvider || order.payment_provider || "");
  const paid = String(order.paymentStatus || order.payment_status || "").toLowerCase() === "lunas";
  if (mode === "PICKUP_PREORDER" && provider && provider !== "cash_at_outlet" && !paid) return false;
  return ["PICKUP_PREORDER", "TAKEAWAY"].includes(mode) || (type === "take away" && source === "self order");
}

export function tokenMatchesOrderCategories(row, orderCategories) {
  const normalize = value => (Array.isArray(value) ? value : String(value || "").split(/[,\n|]+/))
    .map(value => String(value || "").trim().toLowerCase()).filter(Boolean);
  const filters = normalize(row.kitchen_categories);
  const categories = normalize(orderCategories);
  if (row.target === "dapur" && categories.includes(CONFIRMATION_CATEGORY)) return filters.includes(CONFIRMATION_CATEGORY);
  if (!filters.length) return true;
  return categories.some(category => filters.includes(category));
}
