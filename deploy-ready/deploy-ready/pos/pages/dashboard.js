// Page renderer extracted from app.js. Depends on shared helpers/globals in app.js.

function renderDashboard() {
  const period = dashboardPeriod();
  const range = dashboardPeriodRange(period);
  const financialRange = dashboardReportRange(period, range);
  requestDashboardFinancialSummary(financialRange);
  if (typeof requestReportOrderSummary === "function") requestReportOrderSummary(financialRange);
  const periodOrders = state.orders.filter(order => isDashboardOrderInRange(order, range));
  const completed = periodOrders.filter(order => order.status === "Selesai" || order.paymentStatus === "Lunas");
  const active = periodOrders.filter(order => !["Selesai", "Dibatalkan"].includes(order.status));
  const preparing = active.filter(order => order.status === "Sedang Disiapkan");
  const newOrders = active.filter(order => order.status === "Pesanan Baru");
  const cancelled = periodOrders.filter(order => order.status === "Dibatalkan");
  const unpaid = periodOrders.filter(order => order.paymentStatus !== "Lunas" && order.status !== "Dibatalkan");
  const rawMaterialAlerts = dashboardRawMaterialAlerts();
  const productSoldOutAlerts = dashboardProductSoldOutAlerts();
  const rawMaterialAlertCount = dashboardRawMaterialAlerts(Number.POSITIVE_INFINITY).length;
  const productSoldOutAlertCount = dashboardProductSoldOutAlerts(Number.POSITIVE_INFINITY).length;
  const orderSummary = typeof reportOrderSummary === "function"
    ? reportOrderSummary(financialRange)
    : { loaded: false, byType: {}, totalDone: 0 };
  const financialRecords = dashboardFinancialRecords(financialRange);
  const sales = financialRecords.reduce((sum, record) => sum + Number(record.total || 0), 0);
  const profit = financialRecords.reduce((sum, record) => sum + Number(record.profit || 0), 0);
  const paidTransactionCount = financialRecords.reduce((sum, record) => sum + Number(record.count || record.transaction_count || 1), 0);
  const transactionCount = Math.max(paidTransactionCount, periodOrders.length);
  const availableProducts = state.products.filter(product => product.active && !product.soldOut).length;
  const categories = productCategories();
  const latest = [...periodOrders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 4);
  const cancelledLatest = [...cancelled].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 3);
  const topItems = completed
    .flatMap(order => order.items || order.cart || [])
    .reduce((list, item) => {
      const name = item.name || "Produk";
      const found = list.find(row => row.name === name);
      if (found) {
        found.qty += Number(item.qty || 0);
        found.total += cartItemTotal(item);
      } else {
        list.push({ name, qty: Number(item.qty || 0), total: cartItemTotal(item) });
      }
      return list;
    }, [])
    .sort((a, b) => b.qty - a.qty || b.total - a.total)
    .slice(0, 3);
  const quickStats = [
    ["Omzet", money(sales)],
    ["Laba Bersih", money(profit)],
    ["Transaksi", transactionCount.toLocaleString("id-ID")]
  ];
  const orderTypeStats = ORDER_TYPES.map(type => {
    const byType = periodOrders.filter(order => order.type === type.id);
    const reportDoneCount = Number(orderSummary.byType[type.id] || 0);
    return {
      id: type.id,
      title: type.title,
      total: byType.length,
      newCount: byType.filter(order => order.status === "Pesanan Baru").length,
      preparingCount: byType.filter(order => order.status === "Sedang Disiapkan").length,
      doneCount: orderSummary.loaded ? reportDoneCount : byType.filter(order => order.status === "Selesai" || order.paymentStatus === "Lunas").length
    };
  });
  return `
    ${dashboardPeriodFilter(period)}
    <section class="dashboard-hero">
      <div class="dashboard-quick-stats">
        ${quickStats.map(([label, value]) => `<span><small>${label}</small><strong>${value}</strong></span>`).join("")}
      </div>
    </section>
    <section class="dashboard-metrics">
      ${orderTypeStats.map(row => `
        <div class="dashboard-mini-card order-channel">
          <span><i class="dashboard-channel-icon ${dashboardChannelIconClass(row.id)}"></i>${escapeHtml(row.title)}</span>
          <div class="dashboard-channel-breakdown">
            <em><b>${row.newCount}</b><small>Baru</small></em>
            <em><b>${row.preparingCount}</b><small>Proses</small></em>
            <em><b>${row.doneCount}</b><small>Selesai</small></em>
          </div>
        </div>
      `).join("")}
    </section>
    <div class="dashboard-main-grid">
      <div class="card dashboard-list-card">
        <div class="section-title">
          <div><h3>Pesanan Terbaru</h3><p>Transaksi terbaru dan progres dapur.</p></div>
          <button class="btn ghost" onclick="go('orders')">Lihat Semua</button>
        </div>
        <div class="dashboard-order-list">
          ${latest.map(dashboardOrderItem).join("") || empty("Belum ada pesanan. Buat transaksi dari menu Kasir.")}
        </div>
      </div>
      <div class="dashboard-side-stack">
        <div class="card dashboard-status-card">
          <div class="section-title">
            <div><h3>Operasional</h3><p>Kondisi toko yang perlu dipantau.</p></div>
          </div>
          <div class="dashboard-op-grid">
            <span><small>Tagihan belum lunas</small><b>${unpaid.length ? `${unpaid.length} pesanan` : "Bersih"}</b><em>${unpaid.length ? "Perlu ditagih" : "Tidak ada tagihan aktif"}</em></span>
          </div>
          <div class="dashboard-status-list">
            <div class="status-row danger"><i>${navIcon("stock")}</i><span>Bahan baku habis</span><strong>${rawMaterialAlertCount ? `${rawMaterialAlertCount} item` : "Aman"}</strong></div>
            <div class="status-row danger"><i>${navIcon("products")}</i><span>Produk Habis</span><strong>${productSoldOutAlertCount ? `${productSoldOutAlertCount} item` : "Aman"}</strong></div>
            <div class="status-row info"><i>${navIcon("kitchen")}</i><span>Antrian dapur</span><strong>${active.length ? `${active.length} pesanan` : "Kosong"}</strong></div>
            <div class="status-row success"><i>${navIcon("products")}</i><span>Produk aktif</span><strong>${availableProducts} produk</strong></div>
            <div class="status-row warn"><i>${navIcon("dashboard")}</i><span>Kategori</span><strong>${categories.length} tersedia</strong></div>
          </div>
        </div>
        <div class="card dashboard-trend-card">
          <div class="section-title">
            <div><h3>Produk Terlaris</h3><p>Diambil dari transaksi selesai pada periode ini.</p></div>
            <button class="btn ghost" onclick="openTodayProductSalesReport()">Lihat Semua</button>
          </div>
          <div class="dashboard-top-products">
            ${topItems.map(item => `
              <div class="dashboard-top-product-row">
                <strong>${escapeHtml(item.name)}</strong>
                <span>${Number(item.qty || 0).toLocaleString("id-ID")}</span>
              </div>
            `).join("") || `<div class="dashboard-empty-state"><span></span><p>Belum ada produk terjual pada periode ini.</p></div>`}
          </div>
        </div>
        <div class="card dashboard-cancel-list-card">
          <div class="section-title">
            <div>
              <h3>Pesanan Dibatalkan</h3>
              <p>${cancelled.length ? `${cancelled.length} pesanan pada periode ini` : "Tidak ada pembatalan"}</p>
            </div>
            <button class="btn ghost" onclick="openCancelledOrdersReport()">Lihat Semua</button>
          </div>
          <div class="dashboard-order-list dashboard-cancel-order-list">
            ${cancelledLatest.map(dashboardOrderItem).join("") || empty("Tidak ada pesanan dibatalkan pada periode ini.")}
          </div>
        </div>
        <div class="card dashboard-alert-card dashboard-raw-material-alert-card">
          <div class="section-title">
            <div><h3>Bahan Baku Habis</h3><p>Stok habis atau menipis dari Stok Opname.</p></div>
          </div>
          <div class="dashboard-alert-list">
            ${rawMaterialAlerts.map(row => dashboardStockAlertItem(row)).join("") || empty("Bahan baku aman untuk saat ini.")}
          </div>
        </div>
        <div class="card dashboard-alert-card dashboard-product-alert-card">
          <div class="section-title">
            <div><h3>Produk Habis</h3><p>Produk habis dari Manajemen Stok.</p></div>
          </div>
          <div class="dashboard-alert-list">
            ${productSoldOutAlerts.map(row => dashboardStockAlertItem(row)).join("") || empty("Tidak ada produk habis.")}
          </div>
        </div>
      </div>
    </div>
  `;
}

function dashboardStockAlertStatus(product) {
  if (typeof stockStatus === "function") return stockStatus(product);
  if (product.soldOut || (product.trackStock && Number(product.stock || 0) <= 0)) return { label: "Habis", className: "cancel", rank: 0 };
  if (product.trackStock && Number(product.stock || 0) <= Number(product.minStock || 0)) return { label: "Menipis", className: "process", rank: 1 };
  return { label: "Aman", className: "ready", rank: 2 };
}

function dashboardSortStockAlerts(a, b) {
  return a.status.rank - b.status.rank || String(a.product.name || "").localeCompare(String(b.product.name || ""), "id", { sensitivity: "base" });
}

function dashboardRawMaterialAlerts(limit = 4) {
  return stableProducts(state.products)
    .filter(product => product.stockOpname)
    .map(product => ({ product, status: dashboardStockAlertStatus(product) }))
    .filter(row => ["Habis", "Menipis"].includes(row.status.label))
    .sort(dashboardSortStockAlerts)
    .slice(0, limit);
}

function dashboardProductSoldOutAlerts(limit = 4) {
  return stableProducts(state.products)
    .filter(product => !product.stockOpname)
    .map(product => ({ product, status: dashboardStockAlertStatus(product) }))
    .filter(row => row.status.label === "Habis")
    .sort(dashboardSortStockAlerts)
    .slice(0, limit);
}

function dashboardStockAlertItem(row) {
  const product = row.product || row;
  const status = row.status || dashboardStockAlertStatus(product);
  const isWarning = status.label === "Menipis";
  return `
    <div class="dashboard-stock-item">
      <i>${navIcon("products")}</i>
      <strong>${escapeHtml(product.name)}</strong>
      <span class="${isWarning ? "warning" : "danger"}">${escapeHtml(status.label)}</span>
    </div>
  `;
}

function openTodayProductSalesReport() {
  sessionStorage.setItem("report_section", "productSales");
  sessionStorage.setItem("report_period", "day");
  sessionStorage.removeItem("product_report_query");
  go("reports");
}

function openCancelledOrdersReport() {
  sessionStorage.setItem("orders_quick_filter", "Dibatalkan");
  sessionStorage.removeItem("orders_query");
  go("orders");
}

function dashboardPeriodFilter(activePeriod) {
  const items = [
    ["today", "Hari ini"],
    ["yesterday", "Kemarin"],
    ["week", "Minggu ini"],
    ["month", "Bulan ini"]
  ];
  return `
    <div class="dashboard-period-filter transaction-period-menu" role="tablist" aria-label="Filter periode dashboard">
      ${items.map(([key, label]) => `
        <button type="button" role="tab" aria-selected="${key === activePeriod}" class="${key === activePeriod ? "active" : ""}" onclick="setDashboardPeriod('${key}')">
          ${label}
        </button>
      `).join("")}
    </div>
  `;
}

function dashboardChannelIconClass(type) {
  if (type === "Take Away") return "takeaway";
  if (type === "Delivery") return "delivery";
  return "dinein";
}

function dashboardPeriod() {
  const period = sessionStorage.getItem("dashboard_period") || "today";
  return ["today", "yesterday", "week", "month"].includes(period) ? period : "today";
}

function setDashboardPeriod(period) {
  sessionStorage.setItem("dashboard_period", period);
  render();
}

function dashboardPeriodLabel(period) {
  return {
    today: "Hari ini",
    yesterday: "Kemarin",
    week: "Minggu ini",
    month: "Bulan ini"
  }[period] || "Hari ini";
}

function dashboardPeriodRange(period) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);

  if (period === "yesterday") {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate());
    return { start, end };
  }

  if (period === "week") {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 7);
    return { start, end };
  }

  if (period === "month") {
    start.setDate(1);
    end.setFullYear(start.getFullYear(), start.getMonth() + 1, 1);
    return { start, end };
  }

  end.setDate(end.getDate() + 1);
  return { start, end };
}

function dashboardReportRange(period, range) {
  const end = new Date(range.end);
  end.setMilliseconds(end.getMilliseconds() - 1);
  return {
    period: `dashboard-${period || "today"}`,
    start: range.start,
    end,
    label: dashboardPeriodLabel(period),
    group: period === "month" || period === "week" ? "day" : "hour"
  };
}

function dashboardFinancialMonths(range) {
  const months = [];
  const current = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
  const last = new Date(range.end.getFullYear(), range.end.getMonth(), 1);
  while (current <= last) {
    months.push({ year: current.getFullYear(), month: current.getMonth() + 1 });
    current.setMonth(current.getMonth() + 1);
  }
  return months;
}

function requestDashboardFinancialSummary(range) {
  if (!supabaseReadable() || !range) return;
  const staleMonths = dashboardFinancialMonths(range).filter(({ year, month }) => {
    const key = legacyProfitSummaryCacheKey("days", year, month);
    const loadedAt = Math.max(
      Number(profitSummaryLoadedAt.get(key) || 0),
      Number(legacyProfitSummaryLoadedAt.get(key) || 0)
    );
    return !profitSummaryLoadingKeys.has(key) && Date.now() - loadedAt >= 60000;
  });
  if (!staleMonths.length) return;
  Promise.all(staleMonths.map(({ year, month }) => loadProfitSummary("days", year, month, false))).then(() => {
    if (view === "dashboard" && !isBlockingInteractionActive()) render();
  });
}

function dashboardFinancialSummary(range) {
  if (!range) return [];
  const months = dashboardFinancialMonths(range);
  const loaded = months.every(({ year, month }) => {
    const key = legacyProfitSummaryCacheKey("days", year, month);
    return profitSummaryLoadedAt.has(key) || legacyProfitSummaryLoadedAt.has(key);
  });
  const rows = months
    .flatMap(({ year, month }) => profitSummaryCache.days[`${year}-${month}`] || [])
    .filter(row => {
      const date = new Date(`${row.salesDate || todayKey(new Date(row.year, Number(row.month || 1) - 1, row.day || 1))}T00:00:00`);
      return !Number.isNaN(date.getTime()) && date >= range.start && date <= range.end;
    });
  return { loaded, rows };
}

function dashboardFallbackFinancialRecords(range) {
  return reportSourceRecords(range).map(record => ({
    total: Number(record.total || 0),
    profit: Number(record.profit || 0),
    count: 1
  }));
}

function dashboardFinancialRecords(range) {
  const summary = dashboardFinancialSummary(range);
  const fallback = dashboardFallbackFinancialRecords(range);
  const hasSummaryValue = summary.rows.some(row => Number(row.total || 0) || Number(row.profit || 0));
  if (summary.loaded && (hasSummaryValue || !fallback.length)) {
    return summary.rows;
  }
  return fallback;
}

function isDashboardOrderInRange(order, range) {
  const value = order?.createdAt ? new Date(order.createdAt) : null;
  if (!value || Number.isNaN(value.getTime())) return false;
  return value >= range.start && value < range.end;
}

function dashboardOrderItem(order) {
  const shortNumber = displayOrderNumber(order.number);
  const label = dashboardStatusLabel(order.status);
  const className = dashboardStatusClass(order.status);
  const customer = String(order.customer || "").trim();
  const title = customer ? `${order.type} - ${customer}` : String(order.type || "");
  const cancelInfo = order.status === "Dibatalkan"
    ? `<small class="dashboard-order-cancel-note">${escapeHtml(order.cancelReason || "Tidak ada keterangan pembatalan.")}</small>`
    : "";
  return `
    <div class="dashboard-order-item ${order.status === "Dibatalkan" ? "is-cancelled" : ""}">
      <span class="dashboard-order-token">${escapeHtml(shortNumber)}</span>
      <div class="dashboard-order-main">
        <div class="dashboard-order-line">
          <strong>${escapeHtml(title)}</strong>
          <small>${money(orderTotal(order))}</small>
        </div>
        ${cancelInfo}
      </div>
      <span class="dashboard-order-badge ${className}">${label}</span>
    </div>
  `;
}

function dashboardStatusLabel(status) {
  if (status === "Pesanan Baru") return "Baru";
  if (status === "Sedang Disiapkan") return "Diproses";
  return status;
}

function dashboardStatusClass(status) {
  if (status === "Pesanan Baru") return "new";
  if (status === "Sedang Disiapkan") return "process";
  if (status === "Selesai") return "done";
  if (status === "Dibatalkan") return "cancel";
  return "ready";
}
