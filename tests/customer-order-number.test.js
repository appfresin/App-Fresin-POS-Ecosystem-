const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const publishedFiles = {
  'app.js': 'deploy-ready/pos/app.js',
  'SO Takeaway/so-takeaway.js': 'deploy-ready/pos/SO Takeaway/so-takeaway.js',
  'delivery/Customer Order/customer-order.js': 'deploy-ready/delivery/Customer Order/customer-order.js',
  'driver/Driver Order/driver-order.js': 'deploy-ready/driver/Driver Order/driver-order.js'
};

function fn(file, name, indent = '') {
  const source = fs.readFileSync(fs.existsSync(file) ? file : publishedFiles[file], 'utf8');
  const match = new RegExp(`${indent}(?:async )?function ${name}\\(`).exec(source);
  assert.ok(match, name);
  const next = new RegExp(`\n${indent}(?:async )?function \\w+\\(`).exec(source.slice(match.index + match[0].length));
  return source.slice(match.index, next ? match.index + match[0].length + next.index : source.length);
}

test('fresh devices allocate distinct delivery numbers from the server, ignoring local D001', async () => {
  let number = 6;
  const seen = [];
  const rpc = async (name, args) => {
    seen.push([name, args.p_prefix]);
    return { data: `${args.p_prefix}${String(++number).padStart(3, '0')}`, error: null };
  };
  const devices = Array.from({ length: 3 }, () => {
    const ctx = vm.createContext({ console, state: { orders: [] }, supabaseClient: { rpc } });
    vm.runInContext(fn('delivery/Customer Order/customer-order.js', 'homeGenerateNumber', '  '), ctx);
    return ctx;
  });
  const allocated = await Promise.all(devices.map(device => device.homeGenerateNumber('D')));
  assert.deepEqual(allocated, ['D007', 'D008', 'D009']);
  assert.deepEqual(seen, Array(3).fill(['allocate_customer_order_number', 'D']));
});

test('number allocation never falls back to a device-local number on network or malformed responses', async () => {
  const ctx = vm.createContext({ console: { warn() {} }, supabaseClient: {} });
  vm.runInContext(fn('delivery/Customer Order/customer-order.js', 'homeGenerateNumber', '  '), ctx);
  for (const result of [{ data: null, error: { code: 'network' } }, { data: 'D001<script>' }, { data: 'P001' }]) {
    ctx.supabaseClient.rpc = async () => result;
    await assert.rejects(ctx.homeGenerateNumber('D'), error => /nomor pesanan/.test(error.userMessage));
  }
  await assert.rejects(ctx.homeGenerateNumber('X'), /tidak valid/);
});

function upsertEnv(current) {
  const writes = [];
  const builder = {
    select() { return this; }, eq() { return this; },
    maybeSingle: async () => ({ data: current, error: null }),
    insert(payload) { writes.push(['insert', payload]); return this; },
    update(payload) { writes.push(['update', payload]); return this; },
    single: async () => ({ data: { id: current?.id || 'new-order' }, error: null })
  };
  const ctx = vm.createContext({ supabaseClient: { from: () => builder },
    supabaseSupportsPreparedItems: true, supabaseSupportsOrderNotificationCategories: true });
  vm.runInContext(fn('app.js', 'upsertSupabaseOrderPayload'), ctx);
  return { ctx, writes };
}

test('fresh takeaway devices reserve distinct T numbers from the server before creating orders', async () => {
  let next = 1;
  const calls = [];
  const devices = Array.from({ length: 3 }, () => {
    const ctx = vm.createContext({ state: { orders: [] }, supabaseClient: {
      rpc: async (name, args) => {
        calls.push([name, args.p_prefix]);
        return { data: `T${String(++next).padStart(3, '0')}`, error: null };
      }
    } });
    vm.runInContext(fn('SO Takeaway/so-takeaway.js', 'soTakeawayGenerateNumber', '  '), ctx);
    return ctx;
  });
  assert.deepEqual(await Promise.all(devices.map(device => device.soTakeawayGenerateNumber())), ['T002','T003','T004']);
  assert.deepEqual(calls, Array(3).fill(['allocate_customer_order_number','T']));
});

test('takeaway allocation rejects network failures and malformed numbers instead of reusing local T001', async () => {
  const ctx = vm.createContext({ state: { orders: [] }, supabaseClient: {} });
  vm.runInContext(fn('SO Takeaway/so-takeaway.js', 'soTakeawayGenerateNumber', '  '), ctx);
  for (const result of [{data:null,error:{code:'network'}},{data:'P001'},{data:'T001<script>'}]) {
    ctx.supabaseClient.rpc = async () => result;
    await assert.rejects(Promise.resolve().then(()=>ctx.soTakeawayGenerateNumber()), error=>/nomor pesanan/.test(error.userMessage));
  }
});

test('another customer with the same paid or unpaid number cannot overwrite the old order', async () => {
  for (const payment_status of ['Lunas', 'Belum dibayar']) {
    const env = upsertEnv({ id: 'old', payment_status, public_order_token: 'old-token' });
    const result = await env.ctx.upsertSupabaseOrderPayload({ order_number: 'D001', payment_status: 'Belum dibayar' },
      { publicOrderToken: 'new-token' });
    assert.equal(result.error.code, 'ORDER_NUMBER_CONFLICT');
    assert.deepEqual(env.writes, []);
  }
});

test('the same customer token can retry an incomplete creation, and existing paid-order protection remains', async () => {
  const env = upsertEnv({ id: 'old', payment_status: 'Belum dibayar', public_order_token: 'same-token' });
  const result = await env.ctx.upsertSupabaseOrderPayload({ order_number: 'D007', payment_status: 'Belum dibayar' },
    { publicOrderToken: 'same-token' });
  assert.equal(result.data.id, 'old');
  assert.equal(env.writes[0][0], 'update');
  const paid = upsertEnv({ id: 'paid', payment_status: 'Lunas', public_order_token: 'same-token' });
  assert.equal((await paid.ctx.upsertSupabaseOrderPayload({ order_number: 'D007', payment_status: 'Belum dibayar' },
    { supabaseId: 'paid' })).error.code, 'ORDER_ALREADY_PAID');
  assert.deepEqual(paid.writes, []);
});

test('a legacy takeaway without a token or server ID cannot overwrite another customer by T001 alone', async () => {
  for (const payment_status of ['Lunas','Belum dibayar']) {
    const env = upsertEnv({id:'original-customer',payment_status,public_order_token:null});
    const result = await env.ctx.upsertSupabaseOrderPayload({order_number:'T001',payment_status:'Belum dibayar'},
      {source:'Self Order',type:'Take Away',orderMode:'TAKEAWAY'});
    assert.equal(result.error?.code,'ORDER_NUMBER_CONFLICT');
    assert.deepEqual(env.writes,[]);
  }
});

test('a takeaway with its matching server ID or creation token can retry without being mistaken for another customer', async () => {
  for (const identity of [{supabaseId:'same-order'},{publicOrderToken:'same-token'}]) {
    const env = upsertEnv({id:'same-order',payment_status:'Belum dibayar',public_order_token:'same-token'});
    const result = await env.ctx.upsertSupabaseOrderPayload({order_number:'T002',payment_status:'Belum dibayar'},identity);
    assert.equal(result.data.id,'same-order');
    assert.equal(env.writes[0][0],'update');
  }
});

test('completing a driver order stays in Order even when finishing from detail', async () => {
  for (const file of ['driver/Driver Order/driver-order.js', 'deploy-ready/driver/Driver Order/driver-order.js']) {
    const order = { id: 'delivery', customer_order_status: 'DELIVERING', status: 'Selesai' };
    const ctx = vm.createContext({ state: { orders: [order], profile: { id: 'driver' }, view: 'active', selectedId: 'delivery' },
      hasProfile: () => true, driverOrderCancelled: () => false, driverMatches: () => true,
      kitchenReady: () => true, effectiveOrderStatus: () => 'DELIVERING', isCourierCash: () => false,
      render() {}, updateOrder: async (order, patch) => Object.assign(order, patch),
      fetchOrders: async () => {}, localStorage: { setItem() {} }, VIEW_KEY: 'view', console });
    vm.runInContext(fn(file, 'runAction', '  '), ctx);
    await ctx.runAction('complete', 'delivery');
    assert.equal(order.customer_order_status, 'COMPLETED');
    assert.equal(ctx.state.view, 'active');
    assert.equal(ctx.state.selectedId, '');
  }
});
