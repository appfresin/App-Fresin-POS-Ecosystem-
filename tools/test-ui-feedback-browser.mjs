import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// This browser is isolated and visits only our authored fixture, never the live POS.
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = pathToFileURL(path.join(root, 'tests/fixtures/customer-gateway.html')).href;
const customerSource = fs.readFileSync(path.join(root, 'delivery/Customer Order/customer-order.js'), 'utf8');
const emptyStart = customerSource.indexOf('  function homeRenderOrdersEmptyState()');
assert.ok(emptyStart >= 0, 'Empty orders renderer missing');
const emptyEnd = customerSource.indexOf('\n  function ', emptyStart + 3);
const emptyRenderer = customerSource.slice(emptyStart, emptyEnd).trim();
const chrome = process.env.FRESIN_QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fresin-gateway-qa-'));
const artifacts = path.join(root, 'tests/artifacts/customer-gateway');
fs.mkdirSync(artifacts, { recursive: true });
const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--disable-default-apps',
  '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
  '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let socket;
let serial = 0;
const pending = new Map();
const exceptions = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(callback, message) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    const value = await callback();
    if (value) return value;
    await delay(100);
  }
  throw Error(message);
}
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timed out: ${method}`)); }, 12000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
try {
  const portFile = path.join(profile, 'DevToolsActivePort');
  const port = await waitFor(() => {
    try { return Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]) || false; }
    catch (error) { if (['ENOENT', 'EBUSY'].includes(error.code)) return false; throw error; }
  }, 'Chrome did not start');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = pages.find(value => value.type === 'page' && value.url === 'about:blank');
  assert.ok(page, 'Own blank browser page missing');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data);
    if (value.method === 'Runtime.exceptionThrown') exceptions.push(value.params.exceptionDetails.exception?.description || value.params.exceptionDetails.text);
    if (!value.id) return;
    const call = pending.get(value.id);
    pending.delete(value.id);
    if (value.error) call?.reject(Error(value.error.message));
    else call?.resolve(value.result);
  });
  await send('Page.enable');
  await send('Runtime.enable');
  function extract(source, name) {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
    assert.ok(start >= 0, name);
    const next = /\n {0,2}(?:async )?function \w+\(/.exec(source.slice(start + 10));
    return source.slice(start, next ? start + 10 + next.index : source.length);
  }
  const driverSource = fs.readFileSync(path.join(root, 'driver/Driver Order/driver-order.js'), 'utf8')
    .replace('window.DriverOrder = {', 'window.DriverOrder = { render, renderDetail, completedFetchRange, notifyNewDriverOrders,');
  const coreSource = fs.readFileSync(path.join(root, 'delivery/app.js'), 'utf8');
  async function screenshot(name) {
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(artifacts, `feedback-${name}.png`), Buffer.from(shot.data, 'base64'));
  }
  async function loadFixture() {
    await send('Page.navigate', { url: fixture });
    await waitFor(() => evaluate('!!window.FresinGateway'), 'Fixture did not load');
    await evaluate(`window.mediaImageSrcCache=new Map(); ${['escapeHtml','mediaDriveId','mediaImageCacheKey','mediaImageLoaded','mediaImageCandidates','mediaImageSrc','mediaImageFallbackScript','mediaImageTag','productImageOrToken'].map(name=>extract(coreSource,name)).join('\n')}`);
    await evaluate('document.fonts.ready');
  }
  await loadFixture();
  await evaluate(`
    window.view='selforder';window.mediaImageSrcCache=new Map();window.mediaDriveId=()=>'';
    ${['mediaImageCacheKey','mediaImageLoaded','mediaImageCandidates','mediaImageSrc','mediaImageFallbackScript','mediaImageTag','productImageOrToken','replaceSelfOrderMarkup'].map(name=>extract(coreSource,name)).join('\n')}
    window.imagePreview=document.createElement('div');imagePreview.className='self-order-app';document.body.append(imagePreview);
    window.previewImage='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>');
    replaceSelfOrderMarkup(imagePreview,productImageOrToken({imageName:previewImage,name:'donut'},'self-order-product-img',420));
    window.originalProductImage=imagePreview.querySelector('img');
    originalProductImage.decode();
  `);
  await waitFor(()=>evaluate('originalProductImage.complete && originalProductImage.naturalWidth===20 && getComputedStyle(originalProductImage).opacity==="1"'),'Preview image did not decode');
  for(let pass=0;pass<6;pass++) {
    await evaluate(`replaceSelfOrderMarkup(imagePreview,'<h3>Updated '+${pass}+'</h3>'+productImageOrToken({imageName:previewImage,name:'donut'},'self-order-product-img',420))`);
    assert.equal(await evaluate('imagePreview.querySelector("img")===originalProductImage && originalProductImage.complete && originalProductImage.naturalWidth===20 && getComputedStyle(originalProductImage).opacity==="1"'),true,'Rerender discarded the decoded product photo');
  }
  await evaluate(`replaceSelfOrderMarkup(imagePreview,mediaImageTag(previewImage+'%20','Foto donut','self-order-product-img',420,'eager'))`);
  assert.equal(await evaluate('imagePreview.querySelector("img")===originalProductImage'),false,'Changed product photo retained a stale source');
  console.log('PASS decoded SO product images survive repeated catalog renders');
  for (const width of [310, 348, 402, 430]) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await send('Emulation.setDeviceMetricsOverride', { width, height: 700, deviceScaleFactor: 1, mobile: true });
    await loadFixture();
    await evaluate(`
      document.querySelectorAll('link[rel="stylesheet"],style').forEach(el=>el.remove());
      document.head.insertAdjacentHTML('beforeend', '<link rel="stylesheet" href="../../driver/Driver Order/driver-order.css"><link rel="stylesheet" href="../../driver/Driver Order/driver-refresh.css">');
      document.getElementById('app').innerHTML='';
      localStorage.clear(); localStorage.setItem('kasirin_driver_wallet_mode_v1','claim');
      window.DriverAppConfig={}; window.DriverUtils={}; window.DriverSupabase={ready:async()=>{throw Error('Backend disabled in fixture')}};
      ${fs.readFileSync(path.join(root,'driver/Driver Order/driver-notifications.js'),'utf8')}
      ${driverSource}
      DriverOrder.state.profile={id:'preview-driver',name:'Driver Preview'};
      DriverOrder.state.view='active'; DriverOrder.render();
    `);
    await delay(150);
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false, 'Driver overflow');
    assert.match(await evaluate("getComputedStyle(document.querySelector('.driver-shift-card')).backgroundImage"), /linear-gradient/);
    assert.ok(await evaluate("document.querySelector('.driver-topbar').getBoundingClientRect().height")<=70,'Header must fit its content');
    await screenshot(`driver-header-${width}`);
    await evaluate("document.querySelector('[data-action=toggle-settings-menu]').click();document.querySelector('[data-view=settings]').click()");
    assert.match(await evaluate('document.body.innerText'),/Dering & notifikasi/);
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,'Notification settings must fit on mobile');
    await evaluate("document.querySelector('[data-notification-setting=intervalSeconds]').value='45';document.querySelector('[data-notification-setting=intervalSeconds]').dispatchEvent(new Event('change',{bubbles:true}))");
    assert.equal(await evaluate('DriverNotifications.settings().intervalSeconds'),45);
    assert.match(await evaluate("localStorage.getItem('anterin_notification_preferences_v1')"),/45/);
    await screenshot(`driver-notification-settings-${width}`);
    await evaluate("document.querySelector('[data-action=close-settings]').click()");
    await evaluate(`
      window.alertPreview={id:'alert-preview',order_number:'D004',customer_name:'Pelanggan Preview',status:'Pesanan Baru',customer_order_status:'SEARCHING_DRIVER',updated_at:new Date().toISOString(),subtotal:5000,delivery_fee:10000};
      DriverOrder.notifyNewDriverOrders([alertPreview]);DriverOrder.render();
    `);
    assert.equal(await evaluate("!!document.querySelector('.driver-incoming-alert[role=alert]')"),true);
    await screenshot(`driver-new-order-alert-${width}`);
    await evaluate(`
      DriverOrder.notifyNewDriverOrders([]);
      DriverOrder.state.orders=[{...alertPreview,customer_order_status:'DRIVER_ASSIGNED',status:'Dibatalkan',cancel_reason:'Pelanggan membatalkan',driver_id:'preview-driver'}];
      DriverOrder.state.view='active';DriverOrder.render();
    `);
    assert.doesNotMatch(await evaluate('document.body.innerText'),/Pesanan dibatalkan/);
    await evaluate("DriverOrder.state.view='missed';DriverOrder.render()");
    assert.match(await evaluate('document.body.innerText'),/Pesanan dibatalkan/);
    assert.equal(await evaluate("!!document.querySelector('[data-action=process],[data-action=take],[data-action=delivering],[data-action=complete]')"),false);
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    await screenshot(`driver-cancelled-${width}`);
    await evaluate(`
      DriverOrder.state.orders=[{id:'missed-preview',customer_name:'Pelanggan Preview',order_number:'D003',customer_order_status:'NO_DRIVER_AVAILABLE',updated_at:new Date().toISOString(),subtotal:5000,delivery_fee:10000,created_at:new Date(Date.now()-300000).toISOString()}];
      DriverOrder.state.view='missed';DriverOrder.render();
    `);
    assert.match(await evaluate('document.body.innerText'), /Pesanan terlewat/);
    assert.match(await evaluate("document.querySelector('.driver-missed-stat').textContent"),/Batal/);
    assert.equal(await evaluate("!!document.querySelector('[data-action=take]')"), false);
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false, 'Missed orders overflow');
    await screenshot(`driver-missed-${width}`);
    await evaluate(`
      window.waitPreviewOrder={id:'wait-preview',order_number:'D002',customer_name:'Pelanggan Preview',customer_order_status:'SEARCHING_DRIVER',payment_provider:'courier_cash',payment_status:'Belum dibayar',subtotal:5000,delivery_fee:10000,grand_total:15000,created_at:new Date(Date.now()-65000).toISOString()};
      DriverOrder.state.orders=[waitPreviewOrder];DriverOrder.state.view='tasks';DriverOrder.render();
      window.waitCard=document.querySelector('.driver-order-card');
      window.firstWait=document.querySelector('[data-driver-accept-until] time').textContent;
    `);
    await waitFor(()=>evaluate("document.querySelector('[data-driver-accept-until] time').textContent !== firstWait"),'Customer wait did not tick');
    assert.equal(await evaluate("document.querySelector('.driver-order-card') === waitCard"), true, 'Wait tick must retain the card');
    assert.match(await evaluate("document.querySelector('[data-driver-accept-until]').textContent"), /Batas terima pesanan/);
    assert.ok(await evaluate("document.querySelector('[data-driver-accept-until] time').textContent < firstWait"), 'Acceptance timer must count down');
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false, 'Wait card overflow');
    await screenshot(`driver-wait-${width}`);
    await evaluate(`
      waitPreviewOrder.updated_at=new Date(Date.now()-299000).toISOString();
      DriverOrder.render();
    `);
    await waitFor(()=>evaluate("!document.querySelector('[data-action=take]')"),'Expired offer still accepts a driver');
    assert.match(await evaluate("document.querySelector('[data-view=missed]').textContent"), /1/);
    await evaluate(`DriverOrder.state.view='earnings';DriverOrder.render()`);
    const wallet = await evaluate('document.body.innerText');
    assert.match(wallet, /Riwayat pendapatan/);
    assert.doesNotMatch(wallet, /Klaim|Siap diklaim/);
    assert.equal(await evaluate('DriverOrder.state.walletMode'), 'history');
    assert.ok(await evaluate('!!DriverOrder.completedFetchRange()?.start'));
    await evaluate(`
      window.previewOrder={id:'preview-order',order_number:'D001',customer_name:'Pelanggan Preview',customer_phone:'6282100000001',customer_order_type:'DELIVERY',status:'Pesanan Baru',customer_order_status:'DRIVER_ASSIGNED',payment_provider:'courier_cash',payment_status:'Belum dibayar',subtotal:5000,delivery_fee:10000,grand_total:15000,driver_id:'preview-driver',delivery_address:'Jalan Contoh 10',delivery_note:'Pagar hijau',note:'Letak di depan pagar saja ya.\\nKurir membayar harga produk di outlet; ongkir langsung diterima kurir dari pelanggan.',delivery_latitude:5.3,delivery_longitude:95.9,created_at:new Date().toISOString(),items:[{product_name:'Air Mineral',qty:1,price:5000}]};
      DriverOrder.state.orders=[previewOrder];DriverOrder.state.view='active';DriverOrder.render();
    `);
    assert.ok(await evaluate("!!document.querySelector('[data-action=process]')"));
    assert.match(await evaluate('document.body.innerText'), /Konfirmasi WhatsApp/);
    await screenshot(`driver-process-${width}`);
    await evaluate("document.querySelector('[data-action=reject]').click()");
    assert.equal(await evaluate("document.querySelector('#driverRejectDialog').open"),true);
    assert.equal(await evaluate("document.querySelector('#driverRejectReason').required"),true);
    await evaluate(`document.querySelector('#driverRejectReason').value='Kendaraan rusak <script>window.unsafeReason=true</script>';document.querySelector('#driverRejectReason').dispatchEvent(new Event('input',{bubbles:true}));DriverOrder.render()`);
    assert.match(await evaluate("document.querySelector('#driverRejectReason').value"),/Kendaraan rusak <script>/);
    assert.equal(await evaluate('!!window.unsafeReason'),false);
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,'Rejection dialog overflow');
    await screenshot(`driver-reject-${width}`);
    await evaluate("document.querySelector('[data-action=close-reject]').click()");
    assert.equal(await evaluate("!!document.querySelector('#driverRejectDialog')"),false);

    await evaluate("Object.assign(previewOrder,{status:'Sedang Disiapkan',customer_order_status:'PREPARING',payment_status:'Lunas',confirmed_at:new Date().toISOString()});DriverOrder.render()");
    assert.equal(await evaluate("!!document.querySelector('[data-action=delivering],[data-action=complete]')"),false);
    assert.match(await evaluate("document.querySelector('.driver-kitchen-notice').textContent"),/Menunggu dapur/);
    await screenshot(`driver-kitchen-wait-${width}`);
    await evaluate("Object.assign(previewOrder,{status:'Selesai',customer_order_status:'DRIVER_ASSIGNED'});DriverOrder.render()");
    assert.ok(await evaluate("!!document.querySelector('[data-action=delivering]')"));
    assert.equal(await evaluate("!!document.querySelector('[data-action=complete]')"),false);
    assert.match(await evaluate("document.querySelector('.driver-kitchen-notice').textContent"),/Pesanan Siap Dijemput/);
    assert.match(await evaluate("document.querySelector('.driver-route-lines').textContent"),/Siap diambil/);
    assert.ok(await evaluate("document.querySelector('.driver-kitchen-notice').getBoundingClientRect().bottom <= document.querySelector('[data-action=delivering]').getBoundingClientRect().top"),'Ready notice should sit above the pickup button');
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'),false,'Ready driver card overflow');
    await screenshot(`driver-kitchen-ready-${width}`);
    await evaluate("Object.assign(previewOrder,{status:'Pesanan Baru',customer_order_status:'DRIVER_ASSIGNED',payment_status:'Belum dibayar',confirmed_at:null});DriverOrder.render()");
    await evaluate('DriverOrder.state.selectedId=previewOrder.id;DriverOrder.render()');
    assert.equal(await evaluate("!!document.querySelector('.driver-outlet-payment')"), false);
    assert.ok(await evaluate("document.body.innerText.indexOf('Alamat pengantaran') < document.body.innerText.indexOf('Item pesanan')"));
    assert.doesNotMatch(await evaluate('document.body.innerText'), /Kurir membayar harga produk|Bayar harga produk di kasir outlet/);
    assert.equal(await evaluate("document.querySelector('.driver-address-notes span:last-child strong').textContent"),'Letak di depan pagar saja ya.');
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false, 'Detail overflow');
    const item=await evaluate(`(()=>{const qty=document.querySelector('.driver-item-qty').getBoundingClientRect();const name=document.querySelector('.driver-item-copy').getBoundingClientRect();const price=document.querySelector('.driver-item-price').getBoundingClientRect();return {qtyRight:qty.right,nameLeft:name.left,nameRight:name.right,priceLeft:price.left,price:document.querySelector('.driver-item-price').textContent}})()`);
    assert.ok(item.qtyRight<item.nameLeft && item.nameRight<item.priceLeft);
    assert.equal(item.price,'Rp5.000');
    await screenshot(`driver-detail-${width}`);
    await evaluate("Object.defineProperty(navigator,'share',{configurable:true,value:undefined}); document.querySelector('[data-action=share-maps]').click()");
    assert.equal(await evaluate("document.getElementById('driverShareDialog').open"),true);
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'),false,'Share dialog overflow');
    assert.match(await evaluate("document.querySelector('.driver-share-dialog a').href"),/wa.me/);
    await screenshot(`driver-share-${width}`);
    await evaluate("document.querySelector('[data-action=close-share]').click()");
    assert.equal(await evaluate("!!document.getElementById('driverShareDialog')"),false);
    await evaluate("document.querySelector('[data-action=share-phone]').click()");
    assert.equal(await evaluate("document.getElementById('driverShareDialog').open"),true);
    assert.equal(await evaluate("document.querySelector('.driver-share-dialog textarea').value"),'Nama: Pelanggan Preview\nWhatsApp: 6282100000001');
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'),false,'Phone share overflow');
    await screenshot(`driver-share-phone-${width}`);
    await evaluate("document.querySelector('[data-action=close-share]').click();document.querySelector('[data-action=share-order]').click()");
    const sharedOrder=await evaluate("document.querySelector('.driver-share-dialog textarea').value");
    assert.match(sharedOrder,/ITEM PESANAN\n1× Air Mineral — Rp5\.000/);
    assert.match(sharedOrder,/Patokan:\nPagar hijau\n\nLokasi:\nhttps:\/\/www.google.com\/maps/);
    assert.doesNotMatch(sharedOrder,/Kurir membayar harga produk|Alamat pengantaran:|Pin lokasi:/);
    assert.equal(await evaluate("new URL(document.querySelector('.driver-share-dialog a').href).searchParams.get('text')"),sharedOrder);
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'),false,'Order share overflow');
    await screenshot(`driver-share-order-${width}`);
    await evaluate("window.copiedShare='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.copiedShare=text}});document.querySelector('[data-action=copy-share]').click()");
    await waitFor(()=>evaluate("document.querySelector('.driver-share-dialog [role=status]').textContent.includes('Teks berhasil disalin')"),'Copy order message missing');
    assert.equal(await evaluate('window.copiedShare'),sharedOrder);
    await evaluate("document.querySelector('[data-action=close-share]').click()");

    await loadFixture();
    await evaluate(`
      ${extract(coreSource, 'selfOrderAsikIcon')}
      ${extract(coreSource, 'renderSelfOrderUpsellCard')}
      window.selfOrderUpsellProducts=()=>[
        {name:'Cappucino Flakes Donut',priceLabel:'Rp 7.000',key:'one',product:{}},
        {name:'Avocado Chocolate Premium Donut',priceLabel:'Rp 7.000',key:'two',product:{}}
      ];
      window.productImageOrToken=()=>'<span class="self-order-product-token">D</span>';
      document.getElementById('app').innerHTML='<section class="self-order-app"><main class="self-order-main cart">'+renderSelfOrderUpsellCard('cart')+'</main></section>';
    `);
    const upsell = await evaluate(`(() => {
      const name=document.querySelector('.self-order-upsell-item strong');
      const price=document.querySelector('.self-order-upsell-price');
      const button=document.querySelector('.self-order-upsell-item button');
      return {overflow:document.documentElement.scrollWidth>innerWidth, wrap:getComputedStyle(name).whiteSpace,
        nameBottom:name.getBoundingClientRect().bottom,priceTop:price.getBoundingClientRect().top,
        title:name.textContent, button:button.getBoundingClientRect().width};
    })()`);
    assert.equal(upsell.overflow, false);
    assert.equal(upsell.wrap, 'normal');
    assert.ok(upsell.priceTop >= upsell.nameBottom);
    assert.match(upsell.title, /Cappucino Flakes Donut/);
    assert.match(await evaluate("getComputedStyle(document.querySelector('.self-order-upsell-head')).backgroundImage"),/linear-gradient/);
    await screenshot(`upsell-${width}`);

    await evaluate(`
      ${extract(coreSource, 'renderSelfOrderPayment')}
      ${extract(coreSource, 'selfOrderTabIcon')}
      ${extract(coreSource, 'renderSelfOrderBottomNav')}
      window.syncSelfOrderTableFromUrl=()=>{};window.selfOrderOpenTableOrder=()=>null;
      window.selfOrderOpenTableChoice=()=>'';window.selfOrderSubtotal=()=>5000;
      window.selfOrderItemsTotal=()=>1;window.money=n=>'Rp '+n.toLocaleString('id-ID');
      window.selfOrderSubmitError='';
      sessionStorage.setItem('self_order_table','A-1');
      document.getElementById('app').innerHTML='<section class="self-order-app fresin-table-menu">'+renderSelfOrderPayment()+renderSelfOrderBottomNav('payment')+'</section>';
    `);
    const tablePayment = await evaluate(`(() => {
      const head=document.querySelector('.self-order-payment-head');
      const label=head.querySelector('span').getBoundingClientRect(),total=head.querySelector('h3').getBoundingClientRect();
      const plus=document.querySelector('.self-order-upsell-item button'),mark=plus.querySelector('svg');
      const button=plus.getBoundingClientRect(),svg=mark.getBoundingClientRect();
      return {overflow:document.documentElement.scrollWidth>innerWidth,
        rowOffset:Math.abs((label.top+label.height/2)-(total.top+total.height/2)),
        plusX:Math.abs(button.left+button.width/2-svg.left-svg.width/2),
        plusY:Math.abs(button.top+button.height/2-svg.top-svg.height/2),
        navIcons:document.querySelectorAll('.self-order-nav-icon .self-order-line-icon').length,
        cartBadge:document.querySelector('.self-order-nav-icon em').textContent};
    })()`);
    assert.equal(tablePayment.overflow,false);
    assert.ok(tablePayment.rowOffset<1,'Payment and amount should share a row');
    assert.ok(tablePayment.plusX<1 && tablePayment.plusY<1,'Plus must be centered');
    assert.equal(tablePayment.navIcons,3);assert.equal(tablePayment.cartBadge,'1');
    assert.equal(await evaluate("document.getElementById('selfOrderCustomer').placeholder"),'Nama pemesan');
    assert.equal(await evaluate("document.getElementById('selfOrderCheckoutNote').placeholder"),'Catatan pesanan (opsional)');
    assert.equal(await evaluate("getComputedStyle(document.getElementById('selfOrderCustomer').previousElementSibling).position"),'absolute');
    assert.ok(await evaluate("document.getElementById('selfOrderCheckoutNote').getBoundingClientRect().height<=60"),'Note field should start compact');
    const recommendationHead=await evaluate(`(()=>{const card=document.querySelector('.self-order-upsell-card.payment'),head=card.querySelector('.self-order-upsell-head'),title=head.querySelector('h4'),a=card.getBoundingClientRect(),b=head.getBoundingClientRect();return {title:title.textContent,lines:title.getBoundingClientRect().height/parseFloat(getComputedStyle(title).lineHeight),overflow:title.scrollWidth>title.clientWidth,chip:!!head.querySelector('b'),subtitle:!!head.querySelector('p'),inset:Math.max(b.left-a.left,a.right-b.right),height:b.height}})()`);
    assert.equal(recommendationHead.title,'Rekomendasi Best Seller');
    assert.ok(recommendationHead.lines<1.1 && !recommendationHead.overflow,'Best Seller title must fit one line');
    assert.equal(recommendationHead.chip,false);assert.equal(recommendationHead.subtitle,true);
    assert.equal(await evaluate("document.querySelector('.self-order-upsell-card.payment .self-order-upsell-head p').textContent"),'Tambahkan favorit lain sebelum pesanan dikirim');
    assert.ok(recommendationHead.inset<2,'Colored header should reach the card edges');
    assert.ok(recommendationHead.height<95,'Recommendation header should stay compact');
    await screenshot(`so-payment-${width}`);

    await evaluate(`
      ${extract(coreSource, 'renderSelfOrderCart')}
      ${extract(coreSource, 'renderSelfOrderOpenTableDecision')}
      ${extract(coreSource, 'renderSelfOrderOpenTableHistory')}
      ${extract(customerSource, 'homeRenderCart')}
      selfOrderCart=[{lineId:'preview-line',name:'Air Mineral',qty:1,price:5000}];
      window.cartItemTotal=item=>item.price*item.qty;window.orderItemNoteHtml=()=>'';
      window.homeCheckout=()=>({method:'DELIVERY'});window.homeSetCheckout=()=>{};
      window.homeEscape=escapeHtml;window.homeMoney=money;window.homeRenderSupportContact=()=>'';
      document.getElementById('app').innerHTML='<section class="self-order-app">'+renderSelfOrderCart()+'</section>';
      window.soCartHeading=document.querySelector('.self-order-cart-head').outerHTML.replace(/\\s+/g,' ');
    `);
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'),false,'SO cart overflow');
    assert.match(await evaluate("document.querySelector('.self-order-cart-title').textContent"),/Pesanan\s+1 item/);
    assert.ok(await evaluate("(()=>{const button=document.querySelector('.self-order-qty button.danger').getBoundingClientRect(),icon=document.querySelector('.self-order-remove-icon').getBoundingClientRect();return Math.abs(button.left+button.width/2-icon.left-icon.width/2)<1&&Math.abs(button.top+button.height/2-icon.top-icon.height/2)<1})()"),'Remove icon should be centered');
    await screenshot(`so-cart-chip-${width}`);
    await evaluate("document.getElementById('app').innerHTML='<section class=\"self-order-app\">'+homeRenderCart()+'</section>'");
    assert.equal(await evaluate("document.querySelector('.self-order-cart-head').outerHTML.replace(/\\s+/g,' ')===soCartHeading"),true,'Cart chip must match across services');
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'),false,'Home cart overflow');
    await screenshot(`home-cart-chip-${width}`);
    await evaluate(`
      window.groupedOrderItems=order=>[{label:'Pesanan pertama',items:order.items}];
      window.orderItemInlineLabel=item=>item.qty+'× '+item.name;
      window.selfOrderChooseOpenTableOrder=choice=>window.previewTableChoice=choice;
      window.previewPreviousOrder={customer:'Pelanggan dengan nama sangat panjang untuk pengujian tampilan',paymentStatus:'Belum dibayar',items:[{name:'Air Mineral',qty:1}]};
      document.getElementById('app').innerHTML='<section class="self-order-app"><main class="self-order-main payment">'+renderSelfOrderOpenTableDecision(previewPreviousOrder,'A-1','')+'</main></section>';
    `);
    const previous=await evaluate(`(()=>{
      const rows=[...document.querySelectorAll('.self-order-open-table-meta > span')];
      const buttons=[...document.querySelectorAll('.self-order-open-table-actions button')];
      return {overflow:document.documentElement.scrollWidth>innerWidth,
        rows:rows.map(row=>{const label=row.querySelector('.self-order-open-table-label').getBoundingClientRect(),value=row.querySelector('b').getBoundingClientRect();return {left:label.left,right:label.right,valueLeft:value.left,valueRight:value.right,top:row.getBoundingClientRect().top,overflow:row.scrollWidth>row.clientWidth}}),
        colors:buttons.map(button=>getComputedStyle(button).backgroundColor),
        icon:!!document.querySelector('.self-order-open-table-icon svg'),
        status:(()=>{const b=rows.at(-1).querySelector('b'),css=getComputedStyle(b);return b.getBoundingClientRect().height-parseFloat(css.paddingTop)-parseFloat(css.paddingBottom)-parseFloat(css.borderTopWidth)-parseFloat(css.borderBottomWidth)})(),
        statusLine:parseFloat(getComputedStyle(rows.at(-1).querySelector('b')).lineHeight)};
    })()`);
    assert.equal(previous.overflow,false,'Previous order overflow');
    assert.ok(previous.icon,'Previous order must use illustrated icon');
    assert.ok(previous.rows.every(row=>!row.overflow && row.right<row.valueLeft));
    assert.ok(previous.rows[1].top>previous.rows[0].top && previous.rows[2].top>previous.rows[1].top);
    assert.ok(previous.status<previous.statusLine*1.5,'Payment status should fit one line');
    assert.notEqual(previous.colors[0],previous.colors[1],'Yes and no should have distinct colors');
    await screenshot(`previous-order-${width}`);
    await evaluate("document.querySelector('.self-order-open-table-actions button:first-child').click()");
    assert.equal(await evaluate('window.previewTableChoice'),'append');
    await evaluate("document.querySelector('.self-order-open-table-actions button:last-child').click()");
    assert.equal(await evaluate('window.previewTableChoice'),'new');

    await evaluate(`
      ${extract(customerSource, 'homeRenderCheckout')}
      window.fixtureCheckout={method:'DELIVERY',name:'',phone:'',addressNote:'',note:''};
      window.homeCheckout=()=>fixtureCheckout;window.homeInputValue=(id,key)=>fixtureCheckout[key]||'';
      window.homeCalculateDeliveryFee=()=>10000;window.selfOrderSubtotal=()=>5000;window.homeMoney=n=>'Rp'+n.toLocaleString('id-ID');
      window.homeEscape=value=>escapeHtml(value);window.homeCheckoutErrors={};window.selfOrderSubmitError='';
      window.homeCheckoutFieldError=()=>'';window.homeCheckoutInvalidAttrs=()=>'';
      window.homeDeliveryIconSvg=()=>'';window.homeTakeawayIconSvg=()=>'';
      window.homeRenderReview=()=>'';window.homeRenderSupportContact=()=>'';
      window.homeRenderLocationPin=()=>'<section class="customer-home-location-pin is-pinned"><div class="customer-home-location-copy"><strong>Lokasi sudah dipilih</strong></div><div class="customer-home-maplibre-map-card"><div class="customer-home-map-locate-control maplibregl-ctrl"><button type="button" aria-label="Pusatkan lokasi saya saat ini"><span class="customer-home-locate-icon">⌖</span><span class="customer-home-locate-label">Lokasi terkini</span></button></div></div><button class="customer-home-location-btn is-confirmed">Lokasi sudah dipilih</button><p id="customerHomeLocationBody" class="customer-home-location-note">Titik pengantaran sudah ditetapkan.</p></section>';
      document.getElementById('app').innerHTML='<section class="self-order-app">'+homeRenderCheckout()+'</section>';
    `);
    await evaluate(`
      ${extract(customerSource,'homeRenderLocationPin')}
      window.homeLocationUiState=()=>({pinned:true,confirmed:true,currentLocationSelected:false,currentButton:'Pilih lokasi saya saat ini',loading:false,adjusted:false,title:'Lokasi sudah dipilih',button:'Lokasi sudah dipilih',buttonAction:'CustomerOrder.pinCurrentLocation()',buttonDisabled:true,body:'Titik pengantaran sudah ditetapkan.'});
      window.homeRenderMapLoading=()=>'<div class="customer-home-map-locate-control maplibregl-ctrl"><button type="button" aria-label="Pusatkan lokasi saya saat ini"><span class="customer-home-locate-icon">⌖</span><span class="customer-home-locate-label">Lokasi terkini</span></button></div>';window.previewLocationRequests=0;
      window.CustomerOrder={...(window.CustomerOrder||{}),pinCurrentLocation(){previewLocationRequests++;}};
      document.querySelector('.customer-home-location-pin').outerHTML=homeRenderLocationPin();
    `);
    const locationButtons=await evaluate(`(()=>{const current=document.querySelector('#customerHomeCurrentLocationButton'),confirm=document.querySelector('#customerHomeLocationButton');return {current:current.textContent,disabled:current.disabled,before:current.getBoundingClientRect().bottom<=confirm.getBoundingClientRect().top};})()`);
    assert.match(locationButtons.current,/Pilih lokasi saya saat ini/);assert.equal(locationButtons.disabled,false);assert.equal(locationButtons.before,true);
    await evaluate("document.querySelector('#customerHomeCurrentLocationButton').click()");assert.equal(await evaluate('previewLocationRequests'),1);
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false, 'Checkout overflow');
    assert.equal(await evaluate("document.querySelector('#customerHomeName').placeholder"), 'Nama penerima');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#customerHomeName').previousElementSibling).position"), 'absolute');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#customerHomeLocationBody')).textAlign"), 'center');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.customer-home-map-locate-control button')).animationName"), 'fresinLocateNudge');
    await send('DOM.enable');await send('CSS.enable');
    const mapDocument=await send('DOM.getDocument');
    const mapButton=await send('DOM.querySelector',{nodeId:mapDocument.root.nodeId,selector:'.customer-home-map-locate-control button'});
    await send('CSS.forcePseudoState',{nodeId:mapButton.nodeId,forcedPseudoClasses:['hover']});
    const hover=await evaluate("({background:getComputedStyle(document.querySelector('.customer-home-map-locate-control button')).backgroundColor,opacity:getComputedStyle(document.querySelector('.customer-home-map-locate-control button')).opacity})");
    assert.equal(hover.background,'rgb(255, 229, 182)');assert.equal(hover.opacity,'1');
    await send('CSS.forcePseudoState',{nodeId:mapButton.nodeId,forcedPseudoClasses:[]});
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.customer-home-map-locate-control button')).animationName"), 'none');
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await screenshot(`checkout-${width}`);

    await evaluate(`
      ${extract(customerSource, 'homeRenderDriverSearchPanel')}
      window.homeCustomerStatus=order=>order.customerStatus||'SEARCHING_DRIVER';
      window.homeDriverSearchRemainingMs=()=>148000;window.homeDriverSearchProgress=()=>51;
      window.homeDriverSearchTimeLabel=()=>'02:28';window.homeIsPayLaterOrder=()=>true;
      document.getElementById('app').innerHTML='<section class="self-order-app"><main class="self-order-main success">'+homeRenderDriverSearchPanel({})+'</main></section>';
    `);
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false, 'Search overflow');
    assert.equal(await evaluate("!!document.querySelector('.customer-home-driver-search-copy > small')"), false);
    assert.match(await evaluate("getComputedStyle(document.querySelector('.customer-home-driver-search-panel')).backgroundImage"), /linear-gradient/);
    assert.notEqual(await evaluate("getComputedStyle(document.querySelector('.customer-home-driver-search-chip')).borderStyle"), 'none');
    assert.doesNotMatch(await evaluate("document.querySelector('.customer-home-driver-search-chip').textContent"), /Pembayaran dilakukan/);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.customer-home-driver-radar')).animationName"), 'customer-home-driver-radar');
    const radarTransform = await evaluate("getComputedStyle(document.querySelector('.customer-home-driver-radar')).transform");
    await waitFor(()=>evaluate(`getComputedStyle(document.querySelector('.customer-home-driver-radar')).transform !== ${JSON.stringify(radarTransform)}`),'Radar animation is stationary');
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.customer-home-driver-radar')).animationName"), 'customer-home-driver-radar', 'Explicit radar motion remains enabled');
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await screenshot(`driver-search-${width}`);
    await evaluate(`document.querySelector('#app .self-order-main').innerHTML=homeRenderDriverSearchPanel({customerStatus:'NO_DRIVER_AVAILABLE'})`);
    assert.match(await evaluate('document.body.innerText'), /Coba Cari Driver Lagi/);
    assert.doesNotMatch(await evaluate('document.body.innerText'), /dalam 5 menit/);
    assert.equal(await evaluate("!!document.querySelector('.customer-home-driver-unavailable svg')"), true);
    assert.equal(await evaluate("!!document.querySelector('.customer-home-driver-radar')"), false);
    await evaluate(`
      ${extract(customerSource, 'homeCashProgress')}
      window.homeOrderKind=()=> 'DELIVERY';
      window.previewProgressOrder={};
      document.querySelector('#app .self-order-main').insertAdjacentHTML('beforeend',homeCashProgress(previewProgressOrder));
    `);
    assert.equal(await evaluate("document.querySelectorAll('.customer-home-statusbar > span').length"), 5);
    assert.equal(await evaluate("document.querySelectorAll('.customer-home-statusbar [aria-current=step]').length"), 1);
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false, 'Tracking timeline overflow');
    assert.match(await evaluate("getComputedStyle(document.querySelector('.customer-home-statusbar')).backgroundImage"), /linear-gradient/);
    assert.match(await evaluate("getComputedStyle(document.querySelector('.customer-home-statusbar .current i')).backgroundImage"), /linear-gradient/);
    await screenshot(`driver-unavailable-${width}`);
    await evaluate(`
      ${extract(fs.readFileSync(path.join(root,'SO Takeaway/so-takeaway.js'),'utf8'),'soTakeawayResultHero')}
      window.soTakeawayEscape=homeEscape;
      document.querySelector('#app .self-order-main').insertAdjacentHTML('afterbegin',soTakeawayResultHero({title:'Pesanan berhasil dibuat',note:'Sedang mencari kurir untuk pesananmu.'}));
    `);
    assert.equal(await evaluate("!!document.querySelector('.so-takeaway-success-icon.icon-asik svg')"), true);
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false, 'Illustrated success hero overflow');
    await screenshot(`icon-asik-${width}`);
    await evaluate(`
      ${extract(customerSource, 'homeDriverCard')}
      ${extract(customerSource, 'homeRenderCashStatus')}
      ${extract(fs.readFileSync(path.join(root,'SO Takeaway/so-takeaway.js'),'utf8'),'soTakeawayDetailHtml')}
      window.HOME_CONFIG={driverName:'Driver Preview',driverWhatsapp:'08000000000'};
      window.homeIsPaid=()=>false;window.soTakeawayIsPaid=()=>false;window.soTakeawayMoney=homeMoney;
      window.homeOrderTotal=()=>15000;
      window.SOTakeaway={renderHero:soTakeawayResultHero,renderDetails:soTakeawayDetailHtml,renderSuccessActions:()=>''};
      window.driverCardOrder={number:'D001',customer:'Pelanggan Preview',customerStatus:'DRIVER_ASSIGNED',driverId:'driver-preview',driverName:'Driver Preview',driverWhatsapp:'08000000000'};
      document.getElementById('app').innerHTML='<section class="self-order-app">'+homeRenderCashStatus(driverCardOrder)+'</section>';
    `);
    assert.equal(await evaluate("!!document.querySelector('.so-takeaway-result-hero .so-takeaway-status-highlight')"),false);
    assert.match(await evaluate("document.querySelector('.customer-home-progress-card .customer-home-current-status').textContent"),/Menunggu kurir memproses/);
    assert.equal(await evaluate("!!document.querySelector('.customer-home-driver-avatar svg')"),true);
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'),false,'Assigned driver status overflow');
    await screenshot(`assigned-driver-${width}`);
    const driverRow=await evaluate(`(()=>{const name=document.querySelector('.customer-home-driver-main > div').getBoundingClientRect(),contact=document.querySelector('.customer-home-driver-contact').getBoundingClientRect();return {nameCenter:name.y+name.height/2,contactCenter:contact.y+contact.height/2,beside:contact.x>=name.right};})()`);
    assert.ok(Math.abs(driverRow.nameCenter-driverRow.contactCenter)<2,'Driver contact must share the identity row');
    assert.equal(driverRow.beside,true,'Driver contact must sit beside the driver name');
    await evaluate(`driverCardOrder.driverName='Muhammad Rifqi Nama Driver Panjang';document.getElementById('app').innerHTML='<section class="self-order-app">'+homeRenderCashStatus(driverCardOrder)+'</section>'`);
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'),false,'Long driver name overflow');


    await evaluate(`
      ${extract(coreSource,'renderCartSuccess')}
      ${extract(coreSource,'displayOrderNumber')}
      document.querySelector('link[href*="05-orders-modals"]').insertAdjacentHTML('beforebegin','<link rel="stylesheet" href="../../styles/03-reports-products.css"><link rel="stylesheet" href="../../styles/04-pos-products.css">');
      sessionStorage.setItem('pos_last_result',JSON.stringify({title:'Pembayaran berhasil',message:'Pesanan belum bayar sudah dilunasi. Struk kasir siap dicetak.',number:'ORD-20261113-001POS',total:5000,paid:true,receivedAmount:10000,changeAmount:5000}));
      document.getElementById('app').innerHTML='<section class="cart-success-page">'+renderCartSuccess()+'</section>';
    `);
    await waitFor(()=>evaluate("getComputedStyle(document.querySelector('.new-sale-success-btn')).backgroundColor==='rgb(79, 176, 138)'"),'POS button styles did not load');
    assert.equal(await evaluate("!!document.querySelector('.pos-success-asik svg')"),true);
    assert.equal(await evaluate("document.querySelector('.success-card > p').textContent"),'pesanan sudah lunas, struk kasir siap dicetak');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.new-sale-success-btn')).borderRadius"),await evaluate("getComputedStyle(document.querySelector('.receipt-success-btn')).borderRadius"));
    assert.equal(await evaluate("document.querySelector('.new-sale-success-btn').getBoundingClientRect().width"),await evaluate("document.querySelector('.receipt-success-btn').getBoundingClientRect().width"));
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'),false,'POS payment result overflow');
    await screenshot(`pos-payment-success-${width}`);
    const reportsSource=fs.readFileSync(path.join(root,'pages/reports.js'),'utf8');
    await evaluate(`
      (async()=>{
      document.querySelector('link[href*="03-reports-products"]').insertAdjacentHTML('beforebegin','<link rel="stylesheet" href="../../styles/02-dashboard-reports.css">');
      document.head.insertAdjacentHTML('beforeend','<link rel="stylesheet" href="../../styles/06-responsive.css"><link rel="stylesheet" href="../../styles/07-dashboard-overrides.css">');
      ${['openReportVisitorReceipt','reportReceiptEventGuard','reportReceiptMenu','reportReceiptLogoMarkup','toggleReportReceiptMenu'].map(name=>extract(reportsSource,name)).join('\n')}
      window.toggleReportReceiptMenu=toggleReportReceiptMenu;
      state.settings.receiptStoreName='Fresin Indonesia';state.settings.receiptAddress='Outlet Utama, Sigli';
      state.settings.receiptShowLogo=true;state.settings.receiptLogoDataUrl=fixtureLogo;
      window.fixtureReportOrder={number:'D001',createdAt:'2026-11-12T11:59:00Z',paidAt:'2026-11-13T08:03:00Z',type:'Delivery',customer:'Nama Pelanggan Panjang Tetap Terbaca',paymentMethod:'Campuran',subtotal:5000,discount:0,total:5000,items:[{name:'Air Mineral',qty:1,price:5000}]};
      window.resolveReportReceiptOrder=async()=>fixtureReportOrder;window.reportRecordKey=order=>order.number;window.shortOrderNumber=number=>'#'+number;
      window.reportReceiptSiblingKey=()=>'';window.orderCashAmount=()=>3000;window.orderQrisAmount=()=>2000;
      window.dateTime=value=>value.includes('11-12')?'12 Nov 2026, 18.59':'13 Nov 2026, 15.03';
      window.orderItemModifiers=()=>['Dingin'];window.openModal=html=>document.getElementById('app').innerHTML='<div id="drawer"><div class="modal"><div class="modal-card">'+html+'</div></div></div>';
      await openReportVisitorReceipt(null,'D001');
      })();
    `);
    await waitFor(()=>evaluate("getComputedStyle(document.querySelector('.visitor-receipt-paper')).getPropertyValue('--receipt-paper-color').trim()==='#fffdf7'"),'Receipt paper styling missing');
    const reportReceipt=await evaluate(`(()=>{const paper=document.querySelector('.visitor-receipt-paper');return {text:paper.innerText,edges:paper.querySelectorAll('.visitor-receipt-tear').length,overflow:document.documentElement.scrollWidth>innerWidth,logo:paper.querySelector('img')?.getAttribute('src'),height:paper.getBoundingClientRect().height,menu:document.querySelector('.visitor-receipt-menu-panel').hidden}})()`);
    assert.equal(reportReceipt.overflow,false,'Report receipt overflow');
    assert.equal(reportReceipt.edges,2);assert.ok(reportReceipt.height<560,'Receipt stays compact');
    for(const text of ['Fresin Indonesia','Outlet Utama, Sigli','#D001','Waktu dibuat','Waktu dibayar','12 Nov 2026, 18.59','13 Nov 2026, 15.03','Delivery','Nama Pelanggan Panjang Tetap Terbaca','Campuran','Air Mineral','Dingin','Subtotal','Diskon','Total','Cash','QRIS','3.000','2.000']) assert.ok(reportReceipt.text.includes(text),'Receipt missing '+text);
    assert.ok(reportReceipt.logo?.startsWith('data:image/'));assert.equal(reportReceipt.menu,true);
    await screenshot(`report-receipt-${width}`);
    await evaluate("document.querySelector('.visitor-receipt-menu-toggle').click()");
    assert.equal(await evaluate("document.querySelector('.visitor-receipt-menu-panel').hidden"),false);
    assert.match(await evaluate("document.querySelector('.visitor-receipt-menu-panel').innerText"),/Hapus struk[\s\S]*Cetak struk[\s\S]*Unduh gambar/);
    await evaluate("document.querySelector('.visitor-receipt-menu-toggle').click()");
    await evaluate(`
      ${['soTakeawayIsDelivery','soTakeawayServiceLabel','soTakeawayDeliveryStatusLabel','soTakeawayPosDeliveryNote','soTakeawayOrderCard'].map(name=>extract(fs.readFileSync(path.join(root,'SO Takeaway/so-takeaway.js'),'utf8'),name)).join('\n')}
      document.querySelector('.app-shell').className='app-shell view-orders';
      window.soTakeawayProcessingIds=new Set();window.soTakeawayCanProcessOrder=()=>true;
      window.orderUsesOutletPayment=()=>true;window.soTakeawayNumber=order=>order.number;
      window.customerDisplayName=value=>value;window.soTakeawayDateTime=()=> '13 Nov 2026, 12:00';
      window.orderTotal=order=>order.subtotal;window.orderSequenceBadge=()=>'';
      window.groupedOrderItems=order=>[{batch:1,items:order.items}];window.orderGroupNote=order=>order.note;
      window.orderItemInlineLabel=item=>item.name;window.orderItemNoteHtml=()=>'';window.cartItemTotal=item=>item.qty*item.price;
      window.posDeliveryPreview={id:'pos-delivery-preview',number:'D001',customer:'Pemesan Preview',type:'Delivery',customerOrderType:'DELIVERY',customerOrderStatus:'DRIVER_ASSIGNED',driverId:'fixture-driver',paymentProvider:'courier_cash',paymentStatus:'Belum dibayar',status:'Pesanan Baru',subtotal:5000,
        note:'Tanpa gula\\nPin lokasi: https://maps.google.com/?q=5.12,95.34\\nPatokan alamat: Rumah pagar merah',items:[{name:'Air Mineral',qty:1,price:5000}]};
      document.getElementById('app').innerHTML='<section class="orders-page">'+soTakeawayOrderCard(posDeliveryPreview)+'</section>';
    `);
    const deliveryText=await evaluate('document.body.innerText');
    assert.match(deliveryText,/Pemesan Preview/);assert.match(deliveryText,/Delivery/);assert.match(deliveryText,/Kurir ditugaskan/);assert.match(deliveryText,/Tanpa gula/);
    assert.doesNotMatch(deliveryText,/Pin lokasi|maps\.google|Rumah pagar merah|5\.12/);
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'),false,'POS delivery card overflow');
    await screenshot(`pos-delivery-card-${width}`);
    await evaluate(`
      window.soTakeawayStatusLabel=()=> 'MENUNGGU KASIR';
      window.posPickupPreview={...posDeliveryPreview,number:'P001',customer:'Nama Pemesan Panjang Tetap Terbaca',type:'Take Away',customerOrderType:'PICKUP_PREORDER',serviceInfo:'Takeaway-Rumah',paymentProvider:'cash_at_outlet',pickupTime:'Secepatnya',note:'Bungkus terpisah'};
      document.getElementById('app').innerHTML='<section class="orders-page"><div class="orders-list-grid">'+soTakeawayOrderCard(posPickupPreview)+'</div></section>';
    `);
    const pickupCard=await evaluate(`({text:document.body.innerText,overflow:document.documentElement.scrollWidth>innerWidth,
      status:getComputedStyle(document.querySelector('.orders-status-pill')).backgroundColor,
      radius:getComputedStyle(document.querySelector('.orders-status-pill')).borderRadius,
      serviceBeforeName:!!document.querySelector('.so-takeaway-order-heading .so-takeaway-type-chip + .so-takeaway-order-number'),
      noteStyle:[document.querySelector('.so-takeaway-pickup-note'),document.querySelector('.orders-item-group .orders-item-group-note')].map(el=>{const s=getComputedStyle(el);return [s.padding,s.fontSize,s.borderRadius]}),
      meta:document.querySelector('.orders-card-meta').textContent})`);
    assert.equal(pickupCard.overflow,false);assert.match(pickupCard.text,/Jam pengambilan: Secepatnya/);
    assert.doesNotMatch(pickupCard.meta,/item|Ambil/);assert.equal(pickupCard.status,'rgb(255, 241, 216)');
    assert.equal(pickupCard.radius,'999px');assert.equal(pickupCard.serviceBeforeName,true);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.so-takeaway-order-time')).fontWeight"),'700','Order date stays bold');
    if (width >= 348) {
      const metadata = await evaluate(`(() => {const time=document.querySelector('.so-takeaway-order-time').getBoundingClientRect();return [...document.querySelectorAll('.orders-card-meta > span')].map(el=>{const r=el.getBoundingClientRect();return {sameLine:Math.abs((r.top+r.bottom)/2-(time.top+time.bottom)/2)<2,afterDate:r.left>=time.right};});})()`);
      assert.ok(metadata.every(chip=>chip.sameLine&&chip.afterDate),'Date and order chips must share a row, with chips after the date');
    }
    assert.deepEqual(pickupCard.noteStyle[0],pickupCard.noteStyle[1]);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.so-takeaway-pickup-note')).backgroundColor"),'rgb(234, 243, 255)');
    await screenshot(`pos-pickup-card-${width}`);
    await evaluate(`posPickupPreview.customer='Pelanggan';document.getElementById('app').innerHTML='<section class="orders-page"><div class="orders-list-grid">'+soTakeawayOrderCard(posPickupPreview)+'</div></section>'`);
    assert.ok(await evaluate("document.querySelector('.orders-card-head').getBoundingClientRect().height")<76,'Short-customer header must stay compact');
    await screenshot(`pos-pickup-compact-${width}`);
    await evaluate(`
      ${extract(coreSource,'orderCenterCard')}
      ${extract(coreSource,'reportRecordKey')}
      ${extract(coreSource,'orderItemNoteHtml')}
      window.compactOrderStatus=()=> 'Selesai';window.reportOrderDetailLoadingKeys=new Set();
      window.orderServiceInfoDisplay=order=>order.serviceInfo;window.orderItemInlineLabel=item=>item.qty+'x '+item.name;
      window.previewReportCard={id:'report-preview',number:'D001',createdAt:'2026-11-12T11:59:00Z',paidAt:'2026-11-13T08:03:00Z',type:'Delivery',serviceInfo:'Delivery',customer:'Pelanggan Preview',subtotal:5000,total:5000,status:'Selesai',paymentStatus:'Lunas',reportOnly:true,note:'Letak di depan pagar saja ya.\\nKurir membayar harga produk di outlet; ongkir langsung diterima kurir dari pelanggan.',items:[{name:'Air Mineral',qty:1,price:5000,note:'Dingin'}]};
      document.getElementById('app').innerHTML='<section class="orders-page"><div class="orders-list-grid">'+orderCenterCard(previewReportCard)+'</div></section>';
    `);
    const completedCard=await evaluate('document.body.innerText');
    assert.match(completedCard,/1x Air Mineral/);assert.match(completedCard,/Dingin/);assert.match(completedCard,/Letak di depan pagar saja ya/);
    assert.doesNotMatch(completedCard,/Ringkasan transaksi|Kurir membayar harga produk/);
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'),false,'Completed order detail overflow');
    await screenshot(`pos-completed-order-details-${width}`);
    await evaluate(`
      window.previewDineIn={...previewReportCard,type:'Dine In',serviceInfo:'D-3',customer:'Pelanggan Contoh',number:'001MQ7'};
      document.getElementById('app').innerHTML='<section class="orders-page"><div class="orders-list-grid">'+orderCenterCard(previewDineIn)+'</div></section>';
    `);
    const dineIn=await evaluate(`({header:document.querySelector('.orders-card-head').textContent,meta:document.querySelector('.orders-card-meta').textContent,chip:document.querySelector('.orders-service-chip').textContent,overflow:document.documentElement.scrollWidth>innerWidth})`);
    assert.equal(dineIn.chip,'D-3');assert.match(dineIn.header,/D-3Pelanggan Contoh/);assert.doesNotMatch(dineIn.header,/001MQ7/);
    assert.match(dineIn.meta,/001MQ7/);assert.doesNotMatch(dineIn.meta,/D-3|Pelanggan Contoh/);assert.equal(dineIn.overflow,false);
    await screenshot(`pos-dinein-heading-${width}`);
    await evaluate(`
      ${['kitchenOrderNoteDisplay','kitchenCard','nextKitchenAction','orderSequenceBadge'].map(name=>extract(coreSource,name)).join('\n')}
      document.querySelector('.app-shell').className='app-shell view-kitchen';
      window.normalizeOrderBatches=()=>{};window.areAllKitchenItemsPrepared=()=>false;window.orderIsCancelled=order=>order.status==='Dibatalkan'||!!order.cancelledAt;
      window.orderCorrectionRecords=()=>[];window.correctionBatch=()=>1;window.correctionRecordsForBatch=()=>[];
      window.kitchenOrderIsCarryover=()=>true;window.isKitchenItemPrepared=()=>false;window.kitchenOrderItemKey=()=> 'item-0';window.kitchenItemIsLocked=()=>false;
      window.canCancelOrder=()=>true;window.orderCorrectionBadgeHtml=()=>'';window.statusPill=status=>'<span class="pill">'+status+'</span>';
      window.previewKitchenOrder={...posPickupPreview,createdAt:'2026-11-13T16:57:00Z',customer:'Pelanggan Contoh',note:'Bungkus terpisah\\nJam pengambilan: 17:57',pickupTime:'17:57'};
      document.getElementById('app').innerHTML=kitchenCard(previewKitchenOrder,1);
    `);
    const kitchen=await evaluate(`({text:document.body.innerText,overflow:document.documentElement.scrollWidth>innerWidth,
      title:document.querySelector('.kitchen-order-titleline').textContent,
      buttons:Array.from(document.querySelectorAll('.kitchen-order-actions button'),el=>el.textContent),
      chip:getComputedStyle(document.querySelector('.so-takeaway-pickup-note')).backgroundColor})`);
    assert.equal(kitchen.overflow,false);assert.match(kitchen.title,/Takeaway-Rumah\s*Pelanggan Contoh/);assert.doesNotMatch(kitchen.title,/P001|TAKEAWAY ·/);
    assert.equal(kitchen.text.split('Bungkus terpisah').length-1,1);assert.equal(kitchen.text.split('Jam pengambilan:').length-1,1);
    assert.deepEqual(kitchen.buttons,['Terima Pesanan','Batalkan']);assert.equal(kitchen.chip,'rgb(234, 243, 255)');
    assert.match(kitchen.text,/Air Mineral/);assert.match(kitchen.text,/17:57/);
    const kitchenMetadata=await evaluate(`(() => {const date=document.querySelector('.kitchen-order-time'),r=date.getBoundingClientRect();return {weight:getComputedStyle(date).fontWeight,chips:[...document.querySelectorAll('.kitchen-order-meta > .pill')].map(el=>{const c=el.getBoundingClientRect();return {after:c.left>=r.right,sameLine:Math.abs((c.top+c.bottom)/2-(r.top+r.bottom)/2)<2};})};})()`);
    assert.equal(kitchenMetadata.weight,'700');
    if(width>=348) assert.ok(kitchenMetadata.chips.every(chip=>chip.after&&chip.sameLine),'Kitchen date and chips must share a row');
    await screenshot(`kitchen-card-layout-${width}`);
    await evaluate(`previewKitchenOrder.status='Dibatalkan';previewKitchenOrder.cancelReason='Pelanggan membatalkan';document.getElementById('app').innerHTML=kitchenCard(previewKitchenOrder,0)`);
    assert.equal(await evaluate("document.querySelectorAll('.kitchen-order-actions button').length"),0);
    assert.match(await evaluate('document.body.innerText'),/Keterangan pembatalan: Pelanggan membatalkan/);
    await screenshot(`kitchen-cancelled-${width}`);
    await evaluate(`
      ${['isNewOrderStatus','orderNeedsTakeawayCashier','orderNavigationBadgeCount','renderOrderNavigationBadge','updateOrderNavigationBadges'].map(name=>extract(coreSource,name)).join('\n')}
      ${fs.readFileSync(path.join(root,'pages/kitchen.js'),'utf8')}
      window.orderVisibleInPosOrderList=()=>true;window.todayKey=()=> '2026-11-14';window.kitchenOrderActivityAt=order=>order.createdAt;
      window.kitchenFilter='Pemberitahuan Takeaway';window.empty=()=>'<p>Kosong</p>';window.navIcon=()=>'';state.products=[];
      state.orders=[{id:'takeaway-notice',number:'P005',customer:'Pelanggan Preview',createdAt:'2026-11-14T04:00:00Z',customerOrderType:'PICKUP_PREORDER',paymentProvider:'cash_at_outlet',serviceInfo:'Takeaway-Rumah',status:'Pesanan Baru',pickupTime:'18:30',items:[{name:'Hidden item',qty:1}]}];
      document.getElementById('app').innerHTML=renderKitchen();
    `);
    const notice=await evaluate(`({text:document.querySelector('.kitchen-takeaway-notice').textContent,items:document.querySelectorAll('.kitchen-takeaway-notice .kitchen-prep-item').length,actions:document.querySelectorAll('.kitchen-takeaway-notice button').length,overflow:document.documentElement.scrollWidth>innerWidth})`);
    assert.match(notice.text,/Pelanggan Preview/);assert.match(notice.text,/Menunggu diterima kasir/);assert.doesNotMatch(notice.text,/Hidden item|perlu diproses oleh kasir/);
    assert.equal(notice.items,0);assert.equal(notice.actions,0);assert.equal(notice.overflow,false);
    await screenshot(`kitchen-takeaway-notice-${width}`);
    await evaluate(`document.getElementById('app').insertAdjacentHTML('afterbegin','<nav class="nav"><button>Pesanan'+renderOrderNavigationBadge('orders')+'</button><button>Dapur'+renderOrderNavigationBadge('kitchen')+'</button></nav>')`);
    const navBadge=await evaluate(`Array.from(document.querySelectorAll('.order-nav-count'),el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {text:el.textContent,hidden:el.hidden,bg:s.backgroundColor,width:r.width,height:r.height}})`);
    assert.equal(navBadge.length,2);for(const badge of navBadge){assert.equal(badge.text,'1');assert.equal(badge.hidden,false);assert.equal(badge.bg,'rgb(220, 38, 38)');assert.equal(badge.width,badge.height);}
    await evaluate("state.orders[0].status='Sedang Disiapkan';updateOrderNavigationBadges()");
    assert.equal(await evaluate("Array.from(document.querySelectorAll('.order-nav-count')).every(el=>el.hidden)"),true);
    console.log('PASS feedback UI at', width, 'px: driver, wallet, detail, upsell, checkout, location motion, driver search');
  }
  assert.deepEqual(exceptions, []);
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    try { await send('Browser.close'); } catch { /* Our isolated browser closes its socket. */ }
    socket.close();
  }
  if (browser.exitCode === null) browser.kill();
}
