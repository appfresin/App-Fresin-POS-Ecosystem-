const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.join(__dirname, "..");
function readSource(file) {
  const local=path.join(root,file);
  const mapped=file==='app.js'?'pos/app.js':file.startsWith('SO Takeaway/')?`pos/${file}`:file;
  return fs.readFileSync(fs.existsSync(local)?local:path.join(root,'deploy-ready',mapped),'utf8');
}
const source = readSource('app.js');

function extract(name, input = source) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(input);
  assert.ok(match, `Missing function ${name}`);
  const rest = input.slice(match.index + match[0].length);
  const next = /\n(?:async )?function \w+\(/.exec(rest);
  return input.slice(match.index, next ? match.index + match[0].length + next.index : input.length).trim();
}

function confirmationContext(options = {}) {
  const order = { id: "local-1", number: "ORDER-1", supabaseId: "remote-1", syncStatus: "synced" };
  let now = options.now || 1000;
  const timers = [];
  const context = vm.createContext({
    Date: { now: () => now }, Promise,
    selfOrderSubmitStartedAt: 1000,
    state: { orders: [order], syncQueue: [] },
    window: { setTimeout: (callback, delay) => { timers.push({ callback, delay }); } },
    syncOrderToSupabase: options.sync || (async () => true)
  });
  vm.runInContext([
    extract("orderSyncQueueId"), extract("orderHasPendingLocalSync"), extract("submitSelfOrderConfirmed")
  ].join("\n"), context);
  return { order, context, timers, setNow: value => { now = value; } };
}

test("confirmation remains pending until the database writer finishes", async () => {
  let finish;
  const databaseWrite = new Promise(resolve => { finish = resolve; });
  const env = confirmationContext({ now: 2000, sync: () => databaseWrite });
  let done = false;
  const result = env.context.submitSelfOrderConfirmed(env.order).then(value => { done = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(done, false);
  finish(true);
  assert.equal(await result, true);
});

test("a fast successful write retains a brief visible loading state", async () => {
  const env = confirmationContext();
  let done = false;
  const result = env.context.submitSelfOrderConfirmed(env.order).then(value => { done = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(done, false);
  assert.equal(env.timers.length, 1);
  assert.equal(env.timers[0].delay, 400);
  env.setNow(1400);
  env.timers[0].callback();
  assert.equal(await result, true);
});

test("a slow database write does not receive an extra artificial delay", async () => {
  const env = confirmationContext({ now: 3000 });
  assert.equal(await env.context.submitSelfOrderConfirmed(env.order), true);
  assert.equal(env.timers.length, 0);
});

test("a device clock adjustment cannot extend the short loading interval", async () => {
  const env = confirmationContext({ now: 500 });
  const result = env.context.submitSelfOrderConfirmed(env.order);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.timers[0].delay, 400);
  env.timers[0].callback();
  assert.equal(await result, true);
});

test("failed writes and missing server acknowledgement cannot confirm an order", async () => {
  const failed = confirmationContext({ now: 3000, sync: async () => false });
  assert.equal(await failed.context.submitSelfOrderConfirmed(failed.order), false);
  const missingId = confirmationContext({ now: 3000 });
  missingId.order.supabaseId = "";
  assert.equal(await missingId.context.submitSelfOrderConfirmed(missingId.order), false);
  const pending = confirmationContext({ now: 3000 });
  pending.order.syncStatus = "pending";
  assert.equal(await pending.context.submitSelfOrderConfirmed(pending.order), false);
});

test("a pending queue entry still prevents success after a successful write response", async () => {
  const env = confirmationContext({ now: 3000 });
  env.context.state.syncQueue.push({ type: "order", orderId: env.order.id });
  assert.equal(await env.context.submitSelfOrderConfirmed(env.order), false);
});

test("another order's pending sync does not block this order's confirmation", async () => {
  const env = confirmationContext({ now: 3000 });
  env.context.state.syncQueue.push({ type: "order", orderId: "unrelated-order", orderNumber: "OTHER-ORDER" });
  assert.equal(await env.context.submitSelfOrderConfirmed(env.order), true);
});

test("confirmation rechecks pending changes after the visible loading interval", async () => {
  const env = confirmationContext();
  const result = env.context.submitSelfOrderConfirmed(env.order);
  await new Promise(resolve => setImmediate(resolve));
  env.context.state.syncQueue.push({ type: "order", orderNumber: env.order.number });
  env.timers[0].callback();
  assert.equal(await result, false);
});

function checkoutContext() {
  const values = new Map([["self_order_customer", "Customer"], ["self_order_table", "D-12"], ["self_order_step", "payment"]]);
  let finish;
  let fail;
  let submissions = 0;
  const submitting = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  const context = vm.createContext({
    Date, Promise, JSON, console: { error() {} },
    selfOrderSubmitting: false, selfOrderSubmitStartedAt: 0, selfOrderSubmitError: "",
    selfOrderCart: [{ lineId: "line-1", name: "Item", qty: 1, price: 20000 }],
    state: { cashSession: { open: true }, orders: [], syncQueue: [] },
    SELF_ORDER_TABLE_CHOICE_KEY: "table-choice",
    document: { getElementById: () => null },
    sessionStorage: { getItem: key => values.get(key) || null,
      setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    window: { setTimeout: callback => callback() },
    canAttemptSupabaseSync: () => true, supabaseReadable: () => true,
    selfOrderShowCustomerError: () => { throw new Error("Unexpected validation error"); },
    toast() {}, render() {}, saveState() {}, saveSelfOrderCart() {}, syncSelfOrderTableFromUrl() {},
    selfOrderSubtotal: () => 20000, refreshSelfOrderTableOrders: async () => true,
    selfOrderOpenTableOrder: () => null, selfOrderOpenTableChoice: () => "new",
    getSupabaseServerTimeIso: async () => "2026-10-26T08:00:00.000Z",
    tagOrderBatchItems: items => items, uid: () => "local-1", orderNumber: () => "ORDER-1",
    validateLimitedStockItems: () => ({ ok: true }),
    commitLimitedStockReservations: async () => ({ accepted: true, token: "" }),
    submitSelfOrderConfirmed: async () => { submissions += 1; return submitting; },
    orderSyncQueueId: order => order.id,
    audit() {}, money: value => String(value), orderTotal: order => order.subtotal,
    saveSelfOrderLastOrderSnapshot() {}, pushSelfOrderHistory() {},
    rotateLimitedStockReservationToken() {}, loadMasterDataFromSupabase: async () => true,
    broadcastRealtimeEvent() {}
  });
  vm.runInContext(extract("selfOrderCreateOrder"), context);
  return { context, values, finish, fail, submissions: () => submissions };
}

test('dine-in checkout rechecks its operating window before reserving stock or submitting', async () => {
  const env=checkoutContext();
  let reserved=0;
  env.context.commitLimitedStockReservations=async()=>{reserved++;return {accepted:true};};
  env.context.window.FresinOnlineHours={check:async service=>{assert.equal(service,'dinein');return false;}};
  env.finish(true);
  await env.context.selfOrderCreateOrder();
  assert.equal(reserved,0);
  assert.equal(env.submissions(),0);
  assert.equal(env.context.selfOrderCart.length,1);
  assert.equal(env.context.selfOrderSubmitting,false);
});

test("the real checkout blocks double clicks and keeps the cart until confirmed", async () => {
  const env = checkoutContext();
  const first = env.context.selfOrderCreateOrder();
  await new Promise(resolve => setImmediate(resolve));
  await env.context.selfOrderCreateOrder();
  assert.equal(env.submissions(), 1);
  assert.equal(env.context.selfOrderSubmitting, true);
  assert.equal(env.context.selfOrderCart.length, 1);
  assert.equal(env.values.get("self_order_step"), "payment");
  env.finish(true);
  await first;
  assert.equal(env.values.get("self_order_step"), "success");
  assert.equal(env.context.selfOrderCart.length, 0);
  assert.equal(env.context.selfOrderSubmitting, false);
  assert.equal(env.context.selfOrderSubmitStartedAt, 0);
});

test("an unconfirmed real checkout preserves the cart and returns the button to retry", async () => {
  const env = checkoutContext();
  const first = env.context.selfOrderCreateOrder();
  await new Promise(resolve => setImmediate(resolve));
  env.finish(false);
  await first;
  assert.equal(env.values.get("self_order_step"), "payment");
  assert.equal(env.context.selfOrderCart.length, 1);
  assert.ok(env.context.selfOrderSubmitError);
  assert.equal(env.context.selfOrderSubmitting, false);
  assert.equal(env.context.selfOrderSubmitStartedAt, 0);
});

test("an unexpected transport failure releases the checkout lock without clearing the cart", async () => {
  const env = checkoutContext();
  const first = env.context.selfOrderCreateOrder();
  await new Promise(resolve => setImmediate(resolve));
  env.fail(new Error("Connection interrupted"));
  await first;
  assert.equal(env.values.get("self_order_step"), "payment");
  assert.equal(env.context.selfOrderCart.length, 1);
  assert.ok(env.context.selfOrderSubmitError);
  assert.equal(env.context.selfOrderSubmitting, false);
  assert.equal(env.context.selfOrderSubmitStartedAt, 0);
});

test("all checkout modes and deployment packages use the confirmation gate", () => {
  for (const file of ["app.js", "delivery/app.js", "deploy-ready/pos/app.js", "deploy-ready/delivery/app.js", "deploy-ready/self-order/app.js"]) {
    const input = readSource(file);
    assert.equal(extract("submitSelfOrderConfirmed", input), extract("submitSelfOrderConfirmed"), file);
    assert.match(extract("selfOrderCreateOrder", input), /await submitSelfOrderConfirmed\(order\)/);
  }
  for (const file of [
    "SO Takeaway/so-takeaway.js", "delivery/SO Takeaway/so-takeaway.js",
    "deploy-ready/pos/SO Takeaway/so-takeaway.js", "deploy-ready/self-order/SO Takeaway/so-takeaway.js",
    "deploy-ready/delivery/SO Takeaway/so-takeaway.js",
    "delivery/Customer Order/customer-order.js", "deploy-ready/delivery/Customer Order/customer-order.js"
  ]) {
    const input = readSource(file);
    assert.match(input, /await submitSelfOrderConfirmed\(order\)/, file);
    assert.match(input, /selfOrderSubmitStartedAt = Date\.now\(\)/, file);
    assert.match(input, /selfOrderSubmitStartedAt = 0/, file);
  }
});
