// Page renderer extracted from app.js. Depends on shared helpers/globals in app.js.

function renderPos() {
  const mobileView = sessionStorage.getItem("pos_mobile_view") || "items";
  const query = sessionStorage.getItem("pos_query") || "";
  return `
    <div class="pos-layout ${mobileView === "cart" ? "cart-view" : "items-view"} display-${itemDisplay}">
      <div class="grid pos-products-pane">
        <div class="pos-control-panel">
          <div class="pos-search-row">
            <div class="field pos-search"><label>Cari produk / barcode</label><input class="input" data-pos-search value="${escapeHtml(query)}" oninput="updatePosSearch(this)" placeholder="Cari nama produk atau scan barcode" /></div>
            <button class="quick-tool search-tool" type="button" title="Cari produk" onclick="focusPosSearch()">${navIcon("search")}</button>
          </div>
          ${renderPosCategoryCards()}
        </div>
        ${renderPosProductList()}
      </div>
      ${renderPosCartPanel()}
    </div>
    ${renderPosMobileBar()}
  `;
}

function quickPaymentOptions(total) {
  const rounded = Math.ceil(total / 10000) * 10000;
  return [
    { label: "Uang Pas", value: total },
    ...savedPaymentAmounts.map(value => ({ label: money(value).replace("Rp", "Rp "), value })),
    { label: money(rounded), value: rounded }
  ].filter((option, index, list) => option.value >= total && list.findIndex(item => item.value === option.value) === index);
}
