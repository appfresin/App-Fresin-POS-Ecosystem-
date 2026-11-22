const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function setup(file) {
  const local = path.join(__dirname, '..', file);
  const source = readFileSync(existsSync(local) ? local : path.join(__dirname, '../deploy-ready', file), 'utf8');
  const now = Date.now();
  let order = {
    id: 'local', supabaseId: 'remote', number: 'D123', customerOrderType: 'DELIVERY',
    paymentProvider: 'courier_cash', paymentStatus: 'Belum dibayar', status: 'Pesanan Baru',
    customerOrderStatus: 'SEARCHING_DRIVER', driverId: '',
    driverSearchStartedAt: new Date(now - 360000).toISOString(),
    driverSearchExpiresAt: new Date(now - 60000).toISOString()
  };
  let row = { id: 'remote', order_number: 'D123', customer_order_status: 'DRIVER_ASSIGNED',
    customer_order_type: 'DELIVERY', payment_provider: 'courier_cash', driver_id: 'driver-1',
    payment_status: 'Belum dibayar', status: 'Sedang Disiapkan', updated_at: new Date(now).toISOString() };
  const writes = [], reads = [], paints = [], timers = [];
  let readGate, writeGate, readError, step = 'success';
  const query = (table, operation = 'read', payload) => {
    const filters = [];
    const q = {
      select() { return q; }, eq(...args) { filters.push(['eq', ...args]); return q; },
      or(...args) { filters.push(['or', ...args]); return q; },
      order() { return q; }, limit() { return q; },
      update(value) { return query(table, 'update', value); },
      maybeSingle() { return q; },
      async then(resolve, reject) {
        try {
          if (operation === 'update') {
            writes.push({ payload, filters });
            const result = writeGate ? await writeGate.promise : { data: { ...row, ...payload }, error: null };
            if (result.data) row = result.data;
            return resolve(result);
          }
          if (table !== 'orders') return resolve({ data: [], error: null });
          reads.push(table);
          const result = readGate ? await readGate.promise : { data: [row], error: readError || null };
          return resolve(result);
        } catch (error) { return reject(error); }
      }
    };
    return q;
  };
  const ctx = vm.createContext({
    console: { warn() {} }, Date, Map, URLSearchParams,
    HOME_DRIVER_SEARCH_DURATION_MS: 300000, HOME_STATUS_REFRESH_MS: 15000,
    homeStatusRefreshLoading: false, homeStatusRefreshAt: 0,
    homeStatusNeedsRefresh: true, homeStatusRefreshFailed: false, homeStatusRefreshRevision: 0,
    homeDriverSearchTickTimer: null,
    document: { hidden: false },
    window: { setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {} },
    location: { search: '' },
    homeIsMode: () => true, selfOrderStep: () => step, supabaseReadable: () => true,
    homeCurrentOrder: () => order, homeOrderKind: order => order.customerOrderType,
    homeIsPaid: order => order.paymentStatus === 'Lunas', homeIsPayLaterOrder: () => true,
    homeCustomerStatus: order => order.customerOrderStatus,
    homeLifecycleCustomerStatus: order => order.status === 'Sedang Disiapkan' ? 'PREPARING' : '',
    homePreferAdvancedCustomerStatus: (stored, live) => live || stored,
    normalizeSupabaseLiveOrder: row => ({ id: 'local', supabaseId: row.id, number: row.order_number || 'D123',
      status: row.status, paymentStatus: row.payment_status, customerOrderStatus: row.customer_order_status }),
    mergeSupabaseLiveOrders: orders => { order = orders[0]; },
    homePaymentUrlFromPayload: () => '', saveState() {}, broadcastRealtimeEvent() {},
    homeEscape: value => String(value || ''), homeRenderSupportContact: () => '',
    homeRenderCashStatus: order => `<p>${order.customerOrderStatus}</p>`,
    homeRenderOrdersList: () => '', homeQueueDriverSearchSync() { throw Error('Unexpected optimistic sync'); },
    render() { paints.push(ctx.homeRenderStatus()); },
    supabaseClient: { from: table => query(table) }
  });
  const names = ['homeDriverSearchTimestamp', 'homeDriverSearchRemainingMs', 'homeStartDriverSearchSession',
    'homeExpireDriverSearchSession', 'homeEnsureDriverSearchSession', 'homeStatusIsFinal', 'homeRefreshActiveOrderFromSupabase',
    'homeScheduleDriverSearchTick', 'homeRenderStatus', 'homeRenderStatusSync', 'homeResumeOrderStatus'];
  for (const name of names) {
    const fn = source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`, 'm'));
    assert.ok(fn, name);
    vm.runInContext(fn[0], ctx);
  }
  return { ctx, writes, reads, paints, timers, get order() { return order; },
    set step(value) { step = value; },
    set row(value) { row = { ...row, ...value }; },
    set readGate(value) { readGate = value; }, set writeGate(value) { writeGate = value; },
    set readError(value) { readError = value; } };
}

for (const file of ['delivery/Customer Order/customer-order.js', 'deploy-ready/delivery/Customer Order/customer-order.js']) {

  test(`${file}: polling stops for paid completed and cancelled orders, with a fresh read on reopen`, async () => {
    const env = setup(file);
    Object.assign(env.order, { customerOrderStatus: 'COMPLETED', paymentStatus: 'Lunas' });
    env.row = { customer_order_status: 'COMPLETED', payment_status: 'Lunas', status: 'Selesai' };
    assert.equal(await env.ctx.homeRefreshActiveOrderFromSupabase(), false);
    assert.equal(env.reads.length, 0);
    assert.equal(env.ctx.homeResumeOrderStatus({ switched: true }), true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(env.reads.length, 1);
    assert.equal(await env.ctx.homeRefreshActiveOrderFromSupabase(), false);
    env.order.customerOrderStatus = 'CANCELLED';
    env.order.paymentStatus = 'Belum dibayar';
    env.ctx.homeStatusRefreshAt = 0;
    assert.equal(await env.ctx.homeRefreshActiveOrderFromSupabase(), false);
    assert.equal(env.reads.length, 1);
  });

  test(`${file}: delivery still polls after kitchen readiness and pickup still polls until paid`, async () => {
    const env = setup(file);
    Object.assign(env.order, { customerOrderStatus: 'READY_FOR_PICKUP', status: 'Selesai', paymentStatus: 'Lunas' });
    assert.equal(await env.ctx.homeRefreshActiveOrderFromSupabase(), true);
    Object.assign(env.order, { customerOrderType: 'PICKUP_PREORDER', customerOrderStatus: 'COMPLETED', paymentStatus: 'Belum dibayar' });
    env.ctx.homeStatusRefreshAt = 0;
    assert.equal(await env.ctx.homeRefreshActiveOrderFromSupabase(), true);
    env.step = 'menu';
    env.ctx.homeStatusRefreshAt = 0;
    assert.equal(await env.ctx.homeRefreshActiveOrderFromSupabase(), false);
    assert.equal(env.reads.length, 2);
  });

  test(`${file}: expired cached radar waits for the assigned driver on resume`, async () => {
    const env = setup(file), gate = deferred();
    env.readGate = gate;
    env.ctx.render();
    assert.match(env.paints.at(-1), /Memperbarui status pesanan/);
    assert.doesNotMatch(env.paints.at(-1), /NO_DRIVER_AVAILABLE|Coba Cari Driver Lagi/);
    assert.equal(env.order.customerOrderStatus, 'SEARCHING_DRIVER');
    const refresh = env.ctx.homeRefreshActiveOrderFromSupabase({ force: true });
    env.ctx.render();
    assert.match(env.paints.at(-1), /Memperbarui status pesanan/);
    gate.resolve({ data: [{ id: 'remote', customer_order_status: 'DRIVER_ASSIGNED', driver_id: 'driver-1', status: 'Sedang Disiapkan' }], error: null });
    await refresh;
    assert.equal(env.order.driverId, 'driver-1');
    assert.match(env.paints.at(-1), /PREPARING/);
    assert.equal(env.writes.length, 0);
  });

  test(`${file}: failure is displayed only after the server confirms expiry`, async () => {
    const env = setup(file), gate = deferred();
    env.row = { customer_order_status: 'SEARCHING_DRIVER', driver_id: '', status: 'Pesanan Baru', updated_at: env.order.driverSearchStartedAt };
    env.writeGate = gate;
    const refresh = env.ctx.homeRefreshActiveOrderFromSupabase({ force: true });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(env.writes.length, 1);
    env.ctx.render();
    assert.match(env.paints.at(-1), /Memperbarui status pesanan/);
    assert.equal(env.order.customerOrderStatus, 'SEARCHING_DRIVER');
    gate.resolve({ data: { id: 'remote', customer_order_status: 'NO_DRIVER_AVAILABLE', driver_id: '', status: 'Pesanan Baru' }, error: null });
    await refresh;
    assert.match(env.paints.at(-1), /NO_DRIVER_AVAILABLE/);
    assert.ok(env.writes[0].filters.some(filter => filter[0] === 'or' && filter[1] === 'driver_id.is.null,driver_id.eq.'));
    assert.ok(env.writes[0].filters.some(filter => filter[0] === 'eq' && filter[1] === 'customer_order_status' && filter[2] === 'SEARCHING_DRIVER'));
    assert.equal(Object.hasOwn(env.writes[0].payload, 'driver_id'), false);
  });

  test(`${file}: a driver accepting during expiry wins the conditional update`, async () => {
    const env = setup(file), gate = deferred();
    env.row = { customer_order_status: 'SEARCHING_DRIVER', driver_id: '', status: 'Pesanan Baru', updated_at: env.order.driverSearchStartedAt };
    env.writeGate = gate;
    const refresh = env.ctx.homeRefreshActiveOrderFromSupabase({ force: true });
    await new Promise(resolve => setImmediate(resolve));
    env.row = { customer_order_status: 'DRIVER_ASSIGNED', driver_id: 'driver-1' };
    gate.resolve({ data: null, error: null });
    await refresh;
    assert.equal(env.order.customerOrderStatus, 'DRIVER_ASSIGNED');
    assert.equal(env.order.driverId, 'driver-1');
    assert.ok(env.paints.every(html => !html.includes('NO_DRIVER_AVAILABLE')));
  });

  test(`${file}: offline resumption never turns a cached search into failure`, async () => {
    const env = setup(file);
    env.order.customerOrderStatus = 'NO_DRIVER_AVAILABLE';
    env.readError = new Error('offline');
    await env.ctx.homeRefreshActiveOrderFromSupabase({ force: true });
    env.ctx.render();
    assert.match(env.paints.at(-1), /Status(?: pesanan)? belum (?:dapat )?diperbarui/);
    assert.doesNotMatch(env.paints.at(-1), /NO_DRIVER_AVAILABLE|Coba Cari Driver Lagi/);
    assert.equal(env.writes.length, 0);
    env.readError = null;
    await env.ctx.homeRefreshActiveOrderFromSupabase({ force: true });
    assert.equal(env.ctx.homeStatusNeedsRefresh, false);
    assert.equal(env.order.driverId, 'driver-1');
  });

  test(`${file}: a newer search session on the server replaces the old cached timer`, async () => {
    const env = setup(file);
    const startedAt = new Date().toISOString();
    env.row = { customer_order_status: 'SEARCHING_DRIVER', driver_id: '', status: 'Pesanan Baru', updated_at: startedAt };
    await env.ctx.homeRefreshActiveOrderFromSupabase({ force: true });
    assert.equal(env.writes.length, 0);
    assert.equal(env.ctx.homeStatusNeedsRefresh, false);
    assert.equal(env.order.driverSearchStartedAt, startedAt);
    assert.ok(env.ctx.homeDriverSearchRemainingMs(env.order) > 290000);
    assert.match(env.paints.at(-1), /SEARCHING_DRIVER/);
  });

  test(`${file}: backgrounding invalidates an unfinished status request`, async () => {
    const env = setup(file), gate = deferred();
    env.readGate = gate;
    const refresh = env.ctx.homeRefreshActiveOrderFromSupabase({ force: true });
    env.ctx.document.hidden = true;
    env.ctx.homeResumeOrderStatus();
    gate.resolve({ data: [{ id: 'remote', customer_order_status: 'NO_DRIVER_AVAILABLE' }], error: null });
    await refresh;
    assert.equal(env.order.customerOrderStatus, 'SEARCHING_DRIVER');
    assert.equal(env.writes.length, 0);
    env.ctx.homeScheduleDriverSearchTick();
    assert.equal(env.ctx.homeDriverSearchTickTimer, null);
    assert.equal(env.ctx.homeStatusNeedsRefresh, true);
  });
}
