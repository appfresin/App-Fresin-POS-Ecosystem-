(function () {
  "use strict";

  const TAKEAWAY_MODE = "TAKEAWAY";
  const TAKEAWAY_TYPE = "Take Away";
  const TAKEAWAY_ACTIVE_KEY = "so_takeaway_active_order";
  const TAKEAWAY_EXPIRY_MINUTES = 10;
  const TAKEAWAY_STATUS_REFRESH_MS = 20000;
  let soTakeawayStatusRefreshLoading = false;
  let soTakeawayStatusRefreshAt = 0;

  function soTakeawayUrlParams() {
    try {
      const search = new URLSearchParams(location.search || "");
      const hashQuery = String(location.hash || "").split("?")[1] || "";
      const hash = hashQuery ? new URLSearchParams(hashQuery) : new URLSearchParams();
      return { search, hash };
    } catch {
      return { search: new URLSearchParams(), hash: new URLSearchParams() };
    }
  }

  function soTakeawayIsMode() {
    const { search, hash } = soTakeawayUrlParams();
    const values = [
      search.get("type"),
      search.get("mode"),
      search.get("order_type"),
      search.get("orderType"),
      hash.get("type"),
      hash.get("mode"),
      hash.get("order_type"),
      hash.get("orderType")
    ].map(value => String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, ""));
    const path = String(location.pathname || "").toLowerCase();
    return values.includes("takeaway") || path.includes("takeaway");
  }

  function soTakeawayEscape(value) {
    return typeof escapeHtml === "function"
      ? escapeHtml(value)
      : String(value || "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[char]));
  }

  function soTakeawayMoney(value) {
    return typeof money === "function" ? money(value) : `Rp${Number(value || 0).toLocaleString("id-ID")}`;
  }

  function soTakeawayDateTime(value) {
    return typeof dateTime === "function" ? dateTime(value) : new Date(value || Date.now()).toLocaleString("id-ID");
  }

  function soTakeawayFormatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function soTakeawayIsPaid(order) {
    if (typeof orderIsPaid === "function") return orderIsPaid(order);
    return String(order?.paymentStatus || order?.payment_status || "").trim().toLowerCase() === "lunas";
  }

  function soTakeawayIsOrder(order) {
    if (!order) return false;
    if (order.orderMode === TAKEAWAY_MODE || order.takeawayNumber) return true;
    return order.type === TAKEAWAY_TYPE && String(order.source || "").toLowerCase().includes("self order");
  }

  function soTakeawayNumber(order) {
    return String(order?.takeawayNumber || order?.serviceInfo || order?.number || "").trim();
  }

  function soTakeawayExpiryMs(order) {
    const expiresAt = Date.parse(order?.takeawayExpiresAt || "");
    if (Number.isFinite(expiresAt)) return expiresAt;
    const createdAt = Date.parse(order?.createdAt || "");
    return Number.isFinite(createdAt) ? createdAt + TAKEAWAY_EXPIRY_MINUTES * 60 * 1000 : 0;
  }

  function soTakeawayIsExpired(order, now = Date.now()) {
    if (!soTakeawayIsOrder(order)) return false;
    if (order.takeawayStatus === "EXPIRED") return true;
    if (soTakeawayIsPaid(order) || order?.status === "Dibatalkan") return false;
    const expiresAt = soTakeawayExpiryMs(order);
    return Boolean(expiresAt && now >= expiresAt);
  }

  function soTakeawayPaymentWindowLabel(order, now = Date.now()) {
    if (soTakeawayIsPaid(order)) return "Lunas";
    if (soTakeawayIsExpired(order, now)) return "Habis";
    const expiresAt = soTakeawayExpiryMs(order);
    return expiresAt ? soTakeawayFormatDuration(expiresAt - now) : "-";
  }

  function soTakeawayPaymentWindowHtml(order) {
    const expiresAt = soTakeawayExpiryMs(order);
    const countdownAttr = expiresAt && !soTakeawayIsPaid(order) && !soTakeawayIsExpired(order)
      ? ` data-so-takeaway-countdown="${expiresAt}"`
      : "";
    return `<strong class="so-takeaway-payment-window"${countdownAttr}>${soTakeawayPaymentWindowLabel(order)}</strong>`;
  }

  function soTakeawayKitchenAccepted(order) {
    const status = String(order?.status || "").trim();
    return Boolean(
      status === "Sedang Disiapkan"
      || status === "Siap Diambil"
      || status === "Selesai"
      || order?.preparedAt
    );
  }

  function soTakeawayIsCompleted(order) {
    const status = String(order?.status || "").trim();
    return Boolean(status === "Selesai" || order?.completedAt);
  }

  function soTakeawayStatusLabel(order) {
    if (soTakeawayIsExpired(order)) return "KEDALUWARSA";
    if (soTakeawayIsPaid(order)) return "DIBAYAR";
    return "MENUNGGU PEMBAYARAN";
  }

  function soTakeawayGenerateNumber(orders = state.orders || []) {
    const max = orders
      .map(order => String(order.takeawayNumber || order.number || "").trim().match(/^T(\d{1,6})$/i))
      .filter(Boolean)
      .reduce((highest, match) => Math.max(highest, Number(match[1] || 0)), 0);
    return `T${String(max + 1).padStart(3, "0")}`;
  }

  function soTakeawayActiveOrder() {
    let stored = null;
    try {
      stored = JSON.parse(sessionStorage.getItem(TAKEAWAY_ACTIVE_KEY) || "null");
    } catch {
      sessionStorage.removeItem(TAKEAWAY_ACTIVE_KEY);
    }
    const order = (state.orders || []).find(item => (
      soTakeawayIsOrder(item)
      && !soTakeawayIsPaid(item)
      && item.status !== "Dibatalkan"
      && !soTakeawayIsExpired(item)
      && (
        item.id === stored?.id
        || item.number === stored?.number
        || item.takeawayNumber === stored?.takeawayNumber
      )
    ));
    if (!order) sessionStorage.removeItem(TAKEAWAY_ACTIVE_KEY);
    return order || null;
  }

  function soTakeawaySetActiveOrder(order) {
    sessionStorage.setItem(TAKEAWAY_ACTIVE_KEY, JSON.stringify({
      id: order.id,
      number: order.number,
      takeawayNumber: soTakeawayNumber(order)
    }));
  }

  function soTakeawayMarkSnapshot(order, checkoutTotal = null) {
    const total = Number.isFinite(Number(checkoutTotal)) ? Number(checkoutTotal) : orderTotal(order);
    sessionStorage.setItem("self_order_last_order", JSON.stringify({
      id: order?.id || "",
      number: order.number || soTakeawayNumber(order),
      takeawayNumber: soTakeawayNumber(order),
      checkoutTotal: total,
      total,
      orderTotal: orderTotal(order),
      paymentMethod: order.paymentMethod || "Bayar di Kasir",
      table: "Takeaway",
      customer: order.customer || "",
      orderMode: TAKEAWAY_MODE,
      status: order.takeawayStatus || (soTakeawayIsPaid(order) ? "PAID" : "WAITING_PAYMENT"),
      expiresAt: order.takeawayExpiresAt || "",
      items: (order.items || []).map(item => ({
        name: item.name || "Item",
        qty: Number(item.qty || 1),
        total: typeof cartItemTotal === "function" ? cartItemTotal(item) : Number(item.price || 0) * Number(item.qty || 1)
      }))
    }));
  }

  function soTakeawayLastSnapshot() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem("self_order_last_order") || "null");
      return parsed?.orderMode === TAKEAWAY_MODE ? parsed : null;
    } catch {
      return null;
    }
  }

  function soTakeawayFindOrder(snapshot = soTakeawayLastSnapshot()) {
    if (!snapshot) return null;
    const id = String(snapshot.id || "").trim();
    const number = String(snapshot.number || "").trim();
    const takeawayNumber = String(snapshot.takeawayNumber || "").trim();
    return (state.orders || []).find(order => (
      soTakeawayIsOrder(order)
      && (
        (id && order.id === id)
        || (number && order.number === number)
        || (takeawayNumber && soTakeawayNumber(order) === takeawayNumber)
      )
    )) || null;
  }

  function soTakeawayShouldRefreshStatus() {
    if (!soTakeawayIsMode()) return false;
    if (!(IS_SELF_ORDER_APP || view === "selforder")) return false;
    if (sessionStorage.getItem("self_order_step") !== "success") return false;
    const snapshot = soTakeawayLastSnapshot();
    if (!snapshot) return false;
    const order = soTakeawayFindOrder(snapshot);
    return !order || (!soTakeawayIsExpired(order) && !soTakeawayIsCompleted(order));
  }

  async function soTakeawayRefreshActiveOrderFromSupabase(options = {}) {
    if (!soTakeawayShouldRefreshStatus()) return false;
    if (typeof supabaseReadable !== "function" || !supabaseReadable() || !localDbReady || soTakeawayStatusRefreshLoading) return false;
    const now = Date.now();
    if (!options.force && now - soTakeawayStatusRefreshAt < TAKEAWAY_STATUS_REFRESH_MS) return false;
    const snapshot = soTakeawayLastSnapshot();
    const number = String(snapshot?.number || snapshot?.takeawayNumber || "").trim();
    if (!number) return false;
    soTakeawayStatusRefreshLoading = true;
    soTakeawayStatusRefreshAt = now;
    try {
      const { data: orderRows, error: orderError } = await supabaseClient
        .from("orders")
        .select("*")
        .or(`order_number.eq.${number},service_info.eq.${number}`)
        .order("updated_at", { ascending: false })
        .limit(1);
      if (orderError) throw orderError;
      const orderRow = (orderRows || [])[0];
      if (!orderRow?.id) return false;
      const [itemsResult, paymentsResult] = await Promise.all([
        supabaseClient.from("order_items").select("*").eq("order_id", orderRow.id).order("id", { ascending: true }),
        supabaseClient.from("payments").select("*").eq("order_id", orderRow.id).order("paid_at", { ascending: false }).limit(1)
      ]);
      if (itemsResult.error) throw itemsResult.error;
      if (paymentsResult.error) throw paymentsResult.error;
      let addonRows = [];
      const itemIds = (itemsResult.data || []).map(item => item.id).filter(Boolean);
      if (itemIds.length) {
        const { data, error } = await supabaseClient.from("order_item_addons").select("*").in("order_item_id", itemIds);
        if (error) throw error;
        addonRows = data || [];
      }
      const addonsByItemId = addonRows.reduce((map, addon) => {
        const list = map.get(addon.order_item_id) || [];
        list.push({
          id: addon.addon_id || addon.addon_name,
          name: addon.addon_name || "Tambahan",
          qty: Number(addon.qty || 1),
          price: Number(addon.price || 0),
          cost: Number(addon.cost || 0)
        });
        map.set(addon.order_item_id, list);
        return map;
      }, new Map());
      const liveOrder = normalizeSupabaseLiveOrder(
        orderRow,
        itemsResult.data || [],
        addonsByItemId,
        (paymentsResult.data || [])[0] || null
      );
      mergeSupabaseLiveOrders([liveOrder]);
      saveState();
      if (soTakeawayIsPaid(liveOrder) || soTakeawayKitchenAccepted(liveOrder) || soTakeawayIsCompleted(liveOrder)) render();
      return true;
    } catch (error) {
      console.warn("Takeaway status refresh failed", error);
      return false;
    } finally {
      soTakeawayStatusRefreshLoading = false;
    }
  }

  function soTakeawayPaymentIcon({ paid = false, expired = false } = {}) {
    if (expired) return "!";
    if (paid) return "&#10003;";
    return `
      <span class="so-takeaway-wallet-icon" aria-hidden="true">
        <span class="so-takeaway-wallet-body"></span>
        <span class="so-takeaway-wallet-card"></span>
        <span class="so-takeaway-wallet-dot"></span>
      </span>
    `;
  }

  function soTakeawayDetailHtml({ number, customer, total, statusText, order }) {
    return `
      <div class="self-order-success-detail so-takeaway-detail-card">
        <span><b>Nomor pesanan</b><strong class="so-takeaway-number-inline">${soTakeawayEscape(number)}</strong></span>
        <span><b>Nama pemesan</b><strong>${customer ? soTakeawayEscape(customer) : "-"}</strong></span>
        <span><b>Total pembayaran</b><strong>${soTakeawayMoney(total)}</strong></span>
        <span><b>Status</b><strong>${soTakeawayEscape(statusText)}</strong></span>
        <span><b>Masa bayar</b>${soTakeawayPaymentWindowHtml(order)}</span>
      </div>
    `;
  }

  function soTakeawayUpdateCountdowns() {
    const nodes = document.querySelectorAll("[data-so-takeaway-countdown]");
    if (!nodes.length) return;
    let shouldRender = false;
    nodes.forEach(node => {
      const expiresAt = Number(node.getAttribute("data-so-takeaway-countdown") || 0);
      const remaining = expiresAt - Date.now();
      node.textContent = soTakeawayFormatDuration(remaining);
      if (remaining <= 0) shouldRender = true;
    });
    if (shouldRender && soTakeawayExpireWaitingOrders()) render();
  }

  function soTakeawayStartNewOrder(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    sessionStorage.removeItem(TAKEAWAY_ACTIVE_KEY);
    sessionStorage.removeItem("self_order_last_order");
    sessionStorage.removeItem("self_order_checkout_note");
    sessionStorage.removeItem("self_order_payment");
    sessionStorage.setItem("self_order_step", "menu");
    if (typeof pushSelfOrderHistory === "function") pushSelfOrderHistory("menu");
    selfOrderCart = [];
    saveSelfOrderCart();
    render();
    window.setTimeout(() => window.scrollTo?.({ top: 0, behavior: "smooth" }), 0);
  }

  function soTakeawayHandleNewOrderClick(event) {
    const button = event.target?.closest?.("[data-so-takeaway-new-order]");
    if (!button) return;
    soTakeawayStartNewOrder(event);
  }

  function soTakeawayStatusBar({ paid = false, expired = false, processing = false, completed = false } = {}) {
    const steps = expired
      ? [
        ["expired", "Kedaluwarsa", "Waktu pembayaran sudah habis.", true, "!"],
        ["payment", "Pembayaran", "Silakan buat pesanan baru.", false, "2"],
        ["process", "Proses", "Pesanan belum diproses.", false, "3"]
      ]
      : [
        ["payment", paid ? "Pembayaran diterima" : "Menunggu pembayaran", paid ? "Kasir sudah menerima pembayaran." : "Tunjukkan halaman ini ke kasir untuk membayar.", true, paid ? "&#10003;" : "1"],
        ["process", processing ? "Diproses" : "Menunggu diproses", processing ? "Pesanan sedang disiapkan." : "Pesanan masuk antrean setelah pembayaran diterima.", paid, processing ? "&#10003;" : "2"],
        ["done", "Selesai", completed ? "Pesanan sudah selesai." : "Tunggu sampai pesanan siap diambil.", completed, completed ? "&#10003;" : "3"]
      ];
    return `
      <div class="so-takeaway-statusbar ${paid ? "is-paid" : ""} ${processing ? "is-processing" : ""} ${completed ? "is-completed" : ""} ${expired ? "is-expired" : ""}" aria-label="Status pesanan">
        ${steps.map(([id, label, description, active, icon]) => `
          <span class="${active ? "active" : ""}" data-step="${soTakeawayEscape(id)}">
            <i aria-hidden="true">${icon}</i>
            <b>${soTakeawayEscape(label)}</b>
            <small>${soTakeawayEscape(description)}</small>
          </span>
        `).join("")}
      </div>
    `;
  }

  function soTakeawayExpireWaitingOrders() {
    const now = Date.now();
    const expired = (state.orders || []).filter(order => soTakeawayIsExpired(order, now) && order.status !== "Dibatalkan");
    if (!expired.length) return false;
    expired.forEach(order => {
      order.takeawayStatus = "EXPIRED";
      order.status = "Dibatalkan";
      order.cancelledAt = order.cancelledAt || new Date(now).toISOString();
      order.cancelReason = order.cancelReason || "Pesanan Takeaway kedaluwarsa otomatis karena belum dibayar.";
      if (typeof restoreLimitedStockCommit === "function") {
        restoreLimitedStockCommit(order.number).catch(error => console.warn("Takeaway stock restore failed", error));
      }
      if (typeof syncOrderToSupabase === "function") {
        syncOrderToSupabase(order, { silent: true }).catch(error => console.warn("Takeaway expiry sync failed", error));
      }
    });
    saveState();
    return true;
  }

  function soTakeawayPrimeMode() {
    if (!soTakeawayIsMode()) return;
    sessionStorage.removeItem("self_order_table");
  }

  function soTakeawayRenderPayment() {
    sessionStorage.setItem("self_order_payment", "cash");
    const activeOrder = soTakeawayActiveOrder();
    const customer = sessionStorage.getItem("self_order_customer") || "";
    const note = sessionStorage.getItem("self_order_checkout_note") || "";
    const submitLabel = selfOrderSubmitting
      ? `<span class="self-order-btn-spinner" aria-hidden="true"></span><span>Mengirim pesanan</span>`
      : "Buat Pesanan";
    return `
      <main class="self-order-main payment so-takeaway-payment">
        <div class="self-order-section-head">
          <div><span>Takeaway</span><h3>Total ${soTakeawayMoney(selfOrderSubtotal())}</h3></div>
        </div>
        ${activeOrder ? `
          <section class="so-takeaway-active-card">
            <span>Anda masih memiliki pesanan yang menunggu pembayaran.</span>
            <strong>${soTakeawayEscape(soTakeawayNumber(activeOrder))}</strong>
            <button class="self-order-primary" type="button" onclick="SOTakeaway.showActiveOrder()">Lihat Pesanan</button>
          </section>
        ` : ""}
        <section class="self-order-payment-shell">
          <div class="self-order-checkout">
            <label class="self-order-customer-field">
              <span>Nama Pemesan</span>
              <input id="selfOrderCustomer" value="${soTakeawayEscape(customer)}" placeholder="Wajib" required aria-required="true" aria-describedby="selfOrderCustomerError" oninput="sessionStorage.setItem('self_order_customer', this.value); selfOrderClearCustomerError(this)" />
              <small id="selfOrderCustomerError" class="self-order-customer-error" role="alert" hidden>Nama wajib diisi.</small>
            </label>
            <label class="wide"><span>Catatan</span><textarea id="selfOrderCheckoutNote" placeholder="Opsional" oninput="sessionStorage.setItem('self_order_checkout_note', this.value)">${soTakeawayEscape(note)}</textarea></label>
          </div>
        </section>
        ${typeof renderSelfOrderUpsellCard === "function" ? renderSelfOrderUpsellCard("payment") : ""}
        <button class="self-order-primary self-order-finish" type="button" onclick="selfOrderCreateOrder()" ${selfOrderSubmitting ? `disabled aria-busy="true"` : ""}>${submitLabel}</button>
        ${selfOrderSubmitError ? `<p class="self-order-submit-error" role="alert">${soTakeawayEscape(selfOrderSubmitError)}</p>` : ""}
      </main>
    `;
  }

  function soTakeawayRenderSuccess() {
    const snapshot = soTakeawayLastSnapshot();
    if (!snapshot) return null;
    const liveOrder = soTakeawayFindOrder(snapshot);
    const order = liveOrder || snapshot;
    const paid = soTakeawayIsPaid(order) || String(order.status || snapshot.status || "") === "PAID";
    const expired = soTakeawayIsExpired(order) || String(order.status || snapshot.status || "") === "EXPIRED";
    const processing = soTakeawayKitchenAccepted(order);
    const completed = soTakeawayIsCompleted(order);
    const number = String(soTakeawayNumber(order) || snapshot.takeawayNumber || snapshot.number || "-").trim();
    const customer = String(order.customer || snapshot.customer || "").trim();
    const total = liveOrder ? orderTotal(liveOrder) : Number(snapshot.checkoutTotal ?? snapshot.total ?? 0);
    const title = expired
      ? "Pesanan telah kedaluwarsa"
      : paid
        ? "Pesanan berhasil dibuat"
        : "Mohon melakukan pembayaran";
    const note = expired
      ? "Silakan buat pesanan baru jika masih ingin melakukan pemesanan."
      : paid
        ? "Pembayaran telah diterima kasir. Pesanan anda sedang masuk antrean proses."
        : "";
    const instruction = expired
      ? ""
      : paid
        ? ""
        : "Tunjukkan halaman ini kepada kasir dalam melakukan pembayaran sebelum masa bayar habis.";
    const statusText = expired ? "Kedaluwarsa" : completed ? "Selesai" : processing ? "Diproses Dapur" : paid ? "Pembayaran Diterima" : "Menunggu Pembayaran";
    return `
      <main class="self-order-main success so-takeaway-success">
        <section class="self-order-success-card so-takeaway-status-card ${paid ? "is-paid" : "is-pending"} ${expired ? "is-expired" : ""}">
          <div class="so-takeaway-mark ${expired ? "expired" : paid ? "paid" : "pending"}" aria-hidden="true">${soTakeawayPaymentIcon({ paid, expired })}</div>
          <h2>${soTakeawayEscape(title)}</h2>
          ${note ? `<p>${soTakeawayEscape(note)}</p>` : ""}
          ${instruction ? `<p class="so-takeaway-cashier-note">${soTakeawayEscape(instruction)}</p>` : ""}
          ${soTakeawayDetailHtml({ number, customer, total, statusText, order })}
          ${soTakeawayStatusBar({ paid, expired, processing, completed })}
          <button class="self-order-primary so-takeaway-new-order-btn" type="button" data-so-takeaway-new-order="1" onclick="window.SOTakeaway.newOrder(event)">Pesan Lagi</button>
        </section>
      </main>
    `;
  }

  async function soTakeawayCreateOrder() {
    if (selfOrderSubmitting) return;
    if (!state.cashSession.open) return toast("Kas belum dibuka. Minta bantuan staff.");
    if (!selfOrderCart.length) return toast("Keranjang masih kosong.");

    const existingActiveOrder = soTakeawayActiveOrder();
    if (existingActiveOrder) {
      soTakeawayMarkSnapshot(existingActiveOrder);
      sessionStorage.setItem("self_order_step", "success");
      pushSelfOrderHistory("success");
      render();
      return;
    }

    selfOrderSubmitError = "";
    const customerInput = document.getElementById("selfOrderCustomer");
    const customer = String(customerInput?.value || sessionStorage.getItem("self_order_customer") || "").trim();
    if (!customer) return selfOrderShowCustomerError(customerInput);
    if (!canAttemptSupabaseSync()) {
      selfOrderSubmitError = "Self Order Takeaway membutuhkan koneksi internet. Periksa koneksi lalu coba lagi.";
      render();
      return;
    }

    let renderedCompletion = false;
    selfOrderSubmitting = true;
    try {
      sessionStorage.setItem("self_order_payment", "cash");
      render();
      await new Promise(resolve => window.setTimeout(resolve, 0));
      const subtotal = selfOrderSubtotal();
      const checkoutTotal = subtotal;
      const note = String(document.getElementById("selfOrderCheckoutNote")?.value || sessionStorage.getItem("self_order_checkout_note") || "").trim();
      const orderCreatedAt = await getSupabaseServerTimeIso();
      const takeawayNumber = soTakeawayGenerateNumber();
      const orderItems = tagOrderBatchItems(selfOrderCart.map(item => ({ ...item })), 1, note, orderCreatedAt);
      const order = {
        id: uid(),
        number: takeawayNumber,
        source: "Self Order",
        type: "Take Away",
        orderMode: TAKEAWAY_MODE,
        takeawayNumber,
        takeawayStatus: "WAITING_PAYMENT",
        takeawayExpiresAt: new Date(Date.parse(orderCreatedAt) + TAKEAWAY_EXPIRY_MINUTES * 60 * 1000).toISOString(),
        customer,
        serviceInfo: takeawayNumber,
        note,
        status: "Pesanan Baru",
        paymentStatus: "Belum dibayar",
        paymentMethod: "Bayar di Kasir",
        receivedAmount: 0,
        changeAmount: 0,
        printReceipt: false,
        items: orderItems,
        subtotal,
        discount: 0,
        tax: 0,
        serviceFee: 0,
        deliveryFee: 0,
        grandTotal: subtotal,
        createdAt: orderCreatedAt,
        updatedAt: orderCreatedAt,
        confirmedAt: null,
        preparedAt: null,
        readyAt: null,
        completedAt: null,
        cancelledAt: null,
        preparedItems: {}
      };
      const stockValidation = validateLimitedStockItems(orderItems);
      if (!stockValidation.ok) {
        selfOrderSubmitError = limitedStockMessage(stockValidation.product, stockValidation.variantKey, stockValidation.available);
        return;
      }
      const stockCommit = await commitLimitedStockReservations(orderItems, order.number, "Self Order");
      if (!stockCommit.accepted) {
        const failedProduct = stockCommit.product || stockValidation.product;
        selfOrderSubmitError = limitedStockFailureMessage(failedProduct, stockCommit.variantKey || "", stockCommit);
        return;
      }
      order.limitedStockCommitToken = stockCommit.token || "";
      state.orders.unshift(order);
      saveState();
      const synced = await syncOrderToSupabase(order, { silent: true });
      if (!synced) {
        if (stockCommit.token) await restoreLimitedStockCommit(order.number);
        state.orders = state.orders.filter(item => item.id !== order.id);
        state.syncQueue = (state.syncQueue || []).filter(item => item.orderId !== orderSyncQueueId(order));
        saveState();
        selfOrderSubmitError = "Gagal mengirim pesanan, cek koneksi anda lalu coba lagi";
        return;
      }
      audit("Self order takeaway dibuat", `${order.number} ${order.customer} ${soTakeawayMoney(orderTotal(order))}`);
      selfOrderCart = [];
      saveSelfOrderCart();
      sessionStorage.removeItem("self_order_customer");
      sessionStorage.removeItem("self_order_checkout_note");
      soTakeawaySetActiveOrder(order);
      soTakeawayMarkSnapshot(order, checkoutTotal);
      sessionStorage.setItem("self_order_step", "success");
      pushSelfOrderHistory("success");
      saveState();
      rotateLimitedStockReservationToken("Self Order");
      await loadMasterDataFromSupabase({ reason: "so-takeaway-submit", force: true, silent: true });
      broadcastRealtimeEvent("orders");
      broadcastRealtimeEvent("products");
      render();
      renderedCompletion = true;
    } catch (error) {
      console.error("Self order takeaway submit failed", error);
      selfOrderSubmitError = error?.userMessage || "Gagal mengirim pesanan, cek koneksi anda lalu coba lagi";
    } finally {
      selfOrderSubmitting = false;
      if (!renderedCompletion) render();
    }
  }

  function soTakeawayOrderCard(order, options = {}) {
    const qty = (order.items || []).reduce((sum, item) => sum + Number(item.qty || 0), 0);
    const expanded = sessionStorage.getItem(`orders_expanded_${order.id}`) === "1";
    const statusLabel = soTakeawayStatusLabel(order);
    const header = `TAKEAWAY · ${soTakeawayNumber(order)}`;
    const deleteAction = typeof canDeleteOrderCard === "function" && canDeleteOrderCard(order)
      ? `<button class="btn red" type="button" onclick="event.preventDefault(); event.stopPropagation(); openDeleteOrderDialog('${order.id}')">Hapus</button>`
      : "";
    if (options.compactUnpaid && !expanded) {
      return `
        <article class="orders-card unpaid-compact-card so-takeaway-card" onclick="toggleOrderItems('${order.id}', true)">
          <div class="unpaid-compact-head">
            <strong>${soTakeawayEscape(header)}</strong>
            <b>${soTakeawayMoney(orderTotal(order))}</b>
          </div>
          <div class="unpaid-compact-meta">
            <span>${soTakeawayEscape(customerDisplayName(order.customer) || "-")}</span>
            <span>${qty} item</span>
            <span class="so-takeaway-badge">${soTakeawayEscape(statusLabel)}</span>
          </div>
          <button class="btn green so-takeaway-pay-btn" type="button" onclick="event.preventDefault(); event.stopPropagation(); payUnpaidOrder('${order.id}')">Bayar</button>
          ${deleteAction}
        </article>
      `;
    }
    const itemPreview = (order.items || []).map(item => `
      <div class="orders-item-line">
        <span><b>${soTakeawayEscape(orderItemInlineLabel(item))}</b>${orderItemNoteHtml(item, "orders-item-note")}</span>
        <strong>${soTakeawayMoney(cartItemTotal(item))}</strong>
      </div>
    `).join("");
    const actions = [
      order.paymentStatus !== "Lunas" && order.status !== "Dibatalkan"
        ? `<button class="btn green" type="button" onclick="event.preventDefault(); event.stopPropagation(); payUnpaidOrder('${order.id}')">Bayar</button>`
        : "",
      deleteAction
    ].filter(Boolean).join("");
    return `
      <article class="orders-card unpaid-detail-card so-takeaway-card ${expanded ? "is-expanded" : ""}" ${options.returnToUnpaid ? `onclick="toggleOrderItems('${order.id}', true)"` : ""}>
        <div class="orders-card-head">
          <div>
            <div class="order-title-row"><strong>${soTakeawayEscape(header)}</strong></div>
            <span>${soTakeawayDateTime(order.createdAt)}</span>
          </div>
          <span class="orders-status-pill ready">${soTakeawayEscape(statusLabel)}</span>
        </div>
        <div class="orders-card-meta">
          <span>Takeaway</span>
          <span>${soTakeawayEscape(customerDisplayName(order.customer) || "-")}</span>
          <span>${qty} item</span>
          <span>${soTakeawayMoney(orderTotal(order))}</span>
        </div>
        <div class="orders-card-items">${itemPreview || `<span class="muted">Belum ada rincian item.</span>`}</div>
        ${actions ? `<div class="orders-card-actions">${actions}</div>` : ""}
      </article>
    `;
  }

  function soTakeawayInstall() {
    soTakeawayPrimeMode();

    const baseRenderSelfOrderTopbar = renderSelfOrderTopbar;
    renderSelfOrderTopbar = function () {
      if (!soTakeawayIsMode()) return baseRenderSelfOrderTopbar();
      const appName = state.settings.selfOrderAppName || state.settings.receiptStoreName || "Kasirin Cafe";
      const outletName = state.settings.selfOrderOutletName || state.outlet || "Outlet Utama";
      const profileImage = String(state.settings.selfOrderProfileImageDataUrl || state.settings.receiptLogoDataUrl || "").trim();
      return `
        <header class="self-order-topbar so-takeaway-topbar">
          <button type="button" class="self-order-icon-btn ${profileImage ? "has-photo" : ""}" onclick="selfOrderShowMenu()" aria-label="Menu">
            ${profileImage ? mediaImageTag(profileImage, "Foto profil self order", "", 240) : navIcon("selforder")}
          </button>
          <div>
            <strong>${soTakeawayEscape(appName)}</strong>
            <span>${soTakeawayEscape(outletName)}</span>
          </div>
          <label class="self-order-table">
            <span>Mode</span>
            <strong>Takeaway</strong>
          </label>
        </header>
      `;
    };

    const baseRenderSelfOrderPayment = renderSelfOrderPayment;
    renderSelfOrderPayment = function () {
      return soTakeawayIsMode() ? soTakeawayRenderPayment() : baseRenderSelfOrderPayment();
    };

    const baseRenderSelfOrderSuccess = renderSelfOrderSuccess;
    renderSelfOrderSuccess = function () {
      const takeawaySuccess = soTakeawayRenderSuccess();
      return takeawaySuccess || baseRenderSelfOrderSuccess();
    };

    const baseSelfOrderShowPayment = selfOrderShowPayment;
    selfOrderShowPayment = async function () {
      if (!soTakeawayIsMode()) return baseSelfOrderShowPayment();
      if (!selfOrderCart.length) return toast("Keranjang masih kosong.");
      const stockReady = await ensureLimitedStockCartReservations(selfOrderCart, "Self Order");
      if (!stockReady.ok) {
        return toast(limitedStockFailureMessage(stockReady.product, stockReady.variantKey, stockReady));
      }
      sessionStorage.setItem("self_order_step", "payment");
      pushSelfOrderHistory("payment");
      render();
    };

    const baseSelfOrderCreateOrder = selfOrderCreateOrder;
    selfOrderCreateOrder = async function () {
      return soTakeawayIsMode() ? soTakeawayCreateOrder() : baseSelfOrderCreateOrder();
    };

    const baseOpenHeldOrders = openHeldOrders;
    openHeldOrders = function (options = {}) {
      if (soTakeawayExpireWaitingOrders()) render();
      return baseOpenHeldOrders(options);
    };

    const baseUnpaidOrders = unpaidOrders;
    unpaidOrders = function () {
      soTakeawayExpireWaitingOrders();
      return baseUnpaidOrders().filter(order => !soTakeawayIsOrder(order) || !soTakeawayIsExpired(order));
    };

    const baseOrderCenterCard = orderCenterCard;
    orderCenterCard = function (order, options = {}) {
      if (soTakeawayIsOrder(order)) return soTakeawayOrderCard(order, options);
      return baseOrderCenterCard(order, options);
    };

    const basePayUnpaidOrder = payUnpaidOrder;
    payUnpaidOrder = function (id) {
      const order = state.orders.find(item => item.id === id);
      if (!soTakeawayIsOrder(order)) return basePayUnpaidOrder(id);
      cart = (order.items || []).map(item => ({ ...item }));
      clearPosDraft();
      sessionStorage.setItem("pos_pay_unpaid_id", id);
      sessionStorage.setItem("pos_order_type", TAKEAWAY_TYPE);
      sessionStorage.setItem("pos_customer_name", order.customer || "");
      sessionStorage.setItem("pos_service_info", soTakeawayNumber(order));
      sessionStorage.setItem("pos_order_note", order.note || "");
      sessionStorage.setItem("pos_cart_step", "payment");
      sessionStorage.setItem("pos_mobile_view", "cart");
      sessionStorage.setItem("so_takeaway_paying_id", id);
      closeModal({ skipHistory: true });
      view = "pos";
      setAppHash("pos", { replace: true });
      render();
    };

    const baseSubmitOrder = submitOrder;
    submitOrder = async function () {
      const payingId = sessionStorage.getItem("pos_pay_unpaid_id");
      const existingOrder = payingId ? state.orders.find(item => item.id === payingId) : null;
      const wasTakeawayPayment = soTakeawayIsOrder(existingOrder);
      const result = await baseSubmitOrder();
      if (wasTakeawayPayment && existingOrder.paymentStatus === "Lunas") {
        existingOrder.status = "Pesanan Baru";
        existingOrder.paymentStatus = "Lunas";
        existingOrder.takeawayStatus = "PAID";
        existingOrder.confirmedAt = existingOrder.confirmedAt || new Date().toISOString();
        existingOrder.serviceInfo = soTakeawayNumber(existingOrder);
        saveState();
        syncOrderToSupabase(existingOrder, { silent: true }).catch(error => console.warn("Takeaway paid sync failed", error));
        broadcastRealtimeEvent("orders");
      }
      return result;
    };

    if (typeof renderKitchen === "function") {
      const baseRenderKitchen = renderKitchen;
      renderKitchen = function () {
        soTakeawayExpireWaitingOrders();
        return baseRenderKitchen();
      };
    }

    if (typeof kitchenOrderIsVisible === "function") {
      const baseKitchenOrderIsVisible = kitchenOrderIsVisible;
      kitchenOrderIsVisible = function (order, filter, visibleStatuses) {
        if (soTakeawayIsOrder(order) && !soTakeawayIsPaid(order)) return false;
        return baseKitchenOrderIsVisible(order, filter, visibleStatuses);
      };
    }

    if (typeof kitchenOrderHasSequence === "function") {
      const baseKitchenOrderHasSequence = kitchenOrderHasSequence;
      kitchenOrderHasSequence = function (order) {
        if (soTakeawayIsOrder(order) && !soTakeawayIsPaid(order)) return false;
        return baseKitchenOrderHasSequence(order);
      };
    }

    const baseOrderDisplayTitle = orderDisplayTitle;
    orderDisplayTitle = function (order) {
      if (!soTakeawayIsOrder(order)) return baseOrderDisplayTitle(order);
      const number = soTakeawayNumber(order);
      const customer = customerDisplayName(order?.customer);
      return customer ? `TAKEAWAY · ${number} - ${customer}` : `TAKEAWAY · ${number}`;
    };

    const baseCompactOrderStatus = compactOrderStatus;
    compactOrderStatus = function (status) {
      if (status === "Menunggu Pembayaran") return { label: "Menunggu Bayar", className: "ready" };
      return baseCompactOrderStatus(status);
    };

    const baseOrderPushNotificationCategories = orderPushNotificationCategories;
    orderPushNotificationCategories = function (order = {}) {
      if (soTakeawayIsOrder(order) && !soTakeawayIsPaid(order)) return [];
      return baseOrderPushNotificationCategories(order);
    };

    const baseNotifyNativePushForOrder = notifyNativePushForOrder;
    notifyNativePushForOrder = async function (order, options = {}) {
      if (soTakeawayIsOrder(order) && !soTakeawayIsPaid(order)) return false;
      return baseNotifyNativePushForOrder(order, options);
    };

    if (typeof detectNewIncomingOrders === "function") {
      const baseDetectNewIncomingOrders = detectNewIncomingOrders;
      detectNewIncomingOrders = function (orders = [], previousKeys = orderNotificationKnownKeys) {
        return baseDetectNewIncomingOrders(orders, previousKeys)
          .filter(order => !soTakeawayIsOrder(order) || soTakeawayIsPaid(order));
      };
    }

    window.SOTakeaway = {
      isMode: soTakeawayIsMode,
      isOrder: soTakeawayIsOrder,
      showActiveOrder() {
        const order = soTakeawayActiveOrder();
        if (!order) return toast("Tidak ada pesanan Takeaway aktif.");
        soTakeawayMarkSnapshot(order);
        sessionStorage.setItem("self_order_step", "success");
        pushSelfOrderHistory("success");
        render();
      },
      newOrder: soTakeawayStartNewOrder,
      expireWaitingOrders: soTakeawayExpireWaitingOrders
    };

    if (!window.__soTakeawayNewOrderClickBound) {
      document.addEventListener("click", soTakeawayHandleNewOrderClick);
      window.__soTakeawayNewOrderClickBound = true;
    }

    if (soTakeawayIsMode() && (IS_SELF_ORDER_APP || view === "selforder")) {
      window.setTimeout(() => render(), 0);
    }

    if (!window.__soTakeawayCountdownTimer) {
      window.__soTakeawayCountdownTimer = window.setInterval(soTakeawayUpdateCountdowns, 1000);
      window.setTimeout(soTakeawayUpdateCountdowns, 0);
    }

    if (!window.__soTakeawayStatusRefreshTimer) {
      window.__soTakeawayStatusRefreshTimer = window.setInterval(soTakeawayRefreshActiveOrderFromSupabase, TAKEAWAY_STATUS_REFRESH_MS);
      window.setTimeout(() => soTakeawayRefreshActiveOrderFromSupabase({ force: true }), 1200);
    }
  }

  if (typeof renderSelfOrderTopbar === "function") {
    soTakeawayInstall();
  } else {
    window.addEventListener("load", soTakeawayInstall, { once: true });
  }
}());
