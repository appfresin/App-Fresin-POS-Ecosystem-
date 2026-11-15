// Page renderer extracted from app.js. Depends on shared helpers/globals in app.js.

function productReportQueryTokens(value) {
  return String(value || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function productReportSearchText(row) {
  return String(row.displayName || row.name || "").toLowerCase();
}

function productReportMatchesQuery(row, query) {
  const tokens = productReportQueryTokens(query);
  if (!tokens.length) return true;
  const searchText = productReportSearchText(row);
  return tokens.every(token => searchText.includes(token));
}

function productSalesSummaryLoadedForRange(range) {
  if (!range) return false;
  if (typeof supabaseProductSalesUnavailable !== "undefined" && supabaseProductSalesUnavailable) return false;
  if (typeof supabaseProductSalesLastLoadOk !== "undefined" && !supabaseProductSalesLastLoadOk) return false;
  if (typeof supabaseProductSalesLoadKey === "undefined" || typeof reportLoadKey !== "function") return false;
  return supabaseProductSalesLoadKey === reportLoadKey(range) && Number(supabaseProductSalesLoadedAt || 0) > 0;
}

function productSalesSummaryPendingForRange(range) {
  if (!range) return false;
  if (typeof supabaseProductSalesUnavailable !== "undefined" && supabaseProductSalesUnavailable) return false;
  if (typeof supabaseProductSalesLoading === "undefined" || !supabaseProductSalesLoading) return false;
  return !productSalesSummaryLoadedForRange(range);
}

function productSalesSummaryRecordsInRange(range) {
  const rows = typeof supabaseProductSalesRecords !== "undefined" && Array.isArray(supabaseProductSalesRecords)
    ? supabaseProductSalesRecords
    : [];
  if (!range) return rows;
  const startKey = todayKey(range.start);
  const endKey = todayKey(range.end);
  return rows.filter(row => {
    const key = row.salesDate || row.sales_date || row.date || "";
    return key >= startKey && key <= endKey;
  });
}

function setProductReportQuery(value) {
  sessionStorage.setItem("product_report_query", value);
  applyProductSalesSearchFilter(value);
}

function applyProductSalesSearchFilter(value = "") {
  const tokens = productReportQueryTokens(value);
  let visibleCount = 0;
  let productQty = 0;
  let productRevenue = 0;
  let productProfit = 0;
  const rows = document.querySelectorAll("[data-product-sales-row]");
  rows.forEach(row => {
    const searchText = String(row.dataset.productSearch || "");
    const matched = !tokens.length || tokens.every(token => searchText.includes(token));
    row.hidden = !matched;
    row.classList.toggle("is-filtered-out", !matched);
    row.style.display = matched ? "" : "none";
    if (!matched) return;
    visibleCount += 1;
    productQty += Number(row.dataset.productQty || 0);
    productRevenue += Number(row.dataset.productRevenue || 0);
    productProfit += Number(row.dataset.productProfit || 0);
  });
  const qtyNode = document.querySelector("[data-product-sales-summary='qty']");
  const revenueNode = document.querySelector("[data-product-sales-summary='revenue']");
  const profitNode = document.querySelector("[data-product-sales-summary='profit']");
  if (qtyNode) qtyNode.textContent = productQty.toLocaleString("id-ID");
  if (revenueNode) revenueNode.textContent = money(productRevenue);
  if (profitNode) profitNode.textContent = money(productProfit);
  const emptyState = document.querySelector("[data-product-sales-empty]");
  if (emptyState) emptyState.hidden = rows.length === 0 || visibleCount > 0;
}

function renderReports() {
  const range = reportRange();
  const rawSection = sessionStorage.getItem("report_section") || "profit";
  const activeSection = ["profit", "visitors", "productSales"].includes(rawSection) ? rawSection : "profit";
  if (activeSection !== rawSection) sessionStorage.setItem("report_section", activeSection);
  if (activeSection === "productSales" && typeof requestActiveReportData === "function") requestActiveReportData();
  const sectionMenu = `
    <div class="report-section-menu">
      ${[
        ["profit", "Transaksi", "Ikhtisar pendapatan, biaya modal, dan laba."],
        ["visitors", "Pengunjung", "Pantau dine in, take away, dan delivery."],
        ["productSales", "Barang", "Ranking barang, qty, pendapatan, dan keuntungan."]
      ].map(([id, title, hint]) => `
        <button class="${activeSection === id ? "active" : ""}" onclick="sessionStorage.setItem('report_section', '${id}'); render()">
          <span>${title}</span>
          <small>${hint}</small>
        </button>
      `).join("")}
    </div>
  `;
  if (activeSection === "profit") {
    return `
      ${sectionMenu}
      <div>${renderProfitLossDrill()}</div>
    `;
  }
  const completed = reportRecords();
  const gross = completed.reduce((sum, order) => sum + order.subtotal, 0);
  const discount = completed.reduce((sum, order) => sum + order.discount, 0);
  const net = completed.reduce((sum, order) => sum + order.total, 0);
  const profit = completed.reduce((sum, order) => sum + order.profit, 0);
  const paid = completed.filter(order => order.paymentStatus === "Lunas");
  const unpaid = completed.filter(order => order.paymentStatus !== "Lunas");
  const paidValue = paid.reduce((sum, order) => sum + order.total, 0);
  const unpaidValue = unpaid.reduce((sum, order) => sum + order.total, 0);
  const avgOrder = completed.length ? Math.round(net / completed.length) : 0;
  const periodControls = `
    <div class="report-filter-panel report-filter-inline">
      <div class="report-period-tabs">
        ${[["day", "Hari ini"], ["yesterday", "Kemarin"], ["week", "Minggu ini"], ["month", "Bulan ini"]].map(([value, label]) => `<button class="${range.period === value ? "active" : ""}" onclick="sessionStorage.setItem('report_period', '${value}'); render()">${label}</button>`).join("")}
      </div>
      <button class="report-range-picker" onclick="${range.period === "custom" ? "openReportRangeCalendar()" : "sessionStorage.setItem('report_period', 'custom'); openReportRangeCalendar()"}">
        <strong>${escapeHtml(formatReportRangeLabel(range))}</strong>
      </button>
    </div>
  `;
  const estimatedCost = Math.max(0, net - profit);
  const profitMargin = net ? Math.round((profit / net) * 100) : 0;
  const uniqueCustomers = new Set(completed.map(order => order.customer).filter(customer => customer && customer !== "-")).size;
  const activeChartTab = sessionStorage.getItem("report_chart_tab") || "count";
  const trend = reportTrend(completed, range);
  const maxTrendCount = Math.max(1, ...trend.map(item => item.count));
  const maxTrendTotal = Math.max(1, ...trend.map(item => item.total));
  const maxTrendProfit = Math.max(1, ...trend.map(item => {
    const dayRecords = completed.filter(r => todayKey(new Date(reportRecordTime(r))) === item.key);
    return dayRecords.reduce((sum, r) => sum + r.profit, 0);
  }));
  const trendData = {
    count: { max: maxTrendCount, data: trend.map(item => ({ ...item, value: item.count })) },
    total: { max: maxTrendTotal, data: trend.map(item => ({ ...item, value: item.total })) },
    profit: { max: maxTrendProfit, data: trend.map(item => {
      const dayRecords = completed.filter(r => todayKey(new Date(reportRecordTime(r))) === item.key);
      return { ...item, value: dayRecords.reduce((sum, r) => sum + r.profit, 0) };
    }) }
  };
  const maxTrend = Math.max(1, ...trend.map(item => item.count));
  const useRemoteProductSales = productSalesSummaryLoadedForRange(range);
  const productSalesSummaryPending = productSalesSummaryPendingForRange(range);
  const remoteProductRows = productSalesSummaryRecordsInRange(range);
  const byProduct = {};
  if (!useRemoteProductSales && !productSalesSummaryPending) {
    for (const order of completed) {
      for (const item of order.items || []) {
        byProduct[item.name] ??= { code: "", qty: 0, value: 0, profit: 0, transactionCount: 0, source: "Kasirin!", periods: new Set() };
        byProduct[item.name].qty += item.qty;
        byProduct[item.name].value += cartItemTotal(item);
        byProduct[item.name].profit += (Number(item.price || 0) - Number(item.cost || 0)) * Number(item.qty || 1);
        byProduct[item.name].transactionCount += 1;
        byProduct[item.name].periods.add("Transaksi aplikasi");
        for (const addon of item.addons || []) {
          const addonName = addon.name || "Add-on";
          byProduct[addonName] ??= { code: "", qty: 0, value: 0, profit: 0, transactionCount: 0, source: "Kasirin! Add-on", periods: new Set() };
          const addonQty = Number(addon.qty || 1);
          byProduct[addonName].qty += addonQty;
          byProduct[addonName].value += Number(addon.price || 0) * addonQty;
          byProduct[addonName].profit += addonProfit(addon);
          byProduct[addonName].transactionCount += 1;
          byProduct[addonName].periods.add("Transaksi aplikasi");
        }
      }
    }
  }
  for (const row of remoteProductRows) {
    const key = row.code ? `${row.code} - ${row.name}` : row.name;
    byProduct[key] ??= { code: row.code || "", displayName: row.name || key, qty: 0, value: 0, profit: 0, transactionCount: 0, source: "Supabase Ringkasan Barang", periods: new Set() };
    byProduct[key].qty += Number(row.qty || 0);
    byProduct[key].value += Number(row.revenue || 0);
    byProduct[key].profit += Number(row.profit || 0);
    byProduct[key].transactionCount += Number(row.transactionCount || 0);
    if (row.source) byProduct[key].source = row.source;
    if (row.salesDate) byProduct[key].periods.add(formatDateKey(row.salesDate));
  }
  const legacyProductRows = productSalesSummaryPending ? [] : productSalesRecordsInRange(range);
  for (const row of legacyProductRows) {
    const key = row.code ? `${row.code} - ${row.name}` : row.name;
    byProduct[key] ??= { code: row.code || "", displayName: row.name || key, qty: 0, value: 0, profit: 0, transactionCount: 0, source: "Import Penjualan Barang Lama", periods: new Set() };
    byProduct[key].qty += Number(row.qty || 0);
    byProduct[key].value += Number(row.revenue || 0);
    byProduct[key].profit += Number(row.profit || 0);
    byProduct[key].transactionCount += Number(row.transactionCount || 0);
    if (row.source) byProduct[key].source = row.source;
    byProduct[key].periods.add(productSalesPeriodLabel(row));
  }
  const productSearch = sessionStorage.getItem("product_report_query") || "";
  const allProductReportRows = Object.entries(byProduct)
    .map(([name, data]) => ({ name, ...data, periodLabel: [...(data.periods || [])].join(", ") }))
    .sort((a, b) => b.qty - a.qty || b.value - a.value);
  const productReportRows = allProductReportRows.filter(row => productReportMatchesQuery(row, productSearch));
  const productQty = productReportRows.reduce((sum, row) => sum + row.qty, 0);
  const productRevenue = productReportRows.reduce((sum, row) => sum + row.value, 0);
  const productProfit = productReportRows.reduce((sum, row) => sum + row.profit, 0);
  const productReportList = allProductReportRows.map(row => {
    const title = row.displayName || row.name;
    const initials = title.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "PR";
    const visible = productReportMatchesQuery(row, productSearch);
    return `
      <div class="product-sales-row ${visible ? "" : "is-filtered-out"}" data-product-sales-row data-product-search="${escapeHtml(productReportSearchText(row))}" data-product-qty="${Number(row.qty || 0)}" data-product-revenue="${Number(row.value || 0)}" data-product-profit="${Number(row.profit || 0)}" ${visible ? "" : "hidden style=\"display:none\""}>
        <span class="product-sales-avatar">${escapeHtml(initials)}</span>
        <div class="product-sales-main">
          <strong>${escapeHtml(title)}</strong>
          <span><small>Keuntungan</small><b>${money(row.profit)}</b></span>
          <span><small>Pendapatan</small><b>${money(row.value)}</b></span>
        </div>
        <em>${Number(row.qty || 0).toLocaleString("id-ID")}</em>
      </div>
    `;
  }).join("");
  const productRows = Object.entries(byProduct).sort((a, b) => b[1].value - a[1].value).slice(0, 10).map(([name, data]) => `<tr><td>${escapeHtml(name)}</td><td>${data.qty}</td><td>${money(data.value)}</td></tr>`).join("");
  const topProductCards = Object.entries(byProduct)
    .sort((a, b) => b[1].qty - a[1].qty || b[1].value - a[1].value)
    .slice(0, 5)
    .map(([name, data], index) => `
      <div class="report-rank-row">
        <b>${index + 1}</b>
        <span><strong>${escapeHtml(name)}</strong><small>${data.qty} terjual</small></span>
        <em>${money(data.value)}</em>
      </div>
    `).join("");
  const typeRows = ORDER_TYPES.map(type => {
    const orders = completed.filter(order => order.type === type.id);
    const count = orders.length;
    const value = orders.reduce((sum, order) => sum + order.total, 0);
    return {
      id: type.id,
      label: type.title,
      count,
      value,
      avg: count ? Math.round(value / count) : 0,
      share: completed.length ? Math.round((count / completed.length) * 100) : 0,
      peakHour: visitorPeakHour(orders)
    };
  });
  const visitorRows = completed;
  const visitorTypeId = sessionStorage.getItem("visitor_report_type") || "";
  const visitorType = ORDER_TYPES.find(type => type.id === visitorTypeId);
  const visitorDetailRows = visitorType ? completed.filter(order => order.type === visitorType.id) : completed;
  const visitorValue = visitorRows.reduce((sum, order) => sum + order.total, 0);
  const visitorAvg = visitorRows.length ? Math.round(visitorValue / visitorRows.length) : 0;
  const visitorPeak = visitorPeakHour(visitorRows);
  const dominantType = typeRows.slice().sort((a, b) => b.count - a.count)[0];
  setReportReceiptNavigationKeys(visitorDetailRows);
  const visitorProductRows = Object.values(visitorDetailRows.reduce((map, order) => {
    (order.items || order.cart || []).forEach(item => {
      const name = item.name || "Item";
      const qty = Number(item.qty || item.quantity || 1);
      if (!map[name]) map[name] = { name, qty: 0, value: 0 };
      map[name].qty += qty;
      map[name].value += Number(item.price || 0) * qty;
    });
    return map;
  }, {})).sort((a, b) => b.qty - a.qty || b.value - a.value).slice(0, 3);
  const largestPurchase = visitorDetailRows.slice().sort((a, b) => {
    const totalDiff = Number(b.total || 0) - Number(a.total || 0);
    if (totalDiff) return totalDiff;
    return reportRecordTime(b) - reportRecordTime(a);
  })[0];
  const paymentRows = [...new Set(completed.map(order => order.paymentMethod || "Belum dipilih"))].map(method => {
    const orders = completed.filter(order => (order.paymentMethod || "Belum dipilih") === method);
    return {
      label: method,
      count: orders.length,
      value: orders.reduce((sum, order) => sum + order.total, 0)
    };
  }).sort((a, b) => b.value - a.value);
  const recentRows = completed.slice(0, 10).map(order => `
    <div class="report-activity-row">
      <div><strong>${escapeHtml(order.number)}</strong><span>${dateTime(order.paidAt || order.createdAt)} - ${escapeHtml(order.customer)}</span></div>
      <b>${money(order.total)}</b>
    </div>
  `).join("");
  const historyRows = trend.filter(item => item.count || range.period === "month").slice().reverse().map(item => `
    <div class="report-day-row">
      <div><strong>${range.group === "hour" ? item.label : item.key.slice(-2)}</strong><span>${range.group === "hour" ? range.label : range.label}</span></div>
      <span>${item.count} transaksi</span>
      <b>${money(item.total)}</b>
    </div>
  `).join("");
  return `
    ${sectionMenu}
    <div class="${activeSection === "visitors" ? "" : "hidden"}">
      <section class="report-section-panel visitor-report-panel">
        ${periodControls}
        <div class="visitor-overview-card">
          <div class="visitor-overview-stats">
            <div><span>Jumlah Pesanan</span><strong>${visitorRows.length.toLocaleString("id-ID")}</strong></div>
            <div><span>Omzet</span><strong>${money(visitorValue)}</strong></div>
            <div><span>Rata-rata Transaksi</span><strong>${money(visitorAvg)}</strong></div>
            <div><span>Jam ramai</span><strong>${visitorPeak.label}</strong></div>
          </div>
        </div>
        <div class="card report-card report-section-card">
          <div class="section-title"><div><h3>Jenis Pesanan</h3><p>Pilih tipe pesanan untuk melihat rincian transaksi.</p></div></div>
          <div class="report-breakdown visitor-breakdown">${typeRows.map(row => `<button class="${visitorTypeId === row.id ? "active" : ""}" onclick="sessionStorage.setItem('visitor_report_type', '${row.id}'); render()"><span><strong>${row.label}</strong><small>${row.count} pesanan - ${row.share}% kontribusi</small></span><b>${money(row.value)}</b></button>`).join("")}</div>
        </div>
        <div class="visitor-insight-grid">
          <div class="card report-card report-section-card visitor-top-products-card">
            <div class="section-title">
              <div><h3>Produk Terlaris</h3><p>${visitorType ? visitorType.title : "Semua transaksi"} pada periode ini.</p></div>
              ${visitorType ? `<button class="btn visitor-clear-filter" onclick="sessionStorage.removeItem('visitor_report_type'); render()">Semua</button>` : ""}
            </div>
            <div class="dashboard-top-products">
              ${visitorProductRows.map(item => `
                <div class="dashboard-top-product-row">
                  <strong>${escapeHtml(item.name)}</strong>
                  <span>${Number(item.qty || 0).toLocaleString("id-ID")}</span>
                </div>
              `).join("") || `<div class="dashboard-empty-state"><span></span><p>Belum ada produk terjual pada periode ini.</p></div>`}
            </div>
          </div>
          <div class="card report-card report-section-card visitor-largest-card">
            <div class="section-title"><div><h3>Pembelian Terbesar</h3><p>Nominal transaksi tertinggi pada periode ini.</p></div></div>
            ${largestPurchase ? `
              <button class="visitor-largest-purchase" onclick='openReportVisitorReceipt(event, ${JSON.stringify(reportRecordKey(largestPurchase))})'>
                <span>
                  <small>${escapeHtml(shortOrderNumber(largestPurchase.number))}</small>
                  <strong>${money(largestPurchase.total)}</strong>
                </span>
                <div>
                  <b>${escapeHtml(String(largestPurchase.customer || "").trim())}</b>
                  <em>${escapeHtml(largestPurchase.type || "-")} - ${dateTime(largestPurchase.paidAt || largestPurchase.createdAt)}</em>
                </div>
                <i>&rarr;</i>
              </button>
            ` : `<div class="dashboard-empty-state"><span></span><p>Belum ada pembelian pada periode ini.</p></div>`}
          </div>
        </div>
      </section>
    </div>
    <div class="${activeSection === "productSales" ? "" : "hidden"}">
      <section class="report-section-panel product-sales-panel">
        ${periodControls}
        <div class="product-sales-tools">
          <label class="product-sales-search"><span>⌕</span><input value="${escapeHtml(productSearch)}" placeholder="Cari nama atau kode barang" oninput="setProductReportQuery(this.value)" /></label>
        </div>
        <section class="product-sales-summary">
          <span>Qty Terjual</span>
          <strong data-product-sales-summary="qty">${productQty.toLocaleString("id-ID")}</strong>
          <div><small>Pendapatan</small><b data-product-sales-summary="revenue">${money(productRevenue)}</b></div>
          <div><small>Keuntungan</small><b data-product-sales-summary="profit">${money(productProfit)}</b></div>
        </section>
        <div class="product-sales-notice">${productSalesFilterNote(range, legacyProductRows.length, useRemoteProductSales, remoteProductRows.length)}</div>
        <div class="product-sales-list">
          ${productSalesSummaryPending ? empty("Sedang memuat ringkasan barang...") : productReportList || empty("Belum ada rincian barang pada periode ini.")}
          <div data-product-sales-empty ${allProductReportRows.length && !productReportRows.length ? "" : "hidden"}>${empty("Barang tidak ditemukan pada periode ini.")}</div>
        </div>
      </section>
    </div>
  `;
}

function visitorPeakHour(records) {
  if (!records.length) return { label: "-", count: 0 };
  const buckets = new Map();
  for (const record of records) {
    const hour = new Date(record.createdAt || 0).getHours();
    const label = `${String(hour).padStart(2, "0")}:00`;
    buckets.set(label, (buckets.get(label) || 0) + 1);
  }
  const [label, count] = [...buckets.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || ["-", 0];
  return { label, count };
}

function shortOrderNumber(number) {
  const text = String(number || "-");
  const orderMatch = text.match(/(?:ORD-)?\d{8}-(\d+)$/i);
  if (orderMatch) return `#${orderMatch[1]}`;
  const lastDash = text.split("-").filter(Boolean).at(-1);
  return lastDash && lastDash.length <= 6 ? `#${lastDash}` : text;
}

function localDateFromKey(key) {
  const [year, month, day] = String(key || todayKey()).split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function formatDateKey(key) {
  const formatter = new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  return formatter.format(localDateFromKey(key));
}

function formatReportRangeLabel(range = null) {
  const from = range ? todayKey(range.start) : (sessionStorage.getItem("report_from") || todayKey());
  const to = range ? todayKey(range.end) : (sessionStorage.getItem("report_to") || from);
  const start = from <= to ? from : to;
  const end = from <= to ? to : from;
  const startLabel = formatDateKey(start);
  const endLabel = formatDateKey(end);
  return start === end ? startLabel : `${startLabel} - ${endLabel}`;
}

function reportCalendarMonthStart() {
  const value = sessionStorage.getItem("report_calendar_month") || (sessionStorage.getItem("report_from") || todayKey()).slice(0, 7);
  const [year, month] = value.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

function openReportRangeCalendar() {
  const monthStart = reportCalendarMonthStart();
  const from = sessionStorage.getItem("report_from") || todayKey();
  const to = sessionStorage.getItem("report_to") || from;
  const start = from <= to ? from : to;
  const end = from <= to ? to : from;
  const monthTitle = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(monthStart);
  const firstDay = new Date(monthStart);
  const offset = (firstDay.getDay() + 6) % 7;
  const gridStart = new Date(firstDay);
  gridStart.setDate(gridStart.getDate() - offset);
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const key = todayKey(date);
    const inMonth = date.getMonth() === monthStart.getMonth();
    const selected = key === start || key === end;
    const inRange = key > start && key < end;
    return `
      <button class="${inMonth ? "" : "muted"} ${selected ? "selected" : ""} ${inRange ? "in-range" : ""}" onclick="chooseReportCalendarDate('${key}')">
        ${date.getDate()}
      </button>
    `;
  }).join("");
  openModal(`
    <div class="range-calendar-modal">
      <div class="section-title">
        <div>
          <h3>Pilih Rentang Tanggal</h3>
          <p>${escapeHtml(formatReportRangeLabel())}</p>
        </div>
        <button class="btn" onclick="closeModal({ skipHistory: true })">Tutup</button>
      </div>
      <div class="range-calendar-nav">
        <button onclick="shiftReportCalendarMonth(-1)">&#8249;</button>
        <strong>${escapeHtml(monthTitle)}</strong>
        <button onclick="shiftReportCalendarMonth(1)">&#8250;</button>
      </div>
      <div class="range-calendar-weekdays">${["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"].map(day => `<span>${day}</span>`).join("")}</div>
      <div class="range-calendar-grid">${days}</div>
      <div class="range-calendar-actions">
        <button class="btn" onclick="sessionStorage.setItem('report_from', '${todayKey()}'); sessionStorage.setItem('report_to', '${todayKey()}'); closeModal({ skipHistory: true }); render()">Hari ini</button>
        <button class="btn primary" onclick="closeModal({ skipHistory: true }); render()">Terapkan</button>
      </div>
    </div>
  `, { skipHistory: true });
}

function shiftReportCalendarMonth(direction) {
  const monthStart = reportCalendarMonthStart();
  monthStart.setMonth(monthStart.getMonth() + Number(direction || 0));
  sessionStorage.setItem("report_calendar_month", monthKey(monthStart));
  openReportRangeCalendar();
}

function chooseReportCalendarDate(key) {
  const from = sessionStorage.getItem("report_from");
  const to = sessionStorage.getItem("report_to");
  if (!from || (from && to)) {
    sessionStorage.setItem("report_from", key);
    sessionStorage.removeItem("report_to");
    openReportRangeCalendar();
    return;
  }
  const start = from <= key ? from : key;
  const end = from <= key ? key : from;
  sessionStorage.setItem("report_from", start);
  sessionStorage.setItem("report_to", end);
  closeModal({ skipHistory: true });
  render();
}

function productSalesRecordsInRange(range) {
  return (state.importedProductSales || []).filter(row => {
    const start = row.periodStart ? startOfLocalDay(row.periodStart) : null;
    const end = row.periodEnd ? endOfLocalDay(row.periodEnd) : start;
    if (!start || !end) return true;
    return start >= range.start && end <= range.end;
  });
}

function productSalesPeriodLabel(row) {
  const start = row.periodStart ? startOfLocalDay(row.periodStart) : null;
  const end = row.periodEnd ? endOfLocalDay(row.periodEnd) : start;
  if (!start || !end) return "Periode lama";
  const formatter = new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  if (todayKey(start) === todayKey(end)) return formatter.format(start);
  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

function productSalesFilterNote(range, legacyCount, remoteLoaded = false, remoteCount = 0) {
  if (remoteLoaded) {
    return `${remoteCount.toLocaleString("id-ID")} ringkasan barang Supabase masuk filter ${range.label}. Data ini dihitung harian dari transaksi lunas, jadi lebih ringan dan tidak bergantung pada cache order di perangkat.`;
  }
  if (legacyCount) {
    return `${legacyCount.toLocaleString("id-ID")} baris data barang historis masuk filter ${range.label}. Data lama berbentuk agregat file, jadi hanya ditampilkan jika periode file tercakup penuh oleh filter.`;
  }
  if ((state.importedProductSales || []).length) {
    return "Belum ada data barang historis yang cocok. Untuk data lama berbentuk agregat file, pilih rentang yang mencakup penuh periode file, misalnya 01/05/2026 sampai 31/05/2026.";
  }
  return "Jika data laporan tidak lengkap, lakukan sinkronisasi atau impor data barang yang memiliki rincian item.";
}

function reportReceiptCandidates() {
  return [
    ...reportRecords(),
    ...reportAllRecords(),
    ...(state.orders || []).map(orderReportRecord),
    ...(state.importedSales || []).map(importedReportRecord),
    ...(typeof supabaseReportRecords !== "undefined" && Array.isArray(supabaseReportRecords) ? supabaseReportRecords : [])
  ];
}

function uniqueReportReceiptKeys(records) {
  return [...new Set((records || []).map(record => typeof record === "string" ? record : reportRecordKey(record)).filter(Boolean))];
}

function setReportReceiptNavigationKeys(records) {
  sessionStorage.setItem("report_receipt_keys", JSON.stringify(uniqueReportReceiptKeys(records)));
}

function reportReceiptNavigationKeys(currentKey = "") {
  let keys = [];
  try {
    keys = JSON.parse(sessionStorage.getItem("report_receipt_keys") || "[]");
  } catch {
    keys = [];
  }
  keys = Array.isArray(keys) ? keys.filter(Boolean) : [];
  if (!keys.length || (currentKey && !keys.includes(currentKey))) {
    keys = uniqueReportReceiptKeys(reportRecords());
  }
  return keys;
}

function reportReceiptSiblingKey(recordKey, direction) {
  const keys = reportReceiptNavigationKeys(recordKey);
  const index = keys.indexOf(recordKey);
  if (index < 0) return "";
  return keys[index + direction] || "";
}

async function resolveReportReceiptOrder(recordKey, showLoading = false) {
  const candidates = [
    ...reportReceiptCandidates()
  ].filter(record => reportRecordKey(record) === recordKey);
  let order = candidates.find(record => (record.items || []).length) || candidates[0];
  if (!order) {
    toast("Transaksi tidak ditemukan.");
    return null;
  }

  if (!(order.items || []).length && !order.imported && typeof loadSupabaseOrderDetailForReport === "function") {
    if (showLoading) openModal(`
      <div class="visitor-receipt-modal visitor-receipt-loading">
        <div class="receipt-loading-spinner" role="status" aria-label="Memuat rincian item"></div>
      </div>
    `, { skipHistory: true });
    order = await loadSupabaseOrderDetailForReport(order);
  }
  return order;
}

function reportReceiptEventGuard(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
}

async function openReportVisitorReceipt(eventOrRecordKey, maybeRecordKey) {
  reportReceiptEventGuard(eventOrRecordKey);
  const recordKey = typeof maybeRecordKey === "string" ? maybeRecordKey : eventOrRecordKey;
  activeModalState = { type: "report-receipt", recordKey };
  const order = await resolveReportReceiptOrder(recordKey, true);
  if (!order) {
    activeModalState = null;
    return;
  }
  activeModalState = { type: "report-receipt", recordKey: reportRecordKey(order) };

  const items = order.items || [];
  const currentKey = reportRecordKey(order);
  const previousKey = reportReceiptSiblingKey(currentKey, -1);
  const nextKey = reportReceiptSiblingKey(currentKey, 1);
  const cashReceiptAmount = orderCashAmount(order);
  const qrisReceiptAmount = orderQrisAmount(order);
  const itemRows = items.map(item => {
    const modifiers = typeof orderItemModifiers === "function" ? orderItemModifiers(item) : [];
    return `
      <div class="visitor-receipt-item">
        <span><strong>${Number(item.qty || 1)}x ${escapeHtml(item.name || "Item")}</strong>${modifiers.length ? `<small>${modifiers.map(modifier => escapeHtml(modifier)).join(", ")}</small>` : ""}</span>
        <b>${money(cartItemTotal(item))}</b>
      </div>
    `;
  }).join("");
  openModal(`
    <div class="visitor-receipt-modal">
      <div class="section-title visitor-receipt-toolbar">
        <div class="visitor-receipt-nav" aria-label="Navigasi struk">
          <button type="button" onclick='reportReceiptNavigate(event, ${JSON.stringify(currentKey)}, -1)' ${previousKey ? "" : "disabled"} aria-label="Struk sebelumnya">&uarr;</button>
          <button type="button" onclick='reportReceiptNavigate(event, ${JSON.stringify(currentKey)}, 1)' ${nextKey ? "" : "disabled"} aria-label="Struk berikutnya">&darr;</button>
        </div>
        ${reportReceiptMenu(order)}
      </div>
      <div class="visitor-receipt-paper">
        <div class="visitor-receipt-head">
          ${reportReceiptLogoMarkup()}
          <strong>${escapeHtml(state.settings.receiptStoreName || "Kasirin!")}</strong>
          <span>${escapeHtml(state.settings.receiptAddress || state.outlet)}</span>
        </div>
        <div class="visitor-receipt-meta">
          <span>No</span><b>${escapeHtml(shortOrderNumber(order.number))}</b>
          <span>Waktu dibuat</span><b>${dateTime(order.createdAt)}</b>
          <span>Waktu dibayar</span><b>${dateTime(order.paidAt || order.createdAt)}</b>
        </div>
        <div class="visitor-receipt-chips">
          <span>${escapeHtml(order.type || "-")}</span>
          <span>${escapeHtml(String(order.customer || "").trim())}</span>
          <span>${escapeHtml(order.paymentMethod || "-")}</span>
        </div>
        <div class="visitor-receipt-items">
          ${itemRows || `<div class="visitor-receipt-empty">Data lama ini belum memiliki rincian item. Ringkasan transaksi tetap tersimpan di laporan.</div>`}
        </div>
        <div class="visitor-receipt-total">
          <span>Subtotal</span><b>${money(order.subtotal)}</b>
          <span>Diskon</span><b>${money(order.discount)}</b>
          <span>Total</span><b>${money(order.total)}</b>
          ${cashReceiptAmount ? `<span>Cash</span><b>${money(cashReceiptAmount)}</b>` : ""}
          ${qrisReceiptAmount ? `<span>QRIS</span><b>${money(qrisReceiptAmount)}</b>` : ""}
        </div>
      </div>
    </div>
  `, { skipHistory: true });
}

function reportReceiptLogoMarkup() {
  const settings = state.settings || {};
  if (!settings.receiptShowLogo) return "";
  const logoChars = Math.max(1, Math.min(32, Number(settings.receiptLogoLength || 12) || 12));
  if (String(settings.receiptLogoDataUrl || "").trim()) {
    return `<em class="visitor-receipt-logo visitor-receipt-logo-image" style="--receipt-logo-chars:${logoChars}">${mediaImageTag(settings.receiptLogoDataUrl, "Logo usaha", "", 320)}</em>`;
  }
  return `<em class="visitor-receipt-logo" style="--receipt-logo-chars:${logoChars}">${escapeHtml(settings.receiptLogoText || "Logo")}</em>`;
}

function reportReceiptMenu(order) {
  const recordKey = reportRecordKey(order);
  return `
    <div class="visitor-receipt-menu" data-report-receipt-menu>
      <button class="visitor-receipt-menu-toggle" type="button" onclick="toggleReportReceiptMenu(event)" aria-label="Menu struk" aria-expanded="false">&vellip;</button>
      <div class="visitor-receipt-menu-panel" hidden>
        <button type="button" onclick='reportReceiptMenuAction(event, "delete", ${JSON.stringify(recordKey)})'>Hapus struk</button>
        <button type="button" onclick='reportReceiptMenuAction(event, "print", ${JSON.stringify(recordKey)})'>Cetak struk</button>
        <button type="button" onclick='reportReceiptMenuAction(event, "download", ${JSON.stringify(recordKey)})'>Unduh gambar</button>
      </div>
    </div>
  `;
}

function toggleReportReceiptMenu(event) {
  reportReceiptEventGuard(event);
  const menu = event?.currentTarget?.closest?.("[data-report-receipt-menu]");
  if (!menu) return;
  const willOpen = !menu.classList.contains("open");
  document.querySelectorAll("[data-report-receipt-menu].open").forEach(item => {
    if (item === menu) return;
    item.classList.remove("open");
    item.querySelector(".visitor-receipt-menu-toggle")?.setAttribute("aria-expanded", "false");
    const panel = item.querySelector(".visitor-receipt-menu-panel");
    if (panel) panel.hidden = true;
  });
  menu.classList.toggle("open", willOpen);
  event.currentTarget.setAttribute("aria-expanded", String(willOpen));
  const panel = menu.querySelector(".visitor-receipt-menu-panel");
  if (panel) panel.hidden = !willOpen;
}

async function reportReceiptNavigate(event, recordKey, direction) {
  reportReceiptEventGuard(event);
  const nextKey = reportReceiptSiblingKey(recordKey, direction);
  if (!nextKey) return;
  await openReportVisitorReceipt(null, nextKey);
}

async function reportReceiptMenuAction(event, action, recordKey) {
  reportReceiptEventGuard(event);
  const menu = event?.currentTarget?.closest?.("[data-report-receipt-menu]");
  if (menu) {
    menu.classList.remove("open");
    menu.querySelector(".visitor-receipt-menu-toggle")?.setAttribute("aria-expanded", "false");
    const panel = menu.querySelector(".visitor-receipt-menu-panel");
    if (panel) panel.hidden = true;
  }
  if (action === "delete") return deleteReportTransaction(recordKey);
  if (action === "print") return printReportReceipt(recordKey);
  if (action === "download") return downloadReportReceipt(recordKey);
}

async function printReportReceipt(recordKey) {
  const order = await resolveReportReceiptOrder(recordKey);
  if (!order) return;
  printReceiptOrder(order);
}

async function downloadReportReceipt(recordKey) {
  const order = await resolveReportReceiptOrder(recordKey);
  if (!order) return;
  let preview = document.querySelector(".visitor-receipt-modal .visitor-receipt-paper");
  if (!preview) {
    await openReportVisitorReceipt(null, recordKey);
    await nextAnimationFrame();
    preview = document.querySelector(".visitor-receipt-modal .visitor-receipt-paper");
  }
  if (!preview) return toast("Preview struk belum siap diunduh.");
  const filename = `struk-${String(shortOrderNumber(order.number)).replace(/^#/, "") || "transaksi"}.png`;
  try {
    const saveMethod = await downloadElementAsPng(preview, filename);
    if (saveMethod !== "native") toast("Gambar struk berhasil diunduh.");
  } catch (error) {
    if (saveElementSnapshotWithNativeBridge(preview, filename)) {
      toast("Gambar struk sedang disimpan.");
      return;
    }
    console.warn("Receipt image download failed", error);
    toast("Gagal mengunduh gambar struk.");
  }
}

function nextAnimationFrame() {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function waitForElementImages(element) {
  const images = [...element.querySelectorAll("img")];
  await Promise.all(images.map(image => {
    if (image.complete && image.naturalWidth) return Promise.resolve();
    return new Promise(resolve => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
    });
  }));
}

function cloneElementWithInlineStyles(source) {
  const clone = source.cloneNode(true);
  inlineComputedStyles(source, clone);
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  return clone;
}

function inlineComputedStyles(source, target) {
  if (!source || !target || typeof getComputedStyle !== "function") return;
  const computed = getComputedStyle(source);
  for (const property of computed) {
    target.style.setProperty(property, computed.getPropertyValue(property), computed.getPropertyPriority(property));
  }
  if (source instanceof HTMLElement && target instanceof HTMLElement) {
    target.style.boxSizing = "border-box";
    if (source === source.ownerDocument.querySelector(".visitor-receipt-paper")) {
      target.style.width = `${Math.ceil(source.getBoundingClientRect().width || source.offsetWidth)}px`;
    }
  }
  [...source.children].forEach((child, index) => inlineComputedStyles(child, target.children[index]));
}

async function downloadElementAsPng(element, filename) {
  if (!element || typeof XMLSerializer !== "function") throw new Error("Element capture is not supported.");
  await document.fonts?.ready;
  await waitForElementImages(element);
  const rect = element.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rect.width || element.offsetWidth || 320));
  const height = Math.max(1, Math.ceil(rect.height || element.offsetHeight || 420));
  const padding = 18;
  const scale = Math.max(2, Math.min(3, Number(window.devicePixelRatio || 2)));
  const clone = cloneElementWithInlineStyles(element);
  await inlineCloneImagesAsDataUrls(element, clone);
  const serialized = new XMLSerializer().serializeToString(clone);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width + padding * 2}" height="${height + padding * 2}" viewBox="0 0 ${width + padding * 2} ${height + padding * 2}">
      <foreignObject x="0" y="0" width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width + padding * 2}px;min-height:${height + padding * 2}px;padding:${padding}px;background:#f8fafc;box-sizing:border-box;">
          ${serialized}
        </div>
      </foreignObject>
    </svg>
  `;
  const svgUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = await loadImageFromUrl(svgUrl);
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil((width + padding * 2) * scale);
    canvas.height = Math.ceil((height + padding * 2) * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is not supported.");
    context.fillStyle = "#f8fafc";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, width + padding * 2, height + padding * 2);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png", 0.95));
    if (!blob) throw new Error("PNG export failed.");
    if (await saveBlobWithNativeBridge(blob, filename, "image/png")) return "native";
    triggerBlobDownload(blob, filename);
    return "browser";
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function saveElementSnapshotWithNativeBridge(element, filename) {
  const saveVisibleRegionAsImage = window.KasirinNative?.saveVisibleRegionAsImage || window.KasirinAndroid?.saveVisibleRegionAsImage;
  if (!saveVisibleRegionAsImage || !element) return false;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  const payload = {
    filename,
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    viewportWidth: window.innerWidth || document.documentElement.clientWidth || 1,
    viewportHeight: window.innerHeight || document.documentElement.clientHeight || 1,
    dpr: Number(window.devicePixelRatio || 1)
  };
  try {
    if (window.KasirinNative?.saveVisibleRegionAsImage) window.KasirinNative.saveVisibleRegionAsImage(payload);
    else window.KasirinAndroid.saveVisibleRegionAsImage(JSON.stringify(payload));
    return true;
  } catch (error) {
    console.warn("Native receipt snapshot failed", error);
    return false;
  }
}

function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image capture failed."));
    image.src = url;
  });
}

async function inlineCloneImagesAsDataUrls(source, clone) {
  const sourceImages = [...source.querySelectorAll("img")];
  const cloneImages = [...clone.querySelectorAll("img")];
  await Promise.all(sourceImages.map(async (sourceImage, index) => {
    const cloneImage = cloneImages[index];
    if (!cloneImage) return;
    const src = sourceImage.currentSrc || sourceImage.src || cloneImage.src || "";
    if (!src || src.startsWith("data:")) {
      if (src) cloneImage.setAttribute("src", src);
      return;
    }
    try {
      cloneImage.setAttribute("src", await imageUrlToDataUrl(src));
    } catch (error) {
      console.warn("Receipt image inline failed", error);
      cloneImage.setAttribute("src", src);
    }
  }));
}

async function imageUrlToDataUrl(src) {
  const response = await fetch(src, { mode: "cors", credentials: "omit" });
  if (!response.ok) throw new Error("Image fetch failed.");
  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Image read failed."));
    reader.readAsDataURL(blob);
  });
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 600);
}

async function saveBlobWithNativeBridge(blob, filename, mimeType = "application/octet-stream") {
  const saveBase64File = window.KasirinNative?.saveBase64File || window.AndroidDownloader?.saveBase64File;
  if (!saveBase64File || !blob) return false;
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Image read failed."));
    reader.readAsDataURL(blob);
  });
  const base64 = dataUrl.split(",")[1] || "";
  if (!base64) return false;
  if (window.KasirinNative?.saveBase64File) window.KasirinNative.saveBase64File(base64, mimeType || blob.type || "image/png", filename);
  else window.AndroidDownloader.saveBase64File(base64, mimeType || blob.type || "image/png", filename);
  return true;
}

function searchReportReceipt(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const query = String(new FormData(form).get("receiptCode") || "").trim().toLowerCase();
  sessionStorage.setItem("report_receipt_query", query);
  if (!query) return toast("Masukkan kode struk terlebih dahulu.");
  const records = reportAllRecords();
  const found = records.find(record => String(record.number || "").trim().toLowerCase() === query)
    || records.find(record => String(record.number || "").toLowerCase().includes(query));
  if (!found) return toast("Kode struk tidak ditemukan.");
  openReportVisitorReceipt(null, reportRecordKey(found));
}

function reportAllRecords() {
  return reportSourceRecords();
}

function profitSummary(records) {
  const total = records.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const profit = records.reduce((sum, row) => sum + Number(row.profit || 0), 0);
  return { count: records.length, total, profit };
}

function setProfitReportLevel(level, year = "", month = "", parentLevel = "") {
  sessionStorage.setItem("profit_report_level", level);
  if (year) sessionStorage.setItem("profit_report_year", year);
  if (month) sessionStorage.setItem("profit_report_month", month);
  if (parentLevel) {
    sessionStorage.setItem("profit_report_parent", parentLevel);
  } else if (["today", "currentMonth", "currentYear", "years"].includes(level)) {
    sessionStorage.removeItem("profit_report_parent");
  } else if (level === "months") {
    sessionStorage.setItem("profit_report_parent", "years");
  } else if (level === "days" && !sessionStorage.getItem("profit_report_parent")) {
    sessionStorage.setItem("profit_report_parent", "months");
  }
  if (level === "years") loadProfitSummary("years");
  if (level === "months") loadProfitSummary("months", Number(year));
  if (level === "days") loadProfitSummary("days", Number(year), Number(month));
  requestActiveReportData(true);
  render();
}

function setProfitReportDate(dateKey, parentLevel = "days") {
  sessionStorage.setItem("profit_report_level", "dateRecords");
  sessionStorage.setItem("profit_report_date", dateKey);
  sessionStorage.setItem("profit_report_parent", parentLevel);
  const date = new Date(`${dateKey}T00:00:00`);
  if (!Number.isNaN(date.getTime())) {
    sessionStorage.setItem("profit_report_year", String(date.getFullYear()));
    sessionStorage.setItem("profit_report_month", String(date.getMonth() + 1));
  }
  requestActiveReportData(true);
  render();
}

function setProfitChartMetric(metricName) {
  sessionStorage.setItem("profit_chart_metric", metricName);
  render();
}

function compactMoney(value) {
  const number = Number(value) || 0;
  if (number >= 1000000000) return `Rp ${(number / 1000000000).toFixed(1).replace(".", ",")}M`;
  if (number >= 1000000) return `Rp ${(number / 1000000).toFixed(1).replace(".", ",")}jt`;
  if (number >= 1000) return `Rp ${(number / 1000).toFixed(0)}rb`;
  return money(number);
}

function renderProfitAreaChart(rows, title) {
  if (!rows.length) return "";
  const metricName = sessionStorage.getItem("profit_chart_metric") || "count";
  const metricConfig = {
    count: { label: "Transaksi", value: row => Number(row.count || 0), format: value => Number(value || 0).toLocaleString("id-ID") },
    total: { label: "Pendapatan", value: row => Number(row.total || 0), format: compactMoney },
    profit: { label: "Keuntungan", value: row => Number(row.profit || 0), format: compactMoney }
  };
  const renderSvg = (metricId, compact = false) => {
    const gradientId = `profitAreaFill${metricId}${compact ? "Mini" : "Full"}`;
    const config = metricConfig[metricId] || metricConfig.count;
    const data = rows.map(row => ({ ...row, value: config.value(row) }));
    const maxValue = Math.max(1, ...data.map(row => row.value));
    const chartLeft = 8;
    const chartRight = 92;
    const chartTop = compact ? 15 : 12;
    const chartBottom = 60;
    const points = data.map((row, index) => {
      const x = data.length === 1 ? 50 : chartLeft + ((index / (data.length - 1)) * (chartRight - chartLeft));
      const y = chartBottom - ((row.value / maxValue) * (chartBottom - chartTop));
      return { ...row, x, y };
    });
    const linePath = points.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
    const areaPath = `${linePath} L ${points.at(-1).x.toFixed(2)} ${chartBottom} L ${points[0].x.toFixed(2)} ${chartBottom} Z`;
    return `
      <div class="profit-area-chart ${compact ? "mini" : ""}">
        <svg viewBox="0 0 100 72" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="${gradientId}" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stop-color="#0f9b75" stop-opacity=".58"></stop>
              <stop offset="78%" stop-color="#0f9b75" stop-opacity=".08"></stop>
              <stop offset="100%" stop-color="#0f9b75" stop-opacity="0"></stop>
            </linearGradient>
          </defs>
          <path d="${areaPath}" fill="url(#${gradientId})"></path>
          <path d="${linePath}" fill="none" stroke="#0f7a5c" stroke-width="${compact ? "1.05" : "1.28"}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"></path>
          <line x1="${chartLeft}" y1="${chartBottom}" x2="${chartRight}" y2="${chartBottom}" stroke="#d8e3df" stroke-width=".6" vector-effect="non-scaling-stroke"></line>
        </svg>
        <div class="profit-point-dots">
          ${points.map(point => `<span style="left:${point.x.toFixed(2)}%; top:${((point.y / 72) * 100).toFixed(2)}%"></span>`).join("")}
        </div>
        <div class="profit-point-labels">
          ${points.map(point => `<span style="left:${point.x.toFixed(2)}%; top:${Math.max(8, (point.y / 72) * 100 - 8).toFixed(2)}%">${escapeHtml(config.format(point.value))}</span>`).join("")}
        </div>
        <div class="profit-chart-axis">
          ${points.map(point => `<span>${escapeHtml(point.label)}</span>`).join("")}
        </div>
      </div>
    `;
  };
  const config = metricConfig[metricName] || metricConfig.count;
  const tabs = Object.entries(metricConfig).map(([id, item]) => `
    <button class="${metricName === id ? "active" : ""}" onclick="setProfitChartMetric('${id}')">${item.label}</button>
  `).join("");
  return `
    <div class="card profit-area-chart-card">
      <div class="profit-chart-head profit-chart-single-head">
        <div>
          <span>Grafik ${escapeHtml(config.label)}</span>
          <h3>${escapeHtml(title)}</h3>
        </div>
        <div class="profit-chart-tabs">${tabs}</div>
      </div>
      <div class="profit-chart-single">
        ${renderSvg(metricName)}
      </div>
      <div class="profit-chart-triple">
        ${Object.entries(metricConfig).map(([id, item]) => `
          <div class="profit-mini-chart">
            <span>${escapeHtml(item.label)}</span>
            ${renderSvg(id, true)}
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function fallbackProfitSummaryRows(level, year = null, month = null) {
  const buckets = new Map();
  for (const record of reportSourceRecords()) {
    const date = new Date(reportRecordTime(record));
    if (Number.isNaN(date.getTime())) continue;
    const recordYear = date.getFullYear();
    const recordMonth = date.getMonth() + 1;
    if (level === "months" && Number(year) !== recordYear) continue;
    if (level === "days" && (Number(year) !== recordYear || Number(month) !== recordMonth)) continue;
    const key = level === "years"
      ? String(recordYear)
      : level === "months"
        ? String(recordMonth)
        : todayKey(date);
    const row = buckets.get(key) || {
      year: recordYear,
      month: recordMonth,
      day: date.getDate(),
      salesDate: todayKey(date),
      count: 0,
      total: 0,
      profit: 0,
      estimatedCost: 0
    };
    row.count += 1;
    row.total += Number(record.total || 0);
    row.profit += Number(record.profit || 0);
    row.estimatedCost += Math.max(0, Number(record.total || 0) - Number(record.profit || 0));
    buckets.set(key, row);
  }
  return [...buckets.values()].sort((a, b) => {
    if (level === "years") return b.year - a.year;
    if (level === "months") return b.month - a.month;
    return b.day - a.day;
  });
}

function profitSummaryRowKey(level, row) {
  if (level === "years") return String(row.year || "");
  if (level === "months") return `${row.year || ""}-${row.month || ""}`;
  return row.salesDate || `${row.year || ""}-${row.month || ""}-${row.day || ""}`;
}

function mergeProfitSummaryRows(level, cachedRows = [], fallbackRows = []) {
  const merged = new Map();
  for (const row of fallbackRows) merged.set(profitSummaryRowKey(level, row), row);
  for (const row of cachedRows) {
    const key = profitSummaryRowKey(level, row);
    const existing = merged.get(key);
    if (!existing || Number(row.count || 0) >= Number(existing.count || 0)) merged.set(key, row);
  }
  return [...merged.values()].sort((a, b) => {
    if (level === "years") return b.year - a.year;
    if (level === "months") return b.month - a.month;
    return b.day - a.day;
  });
}

function profitRows(level, year = null, month = null, preferFallback = false) {
  const fallbackRows = fallbackProfitSummaryRows(level, year, month);
  if (preferFallback) return fallbackRows;
  let cachedRows = profitSummaryCache.years;
  if (level === "months") cachedRows = profitSummaryCache.months[year] || [];
  if (level === "days") cachedRows = profitSummaryCache.days[`${year}-${month}`] || [];
  return mergeProfitSummaryRows(level, cachedRows || [], fallbackRows);
}

function profitShiftLabel(shiftKey) {
  if (shiftKey === "shift1") return "Shift 1";
  if (shiftKey === "shift2") return "Shift 2";
  return "Tanpa Shift";
}

function profitShiftTimeLabel(session) {
  const start = session?.openedAt ? new Date(session.openedAt) : null;
  const end = session?.closedAt ? new Date(session.closedAt) : null;
  const formatter = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" });
  if (start && !Number.isNaN(start.getTime()) && end && !Number.isNaN(end.getTime())) {
    return `${formatter.format(start)} - ${formatter.format(end)}`;
  }
  if (start && !Number.isNaN(start.getTime())) return `${formatter.format(start)} - berjalan`;
  return "-";
}

function profitShiftNonCashTotal(rows) {
  return rows.reduce((sum, item) => {
    const qrisAmount = orderQrisAmount(item.bucket);
    if (qrisAmount > 0) return sum + qrisAmount;
    const paymentMethod = String(item.bucket.paymentMethod || "").toLowerCase();
    if (!paymentMethod || paymentMethod === "tunai" || paymentMethod === "campuran" || paymentMethod.includes("cash dan piutang")) return sum;
    return sum + Number(item.bucket.total || 0);
  }, 0);
}

function profitShiftValidation(shiftKey, cashStart, cashEnd, expenseTotal, rows) {
  const nonCashTotal = profitShiftNonCashTotal(rows);
  const expectedOmzet = rows.reduce((sum, item) => sum + Number(item.bucket.total || 0), 0);
  const actualOmzet = shiftKey === "shift2"
    ? cashEnd - cashStart + expenseTotal + nonCashTotal
    : cashEnd + expenseTotal + nonCashTotal;
  const difference = actualOmzet - expectedOmzet;
  return {
    nonCashTotal,
    expectedOmzet,
    actualOmzet,
    difference,
    isBalanced: Math.abs(difference) < 1
  };
}

function signedMoney(value) {
  const amount = Number(value || 0);
  if (!amount) return money(0);
  return `${amount > 0 ? "+" : "-"}${money(Math.abs(amount))}`;
}

function profitRowTime(item) {
  const date = new Date(item?.bucket?.paidAt || item?.bucket?.createdAt || 0);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
}

function profitShiftCloseTime(sessions, fallbackTime = 0) {
  const closeTimes = (sessions || [])
    .map(session => session.closedAt ? new Date(session.closedAt).getTime() : 0)
    .filter(time => Number.isFinite(time) && time > 0);
  if (closeTimes.length) return Math.max(...closeTimes);
  return fallbackTime;
}

function profitExpenseTime(expense) {
  const date = new Date(expense?.createdAt || expense?.tanggal || 0);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
}

function profitAssignRowsByShiftCloseBoundary(rows, sessions, range) {
  const grouped = { shift1: [], shift2: [], unmatched: [] };
  const hasShift1 = Boolean((sessions.shift1 || []).length);
  const hasShift2 = Boolean((sessions.shift2 || []).length);
  if (!hasShift1 && !hasShift2) {
    grouped.unmatched = rows;
    return grouped;
  }
  const rangeEnd = range?.end ? range.end.getTime() : Number.POSITIVE_INFINITY;
  const shift1Close = profitShiftCloseTime(sessions.shift1, rangeEnd);
  const shift2Close = profitShiftCloseTime(sessions.shift2, rangeEnd);
  rows.forEach(item => {
    const time = profitRowTime(item);
    if (hasShift1 && time <= shift1Close) {
      grouped.shift1.push(item);
      return;
    }
    if (hasShift2 && time <= shift2Close) {
      grouped.shift2.push(item);
      return;
    }
    if (hasShift2) grouped.shift2.push(item);
    else grouped.unmatched.push(item);
  });
  return grouped;
}

function profitAssignExpensesByShiftCloseBoundary(expenses, sessions, range) {
  const grouped = { shift1: [], shift2: [], unmatched: [] };
  const hasShift1 = Boolean((sessions.shift1 || []).length);
  const hasShift2 = Boolean((sessions.shift2 || []).length);
  const representedSessionIds = new Set([
    ...(sessions.shift1 || []),
    ...(sessions.shift2 || [])
  ].map(session => session.sessionId).filter(Boolean));
  const rangeEnd = range?.end ? range.end.getTime() : Number.POSITIVE_INFINITY;
  const shift1Close = profitShiftCloseTime(sessions.shift1, rangeEnd);
  const shift2Close = profitShiftCloseTime(sessions.shift2, rangeEnd);
  (expenses || []).forEach(expense => {
    if (expense.sessionId && representedSessionIds.has(expense.sessionId)) return;
    const hintedShift = String(expense.shift || "").toLowerCase();
    if (hintedShift === "shift1" || hintedShift === "shift2") {
      grouped[hintedShift].push(expense);
      return;
    }
    const time = profitExpenseTime(expense);
    if (hasShift1 && time <= shift1Close) {
      grouped.shift1.push(expense);
      return;
    }
    if (hasShift2 && time <= shift2Close) {
      grouped.shift2.push(expense);
      return;
    }
    if (hasShift2) grouped.shift2.push(expense);
    else grouped.unmatched.push(expense);
  });
  return grouped;
}

function renderProfitShiftBadge(shiftKey, sessions, rows, extraExpenses = []) {
  const label = profitShiftLabel(shiftKey);
  const cashiers = [...new Set(sessions.map(session => session.cashier).filter(Boolean))].join(", ") || "-";
  const times = sessions.map(profitShiftTimeLabel).filter(Boolean).join(" / ") || "-";
  const cashStart = sessions.reduce((sum, session) => sum + Number(session.cashStart || 0), 0);
  const cashEnd = sessions.reduce((sum, session) => sum + Number(session.cashEnd || 0), 0);
  const expenseTotal = sessions.reduce((sum, session) => sum + Number(session.expenseTotal || 0), 0) + extraExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const omzet = rows.reduce((sum, item) => sum + Number(item.bucket.total || 0), 0);
  const validation = profitShiftValidation(shiftKey, cashStart, cashEnd, expenseTotal, rows);
  const validationClass = validation.isBalanced ? "is-balanced" : "is-different";
  const validationLabel = validation.isBalanced ? "Kas Pas" : "Selisih";
  const validationValue = validation.isBalanced ? "Pas" : signedMoney(validation.difference);
  const metric = (title, value) => `
    <span>
      <small>${escapeHtml(title)}</small>
      <strong>${escapeHtml(value)}</strong>
    </span>
  `;
  return `
    <section class="profit-shift-card ${shiftKey ? `is-${shiftKey}` : "is-unmatched"}">
      <div class="profit-shift-card-head">
        <div class="profit-shift-chip-row">
          <span class="profit-shift-chip is-shift">${escapeHtml(label)}</span>
          <span class="profit-shift-chip"><i class="profit-shift-chip-icon is-cashier" aria-hidden="true"></i>${escapeHtml(cashiers)}</span>
          <span class="profit-shift-chip"><i class="profit-shift-chip-icon is-clock" aria-hidden="true"></i>${escapeHtml(times)}</span>
        </div>
        <em class="profit-shift-balance ${validationClass}">
          <small>${escapeHtml(validationLabel)}</small>
          <strong>${escapeHtml(validationValue)}</strong>
        </em>
      </div>
      <div class="profit-shift-card-metrics">
        ${metric("Total QRIS", money(validation.nonCashTotal))}
        ${metric("Kas Akhir", sessions.some(session => session.cashEnd != null) ? money(cashEnd) : "-")}
        ${metric("Pengeluaran", money(expenseTotal))}
        ${metric("Omset", money(omzet))}
      </div>
    </section>
  `;
}

function renderProfitRowsWithShiftBadges(rows, range) {
  if (typeof legacyCashierShiftSummary !== "function") return rows.map(item => item.html).join("");
  const summary = legacyCashierShiftSummary(range);
  const sessions = {
    shift1: summary.byShift?.shift1?.sessions || [],
    shift2: summary.byShift?.shift2?.sessions || []
  };
  const grouped = profitAssignRowsByShiftCloseBoundary(rows, sessions, range);
  const groupedExpenses = profitAssignExpensesByShiftCloseBoundary(summary.expenses || [], sessions, range);
  const sections = [];
  ["shift1", "shift2"].forEach(shiftKey => {
    if (!grouped[shiftKey].length) return;
    sections.push(renderProfitShiftBadge(shiftKey, sessions[shiftKey], grouped[shiftKey], groupedExpenses[shiftKey]));
    sections.push(grouped[shiftKey].map(item => item.html).join(""));
  });
  if (grouped.unmatched.length) {
    if (sections.length) sections.push(renderProfitShiftBadge("", [], grouped.unmatched, groupedExpenses.unmatched));
    sections.push(grouped.unmatched.map(item => item.html).join(""));
  }
  return sections.join("");
}

function renderProfitLossDrill() {
  loadProfitSummary("years");
  let yearRows = profitRows("years");
  if (!yearRows.length) yearRows = fallbackProfitSummaryRows("years");
  const years = yearRows.map(row => row.year).filter(Boolean);
  let level = sessionStorage.getItem("profit_report_level") || "today";
  if (level === "overview") {
    level = "today";
    sessionStorage.setItem("profit_report_level", "today");
  }
  const selectedYear = Number(sessionStorage.getItem("profit_report_year") || years[0] || new Date().getFullYear());
  const selectedMonth = Number(sessionStorage.getItem("profit_report_month") || (new Date().getMonth() + 1));
  const selectedDateKey = sessionStorage.getItem("profit_report_date") || todayKey();
  const parentLevel = sessionStorage.getItem("profit_report_parent") || "";
  const monthFormatter = new Intl.DateTimeFormat("id-ID", { month: "short" });
  const fullMonthFormatter = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" });
  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth();
  const thisDay = now.getDate();
  const recordsForRange = (start, end) => reportSourceRecords({ start, end });
  const hasDeletedReportRows = Boolean((state.deletedReportKeys || []).length);
  let title = "Penjualan Selama Ini";
  let backButton = "";
  let buckets = [];
  let transactionListRange = null;

  if (level === "today") {
    loadProfitSummary("days", thisYear, thisMonth + 1);
    title = "Laporan Laba Rugi Harian";
    backButton = "";
    const todayDateKey = todayKey();
    transactionListRange = { start: startOfLocalDay(todayDateKey), end: endOfLocalDay(todayDateKey) };
    buckets = recordsForRange(transactionListRange.start, transactionListRange.end).map(record => ({
      id: reportRecordKey(record),
      label: shortOrderNumber(record.number),
      count: 1,
      total: record.total,
      profit: record.profit,
      estimatedCost: Math.max(0, Number(record.total || 0) - Number(record.profit || 0)),
      type: record.type || "-",
      customer: String(record.customer || "").trim(),
      paymentMethod: record.paymentMethod || "Belum dipilih",
      paymentBreakdown: normalizePaymentBreakdown(record.paymentBreakdown || record.payment_breakdown || {}),
      hint: dateTime(record.paidAt || record.createdAt),
      createdAt: record.createdAt,
      paidAt: record.paidAt,
      action: `openReportVisitorReceipt(event, ${JSON.stringify(reportRecordKey(record))})`
    }));
  } else if (level === "currentMonth") {
    loadProfitSummary("days", thisYear, thisMonth + 1);
    title = `Laporan Bulan Ini`;
    backButton = "";
    const sourceRows = profitRows("days", thisYear, thisMonth + 1, hasDeletedReportRows);
    buckets = sourceRows.map(row => ({
      id: row.salesDate || todayKey(new Date(thisYear, thisMonth, row.day)),
      label: String(row.day).padStart(2, "0"),
      count: row.count,
      total: row.total,
      profit: row.profit,
      estimatedCost: row.estimatedCost,
      action: `setProfitReportDate('${row.salesDate || todayKey(new Date(thisYear, thisMonth, row.day))}', 'currentMonth')`
    }));
  } else if (level === "currentYear") {
    loadProfitSummary("months", thisYear);
    title = `Laporan Tahun Ini`;
    backButton = "";
    const sourceRows = profitRows("months", thisYear);
    buckets = sourceRows.map(row => ({
      id: String(row.month),
      label: monthFormatter.format(new Date(thisYear, row.month - 1, 1)).toUpperCase(),
      count: row.count,
      total: row.total,
      profit: row.profit,
      estimatedCost: row.estimatedCost,
      action: `setProfitReportLevel('days', '${thisYear}', '${row.month}', 'currentYear')`
    }));
  } else if (level === "months") {
    loadProfitSummary("months", selectedYear);
    title = `Penjualan Tahun ${selectedYear}`;
    backButton = `<button class="btn profit-back-btn" onclick="setProfitReportLevel('years')">Kembali</button>`;
    const sourceRows = profitRows("months", selectedYear);
    buckets = sourceRows.map(row => ({
      id: String(row.month),
      label: monthFormatter.format(new Date(selectedYear, row.month - 1, 1)).toUpperCase(),
      count: row.count,
      total: row.total,
      profit: row.profit,
      estimatedCost: row.estimatedCost,
      action: `setProfitReportLevel('days', '${selectedYear}', '${row.month}', 'months')`
    }));
  } else if (level === "days") {
    loadProfitSummary("days", selectedYear, selectedMonth);
    const monthDate = new Date(selectedYear, selectedMonth - 1, 1);
    title = `Penjualan ${fullMonthFormatter.format(monthDate)}`;
    const dayBackAction = parentLevel === "currentYear"
      ? "setProfitReportLevel('currentYear')"
      : `setProfitReportLevel('months', '${selectedYear}')`;
    backButton = `<button class="btn profit-back-btn" onclick="${dayBackAction}">Kembali</button>`;
    const sourceRows = profitRows("days", selectedYear, selectedMonth);
    buckets = sourceRows.map(row => ({
      id: row.salesDate || String(row.day),
      label: String(row.day).padStart(2, "0"),
      count: row.count,
      total: row.total,
      profit: row.profit,
      estimatedCost: row.estimatedCost,
      action: row.salesDate ? `setProfitReportDate('${row.salesDate}', 'days')` : ""
    }));
  } else if (level === "dateRecords") {
    const selectedDate = startOfLocalDay(selectedDateKey);
    title = `Transaksi ${new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "long", year: "numeric" }).format(selectedDate)}`;
    const dateBackAction = parentLevel === "currentMonth"
      ? "setProfitReportLevel('currentMonth')"
      : parentLevel === "today"
        ? "setProfitReportLevel('today')"
        : `setProfitReportLevel('days', '${selectedYear}', '${selectedMonth}', '${parentLevel || "days"}')`;
    backButton = `<button class="btn profit-back-btn" onclick="${dateBackAction}">Kembali</button>`;
    transactionListRange = { start: startOfLocalDay(selectedDateKey), end: endOfLocalDay(selectedDateKey) };
    buckets = recordsForRange(transactionListRange.start, transactionListRange.end).map(record => ({
      id: reportRecordKey(record),
      label: shortOrderNumber(record.number),
      count: 1,
      total: record.total,
      profit: record.profit,
      estimatedCost: Math.max(0, Number(record.total || 0) - Number(record.profit || 0)),
      type: record.type || "-",
      customer: String(record.customer || "").trim(),
      paymentMethod: record.paymentMethod || "Belum dipilih",
      paymentBreakdown: normalizePaymentBreakdown(record.paymentBreakdown || record.payment_breakdown || {}),
      hint: dateTime(record.paidAt || record.createdAt),
      createdAt: record.createdAt,
      paidAt: record.paidAt,
      action: `openReportVisitorReceipt(event, ${JSON.stringify(reportRecordKey(record))})`
    }));
  } else if (level === "years") {
    title = "Laporan Selama Ini";
    backButton = "";
    buckets = yearRows.map(row => ({
      id: String(row.year),
      label: String(row.year),
      count: row.count,
      total: row.total,
      profit: row.profit,
      estimatedCost: row.estimatedCost,
      action: `setProfitReportLevel('months', '${row.year}')`
    }));
  }

  const summary = {
    count: buckets.reduce((sum, row) => sum + row.count, 0),
    total: buckets.reduce((sum, row) => sum + row.total, 0),
    profit: buckets.reduce((sum, row) => sum + row.profit, 0)
  };
  const displayRows = level === "years" || level === "currentYear" ? buckets : buckets.slice().reverse();
  const isTransactionList = level === "today" || level === "dateRecords";
  if (isTransactionList) setReportReceiptNavigationKeys(displayRows.map(bucket => bucket.id));
  const renderedRows = displayRows.map(bucket => {
    const clickable = Boolean(bucket.action);
    const valueContent = isTransactionList
      ? `
          <span class="profit-drill-metric">
            <small>Pendapatan</small>
            <strong class="profit-drill-metric-value">${money(bucket.total)}</strong>
            <small class="profit-drill-sub-label">Pelanggan</small>
            <strong class="profit-drill-metric-value">${escapeHtml(String(bucket.customer || "").trim())}</strong>
          </span>
          <span class="profit-drill-metric">
            <small>Keuntungan</small>
            <strong class="profit-drill-metric-value">${money(bucket.profit)}</strong>
            <small class="profit-drill-sub-label">Jenis</small>
            <strong class="profit-drill-metric-value">${escapeHtml(bucket.type || "-")}</strong>
          </span>
        `
      : `
          <span class="profit-drill-value-labels"><small>Pendapatan</small><small>Keuntungan</small></span>
          <span class="profit-drill-value-amounts"><b>${money(bucket.total)}</b><b>${money(bucket.profit)}</b></span>
        `;
    const html = `
      <button type="button" class="profit-drill-row ${isTransactionList ? "is-transaction" : ""} ${clickable ? "clickable" : ""}" ${clickable ? `onclick="${escapeHtml(bucket.action)}"` : ""}>
        <span class="profit-drill-label"><strong>${escapeHtml(bucket.label)}</strong><small>${escapeHtml(bucket.hint || `${bucket.count.toLocaleString("id-ID")} transaksi`)}</small></span>
        <span class="profit-drill-values">
          ${valueContent}
        </span>
        ${clickable ? `<em>&rarr;</em>` : `<em></em>`}
      </button>
    `;
    return { bucket, html };
  });
  const listRows = isTransactionList
    ? renderProfitRowsWithShiftBadges(renderedRows, transactionListRange)
    : renderedRows.map(item => item.html).join("");
  const currentYearRow = yearRows.find(row => row.year === thisYear) || { count: 0, total: 0, profit: 0, estimatedCost: 0 };
  const currentYearSummary = { count: currentYearRow.count, total: currentYearRow.total, profit: currentYearRow.profit };
  let monthRowsForCurrentYear = profitRows("months", thisYear);
  if (!monthRowsForCurrentYear.length) loadProfitSummary("months", thisYear);
  monthRowsForCurrentYear = profitRows("months", thisYear);
  if (!monthRowsForCurrentYear.length) monthRowsForCurrentYear = fallbackProfitSummaryRows("months", thisYear);
  const currentMonthRow = monthRowsForCurrentYear.find(row => row.month === thisMonth + 1) || { count: 0, total: 0, profit: 0, estimatedCost: 0 };
  const currentMonthSummary = hasDeletedReportRows && level === "currentMonth"
    ? summary
    : { count: currentMonthRow.count, total: currentMonthRow.total, profit: currentMonthRow.profit };
  const dayKey = `${thisYear}-${thisMonth + 1}`;
  let dayRowsForCurrentMonth = profitRows("days", thisYear, thisMonth + 1);
  if (!dayRowsForCurrentMonth.length) loadProfitSummary("days", thisYear, thisMonth + 1);
  dayRowsForCurrentMonth = profitRows("days", thisYear, thisMonth + 1);
  if (!dayRowsForCurrentMonth.length) dayRowsForCurrentMonth = fallbackProfitSummaryRows("days", thisYear, thisMonth + 1);
  const currentDayRow = dayRowsForCurrentMonth.find(row => row.day === thisDay) || { count: 0, total: 0, profit: 0, estimatedCost: 0 };
  const currentDaySummary = { count: currentDayRow.count, total: currentDayRow.total, profit: currentDayRow.profit };
  const activeSummary = level === "months"
    ? (yearRows.find(row => row.year === selectedYear) || { count: 0, total: 0, profit: 0, estimatedCost: 0 })
    : level === "days"
      ? ((profitRows("months", selectedYear) || []).find(row => row.month === selectedMonth) || { count: 0, total: 0, profit: 0, estimatedCost: 0 })
      : level === "dateRecords"
        ? summary
      : level === "today"
        ? summary
        : level === "currentMonth"
          ? currentMonthSummary
          : level === "currentYear"
            ? currentYearSummary
            : summary;
  const mainPeriodLevels = ["today", "currentMonth", "currentYear", "years"];
  const periodMenu = `
    <div class="transaction-period-menu" role="tablist" aria-label="Periode penjualan">
      <button type="button" class="${level === "today" ? "active" : ""}" onclick="setProfitReportLevel('today')" role="tab" aria-selected="${level === "today"}">Hari ini</button>
      <button type="button" class="${level === "currentMonth" ? "active" : ""}" onclick="setProfitReportLevel('currentMonth')" role="tab" aria-selected="${level === "currentMonth"}">Bulan ini</button>
      <button type="button" class="${level === "currentYear" ? "active" : ""}" onclick="setProfitReportLevel('currentYear')" role="tab" aria-selected="${level === "currentYear"}">Tahun ini</button>
      <button type="button" class="${level === "years" ? "active" : ""}" onclick="setProfitReportLevel('years')" role="tab" aria-selected="${level === "years"}">Selama ini</button>
    </div>
  `;
  const activePeriodCard = `
    <div class="profit-detail-header">
      <div class="profit-detail-nav">${mainPeriodLevels.includes(level) ? periodMenu : backButton}</div>
      <div class="profit-period-grid">
        <div class="profit-period-tile"><small>Transaksi</small><b>${activeSummary.count.toLocaleString("id-ID")}</b></div>
        <div class="profit-period-tile"><small>Pendapatan</small><b>${money(activeSummary.total)}</b></div>
        <div class="profit-period-tile accent"><small>Keuntungan</small><b>${money(activeSummary.profit)}</b></div>
      </div>
    </div>
  `;
  const chartRows = ["years", "months", "currentYear", "currentMonth"].includes(level)
    ? buckets.slice().sort((a, b) => String(a.id).localeCompare(String(b.id), "id-ID", { numeric: true }))
    : [];
  const profitChartTitle = level === "years"
    ? "Penjualan Selama Ini"
    : level === "currentYear"
      ? "Penjualan Tahun Ini"
      : level === "currentMonth"
        ? "Penjualan Bulan Ini"
        : `Penjualan Tahun ${selectedYear}`;
  const profitChart = chartRows.length ? renderProfitAreaChart(chartRows, profitChartTitle) : "";
  const loadingRows = typeof reportDataLoading === "function" && reportDataLoading() && !listRows;
  const loadingState = `
    <div class="report-loading-state">
      <div class="receipt-loading-spinner" role="status" aria-label="Memuat data laporan"></div>
      <p>Memuat data laporan...</p>
    </div>
  `;
  const summaryCard = (label, value, hint = "", accent = false) => `
    <div class="profit-summary-card ${accent ? "accent" : ""}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${hint ? `<small>${escapeHtml(hint)}</small>` : ""}
    </div>
  `;

  if (level === "overview") {
    const overviewButton = (levelTarget, heading) => `
      <button class="transaction-report-row" onclick="setProfitReportLevel('${levelTarget}')">
        <span class="transaction-report-icon" aria-hidden="true"></span>
        <strong>${escapeHtml(heading)}</strong>
        <em>&rarr;</em>
      </button>
    `;
    return `
      <section class="report-section-panel profit-drill-panel">
        <div class="transaction-report-menu">
          <form class="transaction-receipt-search" onsubmit="searchReportReceipt(event)">
            <input name="receiptCode" value="${escapeHtml(sessionStorage.getItem("report_receipt_query") || "")}" placeholder="Tulis kode struk" oninput="sessionStorage.setItem('report_receipt_query', this.value)" />
            <button type="submit" aria-label="Cari struk">⌕</button>
          </form>
          ${overviewButton("today", "Penjualan Hari Ini")}
          ${overviewButton("currentMonth", "Penjualan Bulan ini")}
          ${overviewButton("currentYear", "Penjualan Tahun ini")}
          ${overviewButton("years", "Penjualan Selama ini")}
        </div>
      </section>
    `;
  }

  return `
    <section class="report-section-panel profit-drill-panel">
      ${activePeriodCard}
      ${profitChart}
      <div class="card profit-drill-list">
        ${listRows || (loadingRows ? loadingState : empty("Belum ada data pada level ini."))}
      </div>
    </section>
  `;
}
