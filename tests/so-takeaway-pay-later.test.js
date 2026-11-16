const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.join(__dirname, "..");
function sourcePath(...parts) {
  const file = parts.join("/");
  const local = path.join(root, file);
  if (fs.existsSync(local)) return local;
  const mapped = file === "app.js" ? "pos/app.js"
    : file === "pos.html" ? "pos/index.html"
    : file === "self-order.html" ? "self-order/index.html"
    : file.startsWith("SO Takeaway/") ? `pos/${file}` : file;
  return path.join(root, "deploy-ready", mapped);
}
function readSource(...parts) {
  return fs.readFileSync(sourcePath(...parts), "utf8").replace(/\r\n/g, "\n");
}
const source = readSource("SO Takeaway/so-takeaway.js");
const noop = () => {};

function setup(options = {}) {
  const order = { id: "one", number: "T001", type: "Take Away", source: "Self Order",
    status: "Pesanan Baru", paymentStatus: "Belum dibayar", createdAt: "2026-11-08T01:00:00Z",
    items: [{ name: "Latte", qty: 1, price: 20000 }], subtotal: 20000, ...options.order };
  const storage = new Map([["self_order_customer", "Rina"], ["so_takeaway_customer_phone", "0812-3456-7890"]]);
  const messages = [];
  const writes = [];
  const ctx = vm.createContext({
    console: { ...console, warn: noop }, URLSearchParams, Date, Set, Map, Promise,
    state: { orders: [order], settings: {}, cashSession: { open: true } },
    sessionStorage: { getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
    location: { search: options.mode ? "?mode=takeaway" : "", hash: "", pathname: "/self-order.html" },
    window: { crypto: require('node:crypto').webcrypto, setTimeout: callback => { callback(); }, setInterval: () => 1, addEventListener: noop },
    document: { addEventListener: noop, querySelectorAll: () => [], getElementById: () => null },
    IS_SELF_ORDER_APP: false, view: "orders", localDbReady: false,
    selfOrderSubmitting: false, selfOrderSubmitStartedAt: 0, selfOrderSubmitError: "",
    selfOrderCart: [{ name: "Latte", qty: 1, price: 20000 }],
    renderSelfOrderTopbar: noop, renderSelfOrderPayment: noop, renderSelfOrderSuccess: noop,
    selfOrderShowPayment: noop, selfOrderCreateOrder: noop, openHeldOrders: noop,
    unpaidOrders: () => [order], orderCenterCard: () => "base-card", payUnpaidOrder: noop,
    submitOrder: async () => { order.paymentStatus = "Lunas"; },
    renderKitchen: noop, kitchenOrderIsVisible: () => true, kitchenOrderHasSequence: () => true,
    orderDisplayTitle: () => "base", compactOrderStatus: () => ({}),
    orderPushNotificationCategories: () => ["Minuman"], notifyNativePushForOrder: async () => true,
    detectNewIncomingOrders: orders => orders, orderNotificationKnownKeys: new Set(),
    activeStaff: () => ({}), canAccessView: () => options.authorized !== false,
    canAttemptSupabaseSync: () => options.online !== false,
    orderHasPendingLocalSync: () => options.pending === true,
    acquireOrderSyncLock: async () => noop, ensureSupabaseProfile: async () => true,
    supabaseClient: { rpc: async () => ({data:'T002',error:null}), from: table => {
      const write = { table, filters: [] };
      const query = {
        update(value) { write.value = value; writes.push(write); return query; },
        eq(key, value) { write.filters.push([key, value]); return query; },
        is(key, value) { write.filters.push([key, value]); return query; },
        select() { return query; },
        async maybeSingle() {
          const result = options.sync ? await options.sync(write.value) : true;
          return result ? { data: options.response || { id: "remote-one", confirmed_at: write.value.confirmed_at }, error: null }
            : { data: null, error: new Error("network") };
        }
      };
      return query;
    } },
    toast: message => messages.push(message), render: noop, saveState: noop, audit: noop,
    broadcastRealtimeEvent: noop, pushSelfOrderHistory: noop, saveSelfOrderCart: noop,
    syncOrderToSupabase: async (value, flags) => { writes.push({ value, flags }); return options.sync ? options.sync(value, flags) : true; },
    orderTotal: value => value.subtotal || 20000, money: value => `Rp ${value}`,
    dateTime: value => value, escapeHtml: value => String(value || ""), customerDisplayName: value => value || "",
    cartItemTotal: item => item.price * item.qty, orderItemInlineLabel: item => `${item.qty}x ${item.name}`,
    orderItemNoteHtml: () => "", orderSequenceBadge: () => "", canDeleteOrderCard: () => false,
    orderSearchText: () => "T001 Rina", orderMatchesSearch: () => true,
    canCancelOrder: () => false, selfOrderShowCustomerError: noop,
    selfOrderSubtotal: () => 20000, getSupabaseServerTimeIso: async () => new Date().toISOString(),
    tagOrderBatchItems: items => items, uid: () => "new-order", validateLimitedStockItems: () => ({ ok: true }),
    commitLimitedStockReservations: async () => ({ accepted: true }),
    submitSelfOrderConfirmed: async value => { writes.push({ value }); return true; },
    rotateLimitedStockReservationToken: noop, loadMasterDataFromSupabase: async () => true,
    ...options.globals
  });
  const sharedSource = readSource("app.js");
  for (const name of ["orderIsCustomerHomeOrder", "orderUsesOutletPayment", "orderVisibleInPosOrderList", "orderIsPaid", "escapeHtml", "orderItemNoteHtml", "orderBatchLabel", "orderItemBatch", "groupedOrderItems", "orderCustomerNoteDisplay", "orderGroupNote"]) {
    const start = sharedSource.indexOf(`function ${name}(`);
    const remainder = sharedSource.slice(start);
    const next = /\n(?:async )?function \w+\(/.exec(remainder);
    vm.runInContext(next ? remainder.slice(0, next.index) : remainder, ctx);
  }
  if (options.realPayment) {
    const app = readSource("app.js");
    const start = app.indexOf("async function submitOrder() {");
    const end = app.indexOf("\nasync function saveOrderPayLater()", start);
    vm.runInContext(app.slice(start, end), ctx);
  }
  vm.runInContext(source, ctx);
  ctx.SOTakeaway = ctx.window.SOTakeaway;
  return { ctx, order, storage, messages, writes };
}

test("new takeaway waits for cashier approval without a payment expiry", async () => {
  const env = setup({ mode: true });
  await env.ctx.selfOrderCreateOrder();
  const created = env.writes[0].value;
  assert.equal(created.customerPhone, "6281234567890");
  assert.equal(created.paymentStatus, "Belum dibayar");
  assert.equal(created.confirmedAt, null);
  assert.equal(created.takeawayStatus, "WAITING_ACCEPTANCE");
  assert.equal(created.takeawayExpiresAt, "");
  assert.equal(created.number, 'T002');
  assert.match(created.publicOrderToken, /^[a-f0-9]{36}$/);
  assert.equal(env.ctx.kitchenOrderIsVisible(created, "Semua", ["Pesanan Baru"]), false);
});

test('failed takeaway number allocation preserves the cart without reserving stock or submitting an order', async () => {
  const env=setup({mode:true});
  let reserved=0;
  env.ctx.supabaseClient.rpc=async()=>({data:null,error:{code:'network'}});
  env.ctx.commitLimitedStockReservations=async()=>{reserved++;return {accepted:true};};
  await env.ctx.selfOrderCreateOrder();
  assert.equal(reserved,0);
  assert.equal(env.writes.length,0);
  assert.equal(env.ctx.selfOrderCart.length,1);
  assert.match(env.ctx.selfOrderSubmitError,/nomor pesanan/);
  assert.equal(env.ctx.selfOrderSubmitting,false);
});

test("Take Away checkout asks for a valid WhatsApp number before submitting", async () => {
  const env = setup({ mode: true });
  env.storage.set("so_takeaway_customer_phone", "08");
  assert.match(env.ctx.renderSelfOrderPayment(), /type="tel"/);
  await env.ctx.selfOrderCreateOrder();
  assert.equal(env.writes.length, 0);
  assert.match(env.ctx.selfOrderSubmitError, /nomor WhatsApp yang valid/);
});

test('SO takeaway cannot submit an already-open checkout after online ordering closes', async () => {
  const env = setup({ mode: true });
  env.ctx.window.FresinOnlineHours = { check: async () => false };
  await env.ctx.selfOrderCreateOrder();
  assert.equal(env.writes.length, 0);
  assert.equal(env.ctx.selfOrderCart.length, 1);
  assert.equal(env.ctx.selfOrderSubmitting, false);
});

test("app pickup shows a phone chip and separate confirmation and blank chat on both card layouts", () => {
  const env = setup({ order: {
    number: "P012", customer: "Rina", customerPhone: "0812-3456-7890", pickupTime: "14:00",
    orderMode: "PICKUP_PREORDER", paymentProvider: "cash_at_outlet", serviceInfo: "Takeaway-Rumah"
  } });
  for (const options of [{}, { compactUnpaid: true }]) {
    const html = env.ctx.orderCenterCard(env.order, options);
    assert.match(html, /<span>P012<\/span>\s*<span class="so-takeaway-whatsapp-number"/);
    assert.match(html, /href="https:\/\/wa\.me\/6281234567890"[^>]*aria-label="Chat WhatsApp pelanggan"/);
    const href = html.match(/href="([^"]+\?text=[^"]+)"/)[1];
    const message = new URL(href).searchParams.get("text");
    assert.match(message, /Rina[\s\S]+P012[\s\S]+Latte[\s\S]+Rp 20000[\s\S]+14:00[\s\S]+sudah benar/);
  }
  env.order.confirmedAt = "accepted";
  assert.doesNotMatch(env.ctx.orderCenterCard(env.order), /\?text=/);
  assert.match(env.ctx.orderCenterCard(env.order), /Chat WhatsApp pelanggan/);
});

test("legacy app Take Away can confirm, while cashier orders and orders without a number do not offer WhatsApp", () => {
  const env = setup({
    order: { customerPhone: "081234567890" },
    globals: { orderCenterCard: (_order, options) => options.contact?.actions || "base-card" }
  });
  assert.match(env.ctx.orderCenterCard(env.order), /Konfirmasi/);
  assert.equal(env.ctx.orderCenterCard({ ...env.order, source: "Kasir", serviceInfo: "Takeaway Outlet" }), "base-card");
  assert.doesNotMatch(env.ctx.orderCenterCard({ ...env.order, customerPhone: "" }), /Konfirmasi|Chat WhatsApp pelanggan|so-takeaway-whatsapp-number/);
  const olderPreorder = { ...env.order, number: "P009", orderMode: "PICKUP_PREORDER", serviceInfo: "Takeaway-Rumah" };
  const olderHtml = env.ctx.orderCenterCard(olderPreorder);
  const href = olderHtml.match(/href="([^"]+\?text=[^"]+)"/)[1];
  assert.match(new URL(href).searchParams.get("text"), /Take Away P009:/);
});

test("unpaid takeaway stays active past the old ten minute deadline", () => {
  const env = setup({ order: { takeawayExpiresAt: "2020-01-01T00:00:00Z" } });
  assert.equal(env.ctx.SOTakeaway.expireWaitingOrders(), false);
  assert.equal(env.order.status, "Pesanan Baru");
  assert.equal(env.ctx.unpaidOrders().length, 1);
});

test("cashier accepts once and only writes status metadata, not payment or items", async () => {
  let finish;
  const env = setup({ sync: () => new Promise(resolve => { finish = resolve; }) });
  const first = env.ctx.SOTakeaway.processOrder("one");
  await new Promise(resolve => setImmediate(resolve));
  await env.ctx.SOTakeaway.processOrder("one");
  assert.equal(env.writes.length, 1);
  assert.equal(env.ctx.kitchenOrderIsVisible(env.order, "Semua", ["Pesanan Baru"]), false);
  assert.deepEqual(Object.keys(env.writes[0].value).sort(), ["confirmed_at", "updated_at"]);
  assert.ok(env.writes[0].filters.some(([key, value]) => key === "status" && value === "Pesanan Baru"));
  assert.ok(env.writes[0].filters.some(([key, value]) => key === "confirmed_at" && value === null));
  finish(true);
  await first;
  assert.ok(env.order.confirmedAt);
  assert.equal(env.order.paymentStatus, "Belum dibayar");
  assert.equal(env.ctx.kitchenOrderIsVisible(env.order, "Semua", ["Pesanan Baru"]), true);
  assert.equal(env.ctx.kitchenOrderHasSequence(env.order), true);
  await env.ctx.SOTakeaway.processOrder("one");
  assert.equal(env.writes.length, 1);
});

test("failed or offline acceptance never claims confirmed kitchen release", async () => {
  for (const options of [{ online: false }, { sync: async () => false }, { sync: async () => { throw new Error("network"); } }]) {
    const env = setup(options);
    await env.ctx.SOTakeaway.processOrder("one");
    assert.equal(Boolean(env.order.confirmedAt), false);
    assert.equal(env.ctx.kitchenOrderIsVisible(env.order, "Semua", ["Pesanan Baru"]), false);
    assert.ok(env.messages.length);
  }
});

test("customers, cancelled orders and empty items cannot accept an order", async () => {
  for (const options of [{ authorized: false }, { pending: true }, { order: { status: "Dibatalkan" } }, { order: { items: [] } }]) {
    const env = setup(options);
    await env.ctx.SOTakeaway.processOrder("one");
    assert.equal(env.writes.length, 0);
  }
});

test("a concurrent remote change does not acknowledge cashier acceptance", async () => {
  const env = setup({ response: {} });
  await env.ctx.SOTakeaway.processOrder("one");
  assert.equal(Boolean(env.order.confirmedAt), false);
  assert.match(env.messages[0], /perangkat lain/);
});

test("paying a prepared or completed takeaway does not reset kitchen progress", async () => {
  for (const status of ["Pesanan Baru", "Sedang Disiapkan", "Selesai"]) {
    const env = setup({ realPayment: true,
      order: { status, confirmedAt: "2026-11-08T01:01:00Z", preparedAt: "prepared", completedAt: status === "Selesai" ? "completed" : null },
      globals: {
        cart: [{ name: "Latte", qty: 1, price: 20000 }],
        cartSubtotal: () => 20000, orderDiscountAmount: () => 0, requirePosPaymentMethod: () => "Cash",
        buildPosPaymentPayload: () => ({ receivedAmount: 20000, changeAmount: 0, paymentBreakdown: {} }),
        orderItemBatch: () => 1, prepareAdditionalOrderItems: () => [], applyLimitedStockItems: () => [],
        clearPosDraft: noop, setLastResult: noop, limitedStockItemTotals: () => new Map(),
        syncProductsByIds: noop, toastOrderSyncOutcome: noop
      }
    });
    env.storage.set("pos_pay_unpaid_id", "one");
    await env.ctx.submitOrder();
    assert.equal(env.order.status, status);
    assert.equal(env.order.preparedAt, "prepared");
    assert.equal(env.order.paymentStatus, "Lunas");
  }
});

test("cash delivery settlement charges products only and retains customer total including delivery", async () => {
  let result;
  const env = setup({ realPayment: true,
    order: { number: "D999", type: "Delivery", customerOrderType: "DELIVERY", paymentProvider: "courier_cash",
      status: "Sedang Disiapkan", confirmedAt: "accepted", deliveryFee: 10000, grandTotal: 30000 },
    globals: {
      cart: [{ name: "Latte", qty: 1, price: 20000 }], cartSubtotal: () => 20000,
      orderDiscountAmount: () => 0, requirePosPaymentMethod: () => "Cash",
      buildPosPaymentPayload: total => { assert.equal(total, 20000); return { receivedAmount: 20000, changeAmount: 0, paymentBreakdown: { Cash: 20000 } }; },
      prepareAdditionalOrderItems: () => [], applyLimitedStockItems: () => [], clearPosDraft: noop,
      setLastResult: value => { result = value; }, limitedStockItemTotals: () => new Map(),
      syncProductsByIds: noop, toastOrderSyncOutcome: noop
    }
  });
  env.storage.set("pos_pay_unpaid_id", "one");
  await env.ctx.submitOrder();
  assert.equal(env.order.type, "Delivery");
  assert.equal(env.order.paymentStatus, "Lunas");
  assert.equal(env.order.subtotal, 20000);
  assert.equal(env.order.grandTotal, 30000);
  assert.equal(env.order.receivedAmount, 20000);
  assert.equal(env.order.status, "Sedang Disiapkan");
  assert.ok(result);
});

test("home pickup uses cashier acceptance while delivery waits for the driver's processing", async () => {
  for (const customerOrderType of ["PICKUP_PREORDER", "DELIVERY"]) {
    const env = setup({ order: { customerOrderType, paymentProvider: customerOrderType === "DELIVERY" ? "courier_cash" : "cash_at_outlet",
      type: customerOrderType === "DELIVERY" ? "Delivery" : "Take Away", driverId: "driver", number: "P999" } });
    await env.ctx.SOTakeaway.processOrder("one");
    if (customerOrderType === "DELIVERY") {
      assert.equal(Boolean(env.order.confirmedAt),false);
      assert.equal(env.writes.length,0);
      assert.equal(env.ctx.orderVisibleInPosOrderList(env.order),false);
      continue;
    }
    assert.ok(env.order.confirmedAt);
    assert.equal(env.order.paymentStatus, "Belum dibayar");
    assert.deepEqual(Object.keys(env.writes[0].value).sort(), ["confirmed_at", "updated_at"]);
    assert.equal(env.ctx.kitchenOrderIsVisible(env.order, "Semua", ["Pesanan Baru"]), true);
  }
});

test("pending card is blue and exposes Process Order, accepted card retains payment", () => {
  const env = setup();
  const html = env.ctx.orderCenterCard(env.order, { searchQuery: "Rina" });
  assert.match(html, /so-takeaway-card/);
  assert.match(html, /Proses Pesanan/);
  assert.match(html, /SOTakeaway.processOrder/);
  assert.match(html, /data-order-search/);
  env.order.confirmedAt = "accepted";
  assert.doesNotMatch(env.ctx.orderCenterCard(env.order), /Proses Pesanan/);
  assert.match(env.ctx.orderCenterCard(env.order), /payUnpaidOrder/);
});

test("success copy supports payment after preparation without countdown", async () => {
  const env = setup({ mode: true });
  await env.ctx.selfOrderCreateOrder();
  const html = env.ctx.renderSelfOrderSuccess();
  assert.match(html, /Pesanan berhasil dibuat/);
  assert.match(html, /kasir/i);
  assert.match(html, /Nanti di kasir/);
  assert.doesNotMatch(html, /Di kasir saat pesanan selesai/);
  assert.doesNotMatch(html, /Pembayaran dapat dilakukan di kasir setelah pesanan selesai/);
  assert.doesNotMatch(html, /Masa bayar|data-so-takeaway-countdown|sebelum masa bayar/);
});

test("only the customer's own session displays the compact active order notice", () => {
  const first = setup({ mode: true });
  const second = setup({ mode: true });
  first.storage.set("so_takeaway_active_order", JSON.stringify({ id: "one", number: "T001" }));
  const html = first.ctx.renderSelfOrderPayment();
  assert.match(html, /so-takeaway-active-copy/);
  assert.match(html, /Pesanan aktif/);
  assert.match(html, /so-takeaway-active-link/);
  assert.match(html, /T001/);
  assert.doesNotMatch(html, /Anda masih memiliki pesanan/);
  assert.doesNotMatch(second.ctx.renderSelfOrderPayment(), /so-takeaway-active-card/);
});

test("self-order takeaway uses the customer heading and Takeaway Online chip", () => {
  const env = setup();
  for (const options of [{}, { compactUnpaid: true }]) {
    const html = env.ctx.orderCenterCard(env.order, options);
    assert.match(html, /<strong class="so-takeaway-order-number">-<\/strong>/);
    assert.match(html, /<span class="so-takeaway-type-chip">Takeaway Online<\/span>/);
    assert.match(html, /T001/);
    assert.doesNotMatch(html, /TAKEAWAY · T001/);
  }
});

test("home pickup and a store QR pickup share the Takeaway Online chip", () => {
  for(const [serviceInfo,label] of [['Takeaway-Rumah','Takeaway Online'],['Takeaway Outlet','Takeaway Online'],['Pickup','Takeaway Online']]) {
    const env=setup({order:{number:'P001',customer:'Pemesan Contoh',customerOrderType:'PICKUP_PREORDER',orderMode:'PICKUP_PREORDER',paymentProvider:'cash_at_outlet',serviceInfo}});
    for(const options of [{},{compactUnpaid:true}]) {
      const html=env.ctx.orderCenterCard(env.order,options);
      assert.ok(html.includes('<strong class="so-takeaway-order-number">Pemesan Contoh</strong>'));
      assert.ok(html.includes(`<span class="so-takeaway-type-chip">${label}</span>`));
      assert.match(html,/P001/);
    }
  }
});

test("POS delivery card uses the ordering customer and a Delivery chip, with clean notes", () => {
  const note = 'Tanpa gula\nKurir membayar harga produk di outlet; ongkir langsung diterima kurir dari pelanggan.\nPin lokasi: https://maps.google.com/?q=5.12,95.34\nPatokan alamat: Rumah pagar merah\nAlamat lanjutan';
  const env = setup({ order: { number: 'D001', customer: 'Pemesan Contoh', type: 'Delivery', customerOrderType: 'DELIVERY',
    paymentProvider: 'courier_cash', customerOrderStatus: 'DRIVER_ASSIGNED', driverId: 'driver', note } });
  for (const options of [{}, { compactUnpaid: true }]) {
    const html = env.ctx.orderCenterCard(env.order, options);
    assert.match(html, /<strong class="so-takeaway-order-number">Pemesan Contoh<\/strong>/);
    assert.match(html, /<span class="so-takeaway-type-chip">Delivery<\/span>/);
    assert.match(html, /Kurir ditugaskan/);
    assert.match(html, /Tanpa gula/);
    assert.doesNotMatch(html, /maps\.google|5\.12|95\.34|Pin lokasi|Rumah pagar merah|Alamat lanjutan|Kurir membayar harga produk/);
  }
  assert.equal(env.order.note, note);
  assert.doesNotMatch(env.ctx.orderCenterCard(env.order), /SOTakeaway.processOrder/);
  assert.equal(env.ctx.orderVisibleInPosOrderList(env.order), false);
});

test('pickup cards put the time in a note and omit the redundant item-count chip', () => {
  for (const pickupTime of ['Secepatnya', '18:45']) {
    const env = setup({ order: { pickupTime, customerOrderType: 'PICKUP_PREORDER', paymentProvider: 'cash_at_outlet',
      note: `Bungkus terpisah\nJam pengambilan: ${pickupTime}` } });
    for (const options of [{}, { compactUnpaid: true }]) {
      const html = env.ctx.orderCenterCard(env.order, options);
      assert.match(html, new RegExp(`<b>Jam pengambilan:</b> ${pickupTime}`));
      assert.doesNotMatch(html, /<span>\d+ item<\/span>|<span>Ambil /);
      assert.equal(html.split('Jam pengambilan:').length - 1, 1);
      assert.match(html, /Bungkus terpisah/);
      assert.equal(env.order.pickupTime, pickupTime);
      if (!options.compactUnpaid) {
        assert.ok(html.indexOf('so-takeaway-type-chip') < html.indexOf('so-takeaway-order-number'));
        assert.match(html, /orders-status-pill ready is-waiting/);
        assert.match(html, /1 barang/);
      }
    }
  }
});

test("Take Away customer note appears above items with the same POS note styling", () => {
  const env = setup({ order: { note: "Bungkus terpisah" } });
  const html = env.ctx.orderCenterCard(env.order);
  assert.match(html, /class="orders-item-group-note"><b>Catatan:<\/b> Bungkus terpisah<\/p>/);
  assert.ok(html.indexOf("orders-card-meta") < html.indexOf("orders-item-group-note"));
  assert.ok(html.indexOf("orders-item-group-note") < html.indexOf('class="orders-item-line"'));
  assert.equal(html.split("Bungkus terpisah").length - 1, 1);
});

test("empty customer notes do not add an empty note section", () => {
  for (const note of [undefined, "", "   "]) {
    const env = setup({ order: { note } });
    assert.doesNotMatch(env.ctx.orderCenterCard(env.order), /orders-item-group-note/);
  }
});

test("customer and item notes stay escaped and separate", () => {
  const env = setup({ order: { note: '<img src=x onerror="alert(1)">',
    items: [{ name: "Latte", qty: 1, price: 20000, note: "Tanpa gula & es" }] } });
  const html = env.ctx.orderCenterCard(env.order);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /class="orders-item-note">Catatan: Tanpa gula &amp; es/);
});

test("additional Take Away batches show their own notes like POS orders", () => {
  const env = setup({ order: { note: "Catatan awal",
    items: [
      { name: "Latte", qty: 1, price: 20000, orderBatch: 1 },
      { name: "Donut", qty: 1, price: 7000, orderBatch: 2, variantData: { orderBatchNote: "Tambahan dibungkus" } }
    ] } });
  const html = env.ctx.orderCenterCard(env.order);
  assert.equal(html.split('class="orders-item-group-note"').length - 1, 2);
  assert.match(html, /Catatan awal/);
  assert.match(html, /Tambahan dibungkus/);
  assert.ok(html.indexOf("Tambahan dibungkus") < html.indexOf("1x Donut"));
});

test("compact and expanded Take Away cards both display the customer note", () => {
  const env = setup({ order: { note: "Pisahkan saus" } });
  assert.match(env.ctx.orderCenterCard(env.order, { compactUnpaid: true }), /Pisahkan saus/);
  env.storage.set("orders_expanded_one", "1");
  assert.match(env.ctx.orderCenterCard(env.order, { compactUnpaid: true }), /Pisahkan saus/);
});

test("success status is highlighted and follows cashier and kitchen progress", async () => {
  const env = setup({ mode: true });
  await env.ctx.selfOrderCreateOrder();
  const order = env.ctx.state.orders[0];
  for (const [status, confirmedAt, tone, label] of [
    ["Pesanan Baru", null, "waiting", "Menunggu kasir menerima pesanan anda."],
    ["Pesanan Baru", "accepted", "accepted", "Kasir sudah menerima pesanan anda."],
    ["Sedang Disiapkan", "accepted", "processing", "Pesanan sedang disiapkan oleh dapur."],
    ["Selesai", "accepted", "completed", "Pesanan sudah selesai dan siap diambil."],
    ["Dibatalkan", "accepted", "cancelled", "Pesanan ini telah dibatalkan."]
  ]) {
    Object.assign(order, { status, confirmedAt });
    const html = env.ctx.renderSelfOrderSuccess();
    assert.match(html, new RegExp(`so-takeaway-status-highlight is-${tone}`));
    assert.match(html, /role="status"/);
    assert.ok(html.includes(`<span class="so-takeaway-status-chip">${label}</span>`));
    assert.doesNotMatch(html, /<b>Status<\/b>|<strong>Menunggu Kasir<\/strong>/);
    assert.doesNotMatch(html, /class="so-takeaway-cashier-note"/);
  }
});

test("successful submission uses the illustrated success icon even before payment", async () => {
  const env = setup({ mode: true });
  await env.ctx.selfOrderCreateOrder();
  let html = env.ctx.renderSelfOrderSuccess();
  assert.match(html, /class="success-icon so-takeaway-success-icon icon-asik" aria-hidden="true">/);
  assert.match(html, /<svg viewBox="0 0 96 96"/);
  assert.doesNotMatch(html, /so-takeaway-wallet-icon/);
  assert.equal(env.ctx.state.orders[0].paymentStatus, "Belum dibayar");
  env.ctx.state.orders[0].paymentStatus = "Lunas";
  html = env.ctx.renderSelfOrderSuccess();
  assert.match(html, /class="success-icon so-takeaway-success-icon icon-asik"/);
  env.ctx.state.orders[0].status = "Dibatalkan";
  html = env.ctx.renderSelfOrderSuccess();
  assert.doesNotMatch(html, /class="success-icon/);
  assert.match(html, /so-takeaway-success-icon icon-asik is-cancelled/);
});

test("compact Take Away UI is responsive without changing other self-order empty states", () => {
  const css = readSource("SO Takeaway/so-takeaway.css");
  assert.match(css, /\.so-takeaway-active-card\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(css, /\.self-order-app:has\(\.so-takeaway-topbar\) \.self-order-cart-list > \.empty/);
  assert.match(css, /\.so-takeaway-type-chip\s*\{[^}]*background: #e5f1ff;[^}]*color: #16519b/);
  assert.match(css, /\.so-takeaway-payment-copy\s*\{[^}]*overflow-wrap: anywhere/);
});

test("non-takeaway kitchen visibility and cards keep their original behavior", () => {
  const env = setup();
  const dineIn = { ...env.order, type: "Dine In", source: "Kasir" };
  assert.equal(env.ctx.kitchenOrderIsVisible(dineIn), true);
  assert.equal(env.ctx.orderCenterCard(dineIn), "base-card");
});

test("home pickup orders do not inherit the in-store Take Away acceptance gate", () => {
  const env = setup({ globals: { orderIsCustomerHomeOrder: order => order.number === "P001" } });
  const pickup = { ...env.order, number: "P001" };
  assert.equal(env.ctx.SOTakeaway.isOrder(pickup), false);
  assert.equal(env.ctx.orderCenterCard(pickup), "base-card");
});

test("a completed but unpaid order keeps refreshing until cashier payment arrives", async () => {
  const env = setup({ mode: true, globals: { localDbReady: true, supabaseReadable: () => true } });
  await env.ctx.selfOrderCreateOrder();
  env.ctx.state.orders[0].status = "Selesai";
  env.ctx.view = "selforder";
  const refreshSource = source.slice(source.indexOf("  function soTakeawayShouldRefreshStatus()"), source.indexOf("  async function soTakeawayRefreshActiveOrderFromSupabase"));
  vm.runInContext(refreshSource, env.ctx);
  env.ctx.soTakeawayIsMode = () => true;
  env.ctx.soTakeawayLastSnapshot = () => ({});
  env.ctx.soTakeawayFindOrder = () => env.ctx.state.orders[0];
  env.ctx.soTakeawayIsExpired = () => false;
  env.ctx.soTakeawayIsCompleted = order => order.status === "Selesai";
  env.ctx.soTakeawayIsPaid = order => order.paymentStatus === "Lunas";
  assert.equal(env.ctx.soTakeawayShouldRefreshStatus(), true);
  env.ctx.state.orders[0].paymentStatus = "Lunas";
  assert.equal(env.ctx.soTakeawayShouldRefreshStatus(), false);
  env.ctx.state.orders[0].paymentStatus = "Belum dibayar";
  env.storage.set("self_order_step", "menu");
  assert.equal(env.ctx.soTakeawayShouldRefreshStatus(), false);
});

test("Take Away buttons keep blue contrast in normal and hover states", () => {
  const css = readSource("SO Takeaway/so-takeaway.css");
  assert.match(css, /\.orders-card\.so-takeaway-card\s*\{[^}]*#e5f1ff/);
  assert.match(css, /\.so-takeaway-process-btn\s*\{[^}]*background: #1764b5;[^}]*color: #fff/);
  assert.match(css, /\.so-takeaway-process-btn:hover,[\s\S]*background: #124d8d;[^}]*color: #fff/);
});

test("all deployment copies carry the same Take Away behavior and cache versions", () => {
  const css = readSource("SO Takeaway/so-takeaway.css");
  for (const directory of ["delivery", "deploy-ready/pos", "deploy-ready/self-order", "deploy-ready/delivery"]) {
    assert.equal(readSource(directory, "SO Takeaway/so-takeaway.js"), source);
    assert.equal(readSource(directory, "SO Takeaway/so-takeaway.css"), css);
  }
  for (const file of ["pos.html", "self-order.html", "delivery/index.html", "deploy-ready/pos/index.html", "deploy-ready/self-order/index.html", "deploy-ready/delivery/index.html"]) {
    const html = readSource(file);
    assert.match(html, /so-takeaway\.js\?v=11-submit-confirm1-pay-later1-takeaway-ui2-notes1/);
    assert.match(html, /so-takeaway\.css\?v=11-pay-later1-takeaway-ui2-notes1/);
  }
});
