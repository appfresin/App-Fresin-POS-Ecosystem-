const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.join(__dirname, '..');
function readSource(file) {
  const local = path.join(root, file);
  return fs.readFileSync(fs.existsSync(local) ? local : path.join(root, 'deploy-ready', file === 'app.js' ? 'pos/app.js' : file), 'utf8');
}
const home = readSource('delivery/Customer Order/customer-order.js');
const core = readSource('app.js');
const driver = readSource('driver/Driver Order/driver-order.js');

function extract(source, name, indent = '') {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(match, `Missing ${name}`);
  const next = new RegExp(`\\n${indent}(?:async )?function \\w+\\(`).exec(source.slice(match.index + match[0].length));
  return source.slice(match.index, next ? match.index + match[0].length + next.index : source.length);
}
function load(ctx, source, names, indent = '') {
  vm.runInContext(names.map(name => extract(source, name, indent)).join('\n'), ctx);
}
function setup(method = 'PICKUP_PREORDER', options = {}) {
  const storage = new Map();
  const writes = [], restored = [];
  const checkout = { method, name: 'Pelanggan fixture', phone: '08000000000', pickupTime: '17:30', note: 'Tanpa gula', addressNote: 'Alamat fixture', latitude: 1, longitude: 1 };
  const noop = () => {};
  const ctx = vm.createContext({
    console, Date, Promise, Number, String, Set, Map, JSON, URLSearchParams,
    state: { cashSession: { open: true }, orders: [], syncQueue: [] },
    selfOrderCart: [{ name: 'Latte', qty: 1, price: 25000 }],
    selfOrderSubmitting: false, selfOrderSubmitStartedAt: 0, selfOrderSubmitError: '',
    homeCheckoutErrors: {}, homeCheckoutValidationAttempted: false,
    HOME_CHECKOUT_KEY: 'checkout', CustomerOrder: { captureCheckout: noop },
    window: { setTimeout: callback => callback() },
    sessionStorage: { setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
    toast: noop, render: noop, saveState: noop, homeResetCheckoutValidation: noop,
    homeCheckout: () => checkout, homeHasPinnedLocation: () => true,
    homeParams: () => ({search:new URLSearchParams(options.origin ? `origin=${options.origin}` : '')}),
    canAttemptSupabaseSync: () => options.online !== false,
    selfOrderSubtotal: () => 25000,
    homeDeliveryQuote: () => ({ distanceKm: 4.435, fee: 12500 }),
    getSupabaseServerTimeIso: async () => '2026-11-12T08:00:00Z',
    homeGenerateNumber: prefix => prefix + '999', homeGenerateToken: () => 'fixture-token',
    homeGoogleMapsUrl: () => 'fixture-pin', homeCoordinate: value => value,
    tagOrderBatchItems: items => items, uid: () => 'fixture-order',
    homeStartDriverSearchSession: noop,
    validateLimitedStockItems: () => ({ ok: true }),
    commitLimitedStockReservations: async () => ({ accepted: true, token: 'reserved' }),
    submitSelfOrderConfirmed: async order => { writes.push(order); order.supabaseId = 'fixture-db'; return options.synced !== false; },
    homeSyncOrderExtras: async () => true,
    restoreLimitedStockCommit: async (...args) => restored.push(args),
    orderSyncQueueId: order => order.id,
    audit: noop, homeMoney: value => `Rp ${value}`, homeOrderTotal: order => order.grandTotal,
    saveSelfOrderCart: noop, homeSaveActiveOrder: noop, pushSelfOrderHistory: noop,
    rotateLimitedStockReservationToken: noop, loadMasterDataFromSupabase: async () => true,
    broadcastRealtimeEvent: noop, homePaymentProvider: () => 'duitku',
    ...options.globals
  });
  load(ctx, home, ['homeIsOrder', 'homeIsPayLaterOrder', 'homeKitchenBlocked', 'homeValidateCheckout', 'homeCreateWaitingPayment'], '  ');
  vm.runInContext('const PaymentService = { createPayment() { throw Error("Cash must not call gateway"); } };', ctx);
  return { ctx, checkout, storage, writes, restored };
}

test('pickup origin is stored in service info for POS and survives synchronization', async () => {
  for (const [origin,label] of [['home','Takeaway-Rumah'],['outlet','Takeaway Outlet']]) {
    const env=setup('PICKUP_PREORDER',{origin});
    await env.ctx.homeCreateWaitingPayment();
    assert.equal(env.writes[0].serviceInfo,label);
    assert.equal(env.writes[0].customerOrderType,'PICKUP_PREORDER');
  }
});

test('pickup and delivery checkouts do not write orders or reserve stock outside online hours', async () => {
  for (const method of ['PICKUP_PREORDER', 'DELIVERY']) {
    const env = setup(method);
    env.ctx.window.FresinOnlineHours = { check: async () => false };
    await env.ctx.homeCreateWaitingPayment();
    assert.equal(env.writes.length, 0);
    assert.equal(env.ctx.selfOrderCart.length, 1);
    assert.equal(env.ctx.selfOrderSubmitting, false);
  }
});

for (const method of ['PICKUP_PREORDER', 'DELIVERY']) {
  test(`${method}: confirmed unpaid submission uses cash and preserves correct totals`, async () => {
    const env = setup(method);
    await env.ctx.homeCreateWaitingPayment();
    const order = env.writes[0];
    assert.ok(order, env.ctx.selfOrderSubmitError);
    assert.equal(order.paymentStatus, 'Belum dibayar');
    assert.equal(order.confirmedAt, null);
    assert.equal(order.subtotal, 25000);
    assert.equal(order.deliveryFee, method === 'DELIVERY' ? 12500 : 0);
    assert.equal(order.deliveryDistanceKm, method === 'DELIVERY' ? 4.435 : null);
    assert.equal(order.grandTotal, method === 'DELIVERY' ? 37500 : 25000);
    assert.equal(order.paymentProvider, method === 'DELIVERY' ? 'courier_cash' : 'cash_at_outlet');
    assert.equal(order.customerOrderStatus, method === 'DELIVERY' ? 'SEARCHING_DRIVER' : 'WAITING_ACCEPTANCE');
    assert.equal(order.note, 'Tanpa gula', 'POS notes must contain only the original customer text');
    if (method === 'DELIVERY') assert.equal(order.deliveryNote, 'Alamat fixture');
    if (method !== 'DELIVERY') assert.equal(order.pickupTime, '17:30');
    assert.equal(env.storage.get('self_order_step'), 'success');
    assert.equal(env.ctx.selfOrderCart.length, 0);
    assert.equal(env.ctx.selfOrderSubmitting, false);
  });
  test(`${method}: failed confirmation keeps cart and restores reserved stock`, async () => {
    const env = setup(method, { synced: false });
    await env.ctx.homeCreateWaitingPayment();
    assert.equal(env.ctx.selfOrderCart.length, 1);
    assert.equal(env.ctx.state.orders.length, 0);
    assert.equal(env.storage.has('self_order_step'), false);
    assert.equal(env.restored[0][1], 'submit_failed');
    assert.match(env.ctx.selfOrderSubmitError, /Gagal/);
  });
}

test('a failed server-number allocation keeps checkout and cart without committing stock or an order', async () => {
  let stockWrites = 0;
  const env = setup('DELIVERY', { globals: {
    homeGenerateNumber: async () => { throw { userMessage: 'Belum bisa menyiapkan nomor pesanan.' }; },
    commitLimitedStockReservations: async () => { stockWrites += 1; }
  } });
  await env.ctx.homeCreateWaitingPayment();
  assert.equal(env.ctx.selfOrderCart.length, 1);
  assert.equal(env.ctx.state.orders.length, 0);
  assert.equal(env.writes.length, 0);
  assert.equal(stockWrites, 0);
  assert.equal(env.checkout.note, 'Tanpa gula');
  assert.equal(env.ctx.selfOrderSubmitting, false);
  assert.match(env.ctx.selfOrderSubmitError, /nomor pesanan/);
});

test('checkout does not accept malformed pickup time and does accept optional time', () => {
  const env = setup();
  for (const pickupTime of ['', 'Secepatnya', '00:00', '23:59']) assert.equal(env.ctx.homeValidateCheckout({ ...env.checkout, pickupTime }).PickupTime, undefined);
  for (const pickupTime of ['24:01', '12:99', '<script>']) assert.ok(env.ctx.homeValidateCheckout({ ...env.checkout, pickupTime }).PickupTime);
});

test('pickup timing switches explicitly between Now and a scheduled time without losing checkout fields', () => {
  const env = setup();
  let renders = 0, pickerCalls = 0;
  Object.assign(env.ctx, {
    document: { getElementById: () => ({ showPicker: () => { pickerCalls += 1; } }) },
    homeSetCheckout: patch => Object.assign(env.checkout, patch),
    homeClearCheckoutErrors: () => {}, render: () => { renders += 1; }
  });
  load(env.ctx, home, ['homeSetPickupTiming', 'homeOpenPickupTimePicker'], '  ');
  env.ctx.homeSetPickupTiming('now');
  assert.equal(env.checkout.pickupTime, 'Secepatnya');
  assert.equal(env.checkout.pickupTiming, 'now');
  assert.equal(pickerCalls, 0);
  env.ctx.homeSetPickupTiming('scheduled');
  assert.equal(env.checkout.pickupTiming, 'scheduled');
  assert.equal(env.checkout.pickupTime, '');
  assert.ok(env.ctx.homeValidateCheckout(env.checkout).PickupTime);
  env.checkout.pickupTime = '18:45';
  assert.equal(env.ctx.homeValidateCheckout(env.checkout).PickupTime, undefined);
  assert.equal(env.checkout.name, 'Pelanggan fixture');
  assert.equal(env.checkout.note, 'Tanpa gula');
  assert.equal(renders, 2);
  assert.equal(pickerCalls, 1);
});

test('pickup time uses the device picker and keeps keyboard focus as a fallback', () => {
  const env = setup();
  let focused = 0;
  let input = { focus: () => { focused += 1; } };
  env.ctx.document = { getElementById: id => id === 'customerHomePickupTime' ? input : null };
  load(env.ctx, home, ['homeOpenPickupTimePicker'], '  ');
  env.ctx.homeOpenPickupTimePicker();
  assert.equal(focused, 1);
  input.showPicker = () => { throw Error('Picker unavailable in this context'); };
  env.ctx.homeOpenPickupTimePicker();
  assert.equal(focused, 2);
  input = null;
  assert.doesNotThrow(() => env.ctx.homeOpenPickupTimePicker());
  assert.equal(env.checkout.pickupTime, '17:30');
});

test('cash acceptance releases unpaid kitchen orders, legacy prepayment still blocks', () => {
  const env = setup();
  env.ctx.homeIsPaid = order => order.paymentStatus === 'Lunas';
  env.ctx.homeCustomerStatus = order => order.customerOrderStatus;
  const order = { customerOrderType: 'PICKUP_PREORDER', paymentProvider: 'cash_at_outlet', status: 'Pesanan Baru', paymentStatus: 'Belum dibayar' };
  assert.equal(env.ctx.homeKitchenBlocked(order), true);
  assert.equal(env.ctx.homeKitchenBlocked({ ...order, confirmedAt: 'confirmed' }), false);
  assert.equal(env.ctx.homeKitchenBlocked({ ...order, paymentProvider: 'duitku', confirmedAt: 'confirmed' }), true);
});

test('cash pickup and assigned delivery appear unpaid in POS; searching delivery and legacy prepaid do not', () => {
  const ctx = vm.createContext({ orderIsPaid: order => order.paymentStatus === 'Lunas' });
  load(ctx, core, ['orderIsCustomerHomeOrder', 'orderUsesOutletPayment', 'orderVisibleInPosOrderList']);
  const pickup = { customerOrderType: 'PICKUP_PREORDER', paymentProvider: 'cash_at_outlet' };
  assert.equal(ctx.orderVisibleInPosOrderList(pickup), true);
  assert.equal(ctx.orderVisibleInPosOrderList({ ...pickup, paymentProvider: 'duitku' }), false);
  const delivery = { customerOrderType: 'DELIVERY', paymentProvider: 'courier_cash', customerOrderStatus: 'SEARCHING_DRIVER' };
  assert.equal(ctx.orderVisibleInPosOrderList(delivery), false);
  assert.equal(ctx.orderVisibleInPosOrderList({ ...delivery, driverId: 'driver' }), false);
  assert.equal(ctx.orderVisibleInPosOrderList({ ...delivery, driverId: 'driver', customerOrderStatus:'DRIVER_ASSIGNED', confirmedAt:'confirmed' }), true);
});

test('manual providers cannot create or expire a Duitku payment', async () => {
  const ctx = vm.createContext({ homePaymentProvider: () => 'duitku', homeIsOrder: () => true, homeOrderTotal: () => 35000 });
  load(ctx, home, ['homeIsPayLaterOrder'], '  ');
  const start = home.indexOf('  const PaymentService = {');
  const end = home.indexOf('\n  function PaymentQRCode', start);
  vm.runInContext(home.slice(start, end) + '\nthis.service = PaymentService;', ctx);
  for (const paymentProvider of ['cash_at_outlet', 'courier_cash']) {
    const order = { paymentProvider };
    assert.equal(ctx.service.createPayment(order).status, 'manual');
    assert.equal(await ctx.service.ensurePayment(order), false);
    assert.equal(ctx.service.expirePayment(order), false);
    assert.equal(order.customerOrderStatus, undefined);
  }
});

test('courier cash delivery fee remains earned but cannot be claimed from wallet', () => {
  const orders = [{ payment_provider: 'courier_cash', delivery_fee: 10000 }, { payment_provider: 'duitku', delivery_fee: 7000 }];
  const ctx = vm.createContext({ completedOrdersForMonth: () => orders, walletMonthKey: () => '2026-11' });
  load(ctx, driver, ['isCourierCash', 'claimableOrdersForMonth'], '  ');
  assert.equal(ctx.claimableOrdersForMonth().length, 1);
  assert.equal(ctx.claimableOrdersForMonth()[0].payment_provider, 'duitku');
  assert.equal(orders.reduce((sum, order) => sum + order.delivery_fee, 0), 17000);
});

test('courier cannot bring an unpaid cash order out of the outlet', async () => {
  const order = { id: 'delivery', payment_provider: 'courier_cash', payment_status: 'Belum dibayar' };
  const ctx = vm.createContext({ state: { orders: [order] }, hasProfile: () => true,
    driverMatches: () => true, kitchenReady: () => true, effectiveOrderStatus: () => 'DELIVERING', render() {} });
  load(ctx, driver, ['driverOrderCancelled', 'isCourierCash', 'isPaidOrder', 'runAction'], '  ');
  for (const action of ['picked', 'delivering', 'complete']) {
    await ctx.runAction(action, order.id);
    assert.match(ctx.state.error, /kasir mencatat pelunasannya/);
    assert.equal(order.payment_status, 'Belum dibayar');
  }
});

test('a late driver search update uses a compare-and-set and refreshes a concurrent assignment', async () => {
  const calls = [];
  let task, refreshed = false;
  const query = {
    update: value => { calls.push(['update', value]); return query; },
    eq: (...args) => { calls.push(['eq', ...args]); return query; },
    in: (...args) => { calls.push(['in', ...args]); return query; },
    or: value => { calls.push(['or', value]); return query; },
    select: () => query, maybeSingle: async () => ({ data: null, error: null })
  };
  const ctx = vm.createContext({
    console, window: { setTimeout: fn => { task = fn(); } },
    homeIsPayLaterOrder: () => true, supabaseClient: { from: () => query },
    homeRefreshActiveOrderFromSupabase: async () => { refreshed = true; }
  });
  load(ctx, home, ['homeQueueDriverSearchSync'], '  ');
  ctx.homeQueueDriverSearchSync({ supabaseId: 'remote', customerOrderStatus: 'NO_DRIVER_AVAILABLE', updatedAt: 'now' });
  await task;
  assert.ok(calls.some(call => call[0] === 'in' && call[1] === 'customer_order_status'));
  assert.ok(calls.some(call => call[0] === 'or' && call[1] === 'driver_id.is.null,driver_id.eq.'));
  assert.equal(refreshed, true);
  assert.equal(Object.hasOwn(calls[0][1], 'driver_id'), false);
});

test('delivery without a route quote cannot reserve stock or create an order', async () => {
  const env = setup('DELIVERY', { globals: {
    homeDeliveryQuote: () => null,
    commitLimitedStockReservations: async () => assert.fail('Unexpected stock reservation')
  } });
  await env.ctx.homeCreateWaitingPayment();
  assert.equal(env.writes.length, 0);
  assert.equal(env.ctx.selfOrderCart.length, 1);
  assert.match(env.ctx.selfOrderSubmitError, /ongkir rute motor/);
});
