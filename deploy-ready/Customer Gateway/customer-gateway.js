(function () {
  "use strict";

  const HANDOFF_KEY = "fresin_gateway_handoff_v1";
  const HANDOFF_MAX_AGE_MS = 2 * 60 * 1000;
  const DRAFTS_KEY = "fresin_gateway_service_drafts_v1";
  const DRAFT_CONTEXT_KEY = "fresin_gateway_draft_context_v1";
  const DRAFT_FIELDS = ["self_order_customer", "self_order_checkout_note", "self_order_last_order"];
  const validDraftContext = value => ["takeaway", "delivery", "home-pickup"].includes(value) || /^table:[A-Za-z0-9-]{1,16}$/.test(String(value || ""));
  const validService = value => value === "dinein" || value === "pickup" || value === "delivery";

  function homeMode() {
    return Boolean(window.CustomerOrder?.isMode());
  }

  function takeawayMode() {
    return Boolean(window.SOTakeaway?.isMode());
  }

  function tableMode() {
    return typeof IS_SELF_ORDER_APP !== "undefined" && IS_SELF_ORDER_APP && !homeMode() && !takeawayMode();
  }

  function tableCode() {
    const fromUrl = typeof selfOrderTableCodeFromUrl === "function" ? selfOrderTableCodeFromUrl() : "";
    const value = String(fromUrl || sessionStorage.getItem("self_order_table") || "A-1").trim();
    return typeof normalizeSelfOrderTableCode === "function" ? (normalizeSelfOrderTableCode(value) || "A-1") : value;
  }

  function routeDraftContext() {
    return tableMode() ? `table:${tableCode()}` : takeawayMode() ? "takeaway" : checkoutMethod() === "DELIVERY" ? "delivery" : "home-pickup";
  }

  function switchDraftContext(next) {
    if (!validDraftContext(next)) return false;
    const storedContext = sessionStorage.getItem(DRAFT_CONTEXT_KEY);
    const previous = validDraftContext(storedContext) ? storedContext : "";
    if (previous === next || (!previous && !tableMode())) return true;
    if (!previous) {
      sessionStorage.setItem(DRAFT_CONTEXT_KEY, next);
      return true;
    }
    const oldCart = selfOrderCart;
    const oldFields = Object.fromEntries(DRAFT_FIELDS.map(key => [key, sessionStorage.getItem(key)]));
    try {
      let drafts;
      try { drafts = JSON.parse(sessionStorage.getItem(DRAFTS_KEY) || "{}"); } catch { drafts = {}; }
      if (!drafts || typeof drafts !== "object" || Array.isArray(drafts)) drafts = {};
      drafts[previous] = { cart: oldCart, fields: oldFields };
      sessionStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
      const target = drafts[next];
      selfOrderCart = Array.isArray(target?.cart) ? target.cart : [];
      DRAFT_FIELDS.forEach(key => {
        const value = target?.fields?.[key];
        if (typeof value === "string") sessionStorage.setItem(key, value);
        else sessionStorage.removeItem(key);
      });
      saveSelfOrderCart();
      sessionStorage.setItem(DRAFT_CONTEXT_KEY, next);
      return true;
    } catch {
      selfOrderCart = oldCart;
      try { saveSelfOrderCart(); } catch { /* Keep the draft in memory if storage is unavailable. */ }
      DRAFT_FIELDS.forEach(key => {
        try {
          if (oldFields[key] === null) sessionStorage.removeItem(key);
          else sessionStorage.setItem(key, oldFields[key]);
        } catch { /* Keep the current in-memory draft available. */ }
      });
      toast("Keranjang belum dapat disimpan. Coba lagi sebelum mengganti layanan.");
      return false;
    }
  }

  function enabled() {
    return typeof IS_SELF_ORDER_APP !== "undefined" && IS_SELF_ORDER_APP
      && (homeMode() || takeawayMode() || tableMode() || window.FRESIN_GATEWAY_APP === true);
  }

  function statusContinuation() {
    const url = new URL(location.href);
    const hash = new URLSearchParams(url.hash.split("?")[1] || "");
    return /\/(?:delivery|order)\/status\//i.test(url.pathname)
      || ["resultCode", "merchantOrderId", "reference", "token", "orderToken", "order_token"]
        .some(key => url.searchParams.has(key) || hash.has(key));
  }

  function checkoutMethod() {
    try { return JSON.parse(sessionStorage.getItem("customer_home_checkout") || "{}").method; }
    catch { return ""; }
  }

  function selectedService() {
    const service = history.state?.fresinService;
    if (!validService(service)) return "";
    if ((service === "dinein") !== tableMode()) return "";
    const method = homeMode() ? checkoutMethod() : "";
    return method === "DELIVERY" ? "delivery" : method === "PICKUP_PREORDER" ? "pickup" : service;
  }

  function isOpen() {
    return enabled() && !statusContinuation()
      && (selfOrderStep() === "gateway" || (selfOrderStep() === "menu" && !selectedService()));
  }

  function icon(kind) {
    if (kind === "all") return `<svg data-icon="all" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <ellipse cx="25" cy="43" rx="20" ry="3" fill="#285e99" opacity=".14"/>
      <path d="M18 4v12" stroke="#356da8" stroke-width="3" stroke-linecap="round"/>
      <path d="M7 15h21l-3 24a3 3 0 0 1-3 3H13a3 3 0 0 1-3-3L7 15Z" fill="#f4dfb7" stroke="#b98b52" stroke-width="1.2"/>
      <path d="M9 23h17l-2 15a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2L9 23Z" fill="#bc8047"/>
      <path d="M9 18h17l-.5 5c-5 3-10-2-16 .5L9 18Z" fill="#fff8e9"/>
      <rect x="5" y="12" width="25" height="5" rx="2.5" fill="#fffaf0" stroke="#b9cde1" stroke-width="1.2"/>
      <path d="M13 20l1 16" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".4"/>
      <circle cx="32" cy="31" r="12" fill="#e8b775" stroke="#c68c4e" stroke-width="1.2"/>
      <path d="M22 30a10 10 0 0 1 20 0c-2-1-3 3-5 2-2-2-3 1-5 0-2-3-3 1-5 0-2-2-3 0-5-2Z" fill="#895331"/>
      <circle cx="32" cy="31" r="3.6" fill="#fff4df" stroke="#bd8649" stroke-width="1.2"/>
      <path d="m27 25 2 1m7-1-1 2m5 3-2 1m-13-1 1-2m11 8-2 1m-6-1-2-1" stroke="#fff0c4" stroke-width="1.6" stroke-linecap="round"/>
    </svg>`;
    // Store and Truck use Lucide's ISC-licensed paths, also used by Depot Air.
    // See LICENSE.lucide.txt alongside this module.
    const paths = {
      bag: '<path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5"/><path d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244"/><path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"/>',
      shopping: '<path d="M5 7h14l1 14H4L5 7Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
      dinein: '<g class="fresin-utensil-fork"><path d="m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8"/><path d="m2.1 21.8 6.4-6.3M19 5l-7 7"/></g><g class="fresin-utensil-knife"><path d="M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7"/></g>',
      seat: '<path d="M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3"/><path d="M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0zM5 18v2M19 18v2"/>',
      delivery: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
      arrow: '<path d="m7 17 10-10M7 7h10v10"/>',
      back: '<path d="m14 6-6 6 6 6M8 12h12"/>',
      close: '<path d="m18 6-12 12M6 6l12 12"/>',
      coffee: '<path d="M4 8h12v9a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8Z"/><path d="M16 9h2a3 3 0 0 1 0 6h-2M7 2v3m4-3v3m4-3v3"/>',
      heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
      pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>'
    };
    const serviceIcon = ["bag", "delivery", "dinein", "seat"].includes(kind);
    const name = kind === "shopping" ? "shopping-bag" : kind === "bag" ? "store" : kind === "delivery" ? "truck" : kind === "dinein" ? "utensils-crossed" : kind === "seat" ? "armchair" : kind;
    return `<svg data-icon="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${serviceIcon ? "2" : "1.7"}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind] || paths.arrow}</svg>`;
  }

  function serviceArt(service) {
    const pickup = service === "pickup";
    return `<span class="fresin-gateway-choice-icon fresin-service-art" aria-hidden="true"><span class="fresin-service-art-frame is-first">${icon(pickup ? "shopping" : "delivery")}</span><span class="fresin-service-art-frame is-second">${icon(pickup ? "bag" : "shopping")}</span></span>`;
  }

  function serviceStrip(service, options = {}) {
    const label = service === "dinein" ? `Makan di sini <small>Meja ${escapeHtml(tableCode())}</small>` : service === "delivery" ? "Diantar (Delivery)" : "Ambil di toko";
    return `<div class="fresin-service-strip is-${service}"><span><span class="fresin-service-strip-icon">${icon(service === "dinein" ? "dinein" : service === "delivery" ? "delivery" : "bag")}</span><span class="fresin-service-strip-copy">${label}</span></span>${options.change === false ? "" : `<button type="button" onclick="FresinGateway.open()">Ubah layanan ${icon("arrow")}</button>`}</div>`;
  }

  function categoryVisual(category, products) {
    if (!enabled()) return "";
    if (category === "Semua" && typeof productImageOrToken === "function") {
      const pictured = (products || []).filter(product => String(product.imageName || "").trim());
      const isDonut = product => /donut|donat/i.test(`${product.category || ""} ${product.name || ""}`);
      const donut = pictured.find(isDonut);
      const drink = pictured.find(product => !isDonut(product) && /coffee|kopi|latte|milky|drink|minum/i.test(`${product.category || ""} ${product.name || ""}`))
        || pictured.find(product => !isDonut(product));
      if (drink && donut) return `<span class="fresin-category-visual fresin-category-photo-stack" aria-hidden="true"><span class="fresin-category-stack-drink">${productImageOrToken(drink, "fresin-category-photo", 96)}</span><span class="fresin-category-stack-donut">${productImageOrToken(donut, "fresin-category-photo", 96)}</span></span>`;
    }
    const candidates = (products || []).filter(product => product.category === category);
    const pictured = candidates.filter(product => String(product.imageName || "").trim());
    const nonCoffee = /^non[\s-]*kopi$/i.test(String(category).trim());
    const representative = (nonCoffee ? pictured.find(product => /choco|cok[el]at|taro|matcha|hazelnut/i.test(product.name || "")) : null) || pictured[0] || candidates[0];
    const photo = category !== "Semua" && representative && typeof productImageOrToken === "function"
      ? productImageOrToken(representative, "fresin-category-photo", 96) : icon("all");
    return `<span class="fresin-category-visual" aria-hidden="true">${photo}</span>`;
  }

  function header() {
    // Keep the existing branding/profile header; a gateway has no selected mode yet.
    const step = selfOrderStep();
    sessionStorage.setItem("self_order_step", "menu");
    try {
      let markup = renderSelfOrderTopbar().replace('onclick="CustomerOrder.scrollToSupport()"', 'onclick="FresinGateway.showSupport()"');
      if (tableMode() && !markup.includes("FresinGateway.showSupport()")) markup = markup.replace("</header>", '<button type="button" class="fresin-gateway-support-button" onclick="FresinGateway.showSupport()">Kontak Support</button></header>');
      return markup;
    } finally {
      sessionStorage.setItem("self_order_step", step);
    }
  }

  function renderTableChoices() {
    return `
      <div class="fresin-gateway-table-choices">
        <button class="fresin-gateway-choice dinein" type="button" onclick="FresinGateway.choose('dinein')">
          <span class="fresin-gateway-choice-icon fresin-dinein-table-art">${icon("dinein")}<strong>${escapeHtml(tableCode())}</strong></span>
          <span class="fresin-gateway-choice-copy"><strong>Makan di sini</strong><span>Pesanan diantar ke meja ${escapeHtml(tableCode())}.</span></span>
          <span class="fresin-gateway-dinein-action">Lihat menu ${icon("arrow")}</span>
        </button>
        <h2 class="fresin-gateway-secondary-heading" id="fresinGatewayOtherTitle">Kamu bisa juga</h2>
        <div class="fresin-gateway-secondary-choices" aria-labelledby="fresinGatewayOtherTitle">
          <button class="fresin-gateway-choice fresin-gateway-small-choice pickup" type="button" onclick="FresinGateway.choose('pickup')"><span class="fresin-gateway-small-top">${serviceArt("pickup")}${icon("arrow")}</span><strong>Pesan dari rumah</strong><span>Ambil ke Outlet saat pesanan selesai</span></button>
          <button class="fresin-gateway-choice fresin-gateway-small-choice delivery" type="button" onclick="FresinGateway.choose('delivery')"><span class="fresin-gateway-small-top">${serviceArt("delivery")}${icon("arrow")}</span><strong>Diantar (Delivery)</strong><span>Pesanan diantar ke rumahmu, (dikenakan ongkir)</span></button>
        </div>
      </div>`;
  }

  function renderSupport() {
    if (window.CustomerOrder?.renderSupport) return window.CustomerOrder.renderSupport({ visible: true });
    if (!tableMode()) return "";
    const settings = state.settings || {};
    const email = String(settings.customerSupportEmail || settings.supportEmail || settings.receiptEmail || "fresin.indonesia@gmail.com").trim();
    const phone = String(settings.customerSupportPhone || settings.supportPhone || settings.receiptPhone || "0822100069671").trim();
    const address = String(settings.customerSupportAddress || settings.supportAddress || settings.receiptAddress || "Jl. Prof. A. M. Ibrahim, Kec. Kota Sigli, Kab. Pidie, Aceh").trim();
    return `<section class="fresin-gateway-table-support"><strong>Kontak Support</strong><p>Hubungi kami jika ada kendala.</p><dl><div><dt>Email</dt><dd>${escapeHtml(email)}</dd></div><div><dt>WhatsApp</dt><dd>${escapeHtml(phone)}</dd></div><div><dt>Alamat</dt><dd>${escapeHtml(address)}</dd></div></dl></section>`;
  }

  function renderGateway() {
    const atTable = tableMode();
    const support = renderSupport();
    const params = new URL(location.href).searchParams;
    const motionPreview = params.get("motion") === "on"
      || (params.get("motion") !== "off" && /^signature-\d+$/.test(params.get("preview") || ""));
    const profileImage = String(state.settings?.selfOrderProfileImageDataUrl || state.settings?.receiptLogoDataUrl || "").trim();
    const brandMark = profileImage && typeof mediaImageTag === "function"
      ? mediaImageTag(profileImage, "Logo Fresin", "fresin-gateway-brand-image", 240)
      : '<span class="fresin-gateway-brand-fallback">F</span>';
    return `
      <section class="self-order-app fresin-gateway${atTable ? " fresin-gateway-table" : ""}"${motionPreview ? ' data-motion="on"' : ""}>
        ${header()}
        <main class="fresin-gateway-main">
          <section class="fresin-gateway-hero" aria-labelledby="fresinGatewayTitle">
            <span class="fresin-gateway-orbit" aria-hidden="true"></span>
            <span class="fresin-gateway-eyebrow">Selamat Datang di</span>
            <h1 id="fresinGatewayTitle">Fresin <span class="fresin-gateway-app-word">App</span></h1>
            <span class="fresin-gateway-description">Aplikasi pemesanan <strong>Fresin Indonesia</strong></span>
            ${atTable ? `<div class="fresin-gateway-table-marker"><span class="fresin-gateway-table-seat">${icon("seat")}</span><span>Kamu di meja</span><strong>${escapeHtml(tableCode())}</strong></div>` : '<p class="fresin-gateway-hero-tagline"><span class="fresin-gateway-tagline-easy">Lebih mudah,</span> <span class="fresin-gateway-tagline-fast">lebih cepat.</span></p>'}
            <span class="fresin-gateway-stamp" aria-hidden="true">${brandMark}</span>
            <span class="fresin-gateway-spark star-one" aria-hidden="true">✦</span>
            <span class="fresin-gateway-spark star-two" aria-hidden="true">✦</span>
            <span class="fresin-gateway-spark star-four" aria-hidden="true">✦</span>
          </section>
          <section class="fresin-gateway-order-card${atTable ? " fresin-gateway-table-card" : ""}" ${atTable ? 'aria-label="Pilihan pemesanan"' : 'aria-labelledby="fresinGatewayChoiceTitle"'}>
          ${atTable ? "" : '<div class="fresin-gateway-heading"><h2 id="fresinGatewayChoiceTitle">Mau pesan bagaimana?</h2></div>'}
          ${atTable ? renderTableChoices() : `<div class="fresin-gateway-choices">
            <button class="fresin-gateway-choice pickup" type="button" onclick="FresinGateway.choose('pickup')">
              ${serviceArt("pickup")}
              <span class="fresin-gateway-choice-copy"><strong>Ambil di toko</strong><span>Pesan dulu, ambil sendiri<br>di outlet Fresin.</span></span>
              <span class="fresin-gateway-choice-arrow">${icon("arrow")}</span>
            </button>
            <button class="fresin-gateway-choice delivery" type="button" onclick="FresinGateway.choose('delivery')">
              ${serviceArt("delivery")}
              <span class="fresin-gateway-choice-copy"><strong>Diantar (Delivery)</strong><span>Pesanan diantarkan oleh driver Fresin ke alamatmu, dikenakan biaya antar.</span></span>
              <span class="fresin-gateway-choice-arrow">${icon("arrow")}</span>
            </button>
          </div>`}
          </section>
          <footer class="fresin-gateway-footer"><button type="button" onclick="FresinGateway.showOrders()">Pesanan saya ${icon("arrow")}</button></footer>
        </main>
      </section>
      ${support ? `<div class="fresin-gateway-support" id="fresinGatewaySupport" role="region" tabindex="-1" aria-label="Kontak Support" onkeydown="if(event.key==='Escape'){FresinGateway.hideSupport();event.stopPropagation();}" hidden>${support}</div>` : ""}
    `;
  }

  function markMenu(service, replace = false) {
    if (!switchDraftContext(service === "dinein" ? `table:${tableCode()}` : homeMode() ? (service === "delivery" ? "delivery" : "home-pickup") : "takeaway")) return;
    if (service === "dinein") sessionStorage.setItem("self_order_table", tableCode());
    sessionStorage.setItem("self_order_step", "menu");
    sessionStorage.removeItem("self_order_product_id");
    const next = { ...(history.state || {}), selfOrderStep: "menu", fresinService: service };
    history[replace ? "replaceState" : "pushState"](next, "", location.href);
    if (homeMode()) window.CustomerOrder.setMethod(service === "delivery" ? "DELIVERY" : "PICKUP_PREORDER");
    else render();
  }

  function choose(service) {
    if (!enabled() || !validService(service) || selfOrderSubmitting) return;
    if (service === "dinein") return tableMode() ? markMenu(service) : undefined;
    if (homeMode() || (service === "pickup" && takeawayMode())) return markMenu(service);
    const pickupPath = tableMode() ? "/pesan/" : (window.FRESIN_PICKUP_URL || "/self-order/");
    const target = new URL(service === "delivery" ? "/pesan/" : pickupPath, location.href);
    if (target.origin !== location.origin) return toast("Tautan layanan tidak tersedia.");
    if (!switchDraftContext(service === "delivery" ? "delivery" : tableMode() ? "home-pickup" : "takeaway")) return;
    target.searchParams.set("mode", service === "delivery" ? "delivery" : tableMode() ? "pickup" : "takeaway");
    saveSelfOrderCart();
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ service, path: target.pathname, at: Date.now() }));
    location.assign(target.href);
  }

  function open() {
    if (!enabled() || selfOrderSubmitting) return;
    sessionStorage.setItem("self_order_step", "gateway");
    history.pushState({ ...(history.state || {}), selfOrderStep: "gateway", fresinService: null }, "", location.href);
    render();
  }

  function showOrders() {
    if (homeMode()) return window.CustomerOrder.showOrders();
    try {
      const snapshot = JSON.parse(sessionStorage.getItem("self_order_last_order") || "null");
      const ownTableOrder = tableMode() && snapshot?.orderMode !== "TAKEAWAY" && (snapshot?.id || snapshot?.number) && String(snapshot?.table || "").trim() === tableCode();
      if (ownTableOrder || (!tableMode() && snapshot?.orderMode === "TAKEAWAY")) {
        sessionStorage.setItem("self_order_step", "success");
        pushSelfOrderHistory("success");
        return render();
      }
    } catch { /* Keep the existing active-order fallback. */ }
    if (tableMode()) return toast("Belum ada pesanan untuk meja ini.");
    window.SOTakeaway?.showActiveOrder();
  }

  function showSupport() {
    const element = document.getElementById("fresinGatewaySupport");
    if (!element) return;
    element.hidden = false;
    element.scrollIntoView({ behavior: "smooth", block: "start" });
    element.focus?.({ preventScroll: true });
  }

  function hideSupport() {
    const element = document.getElementById("fresinGatewaySupport");
    if (element) element.hidden = true;
    document.querySelector?.(".fresin-gateway .customer-home-support-chip,.fresin-gateway .fresin-gateway-support-button")?.focus({ preventScroll: true });
  }

  const baseRenderSelfOrder = renderSelfOrder;
  renderSelfOrder = function () {
    const gatewayOpen = isOpen();
    document.documentElement?.classList?.toggle("fresin-gateway-open", gatewayOpen);
    if (gatewayOpen) return renderGateway();
    let content = baseRenderSelfOrder.apply(this, arguments);
    if (tableMode()) {
      content = content.replace('class="self-order-app"', 'class="self-order-app fresin-table-menu"');
      content = content.replace(/<label class="self-order-table">[\s\S]*?<\/label>/, "");
    }
    if (!enabled() || selfOrderStep() !== "menu" || !selectedService()) return content;
    const service = selectedService();
    const strip = serviceStrip(service);
    return content.replace(/(<main\b[^>]*>)/, `$1${strip}`);
  };

  const basePushSelfOrderHistory = pushSelfOrderHistory;
  pushSelfOrderHistory = function (step) {
    const service = selectedService();
    const result = basePushSelfOrderHistory.apply(this, arguments);
    if (enabled() && validService(service)) history.replaceState({ ...(history.state || {}), fresinService: service }, "", location.href);
    return result;
  };

  window.FresinGateway = { choose, open, showOrders, showSupport, hideSupport, isOpen, categoryVisual, menuVisualsEnabled: enabled, serviceStrip };

  function finishBoot() {
    window.FRESIN_GATEWAY_BOOT_PENDING = false;
    render();
  }

  if (!enabled() || statusContinuation()) {
    if (window.FRESIN_GATEWAY_BOOT_PENDING === true) finishBoot();
    return;
  }
  if (tableMode()) sessionStorage.setItem("self_order_table", tableCode());
  switchDraftContext(routeDraftContext());
  window.addEventListener("pageshow", event => {
    if (!event.persisted || !enabled()) return;
    try {
      const stored = JSON.parse(sessionStorage.getItem("omnipos_self_order_cart") || "[]");
      if (Array.isArray(stored)) selfOrderCart = stored;
    } catch { /* Keep the in-memory draft when browser storage is unavailable. */ }
    switchDraftContext(routeDraftContext());
    render();
  });
  let handoff = null;
  try { handoff = JSON.parse(sessionStorage.getItem(HANDOFF_KEY) || "null"); }
  catch { /* Malformed handoffs should display the gateway. */ }
  sessionStorage.removeItem(HANDOFF_KEY);
  const age = Date.now() - Number(handoff?.at || 0);
  const handoffMatchesMode = tableMode() ? handoff?.service === "dinein" : takeawayMode() ? handoff?.service === "pickup" : handoff?.service === "pickup" || handoff?.service === "delivery";
  if (validService(handoff?.service) && handoffMatchesMode && handoff.path === location.pathname && age >= 0 && age <= HANDOFF_MAX_AGE_MS) {
    markMenu(handoff.service, true);
  } else if (!["menu", "gateway"].includes(selfOrderStep()) && history.state?.selfOrderStep === selfOrderStep()) {
    // Existing carts, payment screens and order results must survive this upgrade.
    if (!selectedService()) history.replaceState({ ...(history.state || {}), fresinService: tableMode() ? "dinein" : checkoutMethod() === "DELIVERY" ? "delivery" : "pickup" }, "", location.href);
  } else if (!selectedService()) {
    sessionStorage.setItem("self_order_step", "gateway");
    history.replaceState({ ...(history.state || {}), selfOrderStep: "gateway", fresinService: null }, "", location.href);
  }
  finishBoot();
}());
