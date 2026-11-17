const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.join(__dirname, '..');
function sourcePath(file) {
  const local = path.join(root,file);
  if(fs.existsSync(local))return local;
  const mapped=file==='app.js'?'pos/app.js':file==='self-order.html'?'self-order/index.html':file;
  return path.join(root,'deploy-ready',mapped);
}
const entry = sourcePath('Customer Gateway/customer-gateway.js');
const source = fs.existsSync(entry) ? fs.readFileSync(entry, 'utf8') : '';
const pendingKey = 'fresin_gateway_handoff_v1';

function setup(options = {}) {
  let url = new URL(options.url || 'https://www.fresin.id/self-order/?mode=takeaway');
  const storage = new Map(Object.entries(options.storage || {}));
  storage.set('self_order_step', options.step || 'menu');
  const navigations = [], messages = [], methods = [], historyEntries = [], frames = [];
  const listeners = {};
  const location = { get href() { return url.href; }, get pathname() { return url.pathname; },
    get search() { return url.search; }, get hash() { return url.hash; }, get origin() { return url.origin; },
    assign(value) { navigations.push(String(value)); } };
  const history = { state: options.history || null,
    replaceState(value, _, href) { this.state = value; if (href) url = new URL(href, url); },
    pushState(value, _, href) { historyEntries.push(value); this.state = value; if (href) url = new URL(href, url); } };
  const window = { FRESIN_PICKUP_URL: options.pickupUrl || '/self-order/',
    FRESIN_GATEWAY_BOOT_PENDING: options.bootPending === true,
    addEventListener: (name, callback) => { listeners[name] = callback; },
    setTimeout: callback => callback() };
  const sessionStorage = { getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
  const ctx = vm.createContext({ window, location, history, sessionStorage, URL, URLSearchParams, Date, console,
    performance: { getEntriesByType: () => options.navigationType ? [{ type: options.navigationType }] : [] },
    IS_SELF_ORDER_APP: options.standalone !== false, view: options.standalone === false ? 'pos' : 'selforder',
    selfOrderSubmitting: false, selfOrderCart: options.cart || [{ name: 'Latte', qty: 1, price: 20000 }],
    state: { settings: { selfOrderAppName: 'Fresin Indonesia' }, outlet: 'Outlet Utama' },
    document: { getElementById: () => null },
    escapeHtml: value => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    renderSelfOrder: () => '<section class="self-order-app"><main>EXISTING FLOW</main></section>',
    renderSelfOrderTopbar: () => '<header class="self-order-topbar">EXISTING HEADER</header>',
    selfOrderStep: () => storage.get('self_order_step') || 'menu',
    selfOrderTableCodeFromUrl: () => url.searchParams.get('table') || url.searchParams.get('meja') || '',
    saveSelfOrderCart: () => storage.set('omnipos_self_order_cart', JSON.stringify(ctx.selfOrderCart)),
    pushSelfOrderHistory(step) { history.pushState({ selfOrderStep: step }, '', location.href); },
    render() { if (!window.FRESIN_GATEWAY_BOOT_PENDING) frames.push(ctx.renderSelfOrder()); }, toast: value => messages.push(value)
  });
  if (options.engine === 'home') window.CustomerOrder = {
    isMode: () => true,
    setMethod: method => { methods.push(method); storage.set('customer_home_checkout', JSON.stringify({ method })); },
    showOrders: () => storage.set('self_order_step', 'success'),
    renderSupport: () => '<section id="customerHomeSupport">Support</section>'
  };
  else window.SOTakeaway = { isMode: () => !options.dineIn, showActiveOrder: () => storage.set('self_order_step', 'success') };
  vm.runInContext(source, ctx, { filename: 'fresin-customer-gateway.js' });
  assert.ok(window.FresinGateway, 'Gateway module must be installed');
  return { ctx, window, storage, navigations, messages, methods, history, historyEntries, listeners, frames };
}

test('initial customer render waits for gateway initialization and shows the gateway first', () => {
  const env = setup({ engine: 'home', url: 'https://www.fresin.id/pesan/', bootPending: true });
  assert.equal(env.window.FRESIN_GATEWAY_BOOT_PENDING, false);
  assert.equal(env.frames.length, 1);
  assert.match(env.frames[0], /fresin-gateway-hero/);
  assert.doesNotMatch(env.frames[0], /EXISTING FLOW/);
});

test('startup also releases for payment/status returns, existing checkout and dine-in', () => {
  for (const options of [
    { engine: 'home', url: 'https://www.fresin.id/delivery/?resultCode=00&reference=ref123', step: 'success' },
    { engine: 'home', url: 'https://www.fresin.id/order/status/token123', step: 'success' },
    { step: 'payment', history: { selfOrderStep: 'payment' } }
  ]) {
    const env = setup({ ...options, bootPending: true });
    assert.equal(env.window.FRESIN_GATEWAY_BOOT_PENDING, false);
    assert.equal(env.frames.length, 1);
    assert.match(env.frames[0], /EXISTING FLOW/);
  }
});

test('core rendering defers customer startup while POS rendering remains available', () => {
  for (const file of ['app.js', 'delivery/app.js', 'deploy-ready/pos/app.js', 'deploy-ready/self-order/app.js', 'deploy-ready/delivery/app.js']) {
    const core = fs.readFileSync(sourcePath(file), 'utf8');
    const start = core.indexOf('function render() {');
    const end = core.indexOf('\nfunction ', start + 1);
    assert.ok(start >= 0 && end > start, file);
    const paints = [];
    const context = vm.createContext({
      window: { FRESIN_GATEWAY_BOOT_PENDING: true }, IS_SELF_ORDER_APP: true,
      captureActiveModalDraft() {}, renderSelfOrderStandalone() { paints.push('customer'); },
      normalizeStaffState() {}, activeStaff: () => null,
      app: { innerHTML: '' }, renderStaffLoginScreen: () => 'POS_LOGIN'
    });
    vm.runInContext(core.slice(start, end), context);
    context.render();
    assert.deepEqual(paints, [], file + ': no menu may paint before the gateway loads');
    context.window.FRESIN_GATEWAY_BOOT_PENDING = false;
    context.render();
    assert.deepEqual(paints, ['customer'], file);
    context.IS_SELF_ORDER_APP = false;
    context.window.FRESIN_GATEWAY_BOOT_PENDING = true;
    context.render();
    assert.equal(context.app.innerHTML, 'POS_LOGIN', file);
  }
});

test('Take Away entry opens the approved gateway and reuses the existing header', () => {
  const env = setup();
  const html = env.ctx.renderSelfOrder();
  assert.match(html, /EXISTING HEADER/);
  assert.match(html.replace(/<[^>]*>/g, ''), /Fresin App/);
  assert.match(html, /Lebih mudah/);
  assert.match(html, /lebih cepat/);
  assert.match(html, /Ambil di toko/);
  assert.match(html, /Diantar/);
  assert.equal(env.storage.get('self_order_step'), 'gateway');
  assert.doesNotMatch(html, /self-order-bottom-nav/);
});

test('service cards use the rounded Store and Truck icon style from the Depot Air reference', () => {
  const env = setup({ engine: 'home' });
  const html = env.ctx.renderSelfOrder();
  assert.match(html, /data-icon="store"/);
  assert.match(html, /data-icon="truck"/);
  assert.match(html, /stroke-width="2"/);
  assert.match(html, /FresinGateway\.hideSupport\(\)/);
});

test('hero uses the Fresin profile logo, short greeting and multiple stars', () => {
  const env = setup();
  env.ctx.state.settings.selfOrderProfileImageDataUrl = 'https://example.test/fresin.webp';
  env.ctx.mediaImageTag = (url, alt) => `<img src="${url}" alt="${alt}">`;
  const html = env.ctx.renderSelfOrder();
  assert.match(html, /Selamat Datang di</);
  assert.doesNotMatch(html, /SELAMAT DATANG DI/);
  assert.match(html, /src="https:\/\/example\.test\/fresin\.webp" alt="Logo Fresin"/);
  assert.ok((html.match(/fresin-gateway-spark /g) || []).length >= 3);
  assert.doesNotMatch(html, /untuk<br>harimu/);
});

test('delivery information mentions Fresin drivers and fees and footer omits the outlet', () => {
  const env = setup();
  const html = env.ctx.renderSelfOrder();
  assert.match(html, /Pesanan diantarkan oleh driver Fresin ke alamatmu, dikenakan biaya antar\./);
  const footer = html.match(/<footer class="fresin-gateway-footer">([\s\S]*?)<\/footer>/)?.[1] || '';
  assert.match(footer, /Pesanan saya/);
  assert.doesNotMatch(footer, /Outlet Utama/);
});

test('empty orders have an illustrated empty cart and a safe menu action', () => {
  const customer = fs.readFileSync(sourcePath('delivery/Customer Order/customer-order.js'), 'utf8');
  const start = customer.indexOf('  function homeRenderOrdersEmptyState()');
  assert.ok(start >= 0, 'Empty order renderer must exist');
  const end = customer.indexOf('\n  function ', start + 3);
  const fn = customer.slice(start, end);
  const html = vm.runInNewContext(`${fn}; homeRenderOrdersEmptyState()`);
  assert.match(html, /customer-home-empty-cart-icon/);
  assert.match(html, /Belum ada pesanan/);
  assert.match(html, /selfOrderShowMenu\(\)/);
  assert.doesNotMatch(html, /createOrder|startNewOrder/);
});

test('Delivery and the new public entry also show both choices before the menu', () => {
  for (const url of ['https://www.fresin.id/delivery/', 'https://www.fresin.id/pesan/']) {
    const env = setup({ engine: 'home', url });
    assert.equal(env.storage.get('self_order_step'), 'gateway');
    assert.match(env.ctx.renderSelfOrder().replace(/<[^>]*>/g, ''), /Fresin App/);
    assert.equal(env.methods.length, 0);
  }
});

test('pickup from the outlet keeps the existing Take Away engine and preserves the cart', () => {
  const env = setup();
  env.window.FresinGateway.choose('pickup');
  assert.equal(env.storage.get('self_order_step'), 'menu');
  assert.equal(env.navigations.length, 0);
  assert.equal(env.history.state.fresinService, 'pickup');
  assert.equal(env.ctx.selfOrderCart.length, 1);
  assert.match(env.ctx.renderSelfOrder(), /EXISTING FLOW/);
});

test('home pickup and delivery select existing methods without changing payment rules', () => {
  const env = setup({ engine: 'home', url: 'https://www.fresin.id/pesan/' });
  env.window.FresinGateway.choose('pickup');
  assert.equal(env.methods.at(-1), 'PICKUP_PREORDER');
  env.window.FresinGateway.open();
  env.window.FresinGateway.choose('delivery');
  assert.equal(env.methods.at(-1), 'DELIVERY');
  assert.equal(env.navigations.length, 0);
});

test('a store table QR carries outlet origin into pickup without changing the common landing page', () => {
  const env=setup({dineIn:true,url:'https://www.fresin.id/self-order/?table=A-1'});
  env.window.FresinGateway.choose('pickup');
  const target=new URL(env.navigations[0]);
  assert.equal(target.pathname,'/pesan/');
  assert.equal(target.searchParams.get('origin'),'outlet');
  assert.equal(target.searchParams.get('mode'),'pickup');
});

test('delivery from the outlet uses a same-origin handoff and keeps cart data', () => {
  const env = setup({ url: 'http://127.0.0.1:8001/self-order.html?mode=takeaway' });
  env.window.FresinGateway.choose('delivery');
  assert.equal(new URL(env.navigations[0]).pathname, '/pesan/');
  assert.equal(new URL(env.navigations[0]).origin, 'http://127.0.0.1:8001');
  assert.equal(JSON.parse(env.storage.get('omnipos_self_order_cart'))[0].name, 'Latte');
  assert.equal(JSON.parse(env.storage.get(pendingKey)).service, 'delivery');
});

test('a matching navigation handoff opens the selected menu once, then gets consumed', () => {
  const pending = { service: 'delivery', path: '/pesan/', at: Date.now() };
  const env = setup({ engine: 'home', url: 'https://www.fresin.id/pesan/', storage: { [pendingKey]: JSON.stringify(pending) } });
  assert.equal(env.storage.get('self_order_step'), 'menu');
  assert.equal(env.history.state.fresinService, 'delivery');
  assert.equal(env.methods.at(-1), 'DELIVERY');
  assert.equal(env.storage.has(pendingKey), false);
});

test('expired or mismatched handoffs never silently skip the gateway', () => {
  for (const pending of [{ service: 'delivery', path: '/other/', at: Date.now() },
    { service: 'delivery', path: '/pesan/', at: 0 }, { service: 'invalid', path: '/pesan/', at: Date.now() }]) {
    const env = setup({ engine: 'home', url: 'https://www.fresin.id/pesan/', storage: { [pendingKey]: JSON.stringify(pending) } });
    assert.equal(env.storage.get('self_order_step'), 'gateway');
    assert.equal(env.methods.length, 0);
  }
});

test('status links and payment returns bypass the gateway without altering active state', () => {
  for (const url of ['https://www.fresin.id/delivery/status/token123',
    'https://www.fresin.id/order/status/token123',
    'https://www.fresin.id/delivery/?resultCode=00&reference=ref123',
    'https://www.fresin.id/delivery/#selforder?resultCode=00&reference=ref123',
    'https://www.fresin.id/delivery/?token=token123']) {
    const env = setup({ engine: 'home', url, step: 'success' });
    assert.match(env.ctx.renderSelfOrder(), /EXISTING FLOW/);
    assert.equal(env.storage.get('self_order_step'), 'success');
    assert.equal(env.methods.length, 0);
  }
});

test('ongoing checkout and a selected service survive reload and later history steps', () => {
  const env = setup({ engine: 'home', step: 'payment', history: { selfOrderStep: 'payment', fresinService: 'delivery' } });
  assert.equal(env.storage.get('self_order_step'), 'payment');
  env.ctx.pushSelfOrderHistory('success');
  assert.equal(env.history.state.fresinService, 'delivery');
  assert.equal(env.history.state.selfOrderStep, 'success');
});

test('legacy advanced checkout is preserved during upgrade', () => {
  const env = setup({ step: 'payment', history: { selfOrderStep: 'payment' } });
  assert.equal(env.storage.get('self_order_step'), 'payment');
  assert.match(env.ctx.renderSelfOrder(), /EXISTING FLOW/);
});

test('fresh public entry is not hijacked by a stale success screen from another ordering route', () => {
  const env = setup({ engine: 'home', url: 'https://www.fresin.id/pesan/', step: 'success' });
  assert.equal(env.storage.get('self_order_step'), 'gateway');
  assert.match(env.ctx.renderSelfOrder().replace(/<[^>]*>/g, ''), /Fresin App/);
});

test('orders shortcut resumes the customers own Take Away snapshot', () => {
  const env = setup({ storage: { self_order_last_order: JSON.stringify({ orderMode: 'TAKEAWAY', id: 'owned-order' }) } });
  env.window.FresinGateway.showOrders();
  assert.equal(env.storage.get('self_order_step'), 'success');
  assert.match(env.ctx.renderSelfOrder(), /EXISTING FLOW/);
});

test('support shortcut reveals only the existing support section', () => {
  const env = setup({ engine: 'home' });
  let scrolled = false;
  const element = { hidden: true, scrollIntoView() { scrolled = true; } };
  env.ctx.document.getElementById = id => id === 'fresinGatewaySupport' ? element : null;
  env.window.FresinGateway.showSupport();
  assert.equal(element.hidden, false);
  assert.equal(scrolled, true);
});

test('cashier ordering is not routed through this gateway', () => {
  for (const options of [{ standalone: false }]) {
    const env = setup(options);
    assert.match(env.ctx.renderSelfOrder(), /EXISTING FLOW/);
    assert.equal(env.storage.get('self_order_step'), 'menu');
  }
});

test('table QR starts with one main dine-in choice and two smaller service choices', () => {
  const env = setup({ dineIn: true, url: 'https://www.fresin.id/self-order/?table=D-12', bootPending: true });
  const html = env.ctx.renderSelfOrder();
  assert.equal(env.storage.get('self_order_step'), 'gateway');
  assert.equal(env.window.FRESIN_GATEWAY_BOOT_PENDING, false);
  assert.match(html, /fresin-gateway-table/);
  assert.match(html, /Makan di sini/);
  assert.match(html, /Lihat menu/);
  assert.match(html, /D-12/);
  assert.match(html, /choose\('dinein'\)/);
  assert.match(html, /choose\('pickup'\)/);
  assert.match(html, /choose\('delivery'\)/);
  assert.match(html, /fresin-gateway-secondary-choices/);
  assert.match(env.frames[0], /fresin-gateway-table/);
});

test('dine-in selection reuses the table flow and keeps the QR table and cart on reload', () => {
  const options = { dineIn: true, url: 'https://www.fresin.id/self-order/?table=D-12' };
  const env = setup(options);
  env.window.FresinGateway.choose('dinein');
  assert.equal(env.navigations.length, 0);
  assert.equal(env.storage.get('self_order_table'), 'D-12');
  assert.equal(env.storage.get('self_order_step'), 'menu');
  assert.equal(env.history.state.fresinService, 'dinein');
  assert.equal(env.ctx.selfOrderCart.length, 1);
  assert.match(env.ctx.renderSelfOrder(), /Makan di sini/);
  assert.match(env.ctx.renderSelfOrder(), /EXISTING FLOW/);
  const reload = setup({ ...options, storage: Object.fromEntries(env.storage), history: env.history.state });
  assert.equal(reload.window.FresinGateway.isOpen(), false);
  assert.equal(reload.ctx.selfOrderCart.length, 1);
});

test('table home-pickup and delivery navigate to customer ordering without a table cart', () => {
  for (const service of ['pickup', 'delivery']) {
    const env = setup({ dineIn: true, url: 'http://127.0.0.1:8001/self-order.html?table=D-12' });
    env.window.FresinGateway.choose(service);
    const target = new URL(env.navigations[0]);
    assert.equal(target.origin, 'http://127.0.0.1:8001');
    assert.equal(target.searchParams.has('table'), false);
    assert.equal(target.searchParams.get('mode'), service === 'pickup' ? 'pickup' : 'delivery');
    assert.equal(target.pathname, '/pesan/');
    assert.equal(JSON.parse(env.storage.get('omnipos_self_order_cart')).length, 0);
    const destination = setup({ engine: 'home', url: target.href, storage: Object.fromEntries(env.storage), cart: [] });
    assert.equal(destination.methods.at(-1), service === 'pickup' ? 'PICKUP_PREORDER' : 'DELIVERY');
    assert.equal(destination.ctx.selfOrderCart.length, 0);
    const returned = setup({ dineIn: true, url: 'http://127.0.0.1:8001/self-order.html?table=D-12', storage: Object.fromEntries(destination.storage), cart: [] });
    assert.equal(returned.ctx.selfOrderCart.length, 1);
    assert.equal(returned.ctx.selfOrderCart[0].name, 'Latte');
  }
});

test('a table checkout resumes directly when upgrading an existing customer session', () => {
  const env = setup({ dineIn: true, url: 'https://www.fresin.id/self-order/?table=D-12', step: 'payment', history: { selfOrderStep: 'payment' }, bootPending: true });
  assert.equal(env.window.FRESIN_GATEWAY_BOOT_PENDING, false);
  assert.equal(env.storage.get('self_order_step'), 'payment');
  assert.equal(env.history.state.fresinService, 'dinein');
  assert.match(env.ctx.renderSelfOrder(), /EXISTING FLOW/);
});

test('browser back restores table drafts without overwriting the updated delivery draft', () => {
  const env = setup({ dineIn: true, url: 'https://www.fresin.id/self-order/?table=D-12' });
  env.window.FresinGateway.choose('delivery');
  env.storage.set('omnipos_self_order_cart', JSON.stringify([{ name: 'Delivery item', qty: 2, price: 10000 }]));
  env.listeners.pageshow({ persisted: true });
  assert.equal(env.ctx.selfOrderCart.length, 1);
  assert.equal(env.ctx.selfOrderCart[0].name, 'Latte');
  env.window.FresinGateway.choose('delivery');
  assert.equal(env.ctx.selfOrderCart[0].name, 'Delivery item');
  assert.equal(env.ctx.selfOrderCart[0].qty, 2);
});

test('table orders shortcut only opens a snapshot owned by that table', () => {
  for (const table of ['D-12', 'A-01']) {
    const env = setup({ dineIn: true, url: 'https://www.fresin.id/self-order/?table=D-12', storage: { self_order_last_order: JSON.stringify({ id: 'owned-order', number: '001', table }) } });
    env.window.FresinGateway.showOrders();
    assert.equal(env.storage.get('self_order_step'), table === 'D-12' ? 'success' : 'gateway');
    if (table !== 'D-12') assert.ok(env.messages.length > 0);
  }
});

test('invalid choices and service changes during submission do not navigate', () => {
  const env = setup();
  env.window.FresinGateway.choose('not-a-service');
  assert.equal(env.storage.get('self_order_step'), 'gateway');
  env.ctx.selfOrderSubmitting = true;
  env.window.FresinGateway.choose('delivery');
  assert.equal(env.navigations.length, 0);
});

test('closed online ordering blocks pickup and delivery while table dining checks its own operating window', () => {
  for (const engine of ['home', 'takeaway']) {
    const env = setup({ engine, url: engine === 'home' ? 'https://www.fresin.id/pesan/' : 'https://www.fresin.id/order/' });
    let checks = 0;
    env.window.FresinOnlineHours = { allow() { checks++; return false; } };
    const before = JSON.stringify(Array.from(env.storage));
    for (const service of ['pickup', 'delivery']) env.window.FresinGateway.choose(service);
    assert.equal(checks, 2);
    assert.equal(env.navigations.length, 0);
    assert.equal(env.methods.length, 0);
    assert.equal(JSON.stringify(Array.from(env.storage)), before);
  }
  const table = setup({ dineIn: true, url: 'https://www.fresin.id/order/?table=A-1' });
  const services=[];
  table.window.FresinOnlineHours = { allow(service) {services.push(service);return service==='dinein';} };
  table.window.FresinGateway.choose('dinein');
  assert.equal(table.storage.get('self_order_step'), 'menu');
  assert.deepEqual(services,['dinein']);
  const closedTable=setup({dineIn:true,url:'https://www.fresin.id/order/?table=A-1'});
  closedTable.window.FresinOnlineHours={allow(service){assert.equal(service,'dinein');return false;}};
  closedTable.window.FresinGateway.choose('dinein');
  assert.equal(closedTable.storage.get('self_order_step'),'gateway');
});

test('table category photos reuse visible catalog products and preserve category filtering', () => {
  const env = setup({ dineIn: true, url: 'https://www.fresin.id/self-order/?table=D-12' });
  const core = fs.readFileSync(sourcePath('app.js'), 'utf8');
  const start = core.indexOf('function renderSelfOrderCatalog() {');
  const end = core.indexOf('\nfunction ', start + 1);
  env.ctx.state.products = [
    { name: 'No photo', category: 'Coffee', imageName: '' },
    { name: 'Hidden coffee', category: 'Coffee', imageName: 'hidden.jpg', hidden: true },
    { name: 'Aren Latte', category: 'Coffee', imageName: 'latte.jpg' },
    { name: 'Donut', category: 'Donuts', imageName: 'donut.jpg' }
  ];
  env.ctx.stableProducts = products => products;
  env.ctx.selfOrderProductCanDisplay = product => !product.hidden;
  env.ctx.selfOrderActiveCategory = () => 'Coffee';
  env.ctx.productCategories = () => ['Coffee', 'Donuts'];
  env.ctx.productImageOrToken = product => `<img src="${product.imageName}" alt="">`;
  env.ctx.renderSelfOrderCategorySection = (category, products) => `CATALOG:${category}:${products.map(product => product.name).join(',')}`;
  vm.runInContext(core.slice(start, end), env.ctx);
  const html = env.ctx.renderSelfOrderCatalog();
  assert.match(html, /fresin-category-chip active/);
  assert.match(html, /src="latte.jpg"/);
  assert.match(html, /src="donut.jpg"/);
  assert.doesNotMatch(html, /hidden.jpg|Hidden coffee/);
  assert.match(html, /CATALOG:Coffee:No photo,Aren Latte/);
  assert.match(env.window.FresinGateway.categoryVisual('Semua', []), /data-icon="all"/);
  assert.match(env.window.FresinGateway.categoryVisual('Unknown', []), /data-icon="all"/);
  const pos = setup({ standalone: false });
  assert.equal(pos.window.FresinGateway.categoryVisual('Coffee', env.ctx.state.products), '');
});

test('pickup checkout exposes a sentence-case card header with its own description', () => {
  const env = setup({ engine: 'home' });
  const html = env.window.FresinGateway.serviceStrip('pickup', { change: false, checkout: true });
  assert.match(html, /is-checkout-header/);
  assert.match(html, /Ambil di Outlet <small>mengambil sendiri pesanan di outlet Fresin<\/small>/);
  assert.doesNotMatch(html, /Ubah layanan|Ambil di toko/);
  assert.match(env.window.FresinGateway.serviceStrip('pickup'), /Ambil di toko/);
});

test('all customer ordering routes share category photos and use a drink for Non-Kopi', () => {
  for (const options of [
    { dineIn: true, url: 'https://www.fresin.id/self-order/?table=D-12' },
    { url: 'https://www.fresin.id/self-order/?mode=takeaway' },
    { engine: 'home', url: 'https://www.fresin.id/pesan/?mode=pickup' },
    { engine: 'home', url: 'https://www.fresin.id/pesan/?mode=delivery' }
  ]) {
    const env = setup(options);
    env.ctx.productImageOrToken = product => `<img src="${product.imageName}" alt="">`;
    const products = [
      { name: 'Air Mineral', category: 'Non-Kopi', imageName: 'water.jpg' },
      { name: 'Chocolatte Crunchy', category: 'Non-Kopi', imageName: 'chocolate.jpg' }
    ];
    assert.equal(env.window.FresinGateway.menuVisualsEnabled(), true);
    assert.match(env.window.FresinGateway.categoryVisual('Non-Kopi', products), /chocolate.jpg/);
    assert.doesNotMatch(env.window.FresinGateway.categoryVisual('Non-Kopi', products), /water.jpg/);
  }
});

test('normal entry and previews keep shared motion active unless explicitly turned off', () => {
  for (const [query, expected] of [['preview=signature-4',true],['preview=signature-4&motion=off',false],['',true],['motion=on',true],['motion=off',false]]) {
    const env = setup({ engine: 'home', url: `https://www.fresin.id/pesan/?${query}` });
    assert.equal(env.ctx.renderSelfOrder().includes('data-motion="on"'), expected);
  }
});

test('Semua combines real drink and donut thumbnails from the current catalog', () => {
  const env = setup({ engine: 'home', url: 'https://www.fresin.id/pesan/' });
  env.ctx.productImageOrToken = product => `<img src="${product.imageName}" alt="">`;
  const html = env.window.FresinGateway.categoryVisual('Semua', [
    { name: 'Fries', category: 'Snack', imageName: 'fries.jpg' },
    { name: 'Aren Latte', category: 'Coffee', imageName: 'latte.jpg' },
    { name: 'Choco Donut', category: 'Donuts', imageName: 'donut.jpg' }
  ]);
  assert.match(html, /fresin-category-photo-stack/);
  assert.match(html, /src="latte.jpg"/);
  assert.match(html, /src="donut.jpg"/);
  assert.doesNotMatch(html, /fries.jpg|<svg/);
  assert.match(env.window.FresinGateway.categoryVisual('Semua', []), /data-icon="all"/);
});

test('customer cart keeps the entry method and checkout data without another service picker', () => {
  for (const file of ['delivery/Customer Order/customer-order.js','deploy-ready/delivery/Customer Order/customer-order.js']) {
    const feature = fs.readFileSync(sourcePath(file), 'utf8');
    const start = feature.indexOf('  function homeRenderCart() {');
    const end = feature.indexOf('\n  function ', start + 3);
    for (const method of ['PICKUP_PREORDER','DELIVERY']) {
      const checkout = { method, address: 'Saved delivery address' };
      const html = vm.runInNewContext(`(${feature.slice(start, end)})()`, {
        selfOrderSubtotal: () => 20000, selfOrderItemsTotal: () => 1, homeCheckout: () => checkout,
        homeSetCheckout: patch => Object.assign(checkout, patch),
        selfOrderCart: [{ lineId: 'line-1', name: 'Aren Latte', qty: 1, price: 20000 }],
        homeEscape: value => value, homeMoney: value => String(value),
        cartItemTotal: item => item.price * item.qty, orderItemNoteHtml: () => '',
        renderSelfOrderUpsellCard: () => '<aside>Recommendations</aside>', homeRenderSupportContact: () => ''
      });
      assert.doesNotMatch(html, /Pilih cara menerima pesanan|customer-home-cart-methods|CustomerOrder.setMethod/);
      assert.match(html, /Aren Latte/);
      assert.match(html, /20000/);
      assert.match(html, /onclick="selfOrderShowPayment\(\)" >Lanjut/);
      assert.equal(checkout.method, method);
      assert.equal(checkout.address, 'Saved delivery address');
    }
  }
});

test('gateway assets are installed after existing extensions in both runtime and deployment entries', () => {
  for (const file of ['self-order.html', 'delivery/index.html', 'pesan/index.html',
    'deploy-ready/self-order/index.html', 'deploy-ready/delivery/index.html', 'deploy-ready/pesan/index.html']) {
    const html = fs.readFileSync(sourcePath(file), 'utf8');
    assert.match(html, /Customer Gateway\/customer-gateway\.css\?v=/, file);
    assert.ok(html.indexOf('FRESIN_GATEWAY_BOOT_PENDING = true') > 0 && html.indexOf('FRESIN_GATEWAY_BOOT_PENDING = true') < html.indexOf('<script src='), file + ': initialize the boot gate before the application scripts');
    assert.ok(html.indexOf('customer-gateway.js?v=') > html.indexOf('so-takeaway.js?v='), file);
    if (html.includes('customer-order.js?v=')) assert.ok(html.indexOf('customer-gateway.js?v=') > html.indexOf('customer-order.js?v='), file);
  }
  assert.equal(fs.readFileSync(path.join(root, 'deploy-ready/Customer Gateway/customer-gateway.js'), 'utf8'), source);
});

test('a new direct visit starts with an empty cart and cannot restore old service cart items',()=>{
 const snapshot=JSON.stringify({id:'existing-order',number:'P100',orderMode:'TAKEAWAY'});
 const env=setup({engine:'home',url:'https://www.fresin.id/pesan/',navigationType:'navigate',storage:{
  omnipos_self_order_cart:JSON.stringify([{name:'Old item',qty:1}]),
  fresin_gateway_draft_context_v1:'delivery',
  fresin_gateway_service_drafts_v1:JSON.stringify({'home-pickup':{cart:[{name:'Old pickup',qty:1}],fields:{self_order_customer:'Andi'}},delivery:{cart:[{name:'Old delivery',qty:1}],fields:{}}}),
  self_order_last_order:snapshot
 }});
 assert.equal(env.ctx.selfOrderCart.length,0);assert.equal(JSON.parse(env.storage.get('omnipos_self_order_cart')).length,0);
 env.window.FresinGateway.choose('pickup');assert.equal(env.ctx.selfOrderCart.length,0);
 env.window.FresinGateway.open();env.window.FresinGateway.choose('delivery');assert.equal(env.ctx.selfOrderCart.length,0);
 assert.equal(env.storage.get('self_order_last_order'),snapshot);
 const drafts=JSON.parse(env.storage.get('fresin_gateway_service_drafts_v1'));
 assert.ok(Object.values(drafts).every(draft=>draft.cart.length===0));
});

test('refresh and browser back retain intentional current carts',()=>{
 for(const navigationType of ['reload','back_forward']){
  const env=setup({engine:'home',url:'https://www.fresin.id/pesan/',navigationType,history:{selfOrderStep:'menu',fresinService:'pickup'}});
  assert.equal(env.ctx.selfOrderCart.length,1);assert.equal(env.ctx.selfOrderCart[0].name,'Latte');
 }
});

test('new document handoffs and order result continuations never clear valid carts or checkout',()=>{
 const handoff={service:'delivery',path:'/pesan/',at:Date.now()};
 const incoming=setup({engine:'home',url:'https://www.fresin.id/pesan/',navigationType:'navigate',storage:{[pendingKey]:JSON.stringify(handoff)}});
 assert.equal(incoming.ctx.selfOrderCart.length,1);assert.equal(incoming.history.state.fresinService,'delivery');
 const checkout=setup({engine:'home',url:'https://www.fresin.id/pesan/',navigationType:'navigate',step:'payment',history:{selfOrderStep:'payment',fresinService:'pickup'}});
 assert.equal(checkout.ctx.selfOrderCart.length,1);assert.equal(checkout.storage.get('self_order_step'),'payment');
 const status=setup({engine:'home',url:'https://www.fresin.id/order/status/token123',navigationType:'navigate',step:'success'});
 assert.equal(status.ctx.selfOrderCart.length,1);assert.equal(status.storage.get('self_order_step'),'success');
});

test('Pesan Lagi resets service selection and returns pickup and delivery customers to the two-choice gateway',()=>{
 for(const [engine,url] of [['home','https://www.fresin.id/pesan/?mode=delivery&origin=outlet'],
   ['home','https://www.fresin.id/pesan/?mode=pickup'],['takeaway','https://www.fresin.id/order/?mode=takeaway']]){
   const env=setup({engine,url,step:'success',history:{selfOrderStep:'success',fresinService:'delivery'},
     storage:{customer_home_checkout:JSON.stringify({method:'DELIVERY',note:'Pesanan sebelumnya'}),
       fresin_gateway_service_drafts_v1:JSON.stringify({delivery:{cart:[{name:'Old item'}]}})}});
   env.window.FresinGateway.restart();
   assert.equal(env.storage.get('self_order_step'),'gateway');
   assert.equal(env.history.state.fresinService,null);
   assert.equal(env.ctx.selfOrderCart.length,0);
   assert.equal(env.storage.has('customer_home_checkout'),false);
   assert.equal(env.storage.has('fresin_gateway_service_drafts_v1'),false);
   assert.equal(env.ctx.location.search.includes('mode='),false);
   assert.equal(env.ctx.location.pathname,engine==='home'?'/pesan/':'/order/');
   const html=env.ctx.renderSelfOrder();
   assert.match(html,/Mau pesan bagaimana/);
   assert.match(html,/Ambil di toko/);
   assert.match(html,/Diantar \(Delivery\)/);
   assert.doesNotMatch(html,/Makan di sini/);
   env.window.FresinGateway.choose('delivery');
   if(engine==='home')assert.equal(env.methods.at(-1),'DELIVERY');
   else assert.match(env.navigations.at(-1),/mode=delivery/);
 }
});
