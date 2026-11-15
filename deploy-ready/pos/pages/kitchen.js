// Page renderer extracted from app.js. Depends on shared helpers/globals in app.js.

function kitchenOrderStableSort(a, b) {
  const bTime = new Date(kitchenOrderActivityAt(b) || 0).getTime();
  const aTime = new Date(kitchenOrderActivityAt(a) || 0).getTime();
  if (bTime !== aTime) return bTime - aTime;
  return String(b.number || b.id || "").localeCompare(String(a.number || a.id || ""), "id", { sensitivity: "base" });
}

function kitchenOrderSequenceMap(orders = []) {
  const sequences = new Map();
  orders.filter(kitchenOrderHasSequence).forEach((order, index) => {
    if (order?.id) sequences.set(order.id, index + 1);
  });
  return sequences;
}

function kitchenOrderHasSequence(order) {
  return ["Pesanan Baru", "Sedang Disiapkan"].includes(order?.status);
}

function kitchenOrderIsCarryover(order, currentDateKey = todayKey()) {
  const orderDateKey = todayKey(new Date(order?.createdAt || Date.now()));
  return orderDateKey !== currentDateKey && kitchenOrderHasSequence(order);
}

function kitchenOrderIsVisible(order, filter, visibleStatuses) {
  const cancelled = typeof orderIsCancelled === "function"
    ? orderIsCancelled(order)
    : Boolean(order?.cancelledAt) || ["Dibatalkan", "Batal"].includes(order?.status);
  if (cancelled) return filter === "Semua" || filter === "Dibatalkan";
  if (typeof orderNeedsTakeawayCashier === "function" && orderNeedsTakeawayCashier(order)) return false;
  if (typeof orderVisibleInPosOrderList === "function" && !orderVisibleInPosOrderList(order)) return false;
  return filter === "Semua" ? visibleStatuses.includes(order.status) : order.status === filter;
}

function renderKitchenTakeawayNotice(order) {
  const customer = customerDisplayName(order.customer) || "-";
  return `<article class="card kitchen-order-card kitchen-takeaway-notice" role="status" aria-label="Pemberitahuan takeaway menunggu kasir">
    <div class="kitchen-order-head">
      <div class="kitchen-order-titleline"><div><div class="order-title-row"><span class="kitchen-service-chip">Takeaway-Rumah</span><strong>${escapeHtml(customer)}</strong></div></div></div>
      <span class="pill kitchen-notice-status">Menunggu diterima kasir</span>
    </div>
    <div class="kitchen-order-meta"><span class="kitchen-order-time">${dateTime(order.createdAt)}</span><span class="pill">${escapeHtml(displayOrderNumber(order.number))}</span><span class="pill">Pemberitahuan takeaway</span></div>
    ${order.pickupTime ? `<p class="orders-item-group-note so-takeaway-pickup-note"><b>Jam pengambilan:</b> ${escapeHtml(order.pickupTime)}</p>` : ""}
  </article>`;
}

function renderKitchen() {
  const today = todayKey();
  const filters = ["Semua", "Pesanan Baru", "Sedang Disiapkan", "Selesai", "Dibatalkan", "Pemberitahuan Takeaway"];
  const filterLabels = {
    "Semua": "Semua",
    "Pesanan Baru": "Baru",
    "Sedang Disiapkan": "Diproses",
    "Selesai": "Selesai",
    "Dibatalkan": "Batal",
    "Pemberitahuan Takeaway": "Pemberitahuan Takeaway"
  };
  if (!filters.includes(kitchenFilter)) kitchenFilter = "Semua";
  const soldOutCount = typeof stockSoldOutCount === "function"
    ? stockSoldOutCount()
    : state.products.filter(product => product.soldOut).length;
  const kitchenStatuses = ["Pesanan Baru", "Sedang Disiapkan", "Selesai"];
  const pendingTakeawayNotices = typeof orderNeedsTakeawayCashier === "function"
    ? state.orders.filter(orderNeedsTakeawayCashier).sort(kitchenOrderStableSort) : [];
  const takeawayNotices = ["Semua", "Pemberitahuan Takeaway"].includes(kitchenFilter) ? pendingTakeawayNotices : [];
  const orders = state.orders
    .filter(order => {
      const isToday = todayKey(new Date(order.cancelledAt || order.createdAt || Date.now())) === today;
      if (!isToday && !kitchenOrderIsCarryover(order, today)) return false;
      return kitchenOrderIsVisible(order, kitchenFilter, kitchenStatuses);
    })
    .sort(kitchenOrderStableSort);
  const orderSequences = kitchenOrderSequenceMap(orders);
  return `
    <div class="kitchen-toolbar">
      <button type="button" class="kitchen-availability-button" onclick="openStockPage()">
        <span class="availability-button-icon">${navIcon("products")}</span>
        <span><strong>Ketersediaan Barang</strong><small>${soldOutCount ? `${soldOutCount} item habis` : "Semua barang tersedia"}</small></span>
      </button>
      <div class="tabs kitchen-status-tabs">${filters.map(filter => `<button class="${filter === kitchenFilter ? "active" : ""}" onclick="kitchenFilter='${filter}'; render()">${filterLabels[filter]}${filter === "Pemberitahuan Takeaway" && pendingTakeawayNotices.length ? `<span class="kitchen-notice-count" aria-label="${pendingTakeawayNotices.length} menunggu kasir">${pendingTakeawayNotices.length}</span>` : ""}</button>`).join("")}</div>
    </div>
    <div class="grid grid-3">
      ${takeawayNotices.map(renderKitchenTakeawayNotice).join("") + orders.map(order => kitchenCard(order, orderSequences.get(order.id) || 0)).join("") || empty("Tidak ada pesanan pada filter ini.")}
    </div>
  `;
}
