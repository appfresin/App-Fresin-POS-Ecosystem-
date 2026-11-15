const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const localSource = path.join(__dirname, "../driver/Driver Order/driver-order.js");
const source = fs.readFileSync(fs.existsSync(localSource) ? localSource : path.join(__dirname, "../deploy-ready/driver/Driver Order/driver-order.js"), "utf8");

function setup(walletMode = "history", options = {}) {
  const storage = new Map([["kasirin_driver_wallet_mode_v1", walletMode]]);
  const listeners = {};
  const intervals = [];
  const timers = [];
  const app = { innerHTML: "", addEventListener(type, handler) { listeners[type] = handler; } };
  let backendCalls = 0;
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
  };
  const window = {
    DriverAppConfig: {}, DriverUtils: {},
    DriverSupabase: { async ready() { backendCalls++; if (options.client) return options.client; throw Error("No backend access in local tests"); } },
    setInterval(callback, ms) { intervals.push({ callback, ms }); }, setTimeout() {}, clearTimeout() {}
  };
  if (options.notifications) window.DriverNotifications = { render:()=>'', update(){}, syncNative(){}, ...options.notifications };
  const document = { getElementById: id => id === "app" ? app : null, querySelectorAll: () => timers, addEventListener() {}, hidden: false };
  class FormData { constructor(form) { this.fields = form.fields; } get(key) { return this.fields[key]; } }
  const ctx = vm.createContext({ window, document, localStorage, FormData, console, URL, URLSearchParams, navigator: { userAgent: "test", ...options.navigator } });
  vm.runInContext(source.replace('window.DriverOrder = {', 'window.DriverOrder = { renderCardActions, effectiveOrderStatus, shareOrderSummary, orderShareText, deliveryMeta, renderItem, copySharedContent, renderDetail, driverAcceptanceTime, renderCustomerWait, runAction, missedOrdersToday, selectOrders, renderStatusAction,'), ctx);
  const api = window.DriverOrder;
  api.state.profile = { id: "driver-a", name: "Rifqi", phone: "6282100000000" };
  const order = { id: "test-order", order_number: "D100", customer_name: "Andi", customer_phone: "6282100000001", customer_order_type: "DELIVERY", customer_order_status: "DRIVER_ASSIGNED", payment_provider: "courier_cash", payment_status: "Belum dibayar", status: "Pesanan Baru", subtotal: 5000, delivery_fee: 10000, grand_total: 15000, driver_id: "driver-a", delivery_address: "Jalan Melati 10", delivery_note: "Pagar hijau", created_at: new Date().toISOString() };
  return { api, app, order, storage, listeners, intervals, timers, document,
    setNow: ms => vm.runInContext(`Date.now = () => ${Number(ms)}`, ctx),
    get backendCalls() { return backendCalls; } };
}

test("WhatsApp confirmation separates totals, landmark and location without redundant address or pin labels", () => {
  const { api, order } = setup();
  const message = new URL(api.whatsappUrl(order)).searchParams.get("text");
  assert.match(message, /Pesanan: Rp5\.000/);
  assert.match(message, /Ongkir: Rp10\.000/);
  assert.match(message, /Total: Rp15\.000/);
  assert.match(message, /Patokan:\nPagar hijau\n\nLokasi:\nhttps:\/\/www.google.com\/maps/);
  assert.doesNotMatch(message, /Alamat pengantaran:|Pin lokasi:|Jalan Melati 10(?!.*query)/);
  assert.doesNotMatch(message, /Nomor rekening:/);
  assert.ok(message.endsWith('apakah sudah benar kak ?'));
  assert.doesNotMatch(message,/Pembayaran bisa dilakukan kepada driver saat pesanan diterima|Mohon konfirmasi lokasi dan rincian pesanan/);
});

test("earnings and confirmation omit saved payment accounts while online payment guidance still works", () => {
  const { api, app, order, storage } = setup();
  storage.set("kasirin_driver_payment_accounts_v1", JSON.stringify({
    "driver-a": { bank: "BSI", number: "0012345678", holder: "Rifqi Atha" }
  }));
  api.setView("earnings");
  assert.doesNotMatch(app.innerHTML, /Rekening pembayaran|Simpan rekening/);
  const text = () => new URL(api.whatsappUrl(order)).searchParams.get("text");
  assert.doesNotMatch(text(), /0012345678|Nomor rekening:|boleh transfer/);
  order.payment_provider = "duitku";
  order.payment_status = "Lunas";
  assert.match(text(), /sudah tercatat lunas/);
  order.payment_status = "Belum dibayar";
  assert.match(text(), /pembayaran melalui halaman pesanan/);
});

test("the card shows products only; free products stay zero instead of including delivery", () => {
  const env = setup();
  env.order.customer_order_status = "SEARCHING_DRIVER";
  env.api.state.orders = [env.order];
  env.api.setView("tasks");
  assert.match(env.app.innerHTML, /<small>Pesanan<\/small><em>Rp5\.000<\/em>/);
  env.order.subtotal = 0;
  env.api.setView("tasks");
  assert.match(env.app.innerHTML, /<small>Pesanan<\/small><em>Rp0<\/em>/);
  env.order.subtotal = null;
  env.api.setView("tasks");
  assert.match(env.app.innerHTML, /<small>Pesanan<\/small><em>Rp5\.000<\/em>/);
});

test("an assigned cash delivery offers WhatsApp confirmation and kitchen processing without marking paid", () => {
  const env = setup();
  env.api.state.orders = [env.order];
  env.api.setView("active");
  assert.match(env.app.innerHTML, /Konfirmasi WhatsApp/);
  assert.match(env.app.innerHTML, /data-action="process"/);
  assert.doesNotMatch(env.app.innerHTML, /data-action="delivering"|data-action="complete"/);
  env.order.payment_status = "Lunas";
  env.api.setView("active");
  assert.match(env.app.innerHTML, /data-action="process"/);
  env.order.confirmed_at = new Date().toISOString();
  env.order.ready_at = new Date().toISOString();
  env.order.customer_order_status = "READY_FOR_PICKUP";
  env.api.setView("active");
  assert.match(env.app.innerHTML, /data-action="delivering"/);
  assert.equal(env.backendCalls, 0);
});

test('kitchen readiness is visible before payment and WhatsApp confirmation ends after processing',()=>{
  const env=setup();env.order.confirmed_at=new Date().toISOString();env.api.state.orders=[env.order];
  env.order.status='Sedang Disiapkan';env.order.customer_order_status='PREPARING';env.api.setView('active');
  assert.doesNotMatch(env.app.innerHTML,/Konfirmasi WhatsApp|Pesanan Siap Dijemput/);
  env.order.status='Selesai';env.order.ready_at=new Date().toISOString();env.api.setView('active');
  assert.match(env.app.innerHTML,/driver-kitchen-notice is-ready/);assert.match(env.app.innerHTML,/Pesanan Siap Dijemput/);
  assert.doesNotMatch(env.app.innerHTML,/Konfirmasi WhatsApp|Menunggu kasir mencatat pelunasan/);
});

test("driver processing acknowledges kitchen release only for its assigned, unchanged order", async () => {
  const writes=[];
  let remote;
  const client={from() {
    const query={
      update(value) { writes.push({value,filters:[]}); return query; },
      select() { return query; },
      eq(...args) { if(writes.length) writes.at(-1).filters.push(['eq',...args]); return query; },
      is(...args) { if(writes.length) writes.at(-1).filters.push(['is',...args]); return query; },
      in() { return query; }, gte() { return query; }, lt() { return query; },order() { return query; },
      limit() { return Promise.resolve({data:[remote],error:null}); },
      async maybeSingle() { remote={...remote,...writes.at(-1).value}; return {data:{id:remote.id,confirmed_at:remote.confirmed_at},error:null}; }
    };return query;
  }};
  const env=setup('history',{client});remote=env.order;env.api.state.orders=[env.order];
  await env.api.runAction('process',env.order.id);
  assert.equal(writes.length,1);
  assert.ok(writes[0].value.confirmed_at);
  assert.deepEqual(Object.keys(writes[0].value).sort(),['confirmed_at','updated_at']);
  assert.ok(writes[0].filters.some(([method,key,value])=>method==='eq'&&key==='driver_id'&&value==='driver-a'));
  assert.ok(writes[0].filters.some(([method,key,value])=>method==='eq'&&key==='customer_order_status'&&value==='DRIVER_ASSIGNED'));
  assert.ok(writes[0].filters.some(([method,key,value])=>method==='is'&&key==='confirmed_at'&&value===null));
  assert.equal(env.api.state.orders[0].payment_status,'Belum dibayar');
  assert.ok(env.api.state.orders[0].confirmed_at);
  await env.api.runAction('process',env.order.id);
  assert.equal(writes.length,1,'Double processing must not write again');
});

test("another driver's order, prepaid flow and cancelled delivery cannot use courier processing", async () => {
  for(const patch of [{driver_id:'another-driver'},{payment_provider:'duitku'},{cancelled_at:new Date().toISOString()},{customer_order_status:'COMPLETED'}]) {
    const env=setup();Object.assign(env.order,patch);env.api.state.orders=[env.order];
    await env.api.runAction('process',env.order.id);
    assert.equal(env.backendCalls,0);
    assert.equal(env.order.confirmed_at,undefined);
  }
});

test("a failed or concurrent server update never pretends the kitchen accepted the order", async () => {
  for(const result of [{data:null,error:null},{data:null,error:{message:'fixture write failed'}}]) {
    const query={update:()=>query,eq:()=>query,is:()=>query,select:()=>query,maybeSingle:async()=>result};
    const env=setup('history',{client:{from:()=>query}});env.api.state.orders=[env.order];
    await env.api.runAction('process',env.order.id);
    assert.equal(env.order.confirmed_at,undefined);
    assert.equal(env.order.payment_status,'Belum dibayar');
    assert.equal(env.api.state.actionLoading,'');
    assert.ok(env.api.state.error);
  }
});

test("a saved claim preference opens earnings history with direct courier fees", () => {
  const env = setup("claim");
  assert.equal(env.api.state.walletMode, "history");
  env.order.customer_order_status = "COMPLETED";
  env.order.payment_status = "Lunas";
  env.order.completed_at = new Date().toISOString();
  env.api.state.orders = [env.order];
  env.api.setView("earnings");
  assert.match(env.app.innerHTML, /Riwayat pendapatan/);
  assert.match(env.app.innerHTML, /Rp10\.000/);
  assert.doesNotMatch(env.app.innerHTML, /data-wallet-mode|data-driver-form="claim"|Siap diklaim|Klaim kosong/);
});

test("order detail places items after the address and omits the outlet payment card", () => {
  const env = setup();
  env.order.items = [{ product_name: "Air Mineral", qty: 1 }];
  const html = env.api.renderDetail(env.order);
  assert.ok(html.indexOf("Alamat pengantaran") < html.indexOf("Item pesanan"));
  assert.doesNotMatch(html, /driver-outlet-payment|Pembayaran driver ke kasir/);
  assert.match(html, /Konfirmasi WhatsApp/);
  assert.match(html, /data-action="process"/);
});

test("acceptance countdown uses the latest search session and stays within five minutes", () => {
  const env = setup();
  const start = '2026-11-12T10:00:00Z';
  const now = Date.parse(start);
  assert.equal(env.api.driverAcceptanceTime({created_at:start}, now).label, '05:00');
  assert.equal(env.api.driverAcceptanceTime({created_at:start}, now + 65000).label, '03:55');
  assert.equal(env.api.driverAcceptanceTime({created_at:start}, now + 3661000).label, '00:00');
  assert.equal(env.api.driverAcceptanceTime({created_at:start}, now - 10000).label, '05:00');
  assert.equal(env.api.driverAcceptanceTime({}, now), null);
  assert.equal(env.api.driverAcceptanceTime({created_at:'invalid'}, now), null);
  assert.equal(env.api.driverAcceptanceTime({created_at:start,updated_at:'2026-11-12T10:03:00Z'}, now + 185000).label, '04:55');
});

test("only searching orders show the acceptance deadline and retry restarts the countdown", () => {
  const env = setup();
  const start = '2026-11-12T10:00:00Z';
  env.setNow(Date.parse(start) + 185000);
  Object.assign(env.order, { created_at: start, updated_at: '2026-11-12T10:03:00Z', customer_order_status: 'SEARCHING_DRIVER' });
  assert.match(env.api.renderCustomerWait(env.order), />04:55<\/time>/);
  assert.match(env.api.renderCustomerWait(env.order), /Batas terima pesanan/);
  assert.doesNotMatch(env.api.renderCustomerWait(env.order), /is-long-wait/);
  for (const status of ['DRIVER_ASSIGNED', 'DELIVERING', 'COMPLETED', 'NO_DRIVER_AVAILABLE']) {
    env.order.customer_order_status = status;
    assert.equal(env.api.renderCustomerWait(env.order), '');
  }
});

test("the acceptance ticker updates only timer nodes and catches up after a hidden page", () => {
  const env = setup();
  const start = Date.parse('2026-11-12T10:00:00Z');
  env.setNow(start + 125000);
  const value = { textContent: '', setAttribute(key, val) { this[key] = val; } };
  const timer = { dataset: { driverAcceptUntil: start + 300000 }, querySelector: () => value,
    classList: { toggle(key, val) { timer[key] = val; }, contains(key) { return !!timer[key]; } } };
  env.timers.push(timer);
  const before = env.app.innerHTML;
  const tick = env.intervals.find(interval => interval.ms === 1000);
  assert.ok(tick);
  tick.callback();
  assert.equal(value.textContent, '02:55');
  assert.equal(value.datetime, 'PT175S');
  assert.equal(timer['is-long-wait'], false);
  env.document.hidden = true;
  env.setNow(start + 250000);
  tick.callback();
  assert.equal(value.textContent, '02:55');
  env.document.hidden = false;
  tick.callback();
  assert.equal(value.textContent, '00:50');
  assert.equal(timer['is-long-wait'], true);
  assert.equal(env.app.innerHTML, before);
  assert.equal(env.backendCalls, 0);
});

test("expired searching offers move to missed and a stale take cannot update the backend", async () => {
  const env = setup();
  const now = new Date();
  env.setNow(now.getTime());
  Object.assign(env.order,{customer_order_status:'SEARCHING_DRIVER',driver_id:'',created_at:new Date(now.getTime()-360000).toISOString(),updated_at:new Date(now.getTime()-360000).toISOString()});
  env.api.state.orders=[env.order];
  env.api.setView('tasks');
  assert.doesNotMatch(env.app.innerHTML,/data-action="take"/);
  assert.equal(env.api.missedOrdersToday().length,1);
  await env.api.runAction('take',env.order.id);
  assert.match(env.api.state.error,/Batas terima pesanan sudah habis/);
  assert.equal(env.backendCalls,0);
});

test("missed chip counts today's unavailable and cancelled offers without blaming other drivers", () => {
  const env = setup();
  const today = new Date().toISOString();
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const offer = (id, status, extra = {}) => ({ ...env.order, id, customer_order_status: status, updated_at: today, driver_id: '', driver_name: '', driver_phone: '', ...extra });
  env.api.state.orders = [
    offer('expired', 'NO_DRIVER_AVAILABLE'), offer('cancelled', 'CANCELLED'),
    offer('mine', 'CANCELLED', { driver_id: 'driver-a' }),
    offer('another', 'CANCELLED', { driver_id: 'driver-b' }),
    offer('old', 'NO_DRIVER_AVAILABLE', { updated_at: yesterday }),
    offer('still-open', 'SEARCHING_DRIVER'), offer('taken', 'DRIVER_ASSIGNED', { driver_id: 'driver-b' })
  ];
  assert.deepEqual(Array.from(env.api.missedOrdersToday(), order => order.id), ['expired', 'cancelled', 'mine']);
  env.api.setView('missed');
  assert.match(env.app.innerHTML, /data-view="missed"[^>]*><b>3<\/b>/);
  assert.match(env.app.innerHTML, /Tidak sempat diterima|Dibatalkan/);
  assert.doesNotMatch(env.app.innerHTML, /data-action="take"|data-action="delivering"|data-action="complete"/);
  assert.match(env.api.renderStatusAction(env.api.state.orders[0]), /tidak sempat diambil driver/);
});

test("refresh reads missed offers in a bounded daily query and merges all status groups", async () => {
  const env = setup();
  const results = [[{ id: 'open' }], [{ id: 'missed' }], [{ id: 'complete' }]];
  const calls = [];
  const client = { from() {
    const index = calls.length;
    const filters = [];
    calls.push(filters);
    const query = {};
    for (const method of ['select', 'eq', 'in', 'gte', 'lt', 'order']) query[method] = (...args) => { filters.push([method, ...args]); return query; };
    query.limit = () => Promise.resolve({ data: results[index], error: null });
    return query;
  } };
  const result = await env.api.selectOrders(client, ['id']);
  assert.deepEqual(Array.from(result.data, order => order.id), ['open', 'missed', 'complete']);
  assert.equal(calls.length, 3);
  assert.ok(calls[1].some(([method, column, values]) => method === 'in' && column === 'customer_order_status' && values.includes('NO_DRIVER_AVAILABLE') && values.includes('CANCELLED')));
  assert.ok(calls[1].some(([method, column]) => method === 'gte' && column === 'updated_at'));
  assert.ok(calls[1].some(([method, column]) => method === 'lt' && column === 'updated_at'));
});

test('driver notes show only the customer message without appending payment instructions', () => {
  const {api,order}=setup();
  order.note='letak di depan pagar saja ya\nKurir membayar harga produk di outlet; ongkir langsung diterima kurir dari pelanggan.\nPin lokasi: https://www.google.com/maps?q=5.3,95.9\nPatokan alamat: rumah pagar merah';
  const original=order.note;
  assert.equal(api.deliveryMeta(order).note,'letak di depan pagar saja ya');
  assert.equal(order.note,original);
  assert.equal(api.deliveryMeta({...order,note:'Tolong telepon dulu\nJangan bunyikan bel.'}).note,'Tolong telepon dulu\nJangan bunyikan bel.');
});

test('driver item displays quantity before product and the line price after it, with addons counted once', () => {
  const {api}=setup();
  const html=api.renderItem({product_name:'Air Mineral',qty:2,price:5000,addons:[{addon_name:'Es',qty:1,price:2000}]});
  assert.match(html,/driver-item-qty[^>]*>2×</);
  assert.match(html,/driver-item-price[^>]*>Rp12\.000</);
  assert.ok(html.indexOf('2×')<html.indexOf('Air Mineral'));
  assert.ok(html.indexOf('Air Mineral')<html.indexOf('Rp12.000'));
  assert.match(api.renderItem({product_name:'Air Mineral',qty:2,price:5000,discount:1000}),/driver-item-price[^>]*>Rp9\.000</);
});

test("detail offers a clean customer chat beside Maps, with sharing confined to the header", () => {
  const { api, order } = setup();
  const html = api.renderDetail(order);
  assert.match(html, /data-action="open-maps".*Buka Maps/);
  assert.match(html, /href="https:\/\/wa\.me\/6282100000001"[^>]*>.*Chat Customer/);
  assert.doesNotMatch(html, /data-action="share-(?:maps|phone)"/);
  assert.match(html, /data-action="share-order"/);
  assert.match(html, /href="https:\/\/wa\.me\/6282100000001\?text=[^"]+"[^>]*>.*Konfirmasi WhatsApp/);
  order.customer_phone = "";
  assert.match(api.renderDetail(order), /<button[^>]*disabled>.*Chat Customer/);
});

test("cancelled native sharing does not open the fallback", async () => {
  const { api, order } = setup("history", { navigator: { share: async () => {
    throw Object.assign(Error("cancel"), { name: "AbortError" });
  } } });
  api.state.orders = [order];
  await api.shareOrderSummary(order.id);
  assert.equal(api.state.sharePayload, null);
});

test('order sharing contains structured current order information, items, notes and correct line amounts', async () => {
  const shared=[];
  const {api,order}=setup('history',{navigator:{share:async payload=>shared.push(payload)}});
  order.note='Letakkan di pagar\nKurir membayar harga produk di outlet; ongkir langsung diterima kurir dari pelanggan.';
  order.delivery_latitude=5.3;order.delivery_longitude=95.9;
  order.items=[{product_name:'Air Mineral',qty:2,price:5000,discount:1000,note:'Dingin',addons:[{addon_name:'Es',qty:1,price:2000}]}];
  api.state.orders=[order];
  await api.shareOrderSummary(order.id);
  assert.equal(shared.length,1);
  const message=shared[0].text;
  assert.match(message,/PESANAN DELIVERY D100\n/);
  assert.match(message,/Pemesan: Andi\nWhatsApp: 6282100000001/);
  assert.match(message,/ITEM PESANAN\n2× Air Mineral — Rp11\.000\n  Catatan: Dingin\n  Tambahan: Es ×1/);
  assert.match(message,/RINCIAN PEMBAYARAN\nPesanan: Rp5\.000\nOngkir: Rp10\.000\nTotal: Rp15\.000\nStatus bayar: Belum dibayar/);
  assert.match(message,/Patokan:\nPagar hijau\n\nLokasi:\nhttps:\/\/www.google.com\/maps\?q=5.3,95.9/);
  assert.match(message,/Catatan pelanggan:\nLetakkan di pagar/);
  assert.match(message,/Driver: Rifqi/);
  assert.doesNotMatch(message,/Alamat pengantaran:|Pin lokasi:|Kurir membayar harga produk/);
  assert.match(api.renderDetail(order),/data-action="share-order"/);
});

test('order sharing fallback previews and copy retain every line, and WhatsApp gets the same message', async () => {
  const copied=[];
  const env=setup('history',{navigator:{clipboard:{writeText:async text=>copied.push(text)}}});
  env.order.items=[{product_name:'Air Mineral <tes>',qty:1,price:5000}];
  env.api.state.orders=[env.order];
  await env.api.shareOrderSummary(env.order.id);
  assert.match(env.app.innerHTML,/<textarea[^>]*readonly/);
  assert.doesNotMatch(env.app.innerHTML,/<tes>/);
  const href=env.app.innerHTML.match(/href="(https:\/\/wa\.me\/\?text=[^"]+)"/)[1];
  await env.api.copySharedContent();
  assert.equal(new URL(href).searchParams.get('text'),copied.at(-1));
  assert.ok(copied.at(-1).includes('\n'));
  assert.match(env.app.innerHTML,/Teks berhasil disalin/);
});

test('paid assigned and preparing deliveries cannot be picked up or completed before kitchen readiness', async () => {
 for(const customerStatus of ['DRIVER_ASSIGNED','PREPARING','DELIVERING']) {
  const env=setup();Object.assign(env.order,{payment_status:'Lunas',confirmed_at:'confirmed',status:'Sedang Disiapkan',customer_order_status:customerStatus});
  env.api.state.orders=[env.order];env.api.setView('active');
  assert.doesNotMatch(env.app.innerHTML,/data-action="delivering"|data-action="complete"/);
  assert.match(env.app.innerHTML,/disiapkan|Menunggu dapur/);
  assert.doesNotMatch(env.api.renderDetail(env.order),/data-action="delivering"|data-action="complete"/);
  for(const action of ['picked','delivering','complete']) await env.api.runAction(action,env.order.id);
  assert.equal(env.backendCalls,0);
 }
});

test('kitchen-ready delivery explicitly tells the driver to collect and preserves the cashier payment guard',()=>{
 const env=setup();Object.assign(env.order,{payment_status:'Lunas',confirmed_at:'confirmed',status:'Selesai',customer_order_status:'DRIVER_ASSIGNED'});
 env.api.state.orders=[env.order];env.api.setView('active');
 assert.match(env.app.innerHTML,/Pesanan Siap Dijemput/);assert.match(env.app.innerHTML,/data-action="delivering"/);assert.doesNotMatch(env.app.innerHTML,/data-action="complete"/);
 assert.match(env.api.renderDetail(env.order),/Pesanan Siap Dijemput/);
 env.order.payment_status='Belum dibayar';env.api.setView('active');assert.doesNotMatch(env.app.innerHTML,/data-action="delivering"|data-action="complete"/);
});

test('Batal groups cancelled and missed cards with distinct explanations and no process actions',()=>{
 const env=setup();const now=new Date().toISOString();
 env.api.state.orders=[{...env.order,id:'missed',customer_order_status:'NO_DRIVER_AVAILABLE',updated_at:now},{...env.order,id:'cancelled',status:'Dibatalkan',customer_order_status:'CANCELLED',cancel_reason:'Permintaan pelanggan',updated_at:now}];
 env.api.setView('missed');
 assert.match(env.app.innerHTML,/<small>Batal<\/small>/);assert.match(env.app.innerHTML,/Pesanan terlewat/);assert.match(env.app.innerHTML,/Batas waktu penerimaan telah berakhir/);
 assert.match(env.app.innerHTML,/Pesanan dibatalkan/);assert.match(env.app.innerHTML,/Permintaan pelanggan/);
 assert.doesNotMatch(env.app.innerHTML,/data-action="take"|data-action="process"|data-action="delivering"|data-action="complete"/);
});

test('active filter excludes cancelled cards and authoritative assignment IDs prevent name collisions',()=>{
 const env=setup();const now=new Date().toISOString();
 env.api.state.orders=[env.order,{...env.order,id:'cancelled',status:'Dibatalkan',cancelled_at:now},{...env.order,id:'other',driver_id:'other-driver',driver_name:'Rifqi'}];
 env.api.setView('active');
 assert.match(env.app.innerHTML,/data-order-id="test-order"/);
 assert.doesNotMatch(env.app.innerHTML,/data-order-id="cancelled"|data-order-id="other"/);
 env.api.setView('missed');assert.match(env.app.innerHTML,/data-order-id="cancelled"/);
});

test('missed and completed history query failures do not discard successfully loaded active orders',async()=>{
 const env=setup(),results=[{data:[env.order],error:null},{data:null,error:{message:'History unavailable'}},{data:null,error:{message:'Completed unavailable'}}];let index=0;
 const client={from(){const q={};for(const method of ['select','eq','in','gte','lt','order'])q[method]=()=>q;q.limit=()=>Promise.resolve(results[index++]);return q;}};
 const result=await env.api.selectOrders(client,['id']);
 assert.equal(result.error,null);assert.equal(result.data[0].id,env.order.id);assert.match(result.warning,/riwayat/i);
});

test('verified driver feed uses the device session rather than the POS login session',async()=>{
 const calls=[];const client={rpc:async(name,args)=>{calls.push({name,args});return {data:[{id:'secure-order'}],error:null};}};
 const env=setup('history',{notifications:{deviceCredentials:()=>({id:'device',secret:'capability'})},client});
 const result=await env.api.selectOrders(client,['id']);
 assert.equal(result.data[0].id,'secure-order');assert.equal(calls[0].name,'driver_order_feed');assert.equal(calls[0].args.p_device_id,'device');assert.equal(calls[0].args.p_secret,'capability');
});

test('late responses for a logged-out account cannot overwrite the next driver session',async()=>{
 let finish;const client={rpc:()=>new Promise(resolve=>{finish=resolve;})};
 const env=setup('history',{notifications:{deviceCredentials:()=>({id:'device',secret:'capability'})},client});
 const loading=env.api.refresh({force:true});await new Promise(setImmediate);assert.equal(typeof finish,'function');
 env.api.state.profile={id:'new-driver',name:'Other'};finish({data:[{...env.order,id:'stale-account-order'}],error:null});
 await loading;assert.equal(env.api.state.orders.length,0);
});

test('collecting a ready order uses driver, kitchen and delivery status conditions on the write',async()=>{
 const writes=[];let remote;
 const client={from(){let writing=false;const query={update(value){writing=true;writes.push({value,filters:[]});remote={...remote,...value};return query;},select(){return writing?Promise.resolve({data:[{id:remote.id}],error:null}):query;},eq(...args){if(writing)writes.at(-1).filters.push(args);return query;},is(...args){if(writing)writes.at(-1).filters.push(args);return query;},in(){return query;},gte(){return query;},lt(){return query;},order(){return query;},limit(){return Promise.resolve({data:[remote],error:null});}};return query;}};
 const env=setup('history',{client});Object.assign(env.order,{payment_status:'Lunas',status:'Selesai',customer_order_status:'DRIVER_ASSIGNED',confirmed_at:'confirmed'});remote=env.order;env.api.state.orders=[env.order];
 await env.api.runAction('delivering',env.order.id);
 assert.equal(writes.length,1);assert.equal(writes[0].value.customer_order_status,'DELIVERING');
 for(const filter of [['driver_id','driver-a'],['status','Selesai'],['customer_order_status','DRIVER_ASSIGNED'],['cancelled_at',null]])assert.ok(writes[0].filters.some(value=>JSON.stringify(value)===JSON.stringify(filter)));
 assert.doesNotMatch(JSON.stringify(writes[0].value),/items|subtotal|grand_total|payment_status/);
});
