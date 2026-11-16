const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const appPath = path.join(__dirname, '..', 'app.js');
const source = fs.readFileSync(fs.existsSync(appPath) ? appPath : path.join(__dirname, '..', 'deploy-ready/pos/app.js'), 'utf8');

function functionSource(name, input = source) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(input);
  assert.ok(match, `Missing function ${name}`);
  const rest = input.slice(match.index + match[0].length);
  const next = /\n(?:async )?function \w+\(/.exec(rest);
  return input.slice(match.index, next ? match.index + match[0].length + next.index : input.length);
}

function setup(options = {}) {
  const db = {
    orders: [{ id: "remote-order", order_number: "ORDER-1", grand_total: 68000, status: "Pesanan Baru",
      payment_status: "Belum dibayar", updated_at: "2026-10-26T08:11:34.929Z" }],
    order_items: [{ id: "old-item", order_id: "remote-order", product_name: "Original", qty: 1, price: 68000 }],
    order_item_addons: [{ id: "old-addon", order_item_id: "old-item", addon_name: "Original addon" }],
    payments: [{ id: "existing-payment", order_id: "remote-order", amount: 68000 }]
  };
  let sequence = 0;
  let online = options.online !== false;
  const requests = [];
  const itemCounts = [];
  const order = {
    id: "local-order", supabaseId: "remote-order", number: "ORDER-1",
    source: "Self Order", status: "Sedang Disiapkan", paymentStatus: "Belum dibayar",
    subtotal: 68000, grandTotal: 68000, preparedAt: "2026-10-26T08:11:48.584Z",
    items: [{ lineId: "line-1", name: "Replacement", qty: 1, price: 68000, addons: [] }]
  };
  const context = vm.createContext({
    console: { warn() {}, error() {} }, Date, Promise, JSON, Map, Set,
    state: { orders: [order], syncQueue: [] },
    navigator: { onLine: true }, view: "orders", syncQueueProcessing: false,
    orderSyncLocks: new Map(), supabaseSupportsPreparedItems: true,
    orderSyncSequence: 0,
    supabaseSupportsOrderNotificationCategories: true,
    canAttemptSupabaseSync: () => online,
    ensureSupabaseProfile: async () => { if (options.ensureProfile) await options.ensureProfile(); return null; },
    uid: () => `queue-${++sequence}`,
    saveState() {}, invalidateReportCaches() {}, render() {}, toast() {},
    scheduleKitchenOptimisticOrderMutationClear() {}, clearKitchenOptimisticOrderMutation() {}, requestActiveReportData() {},
    requestLiveOrderRefresh() {},
    orderGrandTotalForSync: value => value.grandTotal,
    orderProfit: () => 0, orderPushNotificationCategories: () => [],
    orderItemKitchenNotificationCategory: () => "Coffee",
    itemDiscountAmount: item => Number(item.discount || 0),
    cartItemTotal: item => Number(item.price || 0) * Number(item.qty || 0)
      + (item.addons || []).reduce((sum, addon) => sum + addon.price * addon.qty, 0) - Number(item.discount || 0),
    cartItemVariantKey: () => "", orderItemBatch: () => 1,
    orderItemBatchCreatedAt: () => "", orderBatchLabel: () => "Pesanan pertama",
    orderTotal: value => value.grandTotal,
    upsertSupabaseOrderPayload: async payload => {
      requests.push({ table: "orders", operation: "upsert", payload });
      Object.assign(db.orders[0], payload);
      return { data: { id: "remote-order" }, error: null };
    },
    supabaseClient: {
      from(table) {
        const request = { table, operation: "select", filters: [] };
        const builder = {
          select() { return this; },
          single() { request.single = true; return this; },
          maybeSingle() { request.single = true; request.allowEmpty = true; return this; },
          eq(column, value) { request.filters.push(row => row[column] === value); return this; },
          in(column, values) { request.filters.push(row => values.includes(row[column])); return this; },
          insert(payload) { request.operation = "insert"; request.payload = payload; return this; },
          upsert(payload) { request.operation = "upsert"; request.payload = payload; return this; },
          update(payload) { request.operation = "update"; request.payload = payload; return this; },
          delete() { request.operation = "delete"; return this; },
          then(resolve, reject) {
            return Promise.resolve().then(async () => {
              requests.push(request);
              const failure = options.fail?.(request);
              if (failure) return { data: null, error: failure };
              if (options.beforeRequest) await options.beforeRequest(request, db);
              const matches = row => request.filters.every(filter => filter(row));
              let data;
              if (request.operation === "upsert") {
                data = request.payload.map(row => {
                  const previous = db[table].find(existing => existing.id === row.id);
                  if (previous) { Object.assign(previous, row); return previous; }
                  const inserted = { ...row };
                  db[table].push(inserted);
                  return inserted;
                });
              } else if (request.operation === "insert") {
                data = (Array.isArray(request.payload) ? request.payload : [request.payload])
                  .map(row => ({ ...row, id: `new-${++sequence}` }));
                db[table].push(...data);
              } else if (request.operation === "delete") {
                db[table] = db[table].filter(row => !matches(row));
                data = [];
              } else if (request.operation === "update") {
                data = db[table].filter(matches);
                data.forEach(row => Object.assign(row, request.payload));
              } else {
                data = db[table].filter(matches).map(row => ({ ...row }));
              }
              itemCounts.push(db.order_items.length);
              if (request.single) {
                if (request.allowEmpty && data.length === 0) return { data: null, error: null };
                return data.length === 1 ? { data: data[0], error: null }
                  : { data: null, error: { code: "PGRST116", message: "No matching order" } };
              }
              return { data, error: null };
            }).then(resolve, reject);
          }
        };
        return builder;
      }
    }
  });
  const functions = [
    "orderIsCustomerHomeOrder", "orderUsesOutletPayment",
    "orderIsRetiredTakeawayExpiryCancellation", "rejectRetiredTakeawayExpiryCancellation",
    "orderSyncQueueId", "orderHasPendingLocalSync", "syncRetryDelayMs", "nextOrderSyncSequence", "markOrderSyncPending", "markOrderSynced",
    "offlineOrderSyncMessage", "syncOrderToSupabase", "upsertSupabaseOrderPayload", "processSyncQueue",
    "supabaseOrderItemDedupeKey", "dedupeSupabaseOrderItemRows",
    "cartItemTotal", "itemBaseTotal", "itemDiscountAmount", "orderAdditionalItems", "cartItemKey", "unlockCartItemForOrder"
  ];
  for (const name of ["acquireOrderSyncLock", "updateSupabaseOrderStatus"]) {
    if (new RegExp(`function ${name}\\(`).test(source)) functions.push(name);
  }
  vm.runInContext(functions.map(name => functionSource(name)).join("\n"), context);
  return { context, db, order, requests, itemCounts, setOnline: value => { online = value; } };
}

test("a status update preserves remote items, addons, payments and total even with no local items", async () => {
  const env = setup();
  env.order.items = [];
  env.order.grandTotal = 0;
  assert.equal(await env.context.syncOrderToSupabase(env.order, { statusOnly: true }), true);
  assert.equal(env.db.order_items[0].id, "old-item");
  assert.equal(env.db.order_item_addons[0].id, "old-addon");
  assert.equal(env.db.payments[0].id, "existing-payment");
  assert.equal(env.db.orders[0].grand_total, 68000);
  assert.equal(env.db.orders[0].status, "Sedang Disiapkan");
  assert.ok(env.requests.every(request => request.table === "orders" && request.operation === "update"));
});

function retiredTakeawayCancellation(order) {
  return { ...order, type: "Take Away", status: "Dibatalkan", takeawayStatus: "EXPIRED",
    cancelledAt: "2026-11-08T10:40:00Z", cancelReason: "Pesanan Takeaway kedaluwarsa otomatis karena belum dibayar." };
}

test("retired automatic Take Away cancellation cannot write orders or related tables", async () => {
  for (const statusOnly of [false, true]) {
    const env = setup();
    Object.assign(env.order, retiredTakeawayCancellation(env.order));
    assert.equal(await env.context.syncOrderToSupabase(env.order, { statusOnly, silent: true }), false);
    assert.equal(env.requests.length, 0);
    assert.equal(env.db.orders[0].status, "Pesanan Baru");
    assert.equal(env.db.order_items.length, 1);
    assert.equal(env.db.payments.length, 1);
    assert.equal(env.order.syncStatus, "blocked");
    assert.equal(env.context.state.syncQueue.length, 0);
  }
});

test("old queued Take Away expiry is removed without cancelling the server order", async () => {
  const env = setup();
  env.context.state.syncQueue.push({ id: "retired", type: "order", orderId: env.order.id,
    orderNumber: env.order.number, syncMode: "full", payload: retiredTakeawayCancellation(env.order) });
  await env.context.processSyncQueue("manual");
  assert.equal(env.context.state.syncQueue.length, 0);
  assert.equal(env.requests.length, 0);
  assert.equal(env.db.orders[0].status, "Pesanan Baru");
  assert.equal(env.order.status, "Sedang Disiapkan");
});

test("blocking a stale expiry keeps a newer valid sync for the same order", async () => {
  const env = setup();
  env.context.state.syncQueue.push({ id: "valid", type: "order", orderId: env.order.id,
    orderNumber: env.order.number, syncMode: "status", payload: { ...env.order, cancelReason: "Pelanggan membatalkan" } });
  await env.context.syncOrderToSupabase(retiredTakeawayCancellation(env.order), { silent: true });
  assert.equal(env.context.state.syncQueue.length, 1);
  assert.equal(env.context.state.syncQueue[0].id, "valid");
});

test("manual cancellation remains allowed and unrelated order types are not classified as stale expiry", async () => {
  const env = setup();
  Object.assign(env.order, retiredTakeawayCancellation(env.order), { cancelReason: "Pelanggan membatalkan" });
  assert.equal(await env.context.syncOrderToSupabase(env.order, { statusOnly: true, silent: true }), true);
  assert.equal(env.db.orders[0].status, "Dibatalkan");
  assert.equal(env.db.orders[0].cancel_reason, "Pelanggan membatalkan");
  assert.equal(env.context.orderIsRetiredTakeawayExpiryCancellation({ ...retiredTakeawayCancellation(env.order), type: "Dine In" }), false);
  assert.equal(env.context.orderIsRetiredTakeawayExpiryCancellation({ ...retiredTakeawayCancellation(env.order), source: "Kasir" }), false);
});

test("a cancelled order remains cancelled locally until canonical server state is fetched", async () => {
  const env = setup({ online: false });
  let refresh;
  env.context.requestLiveOrderRefresh = options => { refresh = options; };
  Object.assign(env.order, retiredTakeawayCancellation(env.order));
  await env.context.syncOrderToSupabase(env.order, { silent: true });
  assert.equal(env.order.status, "Dibatalkan");
  assert.equal(env.order.takeawayStatus, "");
  assert.equal(refresh.orderIds[0], "remote-order");
  assert.equal(env.requests.length, 0);
  assert.equal(env.context.state.syncQueue.length, 0);
});

test("new Take Away restore callers declare intent while legacy callers cannot bypass the stock guard", async () => {
  const env = setup();
  const calls = [];
  env.context.supabaseClient.rpc = async (name, payload) => {
    calls.push({ name, payload });
    return { data: [{ restored: true }], error: null };
  };
  vm.runInContext(functionSource("restoreLimitedStockCommit"), env.context);
  await env.context.restoreLimitedStockCommit("T004");
  assert.equal(calls[0].name, "restore_limited_stock_commit");
  await env.context.restoreLimitedStockCommit("T004", "manual_delete");
  await env.context.restoreLimitedStockCommit("T004", "submit_failed");
  assert.equal(calls[1].name, "restore_takeaway_stock_with_intent");
  assert.equal(calls[1].payload.p_intent, "manual_delete");
  assert.equal(calls[2].payload.p_intent, "submit_failed");
  await env.context.restoreLimitedStockCommit("P001", "submit_failed");
  assert.equal(calls[3].name, "restore_limited_stock_commit");
});

test("manual Take Away cancellation requires the atomic RPC before mutating local stock", async () => {
  for (const fail of [false, true]) {
    const env = setup();
    Object.assign(env.order, { type: "Take Away", number: "T004", status: "Pesanan Baru" });
    env.order.items[0].stockTracked = true;
    env.context.state.products = [];
    let stocks = 0;
    let rpcName;
    Object.assign(env.context, {
      cancelOrderProcessingIds: new Set(), applyLimitedStockItems: () => { stocks += 1; return []; },
      audit() {}, broadcastRealtimeEvent() {}, syncProductsByIds() {}, loadMasterDataFromSupabase: async () => true
    });
    env.context.supabaseClient.rpc = async name => {
      rpcName = name;
      assert.equal(env.order.status, "Pesanan Baru");
      assert.equal(stocks, 0);
      return fail ? { data: null, error: new Error("network") }
        : { data: [{ order_id: "remote-order", stock_restored: true }], error: null };
    };
    vm.runInContext(functionSource("cancelOrder"), env.context);
    assert.equal(await env.context.cancelOrder(env.order.id, "Permintaan pelanggan"), !fail);
    assert.equal(rpcName, "cancel_takeaway_pay_later_order");
    assert.equal(env.order.status, fail ? "Pesanan Baru" : "Dibatalkan");
    assert.equal(stocks, fail ? 0 : 1);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(env.context.cancelOrderProcessingIds.size, 0);
  }
});

test("an unpaid snapshot cannot downgrade an already paid server order", async () => {
  const env = setup();
  env.db.orders[0].payment_status = "Lunas";
  assert.equal(await env.context.syncOrderToSupabase(env.order, { silent: true }), false);
  assert.equal(env.db.orders[0].payment_status, "Lunas");
  assert.equal(env.db.order_items[0].id, "old-item");
  assert.equal(env.db.payments[0].id, "existing-payment");
  assert.equal(env.order.paymentStatus, "Lunas");
  assert.ok(env.requests.every(request => request.operation === "select"));
});

test("a fresh customer number collision never marks the new order paid or changes the old transaction", async () => {
  const env = setup();
  env.db.orders[0].payment_status = "Lunas";
  env.db.orders[0].public_order_token = "previous-customer";
  Object.assign(env.order, { supabaseId: undefined, customerOrderType: "DELIVERY",
    paymentProvider: "courier_cash", publicOrderToken: "new-customer" });
  assert.equal(await env.context.syncOrderToSupabase(env.order, { silent: true }), false);
  assert.equal(env.order.paymentStatus, "Belum dibayar");
  assert.equal(env.order.supabaseId, undefined);
  assert.match(env.order.syncError, /Nomor pesanan sudah digunakan/);
  assert.equal(env.db.orders[0].payment_status, "Lunas");
  assert.equal(env.db.order_items[0].id, "old-item");
  assert.ok(env.requests.every(request => request.operation === "select"));
});

test("cash order policy and delivery destination are stored in the initial order write", async () => {
  const env = setup();
  env.db.orders = [];
  env.db.order_items = [];
  env.db.order_item_addons = [];
  env.db.payments = [];
  Object.assign(env.order, { supabaseId: undefined, customerOrderType: "DELIVERY", paymentProvider: "courier_cash",
    customerOrderStatus: "SEARCHING_DRIVER", publicOrderToken: "fixture-token", customerPhone: "08000000000",
    deliveryAddress: "Pin lokasi", deliveryNote: "Alamat fixture", deliveryLatitude: 1, deliveryLongitude: 2 });
  assert.equal(await env.context.syncOrderToSupabase(env.order, { silent: true }), true);
  assert.equal(env.db.orders[0].payment_provider, "courier_cash");
  assert.equal(env.db.orders[0].customer_order_type, "DELIVERY");
  assert.equal(env.db.orders[0].customer_order_status, "SEARCHING_DRIVER");
  assert.equal(env.db.orders[0].delivery_note, "Alamat fixture");
  assert.equal(env.db.orders[0].delivery_latitude, 1);
  assert.equal(env.db.orders[0].public_order_token, "fixture-token");
});

test('a new takeaway stores its creation token and a later cashier sync preserves it', async () => {
  const env=setup();
  env.db.orders=[];
  env.db.order_items=[];
  env.db.order_item_addons=[];
  env.db.payments=[];
  Object.assign(env.order,{supabaseId:undefined,number:'T002',type:'Take Away',orderMode:'TAKEAWAY',publicOrderToken:'takeaway-creation-token'});
  assert.equal(await env.context.syncOrderToSupabase(env.order,{silent:true}),true);
  assert.equal(env.db.orders[0].public_order_token,'takeaway-creation-token');
  env.order.publicOrderToken='stale-client-token';
  assert.equal(await env.context.syncOrderToSupabase(env.order,{silent:true}),true);
  assert.equal(env.db.orders[0].public_order_token,'takeaway-creation-token');
});

test("a later cashier item sync cannot overwrite newer delivery progress", async () => {
  const env = setup();
  Object.assign(env.order, { customerOrderType: "DELIVERY", paymentProvider: "courier_cash", customerOrderStatus: "SEARCHING_DRIVER" });
  Object.assign(env.db.orders[0], { customer_order_status: "DRIVER_ASSIGNED", driver_id: "driver" });
  assert.equal(await env.context.syncOrderToSupabase(env.order, { silent: true }), true);
  assert.equal(env.db.orders[0].customer_order_status, "DRIVER_ASSIGNED");
  assert.equal(env.db.orders[0].driver_id, "driver");
});

test("a queued unpaid edit is discarded when another device has already paid", async () => {
  const env = setup({ online: false });
  await env.context.syncOrderToSupabase(env.order, { silent: true });
  env.db.orders[0].payment_status = "Lunas";
  env.setOnline(true);
  await env.context.processSyncQueue("online");
  assert.equal(env.context.state.syncQueue.length, 0);
  assert.equal(env.context.state.orders[0].paymentStatus, "Lunas");
  assert.equal(env.db.payments[0].id, "existing-payment");
});

test("a payment committed between the read and write is not overwritten", async () => {
  let paid = false;
  const env = setup({ beforeRequest(request, db) {
    if (!paid && request.table === "orders" && request.operation === "update") {
      paid = true;
      db.orders[0].payment_status = "Lunas";
      db.orders[0].updated_at = "2026-10-26T08:12:00.000Z";
    }
  } });
  assert.equal(await env.context.syncOrderToSupabase(env.order, { silent: true }), false);
  assert.equal(env.db.orders[0].payment_status, "Lunas");
  assert.equal(env.db.order_items[0].id, "old-item");
  assert.equal(env.db.payments[0].id, "existing-payment");
});

test("an unpaid item update never deletes a payment recorded by another device", async () => {
  const env = setup();
  assert.equal(await env.context.syncOrderToSupabase(env.order, { silent: true }), true);
  assert.equal(env.db.payments[0].id, "existing-payment");
  assert.ok(env.requests.every(request => request.table !== "payments"));
});

test("completed item publication advances the order cursor for other devices", async () => {
  const env = setup();
  const previous = env.db.orders[0].updated_at;
  assert.equal(await env.context.syncOrderToSupabase(env.order, { silent: true }), true);
  assert.ok(Date.parse(env.db.orders[0].updated_at) > Date.parse(previous));
});

test("a partial item list cannot overwrite an order with a larger subtotal", async () => {
  const env = setup();
  env.order.items[0].price = 5000;
  assert.equal(await env.context.syncOrderToSupabase(env.order, { silent: true }), false);
  assert.equal(env.requests.length, 0);
  assert.equal(env.db.order_items[0].id, "old-item");
});

test("increasing an unpaid quantity does not duplicate existing addons or discounts", () => {
  const env = setup();
  for (const discount of [
    {}, { discount: 5000, discountType: "rp" }, { discountValue: 10, discountType: "percent" }
  ]) {
    const previous = { lineId: "existing", name: "Item", price: 68000, qty: 1,
      addons: [{ id: "extra", name: "Extra", price: 2000, qty: 1 }], ...discount };
    const next = { ...previous, qty: 2 };
    const [additional] = env.context.orderAdditionalItems([previous], [next]);
    assert.equal(additional.addons.length, 0);
    assert.equal(env.context.cartItemTotal(previous) + env.context.cartItemTotal(additional), env.context.cartItemTotal(next));
  }
});

test("an empty full sync is rejected before any remote write", async () => {
  const env = setup();
  env.order.items = [];
  assert.equal(await env.context.syncOrderToSupabase(env.order, { silent: true }), false);
  assert.equal(env.requests.length, 0);
  assert.equal(env.db.order_items.length, 1);
  assert.equal(env.order.syncStatus, "pending");
});

test("failed replacement insertion keeps the previous items and addons", async () => {
  const env = setup({ fail: request => request.table === "order_items" && request.operation === "insert"
    ? { message: "Connection lost" } : null });
  assert.equal(await env.context.syncOrderToSupabase(env.order, { silent: true }), false);
  assert.equal(env.db.order_items[0].id, "old-item");
  assert.equal(env.db.order_item_addons[0].id, "old-addon");
  assert.ok(env.itemCounts.every(count => count > 0));
});

test("successful replacement never exposes an empty item list", async () => {
  const env = setup();
  assert.equal(await env.context.syncOrderToSupabase(env.order, { silent: true }), true);
  assert.equal(env.db.order_items.length, 1);
  assert.equal(env.db.order_items[0].product_name, "Replacement");
  assert.ok(env.itemCounts.every(count => count > 0));
});

test("replacement retains addon details and accepts the established discount calculation", async () => {
  const env = setup();
  env.order.items[0] = {
    name: "Replacement", price: 70000, qty: 1,
    discountValue: 10, discountType: "percent",
    addons: [{ name: "New addon", price: 5000, qty: 1 }]
  };
  env.order.subtotal = 67500;
  env.order.grandTotal = 67500;
  assert.equal(await env.context.syncOrderToSupabase(env.order, { silent: true }), true);
  assert.equal(env.db.order_items[0].discount, 7500);
  assert.equal(env.db.order_item_addons.length, 1);
  assert.equal(env.db.order_item_addons[0].addon_name, "New addon");
  assert.equal(env.db.order_item_addons[0].order_item_id, env.db.order_items[0].id);
});

test("failed addon insertion leaves the previous item details intact", async () => {
  const env = setup({ fail: request => request.table === "order_item_addons" && request.operation === "insert"
    ? { message: "Addon insert failed" } : null });
  env.order.items[0].addons = [{ name: "New addon", qty: 1, price: 2000 }];
  env.order.subtotal = 70000;
  env.order.grandTotal = 70000;
  assert.equal(await env.context.syncOrderToSupabase(env.order, { silent: true }), false);
  assert.equal(env.db.order_items.length, 1);
  assert.equal(env.db.order_items[0].id, "old-item");
  assert.equal(env.db.order_item_addons[0].id, "old-addon");
});

test("an interrupted addon write and failed cleanup cannot publish incomplete replacement items", async () => {
  const env = setup({ fail: request =>
    (request.table === "order_item_addons" && request.operation === "insert")
      || (request.table === "order_items" && request.operation === "delete")
      ? { message: "Connection lost" } : null });
  env.db.order_items[0].variant_data = { clientLineId: "line-1" };
  env.order.items[0].price = 66000;
  env.order.items[0].addons = [{ name: "Extra", qty: 1, price: 2000 }];
  assert.equal(await env.context.syncOrderToSupabase(env.order, { silent: true }), false);
  const visible = env.context.dedupeSupabaseOrderItemRows(env.db.order_items);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, "old-item");
  assert.equal(env.db.order_item_addons[0].id, "old-addon");
});

test("cleanup only removes the old IDs and preserves another device's newly added item", async () => {
  let injected = false;
  const env = setup({ beforeRequest(request, db) {
    if (!injected && request.table === "order_items" && request.operation === "insert") {
      injected = true;
      db.order_items.push({ id: "other-device-item", order_id: "remote-order", product_name: "Additional" });
    }
  } });
  assert.equal(await env.context.syncOrderToSupabase(env.order, { silent: true }), true);
  assert.ok(env.db.order_items.some(item => item.id === "other-device-item"));
});

test("offline status retries stay status-only and do not replace item details", async () => {
  const env = setup({ online: false });
  env.order.items = [];
  assert.equal(await env.context.syncOrderToSupabase(env.order, { statusOnly: true, silent: true }), false);
  assert.equal(env.context.state.syncQueue[0].syncMode, "status");
  env.setOnline(true);
  await env.context.processSyncQueue("online");
  assert.equal(env.context.state.syncQueue.length, 0);
  assert.equal(env.db.order_items[0].id, "old-item");
  assert.equal(env.db.payments[0].id, "existing-payment");
});

test("a status retry cannot downgrade or clear a queued full order sync", async () => {
  const env = setup({ online: false });
  await env.context.syncOrderToSupabase(env.order, { silent: true });
  await env.context.syncOrderToSupabase(env.order, { statusOnly: true, silent: true });
  assert.equal(env.context.state.syncQueue[0].syncMode, "full");
  env.setOnline(true);
  await env.context.syncOrderToSupabase(env.order, { statusOnly: true, silent: true });
  assert.equal(env.context.state.syncQueue.length, 1);
  assert.equal(env.order.syncStatus, "pending");
});

test("offline full writes retain an immutable item snapshot for retry", async () => {
  const env = setup({ online: false });
  await env.context.syncOrderToSupabase(env.order, { silent: true });
  env.order.items = [];
  env.order.subtotal = 0;
  env.setOnline(true);
  await env.context.processSyncQueue("online");
  assert.equal(env.context.state.syncQueue.length, 0);
  assert.equal(env.db.order_items.length, 1);
  assert.equal(env.db.order_items[0].product_name, "Replacement");
  assert.equal(env.db.orders[0].grand_total, 68000);
});

test("rejecting an invalid local view preserves the last valid offline snapshot", async () => {
  const env = setup({ online: false });
  await env.context.syncOrderToSupabase(env.order, { silent: true });
  env.order.items = [];
  await env.context.syncOrderToSupabase(env.order, { silent: true });
  env.setOnline(true);
  await env.context.processSyncQueue("online");
  assert.equal(env.context.state.syncQueue.length, 0);
  assert.equal(env.db.order_items[0].product_name, "Replacement");
});

test("realtime reads retain the complete snapshot of a pending full edit", async () => {
  const env = setup({ online: false });
  await env.context.syncOrderToSupabase(env.order, { silent: true });
  env.context.state.products = [];
  env.context.normalizePaymentBreakdown = value => value;
  env.context.mergePreparedItems = value => value;
  env.context.sanitizeKitchenPreparedItems = value => value;
  env.context.applyPendingKitchenOrderMutation = value => value;
  vm.runInContext(functionSource("normalizeSupabaseLiveOrder"), env.context);
  const remote = env.context.normalizeSupabaseLiveOrder({
    id: "remote-order", order_number: "ORDER-1", subtotal: 5000, grand_total: 5000, status: "Pesanan Baru"
  }, []);
  assert.equal(remote.items.length, 1);
  assert.equal(remote.items[0].name, "Replacement");
  assert.equal(remote.subtotal, 68000);
  assert.equal(remote.syncStatus, "pending");
});

test("a fresh POS device reads cash policy, courier assignment and pickup time from Supabase", () => {
  const env = setup();
  env.context.state.orders = [];
  Object.assign(env.context, { normalizePaymentBreakdown: value => value, mergePreparedItems: value => value,
    sanitizeKitchenPreparedItems: value => value, applyPendingKitchenOrderMutation: value => value });
  env.context.state.products = [];
  vm.runInContext(functionSource("normalizeSupabaseLiveOrder"), env.context);
  for (const name of ["customer_order_type", "customer_order_status", "payment_provider", "driver_id", "pickup_time"]) {
    assert.ok(source.match(/const LIVE_ORDER_COLUMNS = "([^"]+)"/)[1].split(',').includes(name), name);
  }
  const remote = env.context.normalizeSupabaseLiveOrder({ id: "fresh", order_number: "D999", subtotal: 25000,
    grand_total: 35000, delivery_fee: 10000, customer_order_type: "DELIVERY", customer_order_status: "DRIVER_ASSIGNED",
    payment_provider: "courier_cash", driver_id: "driver", pickup_time: "17:30", payment_status: "Belum dibayar" },
    [{ id: "item", product_name: "Latte", qty: 1, price: 25000 }]);
  assert.equal(remote.paymentProvider, "courier_cash");
  assert.equal(remote.customerOrderType, "DELIVERY");
  assert.equal(remote.customerOrderStatus, "DRIVER_ASSIGNED");
  assert.equal(remote.driverId, "driver");
  assert.equal(remote.pickupTime, "17:30");
});

test("an earlier sync completion does not clear a newer queued revision", async () => {
  const env = setup({ online: false });
  await env.context.syncOrderToSupabase(env.order, { silent: true });
  const previousRevision = env.context.state.syncQueue[0].revision;
  env.context.markOrderSyncPending(env.order, new Error("New edit"));
  env.context.markOrderSynced(env.order, { queueRevision: previousRevision });
  assert.equal(env.context.state.syncQueue.length, 1);
  assert.equal(env.order.syncStatus, "pending");
});

test("status update retries without an optional missing column", async () => {
  const env = setup({ fail: request => request.table === "orders" && request.payload?.prepared_items
    ? { code: "42703", message: 'column "prepared_items" does not exist' } : null });
  env.order.preparedItems = { "line:line-1": true };
  env.order.status = "Selesai";
  assert.equal(await env.context.syncOrderToSupabase(env.order, { statusOnly: true, silent: true }), true);
  assert.equal(env.db.order_items[0].id, "old-item");
});

test("a status-only retry does not replace freshly loaded local item data", async () => {
  const env = setup({ online: false });
  env.order.items = [];
  await env.context.syncOrderToSupabase(env.order, { statusOnly: true, silent: true });
  env.order.items = [{ name: "Loaded from server", qty: 1, price: 68000 }];
  env.setOnline(true);
  await env.context.processSyncQueue("online");
  assert.equal(env.context.state.orders[0].items[0].name, "Loaded from server");
});

test("an unloaded device cannot clear remote preparation checkmarks", async () => {
  const env = setup();
  env.order.items = [];
  env.db.orders[0].prepared_items = { existingLine: true };
  assert.equal(await env.context.syncOrderToSupabase(env.order, { statusOnly: true, silent: true }), true);
  assert.equal(env.db.orders[0].prepared_items.existingLine, true);
});

test("interrupted replacement deduplication chooses the newest write regardless of UUID order", () => {
  const env = setup();
  const newer = { id: "a", variant_data: { clientLineId: "line-1", clientSyncCreatedAt: "2026-10-26T09:00:00.000Z" } };
  const older = { id: "z", variant_data: { clientLineId: "line-1", clientSyncCreatedAt: "2026-10-26T08:00:00.000Z" } };
  const rows = env.context.dedupeSupabaseOrderItemRows([newer, older]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "a");
});

test("status update does not report success for a missing remote order", async () => {
  const env = setup();
  env.db.orders = [];
  assert.equal(await env.context.syncOrderToSupabase(env.order, { statusOnly: true, silent: true }), false);
  assert.equal(env.order.syncStatus, "pending");
});

test("concurrent syncs for the same order are serialized", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let firstInsert = true;
  const env = setup({ async beforeRequest(request) {
    if (firstInsert && request.table === "order_items" && request.operation === "insert") {
      firstInsert = false;
      await gate;
    }
  } });
  const first = env.context.syncOrderToSupabase(env.order, { silent: true });
  await new Promise(resolve => setImmediate(resolve));
  const second = env.context.syncOrderToSupabase(env.order, { statusOnly: true, silent: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.requests.filter(request => request.table === "orders" && request.operation === "update"
    && !Object.hasOwn(request.payload, "grand_total")).length, 0);
  release();
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(env.db.order_items.length, 1);
  assert.equal(env.context.orderSyncLocks.size, 0);
});

test("a newer successful edit clears the older failed write it supersedes", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let firstInsert = true;
  const env = setup({ async beforeRequest(request) {
    if (firstInsert && request.table === "order_items" && request.operation === "insert") {
      firstInsert = false;
      await gate;
      throw new Error("First request lost connection");
    }
  } });
  const first = env.context.syncOrderToSupabase(env.order, { silent: true });
  await new Promise(resolve => setImmediate(resolve));
  env.order.items[0].name = "Newer edit";
  const second = env.context.syncOrderToSupabase(env.order, { silent: true });
  release();
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.equal(env.context.state.syncQueue.length, 0);
  await env.context.processSyncQueue("online");
  assert.equal(env.db.order_items[0].product_name, "Newer edit");
});

test("an older failing request does not replace a newer offline edit", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let firstInsert = true;
  const env = setup({ async beforeRequest(request) {
    if (firstInsert && request.table === "order_items" && request.operation === "insert") {
      firstInsert = false;
      await gate;
      throw new Error("First request lost connection");
    }
  } });
  const first = env.context.syncOrderToSupabase(env.order, { silent: true });
  await new Promise(resolve => setImmediate(resolve));
  env.setOnline(false);
  env.order.items[0].name = "Newer offline edit";
  await env.context.syncOrderToSupabase(env.order, { silent: true });
  release();
  await first;
  env.setOnline(true);
  await env.context.processSyncQueue("online");
  assert.equal(env.db.order_items[0].product_name, "Newer offline edit");
});

test("a queued snapshot waiting behind a newer successful write is skipped", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let firstInsert = true;
  const env = setup({ online: false, async beforeRequest(request) {
    if (firstInsert && request.table === "order_items" && request.operation === "insert") {
      firstInsert = false;
      await gate;
    }
  } });
  await env.context.syncOrderToSupabase(env.order, { silent: true });
  env.setOnline(true);
  env.order.items.push({ lineId: "line-2", name: "Additional", qty: 1, price: 5000 });
  env.order.subtotal = 73000;
  env.order.grandTotal = 73000;
  const newerWrite = env.context.syncOrderToSupabase(env.order, { silent: true });
  await new Promise(resolve => setImmediate(resolve));
  const olderRetry = env.context.processSyncQueue("online");
  await new Promise(resolve => setImmediate(resolve));
  release();
  await newerWrite;
  await olderRetry;
  assert.equal(env.db.orders[0].grand_total, 73000);
  assert.equal(env.db.order_items.length, 2);
  assert.equal(env.context.state.orders[0].items.length, 2);
  assert.equal(env.context.state.syncQueue.length, 0);
});

test("items and totals use the same snapshot while a network request is pending", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const env = setup({ ensureProfile: () => gate });
  const syncing = env.context.syncOrderToSupabase(env.order, { silent: true });
  await new Promise(resolve => setImmediate(resolve));
  env.order.items = [];
  env.order.subtotal = 0;
  env.order.grandTotal = 0;
  release();
  assert.equal(await syncing, true);
  assert.equal(env.db.orders[0].grand_total, 68000);
  assert.equal(env.db.orders[0].subtotal, 68000);
  assert.equal(env.db.order_items[0].price, 68000);
});

test("kitchen acceptance and cancellation request status-only sync", () => {
  assert.match(functionSource("advanceOrder"), /syncOrderToSupabase\(order, \{ statusOnly: true \}\)/);
  assert.match(functionSource("cancelOrder"), /syncOrderToSupabase\(order, \{ statusOnly: true \}\)/);
});

test("kitchen cannot advance an order before its items are available", () => {
  const env = setup();
  env.order.items = [];
  let message = "";
  env.context.toast = value => { message = value; };
  vm.runInContext(functionSource("advanceOrder"), env.context);
  env.context.advanceOrder(env.order.id);
  assert.ok(message.includes("Rincian pesanan"));
  assert.equal(env.requests.length, 0);
});

test("realtime item updates received during loading are retained and drained afterward", async () => {
  const scheduled = [];
  const context = vm.createContext({
    Date, console, Set, Map, supabaseReadable: () => true,
    realtimeOrdersLoading: true, localDbReady: true, realtimeOrdersLoadedAt: 0,
    realtimePendingOrderIds: new Set(), orderNotificationKnownKeys: new Set(),
    liveOrderSyncSince: () => "2026-10-26T00:00:00Z", EGRESS_SAVER_ORDER_LIMIT: 120,
    mergeSupabaseLiveOrders() {}, pruneDeletedSyncedOrdersFromSupabase: async () => {},
    notifyIncomingOrders() {}, shouldRenderAfterRealtimeLoad: () => false,
    flushPendingNativePushOrderRefresh() {}, scheduleRealtimeRefresh: reason => scheduled.push(reason),
    state: { orders: [] }, LIVE_ORDER_COLUMNS: "id",
    supabaseClient: { from() { return {
      select() { return this; }, order() { return this; }, limit() { return this; }, or() { return this; },
      then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); }
    }; } }
  });
  vm.runInContext(functionSource("loadRecentOrdersFromSupabase"), context);
  await context.loadRecentOrdersFromSupabase({ orderIds: ["remote-order"], force: true });
  assert.ok(context.realtimePendingOrderIds.has("remote-order"));
  context.realtimeOrdersLoading = false;
  await context.loadRecentOrdersFromSupabase({ force: true, silent: true });
  assert.deepEqual(scheduled, ["orders"]);
});

test("every application package ships the same order-preservation logic", () => {
  for (const file of ["delivery/app.js", "deploy-ready/pos/app.js", "deploy-ready/delivery/app.js", "deploy-ready/self-order/app.js"]) {
    const local = path.join(__dirname, '..', file);
    const copy = fs.readFileSync(fs.existsSync(local) ? local : path.join(__dirname, '..', 'deploy-ready', file), 'utf8');
    for (const name of [
      "orderIsRetiredTakeawayExpiryCancellation", "rejectRetiredTakeawayExpiryCancellation",
      "restoreLimitedStockCommit", "restoreOrderStockBeforeDelete",
      "acquireOrderSyncLock", "updateSupabaseOrderStatus", "nextOrderSyncSequence", "markOrderSyncPending", "markOrderSynced",
      "processSyncQueue", "syncOrderToSupabase", "syncOrderPreparedItemsToSupabase",
      "upsertSupabaseOrderPayload", "orderAdditionalItems", "toastOrderSyncOutcome",
      "dedupeSupabaseOrderItemRows", "loadRecentOrdersFromSupabase", "advanceOrder", "cancelOrder"
    ]) {
      const normalize = value => value.replace(/grand_total: orderTotal\(order\),/, "grand_total: orderGrandTotalForSync(order),").trim();
      assert.equal(normalize(functionSource(name, copy)), normalize(functionSource(name)), `${file}: ${name} must match`);
    }
  }
});
