(function () {
  "use strict";

  const PROFILE_KEY = "kasirin_driver_profile_v1";
  const VIEW_KEY = "kasirin_driver_view_v1";
  const ACTIVE_STATUSES = ["SEARCHING_DRIVER", "DRIVER_ASSIGNED", "READY_FOR_PICKUP", "PICKED_UP", "DELIVERING"];
  const HISTORY_STATUSES = ["COMPLETED"];
  const ORDER_COLUMNS = [
    "id",
    "order_number",
    "source",
    "type",
    "customer_name",
    "customer_phone",
    "service_info",
    "note",
    "status",
    "payment_status",
    "customer_order_type",
    "customer_order_status",
    "subtotal",
    "delivery_fee",
    "grand_total",
    "created_at",
    "updated_at",
    "ready_at",
    "completed_at",
    "delivery_address",
    "delivery_note",
    "delivery_location",
    "delivery_latitude",
    "delivery_longitude",
    "driver_id",
    "driver_name",
    "driver_phone"
  ];
  const ITEM_COLUMNS = "id,order_id,product_name,sku,qty,price,variant_label,variant_data,note";
  const ADDON_COLUMNS = "order_item_id,addon_name,qty,price";

  const app = document.getElementById("app");
  const config = window.DriverAppConfig || {};
  const utils = window.DriverUtils || {};
  const state = {
    profile: loadProfile(),
    view: localStorage.getItem(VIEW_KEY) || "tasks",
    orders: [],
    loading: false,
    loginLoading: false,
    actionLoading: "",
    error: "",
    lastSyncAt: "",
    selectedId: "",
    menuOpen: false,
    realtimeReady: false
  };

  function escapeHtml(value) {
    return utils.escapeHtml ? utils.escapeHtml(value) : String(value ?? "");
  }

  function money(value) {
    return utils.money ? utils.money(value) : `Rp${Number(value || 0).toLocaleString("id-ID")}`;
  }

  function cleanPhone(value) {
    return utils.cleanPhone ? utils.cleanPhone(value) : String(value || "").replace(/[^0-9]/g, "");
  }

  function shortDateTime(value) {
    return utils.shortDateTime ? utils.shortDateTime(value) : "-";
  }

  function loadProfile() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveProfile(profile) {
    state.profile = {
      id: String(profile.id || profile.driver_id || profile.username || "").trim(),
      username: String(profile.username || profile.name || "").trim(),
      name: String(profile.name || profile.username || "").trim(),
      role: String(profile.role || "driver").trim(),
      phone: cleanPhone(profile.phone || profile.driver_phone || ""),
      menuAccess: Array.isArray(profile.menu_access) ? profile.menu_access : (Array.isArray(profile.menuAccess) ? profile.menuAccess : []),
      savedAt: new Date().toISOString()
    };
    if (!state.profile.id) state.profile.id = `driver_${state.profile.username || Date.now()}`;
    localStorage.setItem(PROFILE_KEY, JSON.stringify(state.profile));
  }

  function clearProfile() {
    state.profile = {};
    state.orders = [];
    state.selectedId = "";
    state.menuOpen = false;
    state.error = "";
    localStorage.removeItem(PROFILE_KEY);
  }

  function hasProfile() {
    return Boolean(state.profile?.id && state.profile?.name);
  }

  function normalizeLoginKey(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
  }

  function canUseDriver(member = {}) {
    const access = Array.isArray(member.menu_access) ? member.menu_access : (Array.isArray(member.menuAccess) ? member.menuAccess : []);
    return ["owner", "manager", "driver"].includes(String(member.role || "").toLowerCase()) || access.includes("driver");
  }

  function findStaffByLoginInList(members, staffCode) {
    const code = normalizeLoginKey(staffCode);
    return (members || []).find(member => [member.username, member.id, member.name].some(value => normalizeLoginKey(value) === code)) || null;
  }

  async function driverAuthFallbackFromSettings(client, staffCode, pin) {
    const { data, error } = await client
      .from("store_settings")
      .select("self_order_settings,updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const staff = data?.self_order_settings?.staff || {};
    const deletedIds = new Set(staff.deletedStaffIds || []);
    const member = findStaffByLoginInList((staff.members || []).filter(item => item?.active !== false && !deletedIds.has(item.id)), staffCode);
    if (!member || String(member.pin || "") !== String(pin || "")) return null;
    if (!canUseDriver(member)) return { blocked: true };
    return {
      id: member.id,
      username: member.username || member.name || member.id,
      name: member.name || member.username || member.id,
      role: member.role || "driver",
      menu_access: member.menuAccess || []
    };
  }

  async function authenticateDriver(staffCode, pin) {
    const client = await window.DriverSupabase.ready();
    const rpcResult = await client.rpc("authenticate_driver_staff", { p_login: staffCode, p_pin: pin });
    if (!rpcResult.error && Array.isArray(rpcResult.data) && rpcResult.data[0]) return rpcResult.data[0];
    if (rpcResult.error && !isMissingFunction(rpcResult.error)) throw rpcResult.error;
    return driverAuthFallbackFromSettings(client, staffCode, pin);
  }

  function isMissingFunction(error) {
    const text = String(error?.message || error?.details || "").toLowerCase();
    return error?.code === "42883" || text.includes("authenticate_driver_staff") || (text.includes("function") && text.includes("does not exist"));
  }

  function statusLabel(status) {
    const labels = {
      SEARCHING_DRIVER: "Mencari driver",
      DRIVER_ASSIGNED: "Driver ditugaskan",
      READY_FOR_PICKUP: "Siap diambil",
      PICKED_UP: "Sudah diambil",
      DELIVERING: "Dalam perjalanan",
      COMPLETED: "Selesai"
    };
    return labels[status] || status || "-";
  }

  function statusClass(status) {
    if (status === "COMPLETED") return "done";
    if (status === "SEARCHING_DRIVER") return "open";
    if (status === "DELIVERING") return "road";
    return "active";
  }

  function numberValue(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function distanceKm(order) {
    const latitude = numberValue(order.delivery_latitude);
    const longitude = numberValue(order.delivery_longitude);
    const storeLatitude = numberValue(config.storeLatitude);
    const storeLongitude = numberValue(config.storeLongitude);
    if (latitude === null || longitude === null || storeLatitude === null || storeLongitude === null) return null;
    const toRadians = degrees => degrees * Math.PI / 180;
    const earthRadiusKm = 6371;
    const deltaLatitude = toRadians(latitude - storeLatitude);
    const deltaLongitude = toRadians(longitude - storeLongitude);
    const startLatitude = toRadians(storeLatitude);
    const endLatitude = toRadians(latitude);
    const haversine = Math.sin(deltaLatitude / 2) ** 2
      + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(deltaLongitude / 2) ** 2;
    return 2 * earthRadiusKm * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  }

  function distanceLabel(order) {
    const distance = distanceKm(order);
    if (!Number.isFinite(distance)) return "Pin lokasi";
    return `${distance.toFixed(distance < 10 ? 1 : 0)} km`;
  }

  function orderTotal(order) {
    return Number(order.grand_total || order.subtotal || 0);
  }

  function mapsUrl(order) {
    const location = String(order.delivery_location || "").trim();
    if (/^https?:\/\//i.test(location)) return location;
    const latitude = numberValue(order.delivery_latitude);
    const longitude = numberValue(order.delivery_longitude);
    if (latitude === null || longitude === null) return "";
    return `https://www.google.com/maps?q=${latitude},${longitude}`;
  }

  function whatsappUrl(order) {
    const phone = cleanPhone(order.customer_phone);
    if (!phone) return "";
    const text = encodeURIComponent(`Halo Kak ${order.customer_name || ""}, saya driver Fresin untuk pesanan ${order.order_number || ""}.`);
    return `https://wa.me/${phone}?text=${text}`;
  }

  function driverMatches(order) {
    const phone = cleanPhone(order.driver_phone);
    const currentPhone = cleanPhone(state.profile.phone);
    if (order.driver_id && order.driver_id === state.profile.id) return true;
    if (phone && currentPhone && phone === currentPhone) return true;
    return Boolean(order.driver_name && state.profile.name && String(order.driver_name).toLowerCase() === String(state.profile.name).toLowerCase());
  }

  function canShowActive(order) {
    const status = order.customer_order_status;
    if (!["DRIVER_ASSIGNED", "READY_FOR_PICKUP", "PICKED_UP", "DELIVERING"].includes(status)) return false;
    return driverMatches(order) || (!order.driver_id && !order.driver_name && !order.driver_phone);
  }

  function isToday(value) {
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) return false;
    const today = new Date();
    return date.getFullYear() === today.getFullYear()
      && date.getMonth() === today.getMonth()
      && date.getDate() === today.getDate();
  }

  function todayCompletedOrders() {
    return state.orders.filter(order => (
      order.customer_order_status === "COMPLETED"
      && isToday(order.completed_at || order.updated_at)
      && (driverMatches(order) || !order.driver_id)
    ));
  }

  function earningsTotal(orders = todayCompletedOrders()) {
    return orders.reduce((total, order) => total + Number(order.delivery_fee || 0), 0);
  }

  function filteredOrders() {
    if (state.view === "active") return state.orders.filter(canShowActive);
    if (state.view === "history") return todayCompletedOrders();
    return state.orders.filter(order => order.customer_order_status === "SEARCHING_DRIVER");
  }

  function ordersCount(view) {
    if (view === "active") return state.orders.filter(canShowActive).length;
    if (view === "history" || view === "earnings") return todayCompletedOrders().length;
    return state.orders.filter(order => order.customer_order_status === "SEARCHING_DRIVER").length;
  }

  function missingColumnName(error) {
    const message = String(error?.message || error?.details || "");
    const quoted = message.match(/'([^']+)' column|column "([^"]+)"/i);
    return quoted ? (quoted[1] || quoted[2] || "") : "";
  }

  function isMissingColumn(error) {
    return error?.code === "42703" || /column .* does not exist|could not find .* column/i.test(String(error?.message || error?.details || ""));
  }

  async function selectOrders(client, columns) {
    return client
      .from("orders")
      .select(columns.join(","))
      .eq("customer_order_type", "DELIVERY")
      .eq("payment_status", "Lunas")
      .in("customer_order_status", [...ACTIVE_STATUSES, ...HISTORY_STATUSES])
      .order("updated_at", { ascending: false })
      .limit(120);
  }

  async function fetchOrders() {
    if (state.loading || !hasProfile()) return;
    state.loading = true;
    state.error = "";
    render();
    try {
      const client = await window.DriverSupabase.ready();
      let columns = [...ORDER_COLUMNS];
      let result = await selectOrders(client, columns);
      for (let attempt = 0; result.error && isMissingColumn(result.error) && attempt < 8; attempt += 1) {
        const column = missingColumnName(result.error);
        if (!column || !columns.includes(column)) break;
        columns = columns.filter(item => item !== column);
        result = await selectOrders(client, columns);
      }
      if (result.error) throw result.error;
      const orders = result.data || [];
      await attachItems(client, orders);
      state.orders = orders;
      state.lastSyncAt = new Date().toISOString();
      setupRealtime(client);
    } catch (error) {
      console.warn("Driver orders refresh failed", error);
      state.error = "Gagal memuat tugas. Cek koneksi atau policy Supabase.";
    } finally {
      state.loading = false;
      render();
    }
  }

  async function attachItems(client, orders) {
    const ids = orders.map(order => order.id).filter(Boolean);
    if (!ids.length) return;
    const itemsResult = await client
      .from("order_items")
      .select(ITEM_COLUMNS)
      .in("order_id", ids)
      .order("id", { ascending: true });
    if (itemsResult.error) throw itemsResult.error;
    const items = itemsResult.data || [];
    let addonsByItem = new Map();
    const itemIds = items.map(item => item.id).filter(Boolean);
    if (itemIds.length) {
      const addonsResult = await client
        .from("order_item_addons")
        .select(ADDON_COLUMNS)
        .in("order_item_id", itemIds);
      if (!addonsResult.error) {
        addonsByItem = (addonsResult.data || []).reduce((map, addon) => {
          const list = map.get(addon.order_item_id) || [];
          list.push(addon);
          map.set(addon.order_item_id, list);
          return map;
        }, new Map());
      }
    }
    const itemsByOrder = items.reduce((map, item) => {
      const list = map.get(item.order_id) || [];
      list.push({ ...item, addons: addonsByItem.get(item.id) || [] });
      map.set(item.order_id, list);
      return map;
    }, new Map());
    orders.forEach(order => {
      order.items = itemsByOrder.get(order.id) || [];
    });
  }

  function setupRealtime(client) {
    if (state.realtimeReady || !client?.channel) return;
    state.realtimeReady = true;
    client
      .channel("kasirin-driver-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        window.setTimeout(fetchOrders, 500);
      })
      .subscribe();
  }

  async function updateOrder(order, patch, options = {}) {
    const client = await window.DriverSupabase.ready();
    let payload = { ...patch, updated_at: new Date().toISOString() };
    for (let attempt = 0; attempt < 8; attempt += 1) {
      let query = client.from("orders").update(payload).eq("id", order.id);
      if (options.onlyStatus) query = query.eq("customer_order_status", options.onlyStatus);
      const { data, error } = await query.select("id");
      if (!error) {
        if (!Array.isArray(data) || data.length < 1) throw new Error("Order sudah berubah atau sudah diambil driver lain.");
        return true;
      }
      if (!isMissingColumn(error)) throw error;
      const column = missingColumnName(error);
      if (!column || !Object.prototype.hasOwnProperty.call(payload, column)) throw error;
      delete payload[column];
    }
    return false;
  }

  async function runAction(action, orderId) {
    const order = state.orders.find(item => item.id === orderId);
    if (!order || !hasProfile()) return;
    const now = new Date().toISOString();
    const actions = {
      take: {
        label: "Mengambil tugas...",
        patch: {
          customer_order_status: "DRIVER_ASSIGNED",
          driver_id: state.profile.id,
          driver_name: state.profile.name,
          driver_phone: state.profile.phone || ""
        },
        onlyStatus: "SEARCHING_DRIVER"
      },
      picked: {
        label: "Menyimpan pengambilan...",
        patch: {
          customer_order_status: "PICKED_UP",
          driver_id: state.profile.id,
          driver_name: state.profile.name,
          driver_phone: state.profile.phone || ""
        }
      },
      delivering: {
        label: "Mengubah status...",
        patch: { customer_order_status: "DELIVERING" }
      },
      complete: {
        label: "Menyelesaikan order...",
        patch: { customer_order_status: "COMPLETED", status: "Selesai", completed_at: now }
      }
    };
    const next = actions[action];
    if (!next) return;
    state.actionLoading = next.label;
    state.error = "";
    render();
    try {
      await updateOrder(order, next.patch, { onlyStatus: next.onlyStatus });
      if (action === "take" || action === "picked" || action === "delivering") state.view = "active";
      if (action === "complete") state.view = "earnings";
      localStorage.setItem(VIEW_KEY, state.view);
      await fetchOrders();
    } catch (error) {
      console.warn("Driver order action failed", error);
      state.error = "Status belum tersimpan. Cek koneksi lalu coba lagi.";
    } finally {
      state.actionLoading = "";
      render();
    }
  }

  function renderLogin() {
    return `
      <main class="driver-shell login">
        <section class="driver-login-panel">
          <div class="driver-brand">
            <span class="driver-brand-mark" aria-hidden="true">${icon("bike")}</span>
            <div>
              <strong>Fresin Driver</strong>
              <small>Masuk dengan akun staff POS</small>
            </div>
          </div>
          <form class="driver-login-form" data-driver-form="login">
            ${state.error ? `<div class="driver-alert">${escapeHtml(state.error)}</div>` : ""}
            <label>
              <span>Akun staff</span>
              <input name="staffCode" type="text" autocomplete="username" required placeholder="Username driver" value="${escapeHtml(state.profile.username || "")}" />
            </label>
            <label>
              <span>PIN</span>
              <input name="pin" type="password" inputmode="numeric" autocomplete="current-password" minlength="4" required placeholder="PIN staff" />
            </label>
            <button class="driver-primary" type="submit" ${state.loginLoading ? "disabled" : ""}>
              ${icon("start")}<span>${state.loginLoading ? "Memeriksa..." : "Masuk"}</span>
            </button>
          </form>
        </section>
      </main>
    `;
  }

  function render() {
    if (!app) return;
    if (!hasProfile()) {
      app.innerHTML = renderLogin();
      return;
    }
    const selected = state.selectedId ? state.orders.find(order => order.id === state.selectedId) : null;
    app.innerHTML = `
      <main class="driver-shell">
        ${renderTopbar()}
        ${selected ? renderDetail(selected) : state.view === "earnings" ? renderEarnings() : renderList()}
        ${renderDriverDrawer()}
        ${state.actionLoading ? `<div class="driver-busy">${escapeHtml(state.actionLoading)}</div>` : ""}
      </main>
    `;
  }

  function renderTopbar() {
    return `
      <header class="driver-topbar">
        <button class="driver-icon-btn" type="button" data-action="toggle-menu" aria-label="Buka menu" title="Buka menu">${icon("menu")}</button>
        <div class="driver-brand compact">
          <div>
            <strong>Fresin Driver</strong>
            <small>${escapeHtml(state.profile.name)} - ${state.lastSyncAt ? `Sync ${shortDateTime(state.lastSyncAt)}` : "Siap bertugas"}</small>
          </div>
        </div>
        <button class="driver-icon-btn" type="button" data-action="refresh" aria-label="Refresh tugas" title="Refresh tugas">${icon("refresh")}</button>
      </header>
    `;
  }

  function renderDriverDrawer() {
    const items = [
      ["tasks", "Tugas Baru", "bag", ordersCount("tasks") > 0 ? ordersCount("tasks") : ""],
      ["active", "Tugas Aktif", "road", ordersCount("active") > 0 ? ordersCount("active") : ""],
      ["history", "Riwayat", "check", ""],
      ["earnings", "Pendapatan", "wallet", ""]
    ];
    return `
      <div class="driver-drawer ${state.menuOpen ? "open" : ""}" aria-hidden="${state.menuOpen ? "false" : "true"}">
        <button class="driver-drawer-backdrop" type="button" data-action="close-menu" aria-label="Tutup menu"></button>
        <aside class="driver-menu-panel">
          <div class="driver-menu-head">
            <button class="driver-icon-btn menu-head-toggle" type="button" data-action="toggle-menu" aria-label="Tutup menu" title="Tutup menu">${icon("menu")}</button>
            <div>
              <strong>${escapeHtml(state.profile.name)}</strong>
              <small>${escapeHtml(state.profile.username || state.profile.role || "Driver")}</small>
            </div>
          </div>
          <nav class="driver-menu-list" aria-label="Menu driver">
            ${items.map(([id, label, iconName, badge]) => `
              <button class="${state.view === id && !state.selectedId ? "active" : ""}" type="button" data-view="${id}">
                ${icon(iconName)}
                <span>${escapeHtml(label)}</span>
                ${badge ? `<b>${escapeHtml(badge)}</b>` : ""}
              </button>
            `).join("")}
          </nav>
          <div class="driver-menu-actions">
            <button class="driver-secondary" type="button" data-action="refresh">${icon("refresh")}<span>Refresh</span></button>
            <button class="driver-secondary danger" type="button" data-action="logout">${icon("logout")}<span>Keluar</span></button>
          </div>
        </aside>
      </div>
    `;
  }

  function viewTitle() {
    const titles = {
      tasks: ["Tugas Baru", "Order delivery lunas yang siap diambil."],
      active: ["Tugas Aktif", "Order yang sedang kamu antar."],
      history: ["Riwayat hari ini", "Order selesai hari ini."],
      earnings: ["Pendapatan", "Total ongkir untuk diambil di toko."]
    };
    return titles[state.view] || titles.tasks;
  }

  function renderList() {
    const orders = filteredOrders();
    const [title, subtitle] = viewTitle();
    return `
      <section class="driver-content">
        <div class="driver-section-head">
          <div>
            <h1>${escapeHtml(title)}</h1>
            <p>${escapeHtml(subtitle)}</p>
          </div>
          ${["tasks", "active"].includes(state.view) && orders.length > 0 ? `<span>${orders.length}</span>` : ""}
        </div>
        ${renderShiftCard()}
        ${state.error ? `<div class="driver-alert">${escapeHtml(state.error)}</div>` : ""}
        <div class="driver-list">
          ${state.loading ? skeletonCards() : orders.map(renderOrderCard).join("") || emptyState()}
        </div>
      </section>
    `;
  }

  function renderShiftCard() {
    const newCount = ordersCount("tasks");
    const activeCount = ordersCount("active");
    const doneCount = todayCompletedOrders().length;
    return `
      <section class="driver-shift-card" aria-label="Ringkasan tugas driver">
        <div class="driver-shift-copy">
          <span>Online</span>
          <strong>Siap ambil delivery</strong>
          <small>${escapeHtml(state.profile.name || "Driver")} sedang bertugas dari outlet Fresin.</small>
        </div>
        <div class="driver-route-preview" aria-hidden="true">
          <i></i>
          <b></b>
          <em></em>
        </div>
        <div class="driver-shift-stats">
          <span><b>${newCount}</b><small>Baru</small></span>
          <span><b>${activeCount}</b><small>Aktif</small></span>
          <span><b>${doneCount}</b><small>Selesai</small></span>
        </div>
      </section>
    `;
  }

  function renderEarnings() {
    const orders = todayCompletedOrders();
    const total = earningsTotal(orders);
    const claimCode = `${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(state.profile.username || state.profile.id || "driver").toUpperCase()}`;
    return `
      <section class="driver-content">
        <div class="driver-section-head">
          <div>
            <h1>Pendapatan</h1>
            <p>Total ongkir order selesai untuk diambil di toko.</p>
          </div>
        </div>
        ${state.error ? `<div class="driver-alert">${escapeHtml(state.error)}</div>` : ""}
        <article class="driver-earnings-hero">
          <small>Ambil pendapatan di toko</small>
          <strong>${money(total)}</strong>
          <span>${orders.length} order selesai hari ini</span>
        </article>
        <section class="driver-claim-panel">
          <span>${icon("wallet")}</span>
          <div>
            <strong>Kode klaim ${escapeHtml(claimCode)}</strong>
            <small>Tunjukkan halaman ini ke kasir atau owner saat mengambil pendapatan ongkir.</small>
          </div>
        </section>
        <div class="driver-list">
          ${state.loading ? skeletonCards() : orders.map(renderEarningCard).join("") || emptyState()}
        </div>
      </section>
    `;
  }

  function renderOrderCard(order) {
    const status = order.customer_order_status;
    const address = order.delivery_address || order.service_info || "Alamat customer";
    return `
      <article class="driver-order-card" data-order-id="${escapeHtml(order.id)}">
        <div class="driver-card-top">
          <span>Order ${escapeHtml(order.order_number || "-")}</span>
          <strong>${money(orderTotal(order))}</strong>
        </div>
        <button class="driver-card-main" type="button" data-open-order="${escapeHtml(order.id)}">
          <span class="driver-order-icon" aria-hidden="true">${icon(status === "COMPLETED" ? "check" : "bag")}</span>
          <span class="driver-card-copy">
            <strong>${escapeHtml(order.customer_name || "Customer")}</strong>
            <small>${escapeHtml(distanceLabel(order))} dari outlet</small>
          </span>
          <span class="driver-card-chevron" aria-hidden="true">${icon("back")}</span>
        </button>
        <div class="driver-route-lines">
          <span>
            <i class="pickup-dot" aria-hidden="true"></i>
            <b>Pickup</b>
            <strong>Outlet Fresin</strong>
          </span>
          <span>
            <i class="drop-dot" aria-hidden="true"></i>
            <b>Antar</b>
            <strong>${escapeHtml(address)}</strong>
          </span>
        </div>
        <div class="driver-card-meta">
          <span class="driver-pill ${statusClass(status)}">${escapeHtml(statusLabel(status))}</span>
          <span>${icon("fee")} Ongkir ${money(order.delivery_fee || 0)}</span>
          <span>${shortDateTime(order.created_at)}</span>
        </div>
        ${status === "SEARCHING_DRIVER" ? `<button class="driver-primary compact-btn" type="button" data-action="take" data-order="${escapeHtml(order.id)}">${icon("plus")}<span>Ambil order</span></button>` : ""}
      </article>
    `;
  }

  function renderEarningCard(order) {
    return `
      <article class="driver-order-card earning">
        <button class="driver-card-main" type="button" data-open-order="${escapeHtml(order.id)}">
          <span class="driver-order-icon" aria-hidden="true">${icon("wallet")}</span>
          <span class="driver-card-copy">
            <strong>${escapeHtml(order.order_number || "-")}</strong>
            <small>${escapeHtml(order.customer_name || "Customer")} - selesai ${shortDateTime(order.completed_at || order.updated_at)}</small>
          </span>
          <span class="driver-card-total">${money(order.delivery_fee || 0)}</span>
        </button>
      </article>
    `;
  }

  function renderDetail(order) {
    const status = order.customer_order_status;
    const map = mapsUrl(order);
    const wa = whatsappUrl(order);
    return `
      <section class="driver-content detail">
        <button class="driver-back" type="button" data-action="back">${icon("back")}<span>Kembali</span></button>
        <article class="driver-detail-head">
          <div>
            <small>Pesanan ${escapeHtml(order.order_number || "-")}</small>
            <h1>${escapeHtml(order.customer_name || "Customer")}</h1>
          </div>
          <span class="driver-pill ${statusClass(status)}">${escapeHtml(statusLabel(status))}</span>
        </article>
        <section class="driver-summary-grid">
          <span><b>Total</b><strong>${money(orderTotal(order))}</strong></span>
          <span><b>Ongkir</b><strong>${money(order.delivery_fee || 0)}</strong></span>
          <span><b>Jarak</b><strong>${distanceLabel(order)}</strong></span>
          <span><b>WhatsApp</b><strong>${escapeHtml(order.customer_phone || "-")}</strong></span>
        </section>
        <section class="driver-panel">
          <h2>Item pesanan</h2>
          <div class="driver-items">
            ${(order.items || []).map(renderItem).join("") || `<p class="driver-muted">Item belum termuat.</p>`}
          </div>
        </section>
        <section class="driver-panel">
          <h2>Alamat dan catatan</h2>
          <div class="driver-address">
            <p>${escapeHtml(order.delivery_address || order.service_info || "Pin lokasi delivery")}</p>
            <span><b>Patokan</b>${escapeHtml(order.delivery_note || "-")}</span>
            <span><b>Catatan driver</b>${escapeHtml(order.note || "-")}</span>
          </div>
          <div class="driver-action-row">
            <a class="driver-secondary ${map ? "" : "disabled"}" href="${escapeHtml(map || "#")}" target="_blank" rel="noopener">${icon("map")}<span>Buka Maps</span></a>
            <a class="driver-secondary ${wa ? "" : "disabled"}" href="${escapeHtml(wa || "#")}" target="_blank" rel="noopener">${icon("chat")}<span>Chat Customer</span></a>
          </div>
        </section>
        ${renderStatusAction(order)}
      </section>
    `;
  }

  function renderItem(item) {
    const addons = (item.addons || []).map(addon => `${addon.addon_name} x${Number(addon.qty || 1)}`).join(", ");
    return `
      <div class="driver-item-row">
        <span>
          <strong>${escapeHtml(item.product_name || "Item")}</strong>
          <small>${escapeHtml([item.variant_label, item.note, addons].filter(Boolean).join(" - ") || "-")}</small>
        </span>
        <b>${Number(item.qty || 1).toLocaleString("id-ID")}x</b>
      </div>
    `;
  }

  function renderStatusAction(order) {
    const status = order.customer_order_status;
    if (status === "SEARCHING_DRIVER") return `<button class="driver-sticky-action" type="button" data-action="take" data-order="${escapeHtml(order.id)}">${icon("plus")}<span>Ambil order</span></button>`;
    if (status === "DRIVER_ASSIGNED" || status === "READY_FOR_PICKUP") return `<button class="driver-sticky-action" type="button" data-action="picked" data-order="${escapeHtml(order.id)}">${icon("bag")}<span>Pesanan Diambil dari Outlet</span></button>`;
    if (status === "PICKED_UP") return `<button class="driver-sticky-action" type="button" data-action="delivering" data-order="${escapeHtml(order.id)}">${icon("road")}<span>Dalam Perjalanan</span></button>`;
    if (status === "DELIVERING") return `<button class="driver-sticky-action done" type="button" data-action="complete" data-order="${escapeHtml(order.id)}">${icon("check")}<span>Selesai Diantar</span></button>`;
    return `<div class="driver-completed">${icon("check")} Pesanan selesai diantar</div>`;
  }

  function emptyState() {
    const copy = {
      tasks: ["Belum ada tugas tersedia", "Order delivery lunas akan muncul di sini."],
      active: ["Belum ada tugas aktif", "Order yang kamu ambil akan tampil di sini."],
      history: ["Riwayat hari ini kosong", "Order selesai hari ini akan masuk ke riwayat."],
      earnings: ["Pendapatan kosong", "Order selesai hari ini akan dihitung sebagai pendapatan ongkir."]
    }[state.view] || [];
    return `
      <section class="driver-empty">
        <span aria-hidden="true">${icon(state.view === "earnings" ? "wallet" : state.view === "history" ? "check" : "bag")}</span>
        <strong>${escapeHtml(copy[0])}</strong>
        <p>${escapeHtml(copy[1])}</p>
      </section>
    `;
  }

  function skeletonCards() {
    return Array.from({ length: 4 }, () => `<article class="driver-order-card skeleton"><i></i><i></i><i></i></article>`).join("");
  }

  function icon(name) {
    const icons = {
      bike: '<svg viewBox="0 0 24 24"><path d="M5 16.5a3 3 0 1 0 0 .1M19 16.5a3 3 0 1 0 0 .1M7.5 16.5h4.2l2.1-6.5h2.4l1.6 3.4M6.5 11h3.2l2 5.5M13.7 10H17M9 7h3"/></svg>',
      bag: '<svg viewBox="0 0 24 24"><path d="M7 8h10l1 12H6L7 8ZM9 8a3 3 0 0 1 6 0"/></svg>',
      check: '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>',
      road: '<svg viewBox="0 0 24 24"><path d="M7 20 11 4h2l4 16M12 8v2M12 14v2"/></svg>',
      refresh: '<svg viewBox="0 0 24 24"><path d="M20 6v5h-5M4 18v-5h5M18.5 9A7 7 0 0 0 6.4 6.8M5.5 15a7 7 0 0 0 12.1 2.2"/></svg>',
      plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
      fee: '<svg viewBox="0 0 24 24"><path d="M4 7h16v10H4V7ZM8 12h.1M16 12h.1M12 9v6"/></svg>',
      map: '<svg viewBox="0 0 24 24"><path d="m9 18-6 3V6l6-3 6 3 6-3v15l-6 3-6-3ZM9 3v15M15 6v15"/></svg>',
      chat: '<svg viewBox="0 0 24 24"><path d="M5 19.5 6.2 16A7 7 0 1 1 9 18.7L5 19.5Z"/></svg>',
      back: '<svg viewBox="0 0 24 24"><path d="M15 18 9 12l6-6"/></svg>',
      start: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
      menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
      wallet: '<svg viewBox="0 0 24 24"><path d="M4 7h14a2 2 0 0 1 2 2v9H4V7Zm0 0 12-3v3M16 13h.1"/></svg>',
      logout: '<svg viewBox="0 0 24 24"><path d="M10 17 15 12l-5-5M15 12H3M21 4v16"/></svg>'
    };
    return icons[name] || icons.bag;
  }

  function setView(view) {
    state.view = view;
    state.selectedId = "";
    state.menuOpen = false;
    localStorage.setItem(VIEW_KEY, view);
    render();
  }

  app?.addEventListener("submit", async event => {
    const form = event.target.closest("[data-driver-form='login']");
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    const staffCode = String(data.get("staffCode") || "").trim();
    const pin = String(data.get("pin") || "").trim();
    if (!staffCode || pin.length < 4) {
      state.error = "Isi akun staff dan PIN minimal 4 digit.";
      render();
      return;
    }
    state.loginLoading = true;
    state.error = "";
    render();
    try {
      const member = await authenticateDriver(staffCode, pin);
      if (!member) {
        state.error = "Akun staff atau PIN tidak cocok.";
        return;
      }
      if (member.blocked || !canUseDriver(member)) {
        state.error = "Akun staff belum punya akses Driver di POS.";
        return;
      }
      saveProfile(member);
      state.view = localStorage.getItem(VIEW_KEY) || "tasks";
      fetchOrders();
    } catch (error) {
      console.warn("Driver login failed", error);
      state.error = "Login belum berhasil. Jalankan SQL driver staff login atau cek koneksi.";
    } finally {
      state.loginLoading = false;
      render();
    }
  });

  app?.addEventListener("click", event => {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) {
      setView(viewButton.dataset.view);
      return;
    }
    const openButton = event.target.closest("[data-open-order]");
    if (openButton) {
      state.selectedId = openButton.dataset.openOrder;
      state.menuOpen = false;
      render();
      return;
    }
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    const action = actionButton.dataset.action;
    if (action === "back") {
      state.selectedId = "";
      render();
      return;
    }
    if (action === "toggle-menu") {
      state.menuOpen = !state.menuOpen;
      render();
      return;
    }
    if (action === "close-menu") {
      state.menuOpen = false;
      render();
      return;
    }
    if (action === "refresh") {
      state.menuOpen = false;
      fetchOrders();
      return;
    }
    if (action === "logout") {
      clearProfile();
      render();
      return;
    }
    runAction(action, actionButton.dataset.order);
  });

  window.DriverOrder = {
    refresh: fetchOrders,
    setView,
    state,
    statusLabel,
    mapsUrl,
    whatsappUrl,
    todayCompletedOrders,
    earningsTotal
  };

  render();
  if (hasProfile()) fetchOrders();
  window.setInterval(() => {
    if (hasProfile()) fetchOrders();
  }, Number(config.refreshMs || 15000));
}());
