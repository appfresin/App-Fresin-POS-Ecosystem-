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
  if (cancelled) return false;
  if (typeof orderVisibleInPosOrderList === "function" && !orderVisibleInPosOrderList(order)) return false;
  return filter === "Semua" ? visibleStatuses.includes(order.status) : order.status === filter;
}

function renderKitchen() {
  const today = todayKey();
  const filters = ["Semua", "Pesanan Baru", "Sedang Disiapkan", "Selesai"];
  const filterLabels = {
    "Semua": "Semua",
    "Pesanan Baru": "Baru",
    "Sedang Disiapkan": "Diproses",
    "Selesai": "Selesai"
  };
  if (!filters.includes(kitchenFilter)) kitchenFilter = "Semua";
  const soldOutCount = typeof stockSoldOutCount === "function"
    ? stockSoldOutCount()
    : state.products.filter(product => product.soldOut).length;
  const kitchenStatuses = ["Pesanan Baru", "Sedang Disiapkan", "Selesai"];
  const orders = state.orders
    .filter(order => {
      const isToday = todayKey(new Date(order.createdAt || Date.now())) === today;
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
      <div class="tabs kitchen-status-tabs">${filters.map(filter => `<button class="${filter === kitchenFilter ? "active" : ""}" onclick="kitchenFilter='${filter}'; render()">${filterLabels[filter]}</button>`).join("")}</div>
    </div>
    <div class="grid grid-3">
      ${orders.map(order => kitchenCard(order, orderSequences.get(order.id) || 0)).join("") || empty("Tidak ada pesanan pada filter ini.")}
    </div>
  `;
}
