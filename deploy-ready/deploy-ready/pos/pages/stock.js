function renderStockV2() {
  const query = sessionStorage.getItem("stock_query") || "";
  const rawStatusFilter = sessionStorage.getItem("stock_status") || "Semua";
  const statusFilter = ["Semua", "Habis", "Menipis", "Aman"].includes(rawStatusFilter) ? rawStatusFilter : "Semua";
  const categoryFilter = sessionStorage.getItem("stock_category") || "Semua";
  const categories = ["Semua", ...productCategories(), "Add-on"].filter((value, index, list) => list.indexOf(value) === index);
  const products = stockMonitorProducts();
  const addons = stockMonitorAddons();
  const entries = stockMonitorEntries(products, addons);
  const summary = stockMonitorSummary();
  const filtered = filterStockProducts(entries, query, statusFilter, categoryFilter);

  return `
    <section class="stock-page stock-monitor-page">
      <div class="stock-summary-grid stock-monitor-summary">
        ${stockSummaryCard("Total", summary.total, "", "", "setStockFilter('stock_status', 'Semua')", statusFilter === "Semua")}
        ${stockSummaryCard("Habis", summary.soldOut, "", "danger", "setStockFilter('stock_status', 'Habis')", statusFilter === "Habis")}
        ${stockSummaryCard("Menipis", summary.limited, "", "warning", "setStockFilter('stock_status', 'Menipis')", statusFilter === "Menipis")}
        ${stockSummaryCard("Aman", summary.safe, "", "primary", "setStockFilter('stock_status', 'Aman')", statusFilter === "Aman")}
      </div>

      <div class="stock-toolbar-card stock-monitor-toolbar">
        <label class="stock-search-field">
          ${navIcon("search")}
          <input
            class="stock-search-input"
            value="${escapeHtml(query)}"
            oninput="filterStockList(this.value)"
            onkeyup="filterStockList(this.value)"
            onchange="filterStockList(this.value)"
            placeholder="Cari produk, SKU, kategori, atau status"
            autocomplete="off"
            spellcheck="false"
          />
        </label>
        <label class="stock-category-field">
          <select onchange="setStockFilter('stock_category', this.value)">
            ${categories.map(category => `<option value="${escapeHtml(category)}" ${category === categoryFilter ? "selected" : ""}>${escapeHtml(category === "Semua" ? "Semua kategori" : category)}</option>`).join("")}
          </select>
        </label>
      </div>

      <div class="stock-list-card stock-monitor-list-card">
        <div class="stock-section-head">
          <div>
            <h3>Status Stok</h3>
            <p><span data-stock-visible-count>${filtered.length}</span> dari ${entries.length} item ditampilkan</p>
          </div>
        </div>
        <div class="stock-product-list">
          ${filtered.map(stockProductCardHtml).join("") || empty("Produk tidak ditemukan.")}
        </div>
      </div>
    </section>
  `;
}

function filterStockProducts(products, query, statusFilter, categoryFilter) {
  const normalized = String(query || "").trim().toLowerCase();
  return products
    .filter(product => categoryFilter === "Semua" || product.category === categoryFilter)
    .filter(product => statusFilter === "Semua" || stockProductStatusLabel(product) === statusFilter)
    .filter(product => !normalized || stockSearchText(product).includes(normalized));
}

function stockMonitorProducts() {
  return stableProducts(state.products).filter(product => !product.stockOpname);
}

function stockMonitorAddons() {
  return typeof addonStockEntries === "function" ? addonStockEntries() : [];
}

function stockMonitorEntries(products = stockMonitorProducts(), addons = stockMonitorAddons()) {
  return [
    ...products.map(product => ({ ...product, type: "product" })),
    ...addons
  ];
}

function stockMonitorSummary() {
  const entries = stockMonitorEntries();
  return entries.reduce((summary, entry) => {
    const label = stockProductStatusLabel(entry);
    summary.total += 1;
    if (label === "Habis") summary.soldOut += 1;
    else if (label === "Menipis") summary.limited += 1;
    else summary.safe += 1;
    return summary;
  }, { total: 0, soldOut: 0, limited: 0, safe: 0 });
}

function stockProductStatusLabel(product) {
  if (product?.type === "addon") return stockEntryStatus(product).label === "Habis" ? "Habis" : "Aman";
  const variants = productAvailabilityVariants(product);
  if (product.soldOut || (variants.length && variants.every(variant => isProductVariantSoldOut(product, variant.key)))) return "Habis";
  if (variants.some(variant => productVariantStockOption(product, variant.key)?.trackStock === true)) return "Menipis";
  if (!variants.length && product.trackStock) return Number(product.stock || 0) <= 0 ? "Habis" : "Menipis";
  return "Aman";
}

function stockEntryStatus(entry) {
  if (entry?.type === "addon" && typeof addonStockStatus === "function") return addonStockStatus(entry);
  return stockStatus(entry);
}

function stockSearchText(product) {
  return [
    product.name,
    product.category,
    product.sku,
    stockProductStatusLabel(product),
    ...(product.type === "addon" ? ["addon", "add-on"] : productAvailabilityVariants(product).map(variant => variant.label))
  ].join(" ").toLowerCase();
}

function stockProductCardHtml(product) {
  if (product.type === "addon") return stockAddonCardHtml(product);
  const displayStatus = stockProductStatusLabel(product);
  const displayClass = displayStatus === "Habis" ? "cancel" : displayStatus === "Menipis" ? "process" : "ready";
  const photo = mediaImageTag(product.imageName, `Foto ${product.name}`, "stock-product-photo", 120);
  const variantGroups = productAvailabilityVariantGroups(product);
  const variants = variantGroups.flatMap(group => group.variants);

  return `
    <article class="stock-product-card ${product.soldOut ? "soldout" : ""}" data-stock-row data-stock-type="product" data-stock-id="${escapeHtml(product.id)}" data-stock-search="${escapeHtml(stockSearchText(product))}">
      <div class="stock-product-main">
        <div class="stock-product-token ${photo ? "has-photo" : ""}">${photo || escapeHtml((product.name || "PR").slice(0, 2).toUpperCase())}</div>
        <div class="stock-product-info">
          <div class="stock-product-title">
            <strong>${escapeHtml(product.name)}</strong>
            <span class="pill ${displayClass}">${displayStatus}</span>
          </div>
          <div class="stock-product-meta">
            ${!variants.length && product.trackStock
              ? `<span>Stok <b>${Number(product.stock || 0)}</b></span><span>Minimum <b>${Number(product.minStock || 0)}</b></span>`
              : ""}
          </div>
        </div>
      </div>
      <div class="stock-product-actions">
        <button class="btn stock-status-btn available ${!product.soldOut && (variants.length || !product.trackStock) ? "active" : ""}" onclick="setStockProductSoldOut('${product.id}', false)">Tersedia</button>
        ${variants.length ? "" : `<button class="btn stock-status-btn limited ${!product.soldOut && product.trackStock && Number(product.stock || 0) > 0 ? "active" : ""}" onclick="openStockProductLimitedDialog('${product.id}')">Menipis</button>`}
        <button class="btn stock-status-btn soldout ${product.soldOut ? "active" : ""}" onclick="setStockProductSoldOut('${product.id}', true)">Habis</button>
      </div>
      ${variants.length ? stockVariantDetailsHtml(product, variantGroups) : ""}
    </article>
  `;
}

function stockAddonCardHtml(addon) {
  const displayStatus = stockProductStatusLabel(addon);
  const displayClass = displayStatus === "Habis" ? "cancel" : "ready";
  return `
    <article class="stock-product-card ${addon.soldOut ? "soldout" : ""}" data-stock-row data-stock-type="addon" data-stock-id="${escapeHtml(addon.id)}" data-stock-search="${escapeHtml(stockSearchText(addon))}">
      <div class="stock-product-main">
        <div class="stock-product-token">${escapeHtml((addon.name || "AD").slice(0, 2).toUpperCase())}</div>
        <div class="stock-product-info">
          <div class="stock-product-title">
            <strong>${escapeHtml(addon.name)}</strong>
            <span class="pill ${displayClass}">${displayStatus}</span>
          </div>
          <div class="stock-product-meta">
            <span>Add-on</span><span>Jual <b>${money(addon.price)}</b></span>
          </div>
        </div>
      </div>
      <div class="stock-product-actions">
        <button class="btn stock-status-btn available ${!addon.soldOut ? "active" : ""}" onclick="setStockAddonSoldOut('${addon.id}', false)">Tersedia</button>
        <button class="btn stock-status-btn soldout ${addon.soldOut ? "active" : ""}" onclick="setStockAddonSoldOut('${addon.id}', true)">Habis</button>
      </div>
    </article>
  `;
}

function stockVariantDetailsHtml(product, variantGroups) {
  const openIds = JSON.parse(sessionStorage.getItem("stock_variant_open") || "[]");
  const isOpen = openIds.includes(product.id);
  const variants = variantGroups.flatMap(group => group.variants);
  return `
    <details class="stock-variant-details" ${isOpen ? "open" : ""} ontoggle='syncStockVariantOpen(this, ${JSON.stringify(product.id)})'>
      <summary><b>Tampilkan Varian</b>${stockVariantSoldOutSummaryHtml(product, variants)}</summary>
      <div class="stock-variant-panel">
        ${variantGroups.map(group => `
          <section class="stock-variant-group">
            <h4>${escapeHtml(group.title)}</h4>
            <div class="stock-variant-list">
              ${group.variants.map(variant => stockVariantRowHtml(product, variant)).join("")}
            </div>
          </section>
        `).join("")}
      </div>
    </details>
  `;
}

function stockVariantSoldOutSummaryHtml(product, variants) {
  const soldOutCount = variants.filter(variant => product.soldOut || isProductVariantSoldOut(product, variant.key)).length;
  if (!soldOutCount) return "";
  return `<small class="stock-variant-soldout-note">${soldOutCount} dari ${variants.length} varian habis</small>`;
}

function stockVariantRowHtml(product, variant) {
  const option = productVariantStockOption(product, variant.key);
  const limited = option?.trackStock === true && Number(option.stock || 0) > 0;
  const soldOut = product.soldOut || isProductVariantSoldOut(product, variant.key);
  const available = !product.soldOut && !soldOut && !limited;
  return `
    <div class="stock-variant-row">
      <span>${escapeHtml(variant.label)}${limited ? `<small>Sisa ${Number(option.stock || 0)}</small>` : ""}</span>
      <span class="stock-variant-actions">
        <button type="button" class="${available ? "active" : ""}" onclick='toggleStockVariantAvailability(${JSON.stringify(product.id)}, ${JSON.stringify(variant.key)}, false)' ${product.soldOut ? "disabled" : ""}>Tersedia</button>
        <button type="button" class="limited ${limited && !product.soldOut ? "active" : ""}" onclick='openStockVariantLimitedDialog(${JSON.stringify(product.id)}, ${JSON.stringify(variant.key)})' ${product.soldOut ? "disabled" : ""}>Menipis</button>
        <button type="button" class="${soldOut ? "danger active is-solid-danger" : "danger"}" onclick='toggleStockVariantAvailability(${JSON.stringify(product.id)}, ${JSON.stringify(variant.key)}, true)'>Habis</button>
      </span>
    </div>
  `;
}

function filterStockList(query = "") {
  sessionStorage.setItem("stock_query", query);
  const normalized = String(query || "").trim().toLowerCase();
  let visible = 0;
  document.querySelectorAll("[data-stock-row]").forEach(row => {
    const searchText = String(row.dataset.stockSearch || "").toLowerCase();
    const isVisible = !normalized || searchText.includes(normalized);
    row.hidden = !isVisible;
    row.classList.toggle("is-hidden", !isVisible);
    if (isVisible) visible += 1;
  });
  document.querySelectorAll("[data-stock-visible-count]").forEach(node => {
    node.textContent = String(visible);
  });
}

function updateStockMonitorSummaryDom() {
  const summary = stockMonitorSummary();
  const values = [summary.total, summary.soldOut, summary.limited, summary.safe];
  document.querySelectorAll(".stock-monitor-summary .stock-summary-card strong").forEach((node, index) => {
    node.textContent = String(values[index] ?? node.textContent);
  });
  const visible = [...document.querySelectorAll("[data-stock-row]")].filter(row => !row.hidden && !row.classList.contains("is-hidden")).length;
  document.querySelectorAll("[data-stock-visible-count]").forEach(node => {
    node.textContent = String(visible);
  });
}

function updateStockUpdateButtonState() {
  const button = document.querySelector(".stock-update-btn");
  if (!button || typeof queuedMasterSyncCount !== "function") return;
  const count = queuedMasterSyncCount();
  button.classList.toggle("has-queue", count > 0);
  button.title = count ? `${count} update stok dalam antrean` : "Update stok ke Supabase";
  let badge = button.querySelector(".stock-sync-queue-badge");
  if (count) {
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "stock-sync-queue-badge";
      button.prepend(badge);
    }
    badge.textContent = String(count);
  } else {
    badge?.remove();
  }
}

function stockRowForEntry(entry) {
  const type = entry?.type === "addon" ? "addon" : "product";
  const id = String(entry?.id || "");
  return [...document.querySelectorAll("[data-stock-row]")].find(row => row.dataset.stockType === type && row.dataset.stockId === id);
}

function updateStockRowUiFirst(entry) {
  const row = stockRowForEntry(entry);
  if (row) {
    const html = entry.type === "addon" ? stockAddonCardHtml(entry) : stockProductCardHtml(entry);
    const template = document.createElement("template");
    template.innerHTML = html.trim();
    const next = template.content.firstElementChild;
    if (next) row.replaceWith(next);
  }
  filterStockList(sessionStorage.getItem("stock_query") || "");
  updateStockMonitorSummaryDom();
  updateStockUpdateButtonState();
}

function setStockProductSoldOut(productId, soldOut) {
  const product = state.products.find(item => item.id === productId);
  if (!product) return;
  const variants = productAvailabilityVariants(product);
  if (Boolean(product.soldOut) === Boolean(soldOut) && (variants.length || soldOut || !product.trackStock)) return;
  product.soldOut = Boolean(soldOut);
  if (!variants.length) {
    if (soldOut) {
      if (product.trackStock) product.stock = 0;
      delete product.stockAutoSoldOut;
    } else {
      product.trackStock = false;
      delete product.stockAutoSoldOut;
    }
  }
  audit(product.soldOut ? "Produk ditandai habis" : "Produk tersedia kembali", product.name);
  markMasterSyncPending?.("product", product, "upsert", { userInitiated: true }, new Error("Menunggu update stok."));
  saveState();
  updateStockRowUiFirst(product);
  syncMasterEntity("product", product, "upsert", { userInitiated: true }).finally(updateStockUpdateButtonState);
  broadcastRealtimeEvent("products");
}

function setStockAddonSoldOut(addonId, soldOut) {
  const addon = state.addons.find(item => item.id === addonId);
  if (!addon || Boolean(addon.soldOut) === Boolean(soldOut)) return;
  addon.soldOut = Boolean(soldOut);
  audit(addon.soldOut ? "Add-on ditandai habis" : "Add-on tersedia kembali", addon.name);
  markMasterSyncPending?.("addon", addon, "upsert", { userInitiated: true }, new Error("Menunggu update stok."));
  saveState();
  updateStockRowUiFirst(addon);
  syncMasterEntity("addon", addon, "upsert", { userInitiated: true }).finally(updateStockUpdateButtonState);
  broadcastRealtimeEvent("products");
}

function toggleStockVariantAvailability(productId, variantKey, soldOut) {
  const product = state.products.find(item => item.id === productId);
  if (!product) return;
  const openIds = new Set(JSON.parse(sessionStorage.getItem("stock_variant_open") || "[]"));
  openIds.add(productId);
  sessionStorage.setItem("stock_variant_open", JSON.stringify([...openIds]));
  product.soldOutVariants ||= {};
  const option = productVariantStockOption(product, variantKey);
  if (soldOut) {
    product.soldOutVariants[variantKey] = true;
    if (option?.trackStock) option.stock = 0;
    if (option) delete option.stockAutoSoldOut;
  } else {
    delete product.soldOutVariants[variantKey];
    if (option) {
      option.trackStock = false;
      delete option.stockAutoSoldOut;
    }
  }
  markMasterSyncPending?.("product", product, "upsert", { userInitiated: true }, new Error("Menunggu update stok."));
  saveState();
  updateStockRowUiFirst(product);
  syncMasterEntity("product", product, "upsert", { userInitiated: true }).finally(updateStockUpdateButtonState);
  broadcastRealtimeEvent("products");
}

function openStockProductLimitedDialog(productId) {
  const product = state.products.find(item => item.id === productId);
  if (!product || productAvailabilityVariants(product).length) return;
  openModal(stockLimitedQtyDialogHtml({
    title: "Stok Menipis",
    subtitle: product.name,
    submitAction: `setStockProductLimited(event, '${escapeHtml(product.id)}')`
  }));
}

function openStockVariantLimitedDialog(productId, variantKey) {
  const product = state.products.find(item => item.id === productId);
  const option = productVariantStockOption(product, variantKey);
  if (!product || !option || product.soldOut) return;
  openModal(stockLimitedQtyDialogHtml({
    title: "Stok Varian Menipis",
    subtitle: `${product.name} - ${option.name}`,
    submitAction: `setStockVariantLimited(event, ${JSON.stringify(product.id)}, ${JSON.stringify(variantKey)})`
  }));
}

function stockLimitedQtyDialogHtml({ title, subtitle, submitAction }) {
  return `
    <form class="stock-limited-dialog" onsubmit="${escapeHtml(submitAction)}">
      <div class="stock-limited-head">
        <span class="stock-limited-kicker">Menipis</span>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(subtitle)}</p>
      </div>
      <label class="stock-limited-field">
        <span>Sisa stok saat ini</span>
        <div class="stock-limited-stepper">
          <button type="button" aria-label="Kurangi stok" onclick="adjustStockLimitedQty(-1)">-</button>
          <input
            name="limitedStock"
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            placeholder="0"
            autocomplete="off"
            oninput="sanitizeStockLimitedQtyInput(this)"
            data-stock-limited-input
            autofocus
          />
          <button type="button" aria-label="Tambah stok" onclick="adjustStockLimitedQty(1)">+</button>
        </div>
      </label>
      <div class="stock-limited-actions">
        <button class="btn" type="button" onclick="closeModal()">Batal</button>
        <button class="btn accent" type="submit">Simpan</button>
      </div>
    </form>
  `;
}

function sanitizeStockLimitedQtyInput(input) {
  if (!input) return;
  const value = String(input.value || "").replace(/[^\d]/g, "");
  input.value = value ? String(Math.floor(Number(value))) : "";
}

function adjustStockLimitedQty(delta) {
  const input = document.querySelector("[data-stock-limited-input]");
  if (!input) return;
  const current = Math.max(0, Math.floor(Number(input.value || 0)));
  const next = Math.max(0, current + Number(delta || 0));
  input.value = next ? String(next) : "";
  input.focus();
}

function commitLimitedStockChange(product, action, detail) {
  audit(action, detail);
  markMasterSyncPending?.("product", product, "upsert", { userInitiated: true }, new Error("Menunggu update stok."));
  saveState();
  closeModal({ skipHistory: true });
  updateStockRowUiFirst(product);
  syncMasterEntity("product", product, "upsert", { userInitiated: true }).finally(updateStockUpdateButtonState);
  broadcastRealtimeEvent("products");
}

function setStockProductLimited(event, productId) {
  event.preventDefault();
  const product = state.products.find(item => item.id === productId);
  const qty = Math.floor(Number(new FormData(event.currentTarget).get("limitedStock") || 0));
  if (!product || productAvailabilityVariants(product).length || qty < 1) return toast("Sisa stok minimal 1.");
  product.trackStock = true;
  product.stock = qty;
  product.soldOut = false;
  delete product.stockAutoSoldOut;
  commitLimitedStockChange(product, "Stok produk ditandai menipis", `${product.name}; sisa ${qty}`);
}

function setStockVariantLimited(event, productId, variantKey) {
  event.preventDefault();
  const product = state.products.find(item => item.id === productId);
  const option = productVariantStockOption(product, variantKey);
  const qty = Math.floor(Number(new FormData(event.currentTarget).get("limitedStock") || 0));
  if (!product || !option || qty < 1) return toast("Sisa stok minimal 1.");
  option.trackStock = true;
  option.stock = qty;
  delete option.stockAutoSoldOut;
  product.soldOutVariants ||= {};
  delete product.soldOutVariants[variantKey];
  commitLimitedStockChange(product, "Stok varian ditandai menipis", `${product.name} - ${option.name}; sisa ${qty}`);
}

if (location.hash.replace("#", "") === "stock") {
  setTimeout(() => render(), 0);
}
