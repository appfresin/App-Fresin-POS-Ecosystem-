// Page renderer extracted from app.js. Depends on shared helpers/globals in app.js.

function renderProducts() {
  const categories = productCategories();
  const query = sessionStorage.getItem("product_query") || "";
  const categoryFilter = sessionStorage.getItem("product_category") || "Semua";
  const products = stableProducts(state.products);
  const filtered = products
    .filter(product => [product.name, product.category, product.sku].join(" ").toLowerCase().includes(query.toLowerCase()))
    .filter(product => categoryFilter === "Semua" || product.category === categoryFilter)
    .sort((a, b) => a.name.localeCompare(b.name));

  return `
    <section class="products-page products-page-compact">
      <div class="products-admin-actions">
        <div>
          <button class="products-tool-btn" onclick="openCategoryManager()">Kelola Kategori</button>
          <button class="products-tool-btn" onclick="openAddonManager()">Kelola Add-on</button>
          <button class="products-tool-btn" onclick="openStockPage()">Kelola Stok</button>
        </div>
      </div>
      <div class="products-control-bar">
        <label class="products-search">
          ${navIcon("search")}
          <input value="${escapeHtml(query)}" oninput="filterProductsLive(this)" placeholder="Cari produk" autocomplete="off" spellcheck="false" />
        </label>
        ${productSelect("product_category", ["Semua", ...categories], categoryFilter)}
      </div>
      <div class="products-list-toolbar">
        <div class="products-result-count" data-products-result-count>${filtered.length} dari ${products.length} barang</div>
        <button class="products-add-inline-btn" type="button" onclick="openProductForm()">+ Barang</button>
      </div>
      <div class="products-list" data-products-list>
        ${filtered.map(productMasterCard).join("") || empty("Barang tidak ditemukan.")}
      </div>
    </section>
  `;
}

function filteredProductsForCurrentControls() {
  const query = sessionStorage.getItem("product_query") || "";
  const categoryFilter = sessionStorage.getItem("product_category") || "Semua";
  const normalizedQuery = query.trim().toLowerCase();
  return stableProducts(state.products)
    .filter(product => !normalizedQuery || [product.name, product.category, product.sku].join(" ").toLowerCase().includes(normalizedQuery))
    .filter(product => categoryFilter === "Semua" || product.category === categoryFilter)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "id", { sensitivity: "base" }));
}

function updateProductsListHtml() {
  const list = document.querySelector("[data-products-list]");
  const count = document.querySelector("[data-products-result-count]");
  if (!list || !count) return render();
  const products = stableProducts(state.products);
  const filtered = filteredProductsForCurrentControls();
  list.innerHTML = filtered.map(productMasterCard).join("") || empty("Barang tidak ditemukan.");
  count.textContent = `${filtered.length} dari ${products.length} barang`;
}

function filterProductsLive(input) {
  sessionStorage.setItem("product_query", input?.value || "");
  updateProductsListHtml();
}

function productStatCard(label, value, hint, primary = false) {
  return `
    <article class="products-stat ${primary ? "primary" : ""}">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${hint}</small>
    </article>
  `;
}

function productSelect(storageKey, options, selected) {
  return `
    <label class="products-select-field">
      <select onchange="sessionStorage.setItem('${storageKey}', this.value); updateProductsListHtml()">
        ${options.map(item => `<option value="${escapeHtml(item)}" ${item === selected ? "selected" : ""}>${escapeHtml(item === "Semua" ? "Kategori" : item)}</option>`).join("")}
      </select>
    </label>
  `;
}

function productMasterCard(product) {
  const photo = mediaImageTag(product.imageName, `Foto ${product.name}`, "product-master-thumb", 120);
  return `
    <article class="product-master-row ${product.active ? "" : "inactive"} ${product.soldOut ? "soldout" : ""}">
      <div class="product-master-main">
        <div class="product-master-token ${photo ? "has-photo" : ""}">${photo || escapeHtml((product.name || "PR").slice(0, 2).toUpperCase())}</div>
        <div class="product-master-title">
          <h3>${escapeHtml(product.name)}</h3>
        </div>
      </div>
      <div class="product-master-card-actions">
        <button class="btn" onclick="openProductForm('${product.id}')">Edit</button>
        <button class="btn red" onclick="deleteProduct('${product.id}')">Hapus</button>
      </div>
    </article>
  `;
}
