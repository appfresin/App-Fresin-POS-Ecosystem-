(function () {
  "use strict";

  const TAKEAWAY_MODE = "TAKEAWAY";
  const TAKEAWAY_TYPE = "Take Away";
  const TAKEAWAY_ACTIVE_KEY = "so_takeaway_active_order";
  const TAKEAWAY_STATUS_REFRESH_MS = 20000;
  const soTakeawayProcessingIds = new Set();
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

  function soTakeawayIsPaid(order) {
    if (typeof orderIsPaid === "function") return orderIsPaid(order);
    return String(order?.paymentStatus || order?.payment_status || "").trim().toLowerCase() === "lunas";
  }

  function soTakeawayIsOrder(order) {
    if (!order) return false;
    if (typeof orderUsesOutletPayment === "function" && orderUsesOutletPayment(order)) return true;
    if (order.orderMode === TAKEAWAY_MODE || order.takeawayNumber) return true;
    if (typeof orderIsCustomerHomeOrder === "function" && orderIsCustomerHomeOrder(order)) return false;
    return order.type === TAKEAWAY_TYPE && String(order.source || "").toLowerCase().includes("self order");
  }

  function soTakeawayNumber(order) {
    if (typeof orderUsesOutletPayment === "function" && orderUsesOutletPayment(order)) return String(order.number || "").trim();
    return String(order?.takeawayNumber || order?.serviceInfo || order?.number || "").trim();
  }

  function soTakeawayIsExpired(order) {
    if (!soTakeawayIsOrder(order)) return false;
    return order.takeawayStatus === "EXPIRED";
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
    if (order?.status === "Dibatalkan") return "DIBATALKAN";
    if (soTakeawayIsCompleted(order)) return "SELESAI";
    if (soTakeawayKitchenAccepted(order)) return "DIPROSES DAPUR";
    return soTakeawayIsReleasedToKitchen(order) ? "DITERIMA KASIR" : "MENUNGGU KASIR";
  }

  function soTakeawayIsReleasedToKitchen(order) {
    return Boolean(order?.confirmedAt || soTakeawayKitchenAccepted(order));
  }

  function soTakeawayCanProcessOrder(order) {
    return !IS_SELF_ORDER_APP && Boolean(activeStaff()) && canAccessView("orders")
      && soTakeawayIsOrder(order) && order.status === "Pesanan Baru"
      && (typeof orderVisibleInPosOrderList !== "function" || orderVisibleInPosOrderList(order))
      && !order.cancelledAt && !soTakeawayIsExpired(order) && !soTakeawayIsReleasedToKitchen(order);
  }

  async function soTakeawayProcessOrder(id) {
    const order = (state.orders || []).find(item => item.id === id);
    if (!soTakeawayCanProcessOrder(order) || soTakeawayProcessingIds.has(id)) return;
    if (!order.items?.length) return toast("Rincian pesanan belum tersedia. Muat ulang pesanan terlebih dahulu.", 4800);
    if (orderHasPendingLocalSync(order)) return toast("Pesanan masih menunggu sinkronisasi. Coba lagi setelah tersinkron.", 4800);
    if (!canAttemptSupabaseSync()) return toast("Periksa koneksi internet sebelum memproses pesanan.", 4800);
    soTakeawayProcessingIds.add(id);
    render();
    let releaseLock;
    try {
      releaseLock = await acquireOrderSyncLock(order);
      await ensureSupabaseProfile();
      // Only acknowledge cashier acceptance; never rewrite payment, items or kitchen progress.
      const now = new Date().toISOString();
      let query = supabaseClient.from("orders").update({ confirmed_at: now, updated_at: now });
      query = order.supabaseId ? query.eq("id", order.supabaseId) : query.eq("order_number", order.number);
      const { data, error } = await query.eq("status", "Pesanan Baru")
        .is("cancelled_at", null).is("confirmed_at", null)
        .select("id,confirmed_at").maybeSingle();
      if (error) throw error;
      if (!data?.confirmed_at) {
        toast("Pesanan telah berubah di perangkat lain. Muat ulang daftar pesanan.", 4800);
        return;
      }
      const currentOrder = (state.orders || []).find(item => item.id === id) || order;
      currentOrder.confirmedAt = data.confirmed_at;
      currentOrder.updatedAt = now;
      currentOrder.supabaseId = data.id;
      audit("Takeaway diterima kasir", order.number);
      saveState();
      broadcastRealtimeEvent("orders");
      toast("Pesanan diterima dan dikirim ke dapur. Pembayaran bisa dilakukan nanti.", 3600);
      notifyNativePushForOrder(currentOrder, { eventType: "new_order" })
        .catch(error => console.warn("Takeaway acceptance notification failed", error));
    } catch (error) {
      console.warn("Takeaway acceptance failed", error);
      toast("Pesanan belum berhasil diproses. Periksa koneksi lalu coba lagi.", 4800);
    } finally {
      if (releaseLock) releaseLock();
      soTakeawayProcessingIds.delete(id);
      render();
    }
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
        (stored?.id && item.id === stored.id)
        || (stored?.number && item.number === stored.number)
        || (stored?.takeawayNumber && soTakeawayNumber(item) === stored.takeawayNumber)
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
    const total = checkoutTotal !== null && Number.isFinite(Number(checkoutTotal)) ? Number(checkoutTotal) : orderTotal(order);
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
      status: order.status,
      paymentStatus: order.paymentStatus,
      confirmedAt: order.confirmedAt || null,
      preparedAt: order.preparedAt || null,
      completedAt: order.completedAt || null,
      takeawayStatus: order.takeawayStatus || "WAITING_ACCEPTANCE",
      expiresAt: "",
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
    return !order || (!soTakeawayIsExpired(order) && !(soTakeawayIsCompleted(order) && soTakeawayIsPaid(order)));
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
      render();
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

  function soTakeawayDetailHtml({ number, customer, total, order, paymentCopy = "" }) {
    const delivery = String(order.customerOrderType || order.orderMode || order.customer_order_type || "").toUpperCase() === "DELIVERY" || order.type === "Delivery";
    const deliveryFee = Math.max(0, Number(order.deliveryFee ?? order.delivery_fee ?? 0) || 0);
    const productTotal = Math.max(0, (Number(total) || 0) - deliveryFee);
    return `
      <div class="self-order-success-detail so-takeaway-detail-card">
        <span><b>Nomor pesanan</b><strong class="so-takeaway-number-inline">${soTakeawayEscape(number)}</strong></span>
        <span><b>Nama pemesan</b><strong class="so-takeaway-customer-copy">${customer ? soTakeawayEscape(customer) : "-"}</strong></span>
        ${delivery ? `<span><b>Nominal pesanan</b><strong class="so-takeaway-detail-copy">${soTakeawayMoney(productTotal)}</strong></span><span><b>Nominal ongkir</b><strong class="so-takeaway-detail-copy">${soTakeawayMoney(deliveryFee)}</strong></span>` : ""}
        ${order.pickupTime ? `<span><b>Jam pengambilan</b><strong class="so-takeaway-pickup-copy">${soTakeawayEscape(order.pickupTime === "Secepatnya" ? "Sekarang" : order.pickupTime)}</strong></span>` : ""}
        <span class="so-takeaway-total-row"><b>Total pembayaran</b><strong>${soTakeawayMoney(total)}</strong></span>
        <span><b>Pembayaran</b><strong class="so-takeaway-payment-copy">${paymentCopy ? soTakeawayEscape(paymentCopy) : soTakeawayIsPaid(order) ? "Lunas" : "Nanti di kasir"}</strong></span>
      </div>
    `;
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

  function soTakeawayResultHero({ title, note, tone = "waiting" }) {
    const cancelled = tone === "cancelled";
    return `<header class="so-takeaway-result-hero is-${soTakeawayEscape(tone)}">
      <span class="so-takeaway-result-spark" aria-hidden="true">✦</span>
      <div class="so-takeaway-result-heading">
        ${cancelled ? `<div class="so-takeaway-success-icon icon-asik is-cancelled" aria-hidden="true"><svg viewBox="0 0 96 96" fill="none"><circle cx="44" cy="45" r="36" fill="#fff1d8"/><path d="M12 44a33 33 0 0 1 47-30" stroke="#d9b16c" stroke-width="1.5" stroke-dasharray="3 5" stroke-linecap="round"/><path d="M28 21h29l12 12v39H28V21Z" fill="#fffaf0" stroke="#a5773c" stroke-width="2" stroke-linejoin="round"/><path d="M57 21v12h12" fill="#efd5a6"/><path d="M36 42h21M36 50h16M36 58h9" stroke="#bd9256" stroke-width="2.5" stroke-linecap="round"/><circle cx="67" cy="68" r="17" fill="#fbe8df" stroke="#b87b62" stroke-width="2"/><path d="m61 62 12 12m0-12L61 74" stroke="#ae654d" stroke-width="3" stroke-linecap="round"/></svg></div>` : `<div class="success-icon so-takeaway-success-icon icon-asik" aria-hidden="true">
          <svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="45" cy="46" r="37" fill="#fff1d8"/>
            <path d="M12 45a34 34 0 0 1 50-30" stroke="#d9b16c" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="3 5"/>
            <path d="M29 21h29l11 11v40H29V21Z" fill="#fffaf0" stroke="#a5773c" stroke-width="2" stroke-linejoin="round"/>
            <path d="M58 21v12h11" fill="#efd5a6"/>
            <path d="M58 21v12h11M37 42h20M37 49h16M37 56h10" stroke="#bd9256" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M29 72v-8h26" stroke="#a5773c" stroke-width="2" stroke-linecap="round"/>
            <circle cx="67" cy="68" r="17" fill="#e9f2df" stroke="#718e4d" stroke-width="2"/>
            <path d="m59 68 5 5 10-11" stroke="#4f7c41" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M77 17v7m-3.5-3.5h7" stroke="#e5bc73" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>`}
        <div><span class="so-takeaway-result-eyebrow">Fresin App</span><h2>${soTakeawayEscape(title)}</h2></div>
      </div>
      ${note ? `<div class="so-takeaway-status-highlight is-${soTakeawayEscape(tone)}" role="status" aria-live="polite"><span class="so-takeaway-status-chip">${soTakeawayEscape(note)}</span></div>` : ""}
    </header>`;
  }

  function soTakeawaySuccessActions(againAction) {
    const takeaway = againAction === "window.SOTakeaway.newOrder(event)";
    return `<div class="fresin-order-success-actions">
      <button class="self-order-secondary fresin-view-receipt" type="button" onclick="window.SOTakeaway.openReceipt()">Lihat Pesanan</button>
      <button class="self-order-primary ${takeaway ? "so-takeaway-new-order-btn" : ""}" ${takeaway ? 'data-so-takeaway-new-order="1"' : ""} type="button" onclick="${soTakeawayEscape(againAction)}">Pesan Lagi</button>
    </div>`;
  }

  function soTakeawayReceiptOrder() {
    if (window.CustomerOrder?.isMode?.()) return window.CustomerOrder.currentOrder?.() || null;
    if (soTakeawayIsMode()) return soTakeawayActiveOrder() || soTakeawayFindOrder() || soTakeawayLastSnapshot();
    return (typeof selfOrderLastLiveOrder === "function" ? selfOrderLastLiveOrder() : null)
      || (typeof selfOrderLastOrderSnapshot === "function" ? selfOrderLastOrderSnapshot() : null);
  }

  function soTakeawayOpenReceipt() {
    if (!soTakeawayReceiptOrder()) return toast("Pesanan belum tersedia.");
    sessionStorage.setItem("self_order_step", "receipt");
    pushSelfOrderHistory("receipt");
    render();
    window.scrollTo?.({ top: 0, behavior: "smooth" });
  }

  function soTakeawayCloseReceipt() {
    sessionStorage.setItem("self_order_step", "success");
    if (typeof history !== "undefined") history.replaceState({ ...(history.state || {}), selfOrderStep: "success" }, "", location.href);
    render();
    window.scrollTo?.({ top: 0, behavior: "smooth" });
  }

  function soTakeawayRenderReceiptPage() {
    const order = soTakeawayReceiptOrder();
    if (!order) return `<main class="self-order-main fresin-receipt-page"><p>Pesanan belum tersedia.</p><button class="self-order-secondary" type="button" onclick="window.SOTakeaway.closeReceipt()">Kembali</button></main>`;
    return soTakeawayRenderReceipt(order);
  }

  function soTakeawayRenderReceipt(order) {
    const items = order.items || [];
    const lineTotal = item => typeof cartItemTotal === "function" ? cartItemTotal(item)
      : Number(item.qty || 0) * Number(item.price || 0)
        + (item.addons || []).reduce((sum, addon) => sum + Number(addon.price || 0) * Number(addon.qty || 0), 0);
    const subtotal = Number(order.subtotal ?? items.reduce((sum, item) => sum + lineTotal(item), 0));
    const discount = Number(order.discount || 0);
    const fee = Number(order.deliveryFee ?? order.delivery_fee ?? 0);
    const tax = Number(order.tax ?? order.tax_amount ?? 0);
    const service = Number(order.serviceFee ?? order.service_fee ?? 0);
    const total = Math.max(0, Number(order.grandTotal ?? order.total ?? 0), subtotal - discount + fee + tax + service);
    const delivery = order.type === "Delivery" || order.customerOrderType === "DELIVERY";
    // Courier settlement with the outlet does not confirm the customer's COD payment.
    const payment = soTakeawayIsPaid(order) && !(delivery && order.paymentProvider === "courier_cash") ? "Lunas" : "Belum Lunas";
    const store = state.settings?.selfOrderAppName || state.settings?.receiptStoreName || "Fresin Indonesia";
    const logo = String(state.settings?.selfOrderProfileImageDataUrl || state.settings?.receiptLogoDataUrl || "").trim();
    const emblem = logo ? mediaImageTag(logo, "Logo usaha", "fresin-receipt-logo", 160, "eager") : soTakeawayEscape(store.charAt(0));
    const rawNumber = String(order.number || "-").trim();
    const number = /^ORD-\d{8}-[A-Z0-9]+$/i.test(rawNumber)
      ? (typeof displayOrderNumber === "function" ? displayOrderNumber(rawNumber) : rawNumber.replace(/^ORD-\d{8}-/i, "#"))
      : rawNumber;
    const created = Date.parse(order.createdAt || "");
    return `<main class="self-order-main fresin-receipt-page">
      <article class="fresin-customer-receipt" aria-label="Rincian pesanan ${soTakeawayEscape(number)}">
        <header class="fresin-receipt-brand"><span class="fresin-receipt-emblem">${emblem}</span><strong>${soTakeawayEscape(store)}</strong></header>
        <div class="fresin-receipt-meta"><strong>${soTakeawayEscape(number)}</strong><span>${soTakeawayEscape(delivery ? "Delivery" : order.type || "Takeaway")}</span>
          ${order.customer ? `<span>${soTakeawayEscape(order.customer)}</span>` : ""}
          ${Number.isFinite(created) ? `<span>${soTakeawayEscape(soTakeawayDateTime(order.createdAt))}</span>` : ""}
        </div>
        <div class="fresin-receipt-items">
          ${items.map(item => `<div class="fresin-receipt-item"><div><strong>${Number(item.qty || 0)}× ${soTakeawayEscape(item.name || "Produk")}</strong>
            ${item.variantLabel || item.variant ? `<small>${soTakeawayEscape(item.variantLabel || item.variant)}</small>` : ""}
            ${(item.addons || []).map(addon => `<small>+ ${Number(addon.qty || 1)}× ${soTakeawayEscape(addon.name || "Tambahan")}</small>`).join("")}
            ${item.note ? `<small>${soTakeawayEscape(item.note)}</small>` : ""}</div><b>${soTakeawayMoney(lineTotal(item))}</b></div>`).join("") || '<p class="fresin-receipt-empty">Rincian item sedang dimuat. Kembali ke status untuk memperbarui pesanan.</p>'}
        </div>
        <div class="fresin-receipt-totals">
          ${discount ? `<span><b>Diskon</b><strong>− ${soTakeawayMoney(discount)}</strong></span>` : ""}
          ${fee ? `<span><b>Ongkir</b><strong>${soTakeawayMoney(fee)}</strong></span>` : ""}
          ${tax ? `<span><b>Pajak</b><strong>${soTakeawayMoney(tax)}</strong></span>` : ""}
          ${service ? `<span><b>Biaya layanan</b><strong>${soTakeawayMoney(service)}</strong></span>` : ""}
          <span class="fresin-receipt-grand"><b>Total</b><strong>${soTakeawayMoney(total)}</strong></span>
        </div>
        <div class="fresin-receipt-payment"><span>Pembayaran</span><strong>${soTakeawayEscape(payment)}</strong></div>
        <footer class="fresin-receipt-footer"><p>Terima kasih sudah memesan.</p><span>Dari Fresin, untuk hari baikmu.</span></footer>
      </article>
      <button class="self-order-secondary fresin-receipt-back" type="button" onclick="window.SOTakeaway.closeReceipt()">Kembali ke status pesanan</button>
      ${window.CustomerOrder?.isMode?.() ? window.CustomerOrder.renderSupport() : ""}
    </main>`;
  }

  function soTakeawayStatusBar({ paid = false, expired = false, accepted = false, processing = false, completed = false } = {}) {
    const steps = expired
      ? [
        ["expired", "Kedaluwarsa", "Waktu pembayaran sudah habis.", true, "!"],
        ["payment", "Pembayaran", "Silakan buat pesanan baru.", false, "2"],
        ["process", "Proses", "Pesanan belum diproses.", false, "3"]
      ]
      : [
        ["accept", accepted ? "Diterima kasir" : "Menunggu kasir", accepted ? "Pesanan sudah diteruskan ke dapur." : "Menunggu kasir menerima pesanan.", true, accepted ? "&#10003;" : "1"],
        ["process", processing ? "Diproses" : "Menunggu diproses", processing ? "Pesanan sedang disiapkan." : "Dapur akan menyiapkan pesanan setelah diterima kasir.", accepted, processing ? "&#10003;" : "2"],
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
    // Retained for existing callers; unpaid Take Away orders no longer expire automatically.
    return false;
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
            <div class="so-takeaway-active-copy">
              <span>Pesanan aktif</span>
              <strong>${soTakeawayEscape(soTakeawayNumber(activeOrder))}</strong>
            </div>
            <button class="so-takeaway-active-link" type="button" onclick="SOTakeaway.showActiveOrder()">Lihat pesanan</button>
          </section>
        ` : ""}
        <section class="self-order-payment-shell">
          <div class="self-order-checkout">
            <label class="self-order-customer-field">
              <span class="self-order-field-label">Nama Pemesan</span>
              <input id="selfOrderCustomer" value="${soTakeawayEscape(customer)}" placeholder="Nama pemesan" required aria-required="true" aria-describedby="selfOrderCustomerError" oninput="sessionStorage.setItem('self_order_customer', this.value); selfOrderClearCustomerError(this)" />
              <small id="selfOrderCustomerError" class="self-order-customer-error" role="alert" hidden>Nama wajib diisi.</small>
            </label>
            <label class="wide"><span class="self-order-field-label">Catatan</span><textarea id="selfOrderCheckoutNote" placeholder="Catatan pesanan (opsional)" rows="2" oninput="sessionStorage.setItem('self_order_checkout_note', this.value)">${soTakeawayEscape(note)}</textarea></label>
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
    const accepted = soTakeawayIsReleasedToKitchen(order);
    const cancelled = order.status === "Dibatalkan" || Boolean(order.cancelledAt);
    const number = String(soTakeawayNumber(order) || snapshot.takeawayNumber || snapshot.number || "-").trim();
    const customer = String(order.customer || snapshot.customer || "").trim();
    const total = liveOrder ? orderTotal(liveOrder) : Number(snapshot.checkoutTotal ?? snapshot.total ?? 0);
    const title = expired
      ? "Pesanan telah kedaluwarsa"
      : cancelled ? "Pesanan dibatalkan" : "Pesanan berhasil dibuat";
    const note = expired
      ? "Silakan buat pesanan baru jika masih ingin melakukan pemesanan."
      : cancelled ? (order.cancelReason || "Pesanan ini telah dibatalkan.")
        : completed ? "Pesanan sudah selesai dan siap diambil."
        : processing ? "Pesanan sedang disiapkan oleh dapur."
        : accepted ? "Kasir sudah menerima pesanan anda."
        : "Menunggu kasir menerima pesanan anda.";
    const statusTone = expired || cancelled ? "cancelled" : completed ? "completed" : processing ? "processing" : accepted ? "accepted" : "waiting";
    return `
      <main class="self-order-main success so-takeaway-success">
        <section class="self-order-success-card so-takeaway-status-card ${paid ? "is-paid" : "is-pending"} ${expired ? "is-expired" : ""}">
          ${soTakeawayResultHero({ title, note, tone: statusTone })}
          ${soTakeawayDetailHtml({ number, customer, total, order })}
          ${cancelled ? "" : soTakeawayStatusBar({ paid, expired, accepted, processing, completed })}
          ${soTakeawaySuccessActions("window.SOTakeaway.newOrder(event)")}
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
    selfOrderSubmitStartedAt = Date.now();
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
        takeawayStatus: "WAITING_ACCEPTANCE",
        takeawayExpiresAt: "",
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
      const synced = await submitSelfOrderConfirmed(order);
      if (!synced) {
        if (stockCommit.token) await restoreLimitedStockCommit(order.number, "submit_failed");
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
      selfOrderSubmitStartedAt = 0;
      if (!renderedCompletion) render();
    }
  }

  function soTakeawayIsDelivery(order) {
    return String(order?.customerOrderType || order?.orderMode || order?.customer_order_type || "").toUpperCase() === "DELIVERY"
      || String(order?.type || "").toLowerCase() === "delivery";
  }

  function soTakeawayServiceLabel(order) {
    if (soTakeawayIsDelivery(order)) return "Delivery";
    const mode = String(order?.customerOrderType || order?.orderMode || order?.customer_order_type || "").toUpperCase();
    if (mode === "PICKUP_PREORDER") return order.serviceInfo === "Takeaway Outlet" || order.service_info === "Takeaway Outlet" ? "Takeaway Outlet" : "Takeaway-Rumah";
    return "Takeaway Outlet";
  }

  function soTakeawayDeliveryStatusLabel(order) {
    const status = order.customerOrderStatus || order.customer_order_status || "";
    if (status === "CANCELLED" || order.status === "Dibatalkan") return "Dibatalkan";
    if (status === "COMPLETED") return "Selesai diantar";
    if (status === "DELIVERING") return "Sedang diantar";
    if (status === "PICKED_UP") return "Diambil kurir";
    if (status === "READY_FOR_PICKUP" || ["Siap Diambil", "Selesai"].includes(order.status)) return "Siap diambil kurir";
    if (status === "PREPARING" || order.status === "Sedang Disiapkan") return "Diproses dapur";
    if (order.confirmedAt) return "Menunggu dapur";
    if (status === "DRIVER_ASSIGNED" || order.driverId || order.driver_id) return "Kurir ditugaskan";
    return status === "NO_DRIVER_AVAILABLE" ? "Driver belum tersedia" : "Mencari kurir";
  }

  function soTakeawayPosDeliveryNote(note) {
    const text = String(note || "").trim();
    return text.split(/\s*(?:Kurir membayar harga produk di outlet|Pin lokasi\s*:|Patokan alamat\s*:|Jam pengambilan\s*:|Koordinat\s*:|Alamat (?:penerima|pengantaran)\s*:)/i)[0].trim();
  }

  function soTakeawayOrderCard(order, options = {}) {
    const qty = (order.items || []).reduce((sum, item) => sum + Number(item.qty || 0), 0);
    const expanded = sessionStorage.getItem(`orders_expanded_${order.id}`) === "1";
    const delivery = soTakeawayIsDelivery(order);
    const statusLabel = delivery ? soTakeawayDeliveryStatusLabel(order) : soTakeawayStatusLabel(order);
    const serviceLabel = soTakeawayServiceLabel(order);
    const header = `<span class="so-takeaway-type-chip">${serviceLabel}</span><strong class="so-takeaway-order-number">${soTakeawayEscape(customerDisplayName(order.customer) || "-")}</strong>`;
    const cardNote = soTakeawayPosDeliveryNote(order.note);
    const pickupNote = !delivery && order.pickupTime
      ? `<p class="orders-item-group-note so-takeaway-pickup-note"><b>Jam pengambilan:</b> ${soTakeawayEscape(order.pickupTime)}</p>` : "";
    const searchAttributes = Object.prototype.hasOwnProperty.call(options, "searchQuery")
      ? `data-order-search="${soTakeawayEscape(orderSearchText(order))}" ${orderMatchesSearch(order, options.searchQuery) ? "" : "hidden"}` : "";
    const processing = soTakeawayProcessingIds.has(order.id);
    const processAction = soTakeawayCanProcessOrder(order)
      ? `<button class="btn so-takeaway-process-btn" type="button" ${processing ? 'disabled aria-busy="true"' : ""} onclick="event.preventDefault(); event.stopPropagation(); SOTakeaway.processOrder('${order.id}')">${processing ? "Memproses..." : "Proses Pesanan"}</button>` : "";
    const deleteAction = typeof canDeleteOrderCard === "function" && canDeleteOrderCard(order)
      ? `<button class="btn red" type="button" onclick="event.preventDefault(); event.stopPropagation(); openDeleteOrderDialog('${order.id}')">Hapus</button>`
      : "";
    if (options.compactUnpaid && !expanded) {
      return `
        <article class="orders-card unpaid-compact-card so-takeaway-card" ${searchAttributes} onclick="toggleOrderItems('${order.id}', true)">
          <div class="unpaid-compact-head">
            <div class="so-takeaway-order-heading">${header}</div>
            <b>${soTakeawayMoney(orderTotal(order))}</b>
          </div>
          <div class="unpaid-compact-meta">
            <span>${soTakeawayEscape(soTakeawayNumber(order))}</span>
            <span class="so-takeaway-badge">${soTakeawayEscape(statusLabel)}</span>
          </div>
          ${pickupNote}
          ${cardNote ? `<p class="orders-item-group-note"><b>Catatan:</b> ${soTakeawayEscape(cardNote)}</p>` : ""}
          ${processAction}
          <button class="btn green so-takeaway-pay-btn" type="button" onclick="event.preventDefault(); event.stopPropagation(); payUnpaidOrder('${order.id}')">Bayar</button>
          ${deleteAction}
        </article>
      `;
    }
    const groups = groupedOrderItems(order);
    const itemPreview = groups.map(group => {
      const rawGroupNote = orderGroupNote(order, group);
      const groupNote = soTakeawayPosDeliveryNote(rawGroupNote);
      return `
        <div class="orders-item-group">
          ${groups.length > 1 ? `<small>${soTakeawayEscape(group.label)}</small>` : ""}
          ${groupNote ? `<p class="orders-item-group-note"><b>Catatan:</b> ${soTakeawayEscape(groupNote)}</p>` : ""}
          ${group.items.map(item => `
            <div class="orders-item-line">
              <span><b>${soTakeawayEscape(orderItemInlineLabel(item))}</b>${orderItemNoteHtml(item, "orders-item-note")}</span>
              <strong>${soTakeawayMoney(cartItemTotal(item))}</strong>
            </div>
          `).join("")}
        </div>
      `;
    }).join("");
    const actions = [
      processAction,
      order.paymentStatus !== "Lunas" && order.status !== "Dibatalkan"
        ? `<button class="btn green" type="button" onclick="event.preventDefault(); event.stopPropagation(); payUnpaidOrder('${order.id}')">Bayar</button>`
        : "",
      soTakeawayIsPaid(order)
        ? `<button class="btn green orders-print-receipt-btn" type="button" onclick="event.preventDefault(); event.stopPropagation(); printOrderCardReceipt('${order.id}')">Print Struk</button>` : "",
      typeof canCancelOrder === "function" && canCancelOrder(order)
        ? `<button class="btn red" type="button" onclick="event.preventDefault(); event.stopPropagation(); openCancelOrderDialog('${order.id}', ${options.returnToUnpaid ? "true" : "false"})">Batalkan</button>` : "",
      deleteAction
    ].filter(Boolean).join("");
    return `
      <article class="orders-card unpaid-detail-card so-takeaway-card ${expanded ? "is-expanded" : ""}" ${searchAttributes} ${options.returnToUnpaid ? `onclick="toggleOrderItems('${order.id}', true)"` : ""}>
        <div class="orders-card-head">
          <div class="so-takeaway-card-identity">
            <div class="order-title-row so-takeaway-order-heading">${orderSequenceBadge(options.sequenceNumber)}${header}</div>
          </div>
          <span class="orders-status-pill ready ${statusLabel === "MENUNGGU KASIR" ? "is-waiting" : ""}">${soTakeawayEscape(statusLabel)}</span>
        </div>
        <div class="so-takeaway-order-meta-line">
          <span class="so-takeaway-order-time">${soTakeawayDateTime(order.createdAt)}</span>
          <div class="orders-card-meta">
            <span>${soTakeawayEscape(soTakeawayNumber(order))}</span>
            <span>${soTakeawayIsPaid(order) ? "Lunas" : "Belum dibayar"}</span>
          </div>
        </div>
        <div class="orders-card-items">${pickupNote}${itemPreview || `<span class="muted">Belum ada rincian item.</span>`}</div>
        <div class="orders-card-total"><span>${qty} barang</span><strong>${soTakeawayMoney(orderTotal(order))}</strong></div>
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
      if (typeof orderUsesOutletPayment === "function" && orderUsesOutletPayment(order)) return basePayUnpaidOrder(id);
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
        if (soTakeawayIsOrder(order) && !soTakeawayIsReleasedToKitchen(order) && !order.cancelledAt && order.status !== "Dibatalkan") return false;
        return baseKitchenOrderIsVisible(order, filter, visibleStatuses);
      };
    }

    if (typeof kitchenOrderHasSequence === "function") {
      const baseKitchenOrderHasSequence = kitchenOrderHasSequence;
      kitchenOrderHasSequence = function (order) {
        if (soTakeawayIsOrder(order) && !soTakeawayIsReleasedToKitchen(order)) return false;
        return baseKitchenOrderHasSequence(order);
      };
    }

    const baseOrderDisplayTitle = orderDisplayTitle;
    orderDisplayTitle = function (order) {
      if (!soTakeawayIsOrder(order)) return baseOrderDisplayTitle(order);
      const number = soTakeawayNumber(order);
      const customer = customerDisplayName(order?.customer);
      if (soTakeawayIsDelivery(order)) return `Delivery · ${customer || number}`;
      return customer ? `TAKEAWAY · ${number} - ${customer}` : `TAKEAWAY · ${number}`;
    };

    const baseCompactOrderStatus = compactOrderStatus;
    compactOrderStatus = function (status) {
      if (status === "Menunggu Pembayaran") return { label: "Menunggu Bayar", className: "ready" };
      return baseCompactOrderStatus(status);
    };

    const baseOrderPushNotificationCategories = orderPushNotificationCategories;
    orderPushNotificationCategories = function (order = {}) {
      if (soTakeawayIsOrder(order) && !soTakeawayIsReleasedToKitchen(order)) return [];
      return baseOrderPushNotificationCategories(order);
    };

    const baseNotifyNativePushForOrder = notifyNativePushForOrder;
    notifyNativePushForOrder = async function (order, options = {}) {
      if (soTakeawayIsOrder(order) && !soTakeawayIsReleasedToKitchen(order)) return false;
      return baseNotifyNativePushForOrder(order, options);
    };

    if (typeof detectNewIncomingOrders === "function") {
      const baseDetectNewIncomingOrders = detectNewIncomingOrders;
      detectNewIncomingOrders = function (orders = [], previousKeys = orderNotificationKnownKeys) {
        return baseDetectNewIncomingOrders(orders, previousKeys)
          .filter(order => view !== "kitchen" || !soTakeawayIsOrder(order) || soTakeawayIsReleasedToKitchen(order));
      };
    }

    window.SOTakeaway = {
      isMode: soTakeawayIsMode,
      isOrder: soTakeawayIsOrder,
      processOrder: soTakeawayProcessOrder,
      renderDetails: soTakeawayDetailHtml,
      renderHero: soTakeawayResultHero,
      renderSuccessActions: soTakeawaySuccessActions,
      renderReceipt: soTakeawayRenderReceipt,
      renderReceiptPage: soTakeawayRenderReceiptPage,
      openReceipt: soTakeawayOpenReceipt,
      closeReceipt: soTakeawayCloseReceipt,
      renderProgress: soTakeawayStatusBar,
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
