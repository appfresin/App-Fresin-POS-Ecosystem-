(function () {
  "use strict";

  const PROFILE_KEY = "kasirin_driver_profile_v1";
  const VIEW_KEY = "kasirin_driver_view_v1";
  const WALLET_DATE_KEY = "kasirin_driver_wallet_date_v1";
  const WALLET_DATE_TO_KEY = "kasirin_driver_wallet_date_to_v1";
  const WALLET_MODE_KEY = "kasirin_driver_wallet_mode_v1";
  const WALLET_CLAIMS_KEY = "kasirin_driver_wallet_claims_v1";
  const ACTIVE_STATUSES = ["SEARCHING_DRIVER", "DRIVER_ASSIGNED", "READY_FOR_PICKUP", "PICKED_UP", "DELIVERING"];
  const HISTORY_STATUSES = ["COMPLETED"];
  const DRIVER_FETCH_RETRY_MS = 30000;
  const DRIVER_REALTIME_DEBOUNCE_MS = 900;
  const DRIVER_STALE_POLL_MS = 120000;
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
  const MIN_ORDER_COLUMNS = [
    "id",
    "order_number",
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
    "updated_at"
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
    fetching: false,
    loading: false,
    loginLoading: false,
    actionLoading: "",
    error: "",
    lastSyncAt: "",
    selectedId: "",
    menuOpen: false,
    claimLoading: false,
    claimError: "",
    claimValidator: null,
    walletMode: loadWalletMode(),
    walletDate: loadWalletDate(),
    walletDateTo: loadWalletDateTo(),
    walletClaims: loadWalletClaims(),
    fetchFailCount: 0,
    lastFetchErrorAt: 0,
    nextFetchAt: 0,
    realtimeStarted: false,
    realtimeReady: false,
    pendingVisibleRefresh: false,
    itemLoadingId: ""
  };
  const loadedItemOrderIds = new Set();
  let realtimeRefreshTimer = 0;

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

  function shortTime(value) {
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }).replace(/\./g, ":");
  }

  function localDateKey(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value || "");
    if (Number.isNaN(date.getTime())) return localDateKey(new Date());
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function loadWalletDate() {
    const saved = String(localStorage.getItem(WALLET_DATE_KEY) || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(saved) ? saved : localDateKey();
  }

  function loadWalletDateTo() {
    const saved = String(localStorage.getItem(WALLET_DATE_TO_KEY) || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(saved) ? saved : localDateKey();
  }

  function loadWalletMode() {
    const saved = String(localStorage.getItem(WALLET_MODE_KEY) || "").trim();
    return saved === "claim" ? "claim" : "history";
  }

  function loadWalletClaims() {
    try {
      const claims = JSON.parse(localStorage.getItem(WALLET_CLAIMS_KEY) || "[]");
      return Array.isArray(claims) ? claims.filter(item => item && typeof item === "object") : [];
    } catch {
      return [];
    }
  }

  function saveWalletClaims() {
    localStorage.setItem(WALLET_CLAIMS_KEY, JSON.stringify(state.walletClaims.slice(0, 36)));
  }

  function walletMonthKey(value = state.walletDate) {
    const key = /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value).slice(0, 7) : localDateKey().slice(0, 7);
    return key;
  }

  function walletMonthLabel(monthKey = walletMonthKey()) {
    const date = new Date(`${monthKey}-01T00:00:00`);
    if (Number.isNaN(date.getTime())) return monthKey;
    return date.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  }

  function walletDateLabel(value = state.walletDate) {
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value || "-";
    return date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  }

  function walletDateRange() {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(state.walletDate || "")) ? state.walletDate : localDateKey();
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(state.walletDateTo || "")) ? state.walletDateTo : from;
    return from <= to ? { from, to } : { from: to, to: from };
  }

  function walletDateRangeLabel() {
    const range = walletDateRange();
    if (range.from === range.to) return walletDateLabel(range.from);
    return `${walletDateLabel(range.from)} - ${walletDateLabel(range.to)}`;
  }

  function elapsedLabel(value) {
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) return "waktu belum jelas";
    const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
    if (minutes < 1) return "baru saja";
    if (minutes < 60) return `${minutes} menit lalu`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} jam lalu`;
    return `${Math.floor(hours / 24)} hari lalu`;
  }

  function detailHeroTiming(order) {
    const source = order.created_at || order.updated_at;
    if (!source) return "Waktu order belum tersedia";
    return `Masuk ${shortTime(source)} - ${elapsedLabel(source)}`;
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
    state.claimError = "";
    state.claimValidator = null;
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

  function staffRoleLabel(role) {
    const labels = {
      owner: "Owner",
      manager: "Manager",
      kasir: "Kasir",
      driver: "Driver",
      dapur: "Dapur"
    };
    return labels[String(role || "").toLowerCase()] || "Staff";
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

  function isMissingClaimFunction(error) {
    const text = String(error?.message || error?.details || "").toLowerCase();
    return error?.code === "42883" || text.includes("validate_driver_claim_cashier_pin") || (text.includes("function") && text.includes("does not exist"));
  }

  function claimOutletName() {
    return String(config.outletName || config.storeName || "Fresin").trim() || "Fresin";
  }

  async function validateClaimPin(pin) {
    const client = await window.DriverSupabase.ready();
    const result = await client.rpc("validate_driver_claim_cashier_pin", {
      p_pin: pin,
      p_outlet: claimOutletName()
    });
    if (!result.error && Array.isArray(result.data) && result.data[0]) return result.data[0];
    if (result.error && isMissingClaimFunction(result.error)) {
      throw new Error("SQL validasi klaim kasir belum aktif.");
    }
    if (result.error) throw result.error;
    return null;
  }

  function statusLabel(status) {
    const labels = {
      SEARCHING_DRIVER: "Mencari driver",
      DRIVER_ASSIGNED: "Driver ditugaskan",
      PREPARING: "Pesanan diproses",
      READY_FOR_PICKUP: "Siap diambil",
      PICKED_UP: "Sudah diambil",
      DELIVERING: "Pesanan diantar",
      COMPLETED: "Selesai"
    };
    return labels[status] || status || "-";
  }

  function statusRank(status) {
    return {
      SEARCHING_DRIVER: 1,
      DRIVER_ASSIGNED: 2,
      PREPARING: 3,
      READY_FOR_PICKUP: 4,
      PICKED_UP: 5,
      DELIVERING: 6,
      COMPLETED: 7
    }[status] || 0;
  }

  function lifecycleStatus(order) {
    const status = String(order?.status || order?.order_status || "").trim().toLowerCase();
    if (status === "selesai") return "READY_FOR_PICKUP";
    if (status === "siap diambil") return "READY_FOR_PICKUP";
    if (status === "sedang disiapkan" || status === "dikonfirmasi") return "PREPARING";
    return "";
  }

  function effectiveOrderStatus(order) {
    const stored = String(order?.customer_order_status || "").trim();
    const lifecycle = lifecycleStatus(order);
    if (!stored) return lifecycle;
    if (!lifecycle) return stored;
    return statusRank(lifecycle) > statusRank(stored) ? lifecycle : stored;
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
    const coordinates = firstCoordinates(
      order.delivery_latitude && order.delivery_longitude ? `${order.delivery_latitude},${order.delivery_longitude}` : "",
      order.delivery_location,
      order.note,
      order.service_info
    );
    const latitude = coordinates ? coordinates.latitude : null;
    const longitude = coordinates ? coordinates.longitude : null;
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
    if (!Number.isFinite(distance)) return "Belum terukur";
    return `± ${distance.toFixed(distance < 10 ? 1 : 0)} km`;
  }

  function orderTotal(order) {
    return Number(order.grand_total || order.subtotal || 0);
  }

  function orderSubtotal(order) {
    const subtotal = Number(order.subtotal || 0);
    if (Number.isFinite(subtotal) && subtotal > 0) return subtotal;
    return Math.max(0, orderTotal(order) - Number(order.delivery_fee || 0));
  }

  function extractLabelValue(text, label, stopLabels = []) {
    const source = String(text || "");
    if (!source) return "";
    const stops = stopLabels.length ? `|${stopLabels.map(item => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}` : "";
    const pattern = new RegExp(`${label}\\s*:\\s*([\\s\\S]*?)(?=\\s+(?:${label}${stops})\\s*:|$)`, "i");
    const match = source.match(pattern);
    return match ? match[1].trim() : "";
  }

  function stripDeliveryLabels(text) {
    return String(text || "")
      .replace(/Pin lokasi\s*:\s*https?:\/\/\S+/ig, "")
      .replace(/Pin lokasi\s*:\s*[-0-9.,\s]+/ig, "")
      .replace(/Patokan alamat\s*:[\s\S]*$/i, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function firstMapsUrl(...values) {
    for (const value of values) {
      const match = String(value || "").match(/https?:\/\/(?:www\.)?google\.com\/maps[^\s]+/i);
      if (match) return match[0];
    }
    return "";
  }

  function firstCoordinates(...values) {
    const joined = values.map(value => String(value || "")).join(" ");
    const match = joined.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (!match) return null;
    const latitude = numberValue(match[1]);
    const longitude = numberValue(match[2]);
    return latitude === null || longitude === null ? null : { latitude, longitude };
  }

  function deliveryMeta(order) {
    const rawNote = String(order.note || "");
    const rawService = String(order.service_info || "");
    const genericService = ["delivery", "antar", "pin lokasi", "-"].includes(rawService.trim().toLowerCase());
    const pinFromNote = extractLabelValue(rawNote, "Pin lokasi", ["Patokan alamat"]);
    const landmarkFromNote = extractLabelValue(rawNote, "Patokan alamat", ["Pin lokasi"]);
    const note = stripDeliveryLabels(rawNote);
    const coordinates = firstCoordinates(order.delivery_latitude && order.delivery_longitude ? `${order.delivery_latitude},${order.delivery_longitude}` : "", order.delivery_location, pinFromNote, rawNote);
    const address = String(order.delivery_address || (!genericService ? rawService : "") || "").trim();
    const pinAddress = coordinates ? `Pin lokasi (${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)})` : "";
    return {
      address: address || pinAddress || "Pin lokasi belum tersedia",
      landmark: String(order.delivery_note || landmarkFromNote || "").trim() || "-",
      note: note || "-",
      pin: String(order.delivery_location || pinFromNote || "").trim(),
      coordinates
    };
  }

  function mapsUrl(order) {
    const meta = deliveryMeta(order);
    const location = String(meta.pin || "").trim();
    if (/^https?:\/\//i.test(location)) return location;
    const coordinates = meta.coordinates || firstCoordinates(order.delivery_latitude && order.delivery_longitude ? `${order.delivery_latitude},${order.delivery_longitude}` : "");
    if (coordinates) return `https://www.google.com/maps?q=${coordinates.latitude},${coordinates.longitude}`;
    if (meta.address && meta.address !== "Alamat detail belum tersedia") return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(meta.address)}`;
    return "";
  }

  function isMobileMapsClient() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
  }

  function mapsTarget(order) {
    const web = mapsUrl(order);
    const meta = deliveryMeta(order);
    const coordinates = meta.coordinates;
    let app = "";
    if (coordinates) {
      const query = `${coordinates.latitude},${coordinates.longitude}`;
      app = /iPhone|iPad|iPod/i.test(navigator.userAgent || "")
        ? `comgooglemaps://?q=${query}`
        : `geo:${query}?q=${query}`;
    }
    return { web, app };
  }

  function openMapsTarget(button) {
    const web = button?.dataset?.mapWeb || "";
    const appTarget = button?.dataset?.mapApp || "";
    if (!web) return;
    if (appTarget && isMobileMapsClient()) {
      window.location.href = appTarget;
      window.setTimeout(() => {
        window.location.href = web;
      }, 750);
      return;
    }
    window.open(web, "_blank", "noopener");
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
    return completedDriverOrders().filter(order => isToday(order.completed_at || order.updated_at));
  }

  function orderCompletedKey(order) {
    return localDateKey(order.completed_at || order.updated_at);
  }

  function walletClaimForMonth(monthKey = walletMonthKey()) {
    return state.walletClaims.find(claim => claim?.driverId === state.profile.id && claim?.monthKey === monthKey) || null;
  }

  function completedDriverOrders() {
    return state.orders.filter(order => (
      order.customer_order_status === "COMPLETED"
      && (driverMatches(order) || !order.driver_id)
    ));
  }

  function completedOrdersForMonth(monthKey = walletMonthKey()) {
    return completedDriverOrders().filter(order => orderCompletedKey(order).slice(0, 7) === monthKey);
  }

  function completedOrdersForDate(dateKey = state.walletDate) {
    return completedOrdersForMonth(walletMonthKey(dateKey)).filter(order => orderCompletedKey(order) === dateKey);
  }

  function completedOrdersForRange(range = walletDateRange()) {
    return completedDriverOrders().filter(order => {
      const key = orderCompletedKey(order);
      return key >= range.from && key <= range.to;
    });
  }

  function earningsTotal(orders = completedDriverOrders()) {
    return orders.reduce((total, order) => total + Number(order.delivery_fee || 0), 0);
  }

  function walletClaimsForRange(range = walletDateRange()) {
    return state.walletClaims.filter(claim => {
      if (claim?.driverId !== state.profile.id || !claim.monthKey) return false;
      const monthStart = `${claim.monthKey}-01`;
      const [year, month] = String(claim.monthKey).split("-").map(Number);
      const monthEnd = localDateKey(new Date(year, month, 0));
      return monthEnd >= range.from && monthStart <= range.to;
    });
  }

  function summarizeOrdersByDate(orders) {
    const groups = orders.reduce((map, order) => {
      const key = orderCompletedKey(order);
      const previous = map.get(key) || { key, label: walletDateLabel(key), count: 0, total: 0 };
      previous.count += 1;
      previous.total += Number(order.delivery_fee || 0);
      map.set(key, previous);
      return map;
    }, new Map());
    return Array.from(groups.values()).sort((a, b) => b.key.localeCompare(a.key));
  }

  function saveWalletClaim(cashier) {
    const monthKey = walletMonthKey();
    const monthOrders = completedOrdersForMonth(monthKey);
    const claim = {
      id: `${state.profile.id || "driver"}_${monthKey}`,
      driverId: state.profile.id,
      driverName: state.profile.name || "",
      outletName: claimOutletName(),
      monthKey,
      monthLabel: walletMonthLabel(monthKey),
      total: earningsTotal(monthOrders),
      count: monthOrders.length,
      validatedAt: new Date().toISOString(),
      cashierName: cashier?.name || cashier?.username || "Kasir",
      cashierRole: cashier?.role || "kasir",
      cashierOutlet: cashier?.outlet_name || claimOutletName()
    };
    state.walletClaims = [claim, ...state.walletClaims.filter(item => !(item?.driverId === claim.driverId && item?.monthKey === claim.monthKey))];
    saveWalletClaims();
    state.orders = state.orders.filter(order => !(order.customer_order_status === "COMPLETED" && (driverMatches(order) || !order.driver_id) && orderCompletedKey(order).slice(0, 7) === monthKey));
    return claim;
  }

  function filteredOrders() {
    if (state.view === "active") return state.orders.filter(canShowActive);
    if (state.view === "history") return todayCompletedOrders();
    return state.orders.filter(order => order.customer_order_status === "SEARCHING_DRIVER");
  }

  function ordersCount(view) {
    if (view === "active") return state.orders.filter(canShowActive).length;
    if (view === "history") return todayCompletedOrders().length;
    if (view === "earnings") return completedDriverOrders().length;
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

  function driverFetchErrorMessage(error) {
    const code = String(error?.code || "").trim();
    const message = String(error?.message || error?.details || "").trim();
    if (code === "42501" || /permission denied|row-level security|violates row-level security/i.test(message)) {
      return "Gagal memuat tugas. Policy/GRANT Driver di Supabase belum aktif.";
    }
    if (/failed to fetch|network|load failed/i.test(message)) {
      return "Gagal memuat tugas. Cek koneksi internet lalu refresh.";
    }
    if (isMissingColumn(error)) {
      return "Gagal memuat tugas. Schema Supabase belum reload, coba refresh beberapa saat lagi.";
    }
    return `Gagal memuat tugas. ${message ? message.slice(0, 110) : "Cek koneksi atau policy Supabase."}`;
  }

  function activeOrdersQuery(client, columns) {
    return client
      .from("orders")
      .select(columns.join(","))
      .eq("customer_order_type", "DELIVERY")
      .eq("payment_status", "Lunas")
      .in("customer_order_status", ACTIVE_STATUSES)
      .order("updated_at", { ascending: false })
      .limit(80);
  }

  function walletMonthRange(monthKey = walletMonthKey()) {
    const [year, month] = String(monthKey).split("-").map(Number);
    const start = new Date(year, Math.max(0, month - 1), 1);
    const end = new Date(year, month, 1);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  function dayRange(dateKey = localDateKey()) {
    const [year, month, day] = String(dateKey).split("-").map(Number);
    const start = new Date(year, Math.max(0, month - 1), day);
    const end = new Date(year, Math.max(0, month - 1), day + 1);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  function completedFetchRange() {
    if (state.view === "earnings") {
      if (state.walletMode === "history") {
        const range = walletDateRange();
        if (range.from.slice(0, 7) === range.to.slice(0, 7) && walletClaimForMonth(range.from.slice(0, 7))) return null;
        return {
          start: new Date(`${range.from}T00:00:00`).toISOString(),
          end: new Date(new Date(`${range.to}T00:00:00`).getTime() + 86400000).toISOString()
        };
      }
      const monthKey = walletMonthKey();
      if (walletClaimForMonth(monthKey)) return null;
      return walletMonthRange(monthKey);
    }
    return dayRange(localDateKey());
  }

  function completedOrdersQuery(client, columns, range) {
    return client
      .from("orders")
      .select(columns.join(","))
      .eq("customer_order_type", "DELIVERY")
      .eq("payment_status", "Lunas")
      .eq("customer_order_status", "COMPLETED")
      .gte("completed_at", range.start)
      .lt("completed_at", range.end)
      .order("completed_at", { ascending: false })
      .limit(80);
  }

  async function selectOrders(client, columns) {
    const activeResult = await activeOrdersQuery(client, columns);
    if (activeResult.error) return activeResult;
    const range = completedFetchRange();
    if (!range) return activeResult;
    const completedResult = await completedOrdersQuery(client, columns, range);
    if (completedResult.error) return completedResult;
    return {
      data: [...(activeResult.data || []), ...(completedResult.data || [])],
      error: null
    };
  }

  function mergeOrderItems(nextOrders) {
    const previousById = new Map(state.orders.map(order => [order.id, order]));
    nextOrders.forEach(order => {
      const previous = previousById.get(order.id);
      if (previous?.items && loadedItemOrderIds.has(order.id)) order.items = previous.items;
    });
    return nextOrders;
  }

  async function fetchOrders(options = {}) {
    if (state.fetching || !hasProfile()) return;
    const nowMs = Date.now();
    if (!options.force && state.nextFetchAt && nowMs < state.nextFetchAt) return;
    const backgroundRefresh = options.quiet && state.orders.length > 0;
    state.fetching = true;
    state.loading = !backgroundRefresh;
    if (state.loading && !state.error) render();
    try {
      const client = await window.DriverSupabase.ready();
      let columns = [...ORDER_COLUMNS];
      let result = await selectOrders(client, columns);
      for (let attempt = 0; result.error && isMissingColumn(result.error) && attempt < ORDER_COLUMNS.length; attempt += 1) {
        const column = missingColumnName(result.error);
        if (!column || !columns.includes(column)) break;
        columns = columns.filter(item => item !== column);
        result = await selectOrders(client, columns);
      }
      if (result.error && columns.join(",") !== MIN_ORDER_COLUMNS.join(",")) {
        columns = [...MIN_ORDER_COLUMNS];
        result = await selectOrders(client, columns);
      }
      if (result.error) throw result.error;
      const orders = mergeOrderItems(result.data || []);
      state.orders = orders;
      state.lastSyncAt = new Date().toISOString();
      state.error = "";
      state.fetchFailCount = 0;
      state.nextFetchAt = 0;
      setupRealtime(client);
    } catch (error) {
      const now = Date.now();
      if (!state.lastFetchErrorAt || now - state.lastFetchErrorAt > DRIVER_FETCH_RETRY_MS) {
        console.warn("Driver orders refresh failed", error);
        state.lastFetchErrorAt = now;
      }
      state.fetchFailCount += 1;
      state.nextFetchAt = now + Math.min(DRIVER_FETCH_RETRY_MS * 2, DRIVER_FETCH_RETRY_MS + (state.fetchFailCount * 5000));
      state.error = driverFetchErrorMessage(error);
    } finally {
      state.fetching = false;
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
    if (itemsResult.error) {
      console.warn("Driver order items are not readable yet", itemsResult.error);
      orders.forEach(order => {
        order.items = [];
      });
      return;
    }
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

  async function ensureOrderItems(orderId, options = {}) {
    if (!orderId || loadedItemOrderIds.has(orderId) && !options.force) return;
    const order = state.orders.find(item => item.id === orderId);
    if (!order) return;
    state.itemLoadingId = orderId;
    render();
    try {
      const client = await window.DriverSupabase.ready();
      await attachItems(client, [order]);
      loadedItemOrderIds.add(orderId);
    } catch (error) {
      console.warn("Driver order detail items failed", error);
      order.items = order.items || [];
    } finally {
      state.itemLoadingId = "";
      render();
    }
  }

  function scheduleRealtimeRefresh() {
    if (document.hidden) {
      state.pendingVisibleRefresh = true;
      return;
    }
    window.clearTimeout(realtimeRefreshTimer);
    realtimeRefreshTimer = window.setTimeout(() => fetchOrders({ quiet: true }), DRIVER_REALTIME_DEBOUNCE_MS);
  }

  function setupRealtime(client) {
    if (state.realtimeStarted || !client?.channel) return;
    state.realtimeStarted = true;
    client
      .channel("kasirin-driver-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        scheduleRealtimeRefresh();
      })
      .subscribe(status => {
        state.realtimeReady = status === "SUBSCRIBED";
      });
  }

  async function updateOrder(order, patch, options = {}) {
    const client = await window.DriverSupabase.ready();
    let payload = { ...patch, updated_at: new Date().toISOString() };
    for (let attempt = 0; attempt < 12; attempt += 1) {
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
      await fetchOrders({ force: true });
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
              <strong class="driver-brand-title"><span class="brand-anterin">Anterin</span> <span class="brand-delivery">Delivery</span></strong>
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
        ${selected ? "" : renderBottomNav()}
        ${state.actionLoading ? `<div class="driver-busy">${escapeHtml(state.actionLoading)}</div>` : ""}
      </main>
    `;
  }

  function renderTopbar() {
    return `
      <header class="driver-topbar">
        <div class="driver-brand compact">
          <span class="driver-app-logo" aria-hidden="true">${appLogo()}</span>
          <div>
            <strong class="driver-brand-title"><span class="brand-anterin">Anterin</span> <span class="brand-delivery">Delivery</span></strong>
          </div>
        </div>
        <button class="driver-icon-btn ${state.fetching ? "is-refreshing" : ""}" type="button" data-action="refresh" aria-label="Refresh tugas" title="Refresh tugas">${icon("refresh")}</button>
      </header>
    `;
  }

  function renderBottomNav() {
    const orderActive = state.view !== "earnings";
    return `
      <nav class="driver-bottom-nav" aria-label="Navigasi utama driver">
        <button class="driver-bottom-tab ${orderActive ? "active" : ""}" type="button" data-view="tasks">
          ${icon("orders")}
          <span>Order</span>
        </button>
        <button class="driver-bottom-tab ${state.view === "earnings" ? "active" : ""}" type="button" data-view="earnings">
          ${icon("wallet")}
          <span>Dompet</span>
        </button>
      </nav>
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
    const showSkeleton = state.loading && orders.length < 1;
    return `
      <section class="driver-content">
        ${renderShiftCard()}
        ${state.error ? `<div class="driver-alert">${escapeHtml(state.error)}</div>` : ""}
        <div class="driver-list">
          ${showSkeleton ? skeletonCards() : orders.map(renderOrderCard).join("") || emptyState()}
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
          <small>${escapeHtml(state.profile.name || "Driver")} siap bertugas</small>
        </div>
        <div class="driver-route-preview" aria-hidden="true">
          <i></i>
          <b></b>
          <em></em>
        </div>
        <div class="driver-shift-stats">
          <button class="${state.view === "tasks" ? "active" : ""}" type="button" data-view="tasks"><b>${newCount}</b><small>Baru</small></button>
          <button class="${state.view === "active" ? "active" : ""}" type="button" data-view="active"><b>${activeCount}</b><small>Aktif</small></button>
          <button class="${state.view === "history" ? "active" : ""}" type="button" data-view="history"><b>${doneCount}</b><small>Selesai</small></button>
        </div>
      </section>
    `;
  }

  function renderEarnings() {
    const monthKey = walletMonthKey();
    const claim = walletClaimForMonth(monthKey);
    const monthOrders = claim ? [] : completedOrdersForMonth(monthKey);
    const range = walletDateRange();
    const historyOrders = completedOrdersForRange(range);
    const historyClaims = walletClaimsForRange(range);
    const historyTotal = earningsTotal(historyOrders) + historyClaims.reduce((total, item) => total + Number(item.total || 0), 0);
    const historyCount = historyOrders.length + historyClaims.reduce((total, item) => total + Number(item.count || 0), 0);
    const claimTotal = earningsTotal(monthOrders);
    const isHistory = state.walletMode === "history";
    const showSkeleton = state.loading && ((isHistory && historyOrders.length < 1 && historyClaims.length < 1) || (!isHistory && monthOrders.length < 1 && !claim));
    return `
      <section class="driver-content">
        ${state.error ? `<div class="driver-alert">${escapeHtml(state.error)}</div>` : ""}
        ${renderWalletModeTabs()}
        <article class="driver-earnings-hero">
          <small>${isHistory ? `Riwayat ${escapeHtml(walletDateRangeLabel())}` : `Siap diklaim ${escapeHtml(walletMonthLabel(monthKey))}`}</small>
          <strong>${money(isHistory ? historyTotal : claimTotal)}</strong>
          <span>${isHistory ? `${historyCount} transaksi tercatat` : `${monthOrders.length} transaksi belum diklaim`}</span>
        </article>
        ${isHistory ? renderWalletHistory(historyOrders, historyClaims, showSkeleton) : renderWalletClaim(claim, monthOrders, showSkeleton)}
      </section>
    `;
  }

  function renderWalletModeTabs() {
    return `
      <div class="driver-wallet-tabs" role="tablist" aria-label="Menu dompet driver">
        <button class="${state.walletMode === "history" ? "active" : ""}" type="button" data-wallet-mode="history">Riwayat</button>
        <button class="${state.walletMode === "claim" ? "active" : ""}" type="button" data-wallet-mode="claim">Klaim</button>
      </div>
    `;
  }

  function renderWalletRangeFilters() {
    return `
      <section class="driver-wallet-filter range" aria-label="Filter riwayat pendapatan">
        <label>
          <span>Mulai</span>
          <input type="date" value="${escapeHtml(state.walletDate)}" data-driver-wallet-date="from" />
        </label>
        <label>
          <span>Sampai</span>
          <input type="date" value="${escapeHtml(state.walletDateTo)}" data-driver-wallet-date="to" />
        </label>
      </section>
    `;
  }

  function renderWalletHistory(historyOrders, historyClaims, showSkeleton) {
    const orderBars = summarizeOrdersByDate(historyOrders).map(item => ({
      label: item.label,
      meta: `${item.count} order selesai`,
      total: item.total
    }));
    const claimBars = historyClaims.map(claim => ({
      label: `Klaim ${claim.monthLabel || walletMonthLabel(claim.monthKey)}`,
      meta: `${Number(claim.count || 0).toLocaleString("id-ID")} order - ${escapeHtml(shortDateTime(claim.validatedAt))}`,
      total: Number(claim.total || 0)
    }));
    const bars = [...claimBars, ...orderBars];
    return `
      ${renderWalletRangeFilters()}
      <section class="driver-earning-history" aria-label="Riwayat pendapatan driver">
        <div class="driver-wallet-section-title compact">
          <strong>Riwayat pendapatan</strong>
          <small>Ringkasan tanggal saja, tanpa membuka detail order.</small>
        </div>
        <div class="driver-wallet-bars">
          ${showSkeleton ? skeletonCards() : bars.map(renderWalletBar).join("") || emptyState()}
        </div>
      </section>
    `;
  }

  function renderWalletClaim(claim, monthOrders, showSkeleton) {
    if (claim || monthOrders.length < 1) {
      return `
        <section class="driver-earning-history" aria-label="Klaim pendapatan driver">
          <div class="driver-wallet-section-title compact">
            <strong>Klaim kosong</strong>
            <small>Seluruh transaksi pada bulan ini sudah diklaim atau belum ada saldo klaim.</small>
          </div>
          ${claim ? renderWalletClaimSummary(claim) : emptyState()}
        </section>
      `;
    }
    const bars = summarizeOrdersByDate(monthOrders).map(item => ({
      label: item.label,
      meta: `${item.count} order belum diklaim`,
      total: item.total
    }));
    return `
      ${renderClaimPanel(null, monthOrders)}
      <section class="driver-earning-history" aria-label="Saldo klaim driver">
        <div class="driver-wallet-section-title compact">
          <strong>Siap diklaim</strong>
          <small>Ringkasan ongkir bulan ini, tanpa membuka detail order.</small>
        </div>
        <div class="driver-wallet-bars">
          ${showSkeleton ? skeletonCards() : bars.map(renderWalletBar).join("") || emptyState()}
        </div>
      </section>
    `;
  }

  function renderWalletBar(item) {
    return `
      <article class="driver-wallet-bar">
        <span>${icon("wallet")}</span>
        <div>
          <strong>${escapeHtml(item.label)}</strong>
          <small>${escapeHtml(item.meta)}</small>
        </div>
        <b>${money(item.total || 0)}</b>
      </article>
    `;
  }

  function renderClaimPanel(claim = null, monthOrders = completedOrdersForMonth()) {
    const validator = state.claimValidator;
    if (claim) {
      return `
        <section class="driver-claim-panel claim-modern claimed">
          <span>${icon("check")}</span>
          <div class="driver-claim-copy">
            <strong>Pendapatan sudah diklaim</strong>
            <small>${escapeHtml(claim.monthLabel || walletMonthLabel(claim.monthKey))} divalidasi oleh ${escapeHtml(claim.cashierName || "Kasir")}.</small>
          </div>
          <div class="driver-claim-status">
            <b>${icon("wallet")}</b>
            <span>
              <strong>${money(claim.total || 0)} dari ${Number(claim.count || 0).toLocaleString("id-ID")} order</strong>
              <small>${escapeHtml(shortDateTime(claim.validatedAt))} - detail per pesanan disembunyikan.</small>
            </span>
          </div>
        </section>
      `;
    }
    const canClaim = monthOrders.length > 0;
    return `
      <section class="driver-claim-panel claim-modern">
        <span>${icon("wallet")}</span>
        <div class="driver-claim-copy">
          <strong>Validasi klaim outlet</strong>
          <small>Outlet ${escapeHtml(claimOutletName())}. Klaim pendapatan bulan ${escapeHtml(walletMonthLabel(walletMonthKey()))} dengan kode validasi kasir.</small>
        </div>
        <form class="driver-claim-form" data-driver-form="claim">
          <label class="driver-claim-field">
            <span>Kode validasi</span>
            <input class="driver-claim-code" name="claimPin" type="password" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="••••••" aria-label="Kode validasi kasir" />
          </label>
          <button class="driver-claim-submit" type="submit" ${state.claimLoading || !canClaim ? "disabled" : ""}>
            ${state.claimLoading ? "Memeriksa..." : "Validasi"}
          </button>
        </form>
        ${!canClaim ? `<p class="driver-claim-message">Belum ada pendapatan pada bulan ini untuk diklaim.</p>` : ""}
        ${state.claimError ? `<p class="driver-claim-message error">${escapeHtml(state.claimError)}</p>` : ""}
        ${validator ? `
          <div class="driver-claim-status">
            <b>${icon("check")}</b>
            <span>
              <strong>Divalidasi oleh ${escapeHtml(validator.name || validator.username || "Kasir")}</strong>
              <small>${escapeHtml(staffRoleLabel(validator.role))} Outlet ${escapeHtml(validator.outlet_name || claimOutletName())} - ${escapeHtml(shortDateTime(validator.validatedAt))}</small>
            </span>
          </div>
        ` : ""}
      </section>
    `;
  }

  function renderWalletClaimSummary(claim) {
    return `
      <article class="driver-wallet-claim-summary">
        <span>${icon("wallet")}</span>
        <div>
          <small>${escapeHtml(claim.monthLabel || walletMonthLabel(claim.monthKey))}</small>
          <strong>${money(claim.total || 0)}</strong>
          <em>${Number(claim.count || 0).toLocaleString("id-ID")} order - ${escapeHtml(staffRoleLabel(claim.cashierRole))} ${escapeHtml(claim.cashierName || "Kasir")}</em>
        </div>
      </article>
    `;
  }

  function renderOrderCard(order) {
    const rawStatus = order.customer_order_status;
    const status = effectiveOrderStatus(order);
    const orderTime = shortTime(order.created_at || order.updated_at);
    return `
      <article class="driver-order-card" data-order-id="${escapeHtml(order.id)}">
        <div class="driver-card-top">
          <span class="driver-card-top-right">
            <span><small>Total pesanan</small><em>${money(orderSubtotal(order))}</em></span>
            <span><small>Ongkir</small><em>${money(order.delivery_fee || 0)}</em></span>
          </span>
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
          <span class="driver-route-order">
            <i class="order-dot" aria-hidden="true"></i>
            <b>Order masuk</b>
            <strong>${escapeHtml(order.order_number || "-")} - ${escapeHtml(orderTime)}</strong>
          </span>
          <span class="driver-route-status">
            <i class="status-dot" aria-hidden="true"></i>
            <b>Status order</b>
            <strong>${escapeHtml(statusLabel(status))}</strong>
          </span>
          <span>
            <i class="pickup-dot" aria-hidden="true"></i>
            <b>Pickup</b>
            <strong>Outlet Fresin</strong>
          </span>
        </div>
        ${renderCardActions(order, rawStatus, status)}
      </article>
    `;
  }

  function renderCardActions(order, rawStatus, status) {
    const orderId = escapeHtml(order.id);
    if (rawStatus === "SEARCHING_DRIVER") {
      return `<button class="driver-primary compact-btn" type="button" data-action="take" data-order="${orderId}">${icon("plus")}<span>Ambil order</span></button>`;
    }
    if (status === "COMPLETED") return "";
    if (status === "DELIVERING") {
      return `
        <div class="driver-card-actions">
          <button class="driver-card-action done" type="button" data-action="complete" data-order="${orderId}">${icon("check")}<span>Pesanan selesai</span></button>
        </div>
      `;
    }
    return `
      <div class="driver-card-actions">
        <button class="driver-card-action" type="button" data-action="delivering" data-order="${orderId}">${icon("bag")}<span>Ambil ke outlet</span></button>
      </div>
    `;
  }

  function renderEarningCard(order) {
    return `
      <article class="driver-order-card earning">
        <button class="driver-earning-main" type="button" data-open-order="${escapeHtml(order.id)}">
          <span class="driver-order-icon earning-icon" aria-hidden="true">${icon("wallet")}</span>
          <span class="driver-earning-copy">
            <strong>${escapeHtml(order.order_number || "-")}</strong>
            <small>${escapeHtml(order.customer_name || "Customer")} · selesai ${shortDateTime(order.completed_at || order.updated_at)}</small>
          </span>
          <span class="driver-earning-total"><b>${money(order.delivery_fee || 0)}</b></span>
        </button>
      </article>
    `;
  }

  function renderDetail(order) {
    const status = effectiveOrderStatus(order);
    const meta = deliveryMeta(order);
    const map = mapsTarget(order);
    const wa = whatsappUrl(order);
    return `
      <section class="driver-content detail">
        <button class="driver-back" type="button" data-action="back">${icon("back")}<span>Kembali</span></button>
        <article class="driver-detail-hero">
          <div>
            <small>Pesanan ${escapeHtml(order.order_number || "-")}</small>
            <h1>${escapeHtml(order.customer_name || "Customer")}</h1>
            <p>${escapeHtml(detailHeroTiming(order))}</p>
          </div>
          <span class="driver-pill ${statusClass(status)}">${escapeHtml(statusLabel(status))}</span>
        </article>
        <section class="driver-summary-grid">
          <span><b>Total pesanan</b><strong>${money(orderTotal(order))}</strong></span>
          <span><b>Ongkir</b><strong>${money(order.delivery_fee || 0)}</strong></span>
          <span><b>Jarak</b><strong>${distanceLabel(order)}</strong></span>
          <span><b>WhatsApp</b><strong>${escapeHtml(order.customer_phone || "-")}</strong></span>
        </section>
        <section class="driver-panel driver-items-panel">
          <h2>Item pesanan</h2>
          <div class="driver-items">
            ${state.itemLoadingId === order.id ? `<p class="driver-muted">Memuat item pesanan...</p>` : (order.items || []).map(renderItem).join("") || `<p class="driver-muted">Item belum termuat.</p>`}
          </div>
        </section>
        <section class="driver-panel">
          <h2>Alamat pengantaran</h2>
          <div class="driver-address modern">
            <div class="driver-address-route">
              <span><i class="pickup-dot" aria-hidden="true"></i><b>Pickup</b><strong>Outlet Fresin</strong></span>
              <span><i class="drop-dot" aria-hidden="true"></i><b>Tujuan</b><strong>${escapeHtml(meta.address)}</strong></span>
            </div>
            <div class="driver-address-notes">
              <span><b>Patokan alamat</b><strong>${escapeHtml(meta.landmark)}</strong></span>
              <span><b>Catatan driver</b><strong>${escapeHtml(meta.note)}</strong></span>
            </div>
          </div>
          <div class="driver-action-row">
            <button class="driver-secondary ${map.web ? "" : "disabled"}" type="button" data-action="open-maps" data-map-web="${escapeHtml(map.web || "")}" data-map-app="${escapeHtml(map.app || "")}">${icon("map")}<span>Buka Maps</span></button>
            <a class="driver-secondary ${wa ? "" : "disabled"}" href="${escapeHtml(wa || "#")}" target="_blank" rel="noopener">${icon("chat")}<span>Chat Customer</span></a>
          </div>
        </section>
        ${renderStatusAction(order)}
      </section>
    `;
  }

  function renderItem(item) {
    const addons = (item.addons || []).map(addon => `${addon.addon_name} x${Number(addon.qty || 1)}`).join(", ");
    const description = [item.variant_label, item.note, addons].map(value => String(value || "").trim()).filter(Boolean).join(" - ");
    return `
      <div class="driver-item-row">
        <span>
          <strong>${escapeHtml(item.product_name || "Item")}</strong>
          ${description ? `<small>${escapeHtml(description)}</small>` : ""}
        </span>
        <b>${Number(item.qty || 1).toLocaleString("id-ID")}x</b>
      </div>
    `;
  }

  function renderStatusAction(order) {
    const status = effectiveOrderStatus(order);
    const rawStatus = order.customer_order_status;
    if (status === "COMPLETED") return `<div class="driver-completed">${icon("check")} Pesanan selesai diantar</div>`;
    if (rawStatus === "SEARCHING_DRIVER") return `<button class="driver-sticky-action" type="button" data-action="take" data-order="${escapeHtml(order.id)}">${icon("plus")}<span>Ambil order</span></button>`;
    if (status === "DRIVER_ASSIGNED" || status === "PREPARING" || status === "READY_FOR_PICKUP" || status === "PICKED_UP") return `<button class="driver-sticky-action" type="button" data-action="delivering" data-order="${escapeHtml(order.id)}">${icon("bag")}<span>Ambil ke outlet</span></button>`;
    if (status === "DELIVERING") return `<button class="driver-sticky-action done" type="button" data-action="complete" data-order="${escapeHtml(order.id)}">${icon("check")}<span>Pesanan selesai diantar</span></button>`;
    return `<div class="driver-completed">${icon("check")} Pesanan selesai diantar</div>`;
  }

  function emptyState() {
    const copy = {
      tasks: ["Belum ada tugas tersedia", "Order delivery lunas akan muncul di sini."],
      active: ["Belum ada tugas aktif", "Order yang kamu ambil akan tampil di sini."],
      history: ["Riwayat hari ini kosong", "Order selesai hari ini akan masuk ke riwayat."],
      earnings: ["Pendapatan kosong", "Order selesai akan dihitung sebagai riwayat pendapatan ongkir."]
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
      orders: '<svg viewBox="0 0 24 24"><path d="M7 4h10l2 3v13H5V7l2-3ZM7 8h10M8 13h8M8 17h6"/></svg>',
      wallet: '<svg viewBox="0 0 24 24"><path d="M4 7h14a2 2 0 0 1 2 2v9H4V7Zm0 0 12-3v3M16 13h.1"/></svg>',
      logout: '<svg viewBox="0 0 24 24"><path d="M10 17 15 12l-5-5M15 12H3M21 4v16"/></svg>'
    };
    return icons[name] || icons.bag;
  }

  function appLogo() {
    return `
      <svg viewBox="0 0 64 64" role="img">
        <defs>
          <linearGradient id="anterinBox" x1="12" y1="12" x2="52" y2="54" gradientUnits="userSpaceOnUse">
            <stop offset="0" stop-color="#ff7a1a"/>
            <stop offset="1" stop-color="#ffb11f"/>
          </linearGradient>
        </defs>
        <path class="logo-speed speed-1" d="M6 28h24"/>
        <path class="logo-speed speed-2" d="M11 36h23"/>
        <path class="logo-speed speed-3" d="M17 44h20"/>
        <path class="logo-box-left" d="M31 23 47 32v18L31 41Z"/>
        <path class="logo-box-right" d="M47 32 58 25v18L47 50Z"/>
        <path class="logo-box-top" d="M31 23 43 16l15 9-11 7Z"/>
        <path class="logo-box-edge" d="M31 23 47 32 58 25M47 32v18"/>
      </svg>
    `;
  }

  function setView(view) {
    state.view = view;
    state.selectedId = "";
    state.menuOpen = false;
    localStorage.setItem(VIEW_KEY, view);
    render();
  }

  app?.addEventListener("submit", async event => {
    const claimForm = event.target.closest("[data-driver-form='claim']");
    if (claimForm) {
      event.preventDefault();
      const data = new FormData(claimForm);
      const pin = String(data.get("claimPin") || "").replace(/[^0-9]/g, "").slice(0, 6);
      state.claimError = "";
      state.claimValidator = null;
      if (pin.length !== 6) {
        state.claimError = "Masukkan kode validasi 6 digit.";
        render();
        return;
      }
      state.claimLoading = true;
      render();
      try {
        const cashier = await validateClaimPin(pin);
        if (!cashier) {
          state.claimError = "Kode validasi tidak cocok untuk outlet ini.";
          return;
        }
        state.claimValidator = {
          ...cashier,
          validatedAt: new Date().toISOString()
        };
        saveWalletClaim(cashier);
      } catch (error) {
        console.warn("Driver claim validation failed", error);
        state.claimError = error?.message || "Validasi klaim belum berhasil.";
      } finally {
        state.claimLoading = false;
        render();
      }
      return;
    }

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
      fetchOrders({ force: true });
    } catch (error) {
      console.warn("Driver login failed", error);
      state.error = "Login belum berhasil. Jalankan SQL driver staff login atau cek koneksi.";
    } finally {
      state.loginLoading = false;
      render();
    }
  });

  app?.addEventListener("change", event => {
    const walletDate = event.target.closest("[data-driver-wallet-date]");
    if (!walletDate) return;
    const value = String(walletDate.value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    if (walletDate.dataset.driverWalletDate === "to") {
      state.walletDateTo = value;
      localStorage.setItem(WALLET_DATE_TO_KEY, value);
    } else {
      state.walletDate = value;
      localStorage.setItem(WALLET_DATE_KEY, value);
    }
    state.claimError = "";
    state.claimValidator = null;
    render();
    fetchOrders({ force: true, quiet: true });
  });

  app?.addEventListener("click", event => {
    const walletModeButton = event.target.closest("[data-wallet-mode]");
    if (walletModeButton) {
      state.walletMode = walletModeButton.dataset.walletMode === "claim" ? "claim" : "history";
      state.claimError = "";
      state.claimValidator = null;
      localStorage.setItem(WALLET_MODE_KEY, state.walletMode);
      render();
      fetchOrders({ force: true, quiet: true });
      return;
    }
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
      ensureOrderItems(state.selectedId);
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
    if (action === "refresh") {
      state.menuOpen = false;
      fetchOrders({ force: true });
      return;
    }
    if (action === "open-maps") {
      openMapsTarget(actionButton);
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
  if (hasProfile()) fetchOrders({ force: true });
  window.setInterval(() => {
    if (!hasProfile() || document.hidden) return;
    fetchOrders({ quiet: true });
  }, Number(config.staleRefreshMs || config.refreshMs || DRIVER_STALE_POLL_MS));
  document.addEventListener("visibilitychange", () => {
    if (!hasProfile() || document.hidden) return;
    if (state.pendingVisibleRefresh) {
      state.pendingVisibleRefresh = false;
      fetchOrders({ quiet: true });
      return;
    }
    const lastSync = new Date(state.lastSyncAt || 0).getTime();
    if (!lastSync || Date.now() - lastSync > Number(config.visibleRefreshMs || 30000)) fetchOrders({ quiet: true });
  });
}());
