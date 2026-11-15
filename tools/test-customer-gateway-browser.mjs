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
  if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
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
    if (value.method === 'Runtime.exceptionThrown') exceptions.push(value.params.exceptionDetails.text);
    if (!value.id) return;
    const call = pending.get(value.id);
    pending.delete(value.id);
    if (value.error) call?.reject(Error(value.error.message));
    else call?.resolve(value.result);
  });
  await send('Page.enable');
  await send('Runtime.enable');
  const results = [];
  for (const [width, height] of (process.argv.includes('--cash-only') ? [] : [[320, 568], [338, 585], [375, 641], [390, 844], [430, 932], [768, 600], [844, 390]])) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
    const fixtureUrl = width === 320 ? fixture + '?boot_delay=1' : fixture;
    await send('Page.navigate', { url: fixtureUrl });
    if (width === 320) {
      await waitFor(() => evaluate('window.fixtureBootAttempted === true'), 'Initial render attempt missing');
      assert.equal(await evaluate('window.FRESIN_GATEWAY_BOOT_PENDING'), true);
      assert.deepEqual(await evaluate('window.fixturePaints'), []);
      assert.equal(await evaluate("!!document.querySelector('.fixture-menu')"), false, 'A delayed gateway must not paint the old menu');
      assert.match(await evaluate("getComputedStyle(document.querySelector('#app'),'::before').content"), /Memuat Fresin App/);
    }
    await waitFor(() => evaluate("typeof window.FresinGateway === 'object' && !!document.querySelector('.fresin-gateway-choice')"), 'Fixture did not load');
    assert.equal(await evaluate('location.href'), fixtureUrl);
    assert.equal(await evaluate('window.fixturePaints[0]'), 'gateway', 'First customer paint must be the gateway');
    assert.equal(await evaluate('window.FRESIN_GATEWAY_BOOT_PENDING'), false);
    assert.equal(await evaluate('selfOrderCart.length'),0,'New entry must discard leftover cart items');
    await evaluate('document.fonts.ready');
    await evaluate("Promise.all([...document.querySelectorAll('.fresin-gateway-stamp img')].map(image=>image.decode()))");
    await evaluate(`window.fixtureEmptyOrdersHtml = (${emptyRenderer})()`);
    const metrics = await evaluate(`(() => {
      const choices=[...document.querySelectorAll('.fresin-gateway-choice')];
      return { overflow:document.documentElement.scrollWidth>innerWidth,
        verticalOverflow:document.scrollingElement.scrollHeight>innerHeight+1,
        choices:choices.length, title:document.querySelector('#fresinGatewayTitle').textContent,
        header:document.querySelector('.self-order-topbar strong').textContent,
        touchTargets:choices.every(button=>button.getBoundingClientRect().height>=44),
        shadow:getComputedStyle(choices[0]).boxShadow,
        lastChoiceBottom:choices[1].getBoundingClientRect().bottom,
        footerBottom:document.querySelector('.fresin-gateway-footer').getBoundingClientRect().bottom,
        headingCentered:Math.abs(document.querySelector('.fresin-gateway-heading h2').getBoundingClientRect().x+document.querySelector('.fresin-gateway-heading h2').getBoundingClientRect().width/2-(document.querySelector('.fresin-gateway-heading').getBoundingClientRect().x+document.querySelector('.fresin-gateway-heading').getBoundingClientRect().width/2))<1,
        heroContentFits:[...document.querySelectorAll('.fresin-gateway-hero h1,.fresin-gateway-hero p')].every(el=>el.getBoundingClientRect().bottom<=document.querySelector('.fresin-gateway-hero').getBoundingClientRect().bottom-5),
        descriptionsFit:choices.every(button=>button.querySelector('.fresin-gateway-choice-copy').getBoundingClientRect().bottom<=button.getBoundingClientRect().bottom-3),
        serviceIcons:choices.map(button=>button.querySelector('.fresin-gateway-choice-icon svg').dataset.icon),
        brandImageFits:(()=>{const box=document.querySelector('.fresin-gateway-stamp').getBoundingClientRect(),image=document.querySelector('.fresin-gateway-stamp img').getBoundingClientRect();return image.width>40&&image.left>=box.left&&image.right<=box.right+1&&image.top>=box.top&&image.bottom<=box.bottom+1})() };
    })()`);
    assert.equal(metrics.overflow, false, `Horizontal overflow at ${width}px`);
    assert.equal(metrics.verticalOverflow, false, `Main page scrolls at ${width}x${height}`);
    assert.equal(metrics.choices, 2);
    assert.equal(metrics.title, 'Fresin App');
    assert.equal(metrics.header, 'Fresin Indonesia');
    assert.equal(metrics.touchTargets, true);
    assert.notEqual(metrics.shadow, 'none');
    assert.ok(metrics.lastChoiceBottom <= height, 'Both choices should be visible');
    assert.ok(metrics.footerBottom <= height, 'Footer must fit without clipping');
    assert.equal(metrics.headingCentered, true);
    assert.equal(metrics.heroContentFits, true, 'Hero text must not be clipped');
    assert.equal(metrics.descriptionsFit, true, 'Long service descriptions must fit');
    assert.deepEqual(metrics.serviceIcons, ['shopping-bag', 'truck']);
    assert.equal(metrics.brandImageFits, true, 'Fresin logo image must fit its circular badge');
    await evaluate("document.querySelector('.fresin-gateway-choice.pickup').click()");
    assert.equal(await evaluate("document.documentElement.classList.contains('fresin-gateway-open')"), false);
    assert.equal(await evaluate("JSON.parse(sessionStorage.getItem('customer_home_checkout')).method"), 'PICKUP_PREORDER');
    assert.equal(await evaluate("document.querySelector('.fresin-service-strip>span').textContent.trim()"), 'Ambil di toko');
    assert.equal(await evaluate('selfOrderCart.length'),0,'Selecting a service must not add an item');
    await evaluate("selfOrderCart=[{name:'Chosen fixture item',qty:1,price:20000}];saveSelfOrderCart()");
    await evaluate('history.back()');
    await waitFor(() => evaluate('FresinGateway.isOpen()'), 'Browser back did not return to gateway');
    await evaluate("document.querySelector('.fresin-gateway-choice.pickup').click()");
    await evaluate("document.querySelector('.fresin-service-strip button').click()");
    assert.equal(await evaluate('FresinGateway.isOpen()'), true);
    await evaluate("document.querySelector('.fresin-gateway-choice.delivery').click()");
    assert.equal(await evaluate("JSON.parse(sessionStorage.getItem('customer_home_checkout')).method"), 'DELIVERY');
    assert.equal(await evaluate('selfOrderCart.length'), 1);
    await evaluate('FresinGateway.open()');
    await evaluate("document.querySelector('.customer-home-support-chip').click()");
    assert.equal(await evaluate("document.querySelector('#fresinGatewaySupport').hidden"), false);
    assert.equal(await evaluate("document.querySelector('#fresinGatewaySupport').offsetTop>=document.querySelector('.fresin-gateway').offsetTop+document.querySelector('.fresin-gateway').offsetHeight-1"), true, 'Support card must appear below the full-height gateway');
    assert.equal(await evaluate("document.querySelector('.fresin-gateway-support-actions')"), null);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#fresinGatewaySupport')).boxShadow"), 'none');
    if (width === 338) {
      const supportCapture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      fs.writeFileSync(path.join(artifacts, 'support-below-gateway-338x585.png'), Buffer.from(supportCapture.data, 'base64'));
    }
    await evaluate('FresinGateway.hideSupport()');
    assert.equal(await evaluate("document.querySelector('#fresinGatewaySupport').hidden"), true);
    assert.equal(await evaluate('document.scrollingElement.scrollHeight>innerHeight+1'), false, 'Closing support restores the initial page without scroll');
    await evaluate('FresinGateway.open()');
    await evaluate("document.querySelector('.fresin-gateway-footer button').click()");
    assert.equal(await evaluate('selfOrderStep()'), 'success');
    assert.equal(await evaluate("!!document.querySelector('.customer-home-empty-cart-icon svg')"), true);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.customer-home-orders-empty h3')).fontSize"), '23px');
    if (width === 375) {
      const emptyCapture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      fs.writeFileSync(path.join(artifacts, `empty-orders-${width}x${height}.png`), Buffer.from(emptyCapture.data, 'base64'));
    }
    await evaluate("document.querySelector('.customer-home-empty-menu').click()");
    assert.equal(await evaluate('selfOrderCart.length'), 1);
    await evaluate('FresinGateway.open()');
    await evaluate('scrollTo(0,0)');
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(artifacts, `gateway-${width}x${height}.png`), Buffer.from(capture.data, 'base64'));
    results.push({ width, height, ...metrics, passed: true });
    if (width === 375) {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      assert.notEqual(await evaluate("getComputedStyle(document.querySelector('.fresin-gateway-tagline-easy')).animationName"), 'none');
      assert.notEqual(await evaluate("getComputedStyle(document.querySelector('.fresin-service-art-frame')).animationName"), 'none');
      await send('Page.navigate', { url: fixture + '?motion=on' });
      await waitFor(() => evaluate("!!document.querySelector('.fresin-gateway[data-motion=on]')"), 'Explicit motion preview did not load');
      const motionBefore = await evaluate("[...document.querySelectorAll('.fresin-gateway-spark,.fresin-gateway-hero-tagline>span,.fresin-gateway-hero h1')].map(el=>({name:getComputedStyle(el).animationName, transform:getComputedStyle(el).transform}))");
      await delay(450);
      const motionAfter = await evaluate("[...document.querySelectorAll('.fresin-gateway-spark,.fresin-gateway-hero-tagline>span,.fresin-gateway-hero h1')].map(el=>({name:getComputedStyle(el).animationName, transform:getComputedStyle(el).transform}))");
      assert.ok(motionAfter.every(item => item.name !== 'none'), 'Explicit preview must enable each decorative animation');
      assert.ok(motionAfter.every((item, index) => item.transform !== motionBefore[index].transform), 'Stars and floating text must actually move over time');
      const opposedMotion = await evaluate("[...document.querySelectorAll('.fresin-gateway-hero-tagline>span')].map(el=>new DOMMatrix(getComputedStyle(el).transform).m42)");
      assert.ok(opposedMotion[0] < 0 && opposedMotion[1] > 0, 'Tagline phrases should float in opposite directions');
      const servicePhases = [];
      for (const time of [1000, 4800]) {
        servicePhases.push(await evaluate(`(() => {
          const frames = [...document.querySelectorAll('.fresin-service-art-frame')];
          frames.forEach(frame => frame.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = ${time}; }));
          return frames.map(frame => ({ icon: frame.querySelector('svg').dataset.icon, opacity: Number(getComputedStyle(frame).opacity) }));
        })()`));
      }
      assert.deepEqual(servicePhases[0].filter(frame => frame.opacity > .95).map(frame => frame.icon), ['shopping-bag','truck']);
      assert.deepEqual(servicePhases[1].filter(frame => frame.opacity > .95).map(frame => frame.icon), ['store','shopping-bag']);
      console.log('PASS shared service artwork: bag/store and truck/bag alternate; ordinary entry keeps motion enabled');
      await send('Page.navigate', { url: fixture + '?preview=signature-4' });
      await waitFor(() => evaluate("!!document.querySelector('.fresin-gateway[data-motion=on]')"), 'Signature preview should show motion consistently');
      assert.notEqual(await evaluate("getComputedStyle(document.querySelector('.fresin-service-art-frame')).animationName"), 'none');
      await send('Page.navigate', { url: fixture + '?preview=signature-4&motion=off' });
      await waitFor(() => evaluate("!!document.querySelector('.fresin-service-art-frame')"), 'Preview did not load');
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.fresin-service-art-frame')).animationName"), 'none');
      await evaluate("document.querySelector('.fresin-gateway-choice.pickup').click();selfOrderCart=[{name:'Intentional draft',qty:2,price:5000}];saveSelfOrderCart()");
      await send('Page.reload');
      await waitFor(()=>evaluate('!!window.FresinGateway'),'Reloaded fixture missing');
      assert.equal(await evaluate('selfOrderCart[0].name'),'Intentional draft');
      assert.equal(await evaluate('selfOrderCart[0].qty'),2);
      assert.equal(await evaluate('FresinGateway.isOpen()'),false,'Reload must retain selected service');
      await send('Page.navigate',{url:fixture+'?fresh-start=1'});
      await waitFor(()=>evaluate('!!window.FresinGateway'),'Fresh entry fixture missing');
      assert.equal(await evaluate('selfOrderCart.length'),0,'New direct visit must clear prior draft');
      assert.equal(await evaluate('FresinGateway.isOpen()'),true);
      fs.writeFileSync(path.join(artifacts, 'motion-results.json'), JSON.stringify({ reducedMotion: true, explicitPreview: true, before: motionBefore, after: motionAfter }, null, 2));
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
      console.log('PASS motion: normal entry and previews animate; explicit motion=off stays static');
    }
    console.log(`PASS ${width}x${height}: no page scroll, header, both services, cart, support and order navigation`);
  }
  for (const [width, height] of (process.argv.includes('--cash-only') ? [] : [[320,568],[338,585],[375,641],[390,844],[430,932],[768,600],[844,390]])) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor:1, mobile:true });
    await send('Page.navigate', { url: fixture + '?table=D-12' });
    await waitFor(() => evaluate("!!document.querySelector('.fresin-gateway-table')"), 'Table gateway did not load');
    await evaluate('document.fonts.ready');
    await evaluate("Promise.all([...document.querySelectorAll('.fresin-gateway-stamp img')].map(image=>image.decode()))");
    const tableMetrics = await evaluate(`(() => {
      const buttons=[...document.querySelectorAll('.fresin-gateway-choice')];
      const primary=document.querySelector('.fresin-gateway-choice.dinein').getBoundingClientRect();
      const secondary=document.querySelector('.fresin-gateway-small-choice').getBoundingClientRect();
      const cta=getComputedStyle(document.querySelector('.fresin-gateway-dinein-action'));
      const luminance=value=>value.match(/[0-9.]+/g).slice(0,3).map(n=>Number(n)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
      const foreground=luminance(cta.color),background=luminance(cta.backgroundColor);
      return {width:innerWidth,height:innerHeight,choices:buttons.length,smallChoices:document.querySelectorAll('.fresin-gateway-small-choice').length,
        overflow:document.documentElement.scrollWidth>innerWidth||document.scrollingElement.scrollHeight>innerHeight+1,
        contentsFit:buttons.every(button=>button.scrollHeight<=button.clientHeight+1&&button.scrollWidth<=button.clientWidth+1),
        buttonSizes:buttons.map(button=>({label:button.textContent.trim(),height:button.clientHeight,contentHeight:button.scrollHeight,width:button.clientWidth,contentWidth:button.scrollWidth})),
        primaryEmphasis:primary.width*primary.height>secondary.width*secondary.height*1.8,
        ctaContrast:(Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05),
        removedQuestion:!document.querySelector('#fresinGatewayChoiceTitle'),
        secondaryTitle:document.querySelector('.fresin-gateway-secondary-heading').textContent,
        footerFits:document.querySelector('.fresin-gateway-footer').getBoundingClientRect().bottom<=innerHeight+1,
        table:document.querySelector('.fresin-gateway-table-marker').textContent.trim()};
    })()`);
    assert.equal(tableMetrics.choices, 3);
    assert.equal(tableMetrics.smallChoices, 2);
    assert.equal(tableMetrics.overflow, false, 'Table gateway must fit '+width+'x'+height);
    assert.equal(tableMetrics.contentsFit, true, 'Table choice text must fit '+width+'x'+height+': '+JSON.stringify(tableMetrics.buttonSizes));
    assert.equal(tableMetrics.primaryEmphasis, true);
    assert.ok(tableMetrics.ctaContrast>=4.5,'Main CTA text must contrast against its background');
    assert.equal(tableMetrics.removedQuestion,true);
    assert.equal(tableMetrics.secondaryTitle,'Kamu bisa juga');
    assert.equal(tableMetrics.footerFits, true);
    assert.match(tableMetrics.table, /D-12/);
    const tableCapture=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
    fs.writeFileSync(path.join(artifacts, 'table-gateway-'+width+'x'+height+'.png'), Buffer.from(tableCapture.data,'base64'));
    await evaluate("document.querySelector('.fresin-gateway-choice.dinein').click()");
    assert.equal(await evaluate('selfOrderStep()'), 'menu');
    assert.equal(await evaluate("sessionStorage.getItem('self_order_table')"), 'D-12');
    assert.equal(await evaluate('selfOrderCart.length'), 0);
    await evaluate("selfOrderCart=[{name:'Chosen table item',qty:1,price:20000}];saveSelfOrderCart()");
    assert.match(await evaluate("document.querySelector('.fresin-service-strip>span').textContent"), /Makan di sini.*D-12/);
    await evaluate('history.back()');
    await waitFor(()=>evaluate('FresinGateway.isOpen()'), 'Browser back must restore table choices');
    results.push({...tableMetrics,mode:'table',passed:true});
    console.log('PASS table '+width+'x'+height+': three choices, QR table, original menu/cart and browser back');
  }
  if (process.argv.includes('--cash-only')) {
    await send('Emulation.setDeviceMetricsOverride', { width:375,height:641,deviceScaleFactor:1,mobile:true });
    await send('Page.navigate', { url:fixture });
    await waitFor(()=>evaluate('!!window.FresinGateway'),'Fixture gateway missing');
    function extract(source, name) {
      const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
      assert.ok(start >= 0, name);
      const next = /\n  (?:async )?function \w+\(/.exec(source.slice(start + 10));
      return source.slice(start, next ? start + 10 + next.index : source.length);
    }
    const takeaway = fs.readFileSync(path.join(root,'SO Takeaway/so-takeaway.js'),'utf8');
    const functions = ['homeIsOrder','homeIsPayLaterOrder','homeKitchenBlocked','homeIsPaid','homeOrderKind','homeOrderTotal','homeDeliveryFee',
      'homeCustomerStatus','homeLifecycleCustomerStatus','homePreferAdvancedCustomerStatus','homeStatusRank','homeCashProgress',
      'homeRenderCashStatus','homeRenderCheckout','homeRenderReview','homeCheckoutFieldError','homeCheckoutInvalidAttrs','homeSetPickupTiming','homeOpenPickupTimePicker']
      .map(name=>extract(customerSource,name)).join('\n');
    const components = ['soTakeawayEscape','soTakeawayMoney','soTakeawayIsPaid','soTakeawayDetailHtml','soTakeawayResultHero','soTakeawayStatusBar','soTakeawaySuccessActions','soTakeawayRenderReceipt','soTakeawayDateTime']
      .map(name=>extract(takeaway,name)).join('\n');
    await evaluate(`${functions}\n${components}\n
      window.SOTakeaway={renderDetails:soTakeawayDetailHtml,renderProgress:soTakeawayStatusBar,renderHero:soTakeawayResultHero,renderSuccessActions:soTakeawaySuccessActions,renderReceipt:soTakeawayRenderReceipt};
      window.homeEscape=escapeHtml; window.homeMoney=value=>'Rp '+Number(value).toLocaleString('id-ID');
      window.homeCheckoutErrors={};window.homeCheckoutValidationAttempted=false;window.selfOrderSubmitError='';
      window.fixtureCheckout={method:'PICKUP_PREORDER',name:'Pelanggan preview',phone:'08000000000',pickupTime:'17:30',note:'Tanpa gula'};
      window.homeCheckout=()=>fixtureCheckout;window.homeInputValue=(id,key)=>homeEscape(fixtureCheckout[key]||'');
      window.homeSetCheckout=patch=>Object.assign(fixtureCheckout,patch);window.homeClearCheckoutErrors=()=>{};
      window.CustomerOrder.setPickupTiming=homeSetPickupTiming;window.CustomerOrder.captureCheckout=()=>{};
      window.CustomerOrder.openPickupTimePicker=homeOpenPickupTimePicker;
      window.fixturePickerCalls=0;HTMLInputElement.prototype.showPicker=function(){fixturePickerCalls++};
      window.render=()=>{document.querySelector('#app').innerHTML='<section class="self-order-app">'+renderSelfOrderTopbar()+homeRenderCheckout()+'</section>'};
      window.selfOrderSubtotal=()=>25000;window.homeCalculateDeliveryFee=()=>10000;
      window.homeRenderSupportContact=()=>'';window.homeDriverCard=()=>'';
      window.fixtureCashOrder={id:'fixture',number:'P999',customer:'Pelanggan preview',subtotal:25000,grandTotal:25000,
        customerOrderType:'PICKUP_PREORDER',paymentProvider:'cash_at_outlet',paymentStatus:'Belum dibayar',status:'Pesanan Baru',pickupTime:'17:30'};
      document.querySelector('#app').innerHTML='<section class="self-order-app">'+renderSelfOrderTopbar()+homeRenderCheckout()+'</section>';
    `);
    const deliverySteps=await evaluate(`['PREPARING','READY_FOR_PICKUP','DELIVERING'].map(status=>{const el=document.createElement('div');el.innerHTML=homeCashProgress({...fixtureCashOrder,customerOrderType:'DELIVERY',paymentProvider:'courier_cash',customerOrderStatus:status,driverId:'driver',status:status==='PREPARING'?'Sedang Disiapkan':'Selesai'});return {labels:[...el.querySelectorAll('b')].map(node=>node.textContent),current:el.querySelector('[aria-current=step] b')?.textContent};})`);
    assert.deepEqual(deliverySteps.map(step=>step.current),['Disiapkan','Menjemput','Diantar']);
    assert.deepEqual(deliverySteps[0].labels,['Driver','Disiapkan','Menjemput','Diantar','Selesai']);
    const checkoutMetrics=await evaluate(`({
      time:document.querySelector('#customerHomePickupTime').value,
      labelWeight:getComputedStyle(document.querySelector('.self-order-customer-field>span')).fontWeight,
      service:document.querySelector('.fresin-service-strip').textContent.trim(),
      oldNote:document.body.textContent.includes('setelah pembayaran berhasil'),
      submit:document.querySelector('.self-order-finish').textContent.trim(),
      overflow:document.documentElement.scrollWidth>innerWidth
    })`);
    assert.equal(checkoutMetrics.time,'17:30');assert.equal(checkoutMetrics.labelWeight,'400');
    assert.match(checkoutMetrics.service,/Ambil di Outlet\s+mengambil sendiri pesanan di outlet Fresin/);assert.equal(checkoutMetrics.oldNote,false);
    const pickupHeader=await evaluate(`({
      card:document.querySelector('.customer-home-checkout-shell').getBoundingClientRect().toJSON(),
      header:document.querySelector('.is-checkout-header').getBoundingClientRect().toJSON(),
      transform:getComputedStyle(document.querySelector('.is-checkout-header .fresin-service-strip-copy')).textTransform,
      now:document.querySelector('.customer-home-timing-options button').textContent
    })`);
    assert.equal(pickupHeader.header.left,pickupHeader.card.left);assert.equal(pickupHeader.header.right,pickupHeader.card.right);
    assert.equal(pickupHeader.header.top,pickupHeader.card.top);assert.equal(pickupHeader.transform,'none');assert.equal(pickupHeader.now,'Segera');
    assert.equal(checkoutMetrics.submit,'Buat Pesanan');assert.equal(checkoutMetrics.overflow,false);
    await evaluate("document.querySelector('.customer-home-timing-options button').click()");
    assert.equal(await evaluate("document.querySelector('.customer-home-timing-options button').getAttribute('aria-pressed')"),'true');
    assert.equal(await evaluate("document.querySelector('#customerHomePickupTime') === null"),true);
    assert.equal(await evaluate('fixtureCheckout.pickupTime'),'Secepatnya');
    await evaluate("document.querySelector('.customer-home-timing-options button:nth-child(2)').click()");
    assert.equal(await evaluate("!!document.querySelector('#customerHomePickupTime')"),true);
    assert.equal(await evaluate('fixturePickerCalls'),1);
    await evaluate("document.querySelector('#customerHomePickupTime').click()");
    assert.equal(await evaluate('fixturePickerCalls'),2);
    for (const width of [320,348,430]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height:641,deviceScaleFactor:1,mobile:true});
      const timing=await evaluate(`({
        overflow:document.documentElement.scrollWidth>innerWidth,
        background:getComputedStyle(document.querySelector('.customer-home-pickup-timing')).backgroundImage,
        type:document.querySelector('#customerHomePickupTime').type,
        width:document.querySelector('#customerHomePickupTime').getBoundingClientRect().width,
        cardWidth:document.querySelector('.customer-home-pickup-timing').getBoundingClientRect().width
      })`);
      assert.equal(timing.overflow,false);assert.equal(timing.type,'time');
      assert.match(timing.background,/linear-gradient/);assert.ok(timing.width<timing.cardWidth);
      const capture=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
      fs.writeFileSync(path.join(artifacts,`pickup-timing-${width}.png`),Buffer.from(capture.data,'base64'));
    }
    console.log('PASS pickup timing at 320/348/430px: dedicated card, native time input and picker on both scheduled option and field.');
    for (const mode of ['pickup','delivery']) {
      await evaluate(`if(${JSON.stringify(mode)}==='delivery')Object.assign(fixtureCashOrder,{number:'D999',customerOrderType:'DELIVERY',paymentProvider:'courier_cash',deliveryFee:10000,grandTotal:35000,driverId:'fixture-driver',customerOrderStatus:'DRIVER_ASSIGNED',pickupTime:''});
        document.querySelector('#app').innerHTML='<section class="self-order-app">'+renderSelfOrderTopbar()+homeRenderCashStatus(fixtureCashOrder)+'</section>';`);
      const metrics=await evaluate(`({text:document.body.textContent,overflow:document.documentElement.scrollWidth>innerWidth,mark:!!document.querySelector('.success-icon'),
        minimum:getComputedStyle(document.querySelector('.so-takeaway-success')).minHeight,
        cardPadding:getComputedStyle(document.querySelector('.so-takeaway-status-card')).padding,
        heroBackground:getComputedStyle(document.querySelector('.so-takeaway-result-hero')).backgroundColor})`);
      assert.equal(metrics.overflow,false);assert.equal(metrics.mark,true);
      assert.equal(metrics.minimum,'0px');assert.equal(metrics.cardPadding,'0px');assert.equal(metrics.heroBackground,'rgb(16, 73, 133)');
      assert.match(metrics.text,/Pesanan berhasil dibuat/);assert.doesNotMatch(metrics.text,/Duitku|Menunggu pembayaran/);
      assert.match(metrics.text,mode==='delivery'?/Bayar ke kurir/:/Bayar saat ambil di outlet/);
      assert.match(metrics.text,mode==='delivery'?/35.000/:/25.000/);
      const statusGap=await evaluate(`document.querySelector('.customer-home-current-status').getBoundingClientRect().top-document.querySelector('.customer-home-progress-card').firstElementChild.getBoundingClientRect().bottom`);
      assert.ok(statusGap>=12,'Status copy needs space below the timeline');
      const statusCenter=await evaluate(`(()=>{const note=document.querySelector('.customer-home-current-status'),parent=note.parentElement;const a=note.getBoundingClientRect(),b=parent.getBoundingClientRect();return {offset:Math.abs((a.left+a.right-b.left-b.right)/2),align:getComputedStyle(note).textAlign,width:a.width,parentWidth:b.width}})()`);
      assert.ok(statusCenter.offset<1,'Status chip must be centered in its card');
      assert.equal(statusCenter.align,'center');assert.ok(statusCenter.width>statusCenter.parentWidth-30);
      if(mode==='pickup') {
        const detailFonts=await evaluate(`['.so-takeaway-pickup-copy','.so-takeaway-customer-copy','.so-takeaway-payment-copy'].map(selector=>{const style=getComputedStyle(document.querySelector(selector));return [style.fontFamily,style.fontWeight]})`);
        assert.deepEqual(detailFonts[0],detailFonts[1]);assert.deepEqual(detailFonts[0],detailFonts[2]);
        assert.equal(detailFonts[0][1],'400');
      }
      const capture=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
      fs.writeFileSync(path.join(artifacts,`cash-${mode}-success.png`),Buffer.from(capture.data,'base64'));
    }
    await evaluate(`Object.assign(fixtureCashOrder,{customerOrderType:'PICKUP_PREORDER',paymentProvider:'cash_at_outlet',status:'Selesai',customerOrderStatus:'COMPLETED'});document.querySelector('#app').innerHTML='<section class="self-order-app">'+renderSelfOrderTopbar()+homeRenderCashStatus(fixtureCashOrder)+'</section>'`);
    assert.match(await evaluate("document.querySelector('.customer-home-current-status').textContent"),/silakan ambil ke outlet segera ya/);
    await evaluate(`Object.assign(fixtureCashOrder,{customerOrderType:'DELIVERY',paymentProvider:'courier_cash',status:'Dibatalkan',customerOrderStatus:'CANCELLED',cancelReason:'Pelanggan membatalkan'});document.querySelector('#app').innerHTML='<section class="self-order-app">'+renderSelfOrderTopbar()+homeRenderCashStatus(fixtureCashOrder)+'</section>'`);
    assert.equal(await evaluate("!!document.querySelector('.so-takeaway-success-icon.is-cancelled svg')"),true);
    const cancellation=await evaluate("({text:document.querySelector('.customer-home-current-status').textContent,center:getComputedStyle(document.querySelector('.customer-home-current-status')).textAlign,overflow:document.documentElement.scrollWidth>innerWidth})");
    assert.match(cancellation.text,/Keterangan pembatalanPelanggan membatalkan/);assert.equal(cancellation.center,'center');assert.equal(cancellation.overflow,false);
    const cancelledCapture=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
    fs.writeFileSync(path.join(artifacts,'customer-cancelled-asik.png'),Buffer.from(cancelledCapture.data,'base64'));
    console.log('PASS cash UI, pickup completion copy and illustrated cancellation details.');
    const coreSource=fs.readFileSync(path.join(root,'app.js'),'utf8');
    function coreFunction(name) {
      const start=coreSource.indexOf(`function ${name}(`);
      assert.ok(start>=0,name);
      const next=/\n(?:async )?function \w+\(/.exec(coreSource.slice(start+10));
      return coreSource.slice(start,next?start+10+next.index:coreSource.length);
    }
    await evaluate(`${coreFunction('selfOrderAsikIcon')}\n${coreFunction('renderSelfOrderSuccess')}\n${coreFunction('renderSelfOrderSuccessMoveInline')}\n
      window.fixtureSoSnapshot={id:'table-fixture',number:'SO999',customer:'Pelanggan preview',table:'D-12',checkoutTotal:5000,total:25000};
      window.fixtureSoOrder={id:'table-fixture',serviceInfo:'D-12',createdAt:'2026-11-12T10:00:00Z'};
      window.selfOrderLastOrderSnapshot=()=>fixtureSoSnapshot;window.selfOrderLastLiveOrder=()=>fixtureSoOrder;
      window.canMoveOrderTable=()=>true;window.fixtureMoveInline=false;window.selfOrderMoveTableInlineVisible=()=>fixtureMoveInline;
      window.displayOrderNumber=value=>value;window.timeOnly=()=> '17:00';window.money=homeMoney;
      window.openSelfOrderMoveTableDialog=()=>{fixtureMoveInline=true;renderTableFixture()};
      window.renderTableFixture=()=>{document.querySelector('#app').innerHTML='<section class="self-order-app">'+renderSelfOrderTopbar()+renderSelfOrderSuccess()+'</section>'};
    `);
    for (const width of [320,375,430]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height:641,deviceScaleFactor:1,mobile:true});
      await evaluate('fixtureMoveInline=false;renderTableFixture()');
      const soMetrics=await evaluate(`({text:document.body.textContent,
        overflow:document.documentElement.scrollWidth>innerWidth,
        detailHeight:document.querySelector('.so-takeaway-detail-card').getBoundingClientRect().height,
        hero:getComputedStyle(document.querySelector('.so-takeaway-result-hero')).backgroundColor,
        payment:document.querySelector('.so-takeaway-payment-copy').textContent})`);
      assert.equal(soMetrics.overflow,false);assert.equal(soMetrics.hero,'rgb(16, 73, 133)');
      assert.equal(await evaluate("document.querySelector('.so-takeaway-result-hero').nextElementSibling.matches('.fresin-so-table-notice')"),true);
      assert.match(soMetrics.text,/D-12/);assert.match(soMetrics.text,/5.000/);
      const soFonts=await evaluate(`Array.from(document.querySelectorAll('.so-takeaway-detail-copy,.so-takeaway-payment-copy'),el=>{const style=getComputedStyle(el);return [style.fontFamily,style.fontWeight]})`);
      assert.equal(soFonts.length,4);assert.ok(soFonts.every(font=>font[0]===soFonts[0][0]&&font[1]==='400'));
      assert.doesNotMatch(soMetrics.text,/25.000/,'Addition receipt must retain checkout total rather than full table bill');
      assert.match(soMetrics.payment,/Bayar di Kasir saat pulang/);
      assert.ok(soMetrics.detailHeight<280,'SO details should remain compact');
      const capture=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
      fs.writeFileSync(path.join(artifacts,`so-table-success-${width}.png`),Buffer.from(capture.data,'base64'));
      await evaluate("document.querySelector('.self-order-success-actions > .self-order-secondary').click()");
      assert.equal(await evaluate("document.querySelector('#moveOrderTableInput').value"),'D-12');
      assert.match(await evaluate("document.querySelector('[data-move-table-submit]').textContent"),/Konfirmasi Pindah Meja/);
      const moveLayout=await evaluate(`Array.from(document.querySelectorAll('.self-order-success-move-grid input'),el=>{const rect=el.getBoundingClientRect();return {top:rect.top,left:rect.left,right:rect.right}})`);
      assert.equal(moveLayout.length,2);assert.equal(moveLayout[0].top,moveLayout[1].top);
      assert.ok(moveLayout[0].right<moveLayout[1].left);
      assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
      const moveCapture=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
      fs.writeFileSync(path.join(artifacts,`so-move-inline-${width}.png`),Buffer.from(moveCapture.data,'base64'));
    }
    console.log('PASS SO success at 320/375/430px: shared blue hero, compact details, checkout total preserved, payment copy and table-moving controls retained.');
    for (const width of [320,375,430]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height:641,deviceScaleFactor:1,mobile:true});
      await evaluate(`document.querySelector('#app').innerHTML='<section class="self-order-app">'+renderSelfOrderTopbar()+soTakeawayRenderReceipt({
        number:'D999',customer:'Pelanggan preview',type:'Delivery',paymentProvider:'courier_cash',paymentStatus:'Lunas',subtotal:25000,grandTotal:35000,deliveryFee:10000,
        items:[{name:'Avocado Latte dengan nama produk panjang',qty:1,price:20000,note:'Tanpa gula'},{name:'Air Mineral',qty:1,price:5000}]})+'</section>'`);
      const receipt=await evaluate(`({text:document.querySelector('.fresin-customer-receipt').textContent,overflow:document.documentElement.scrollWidth>innerWidth})`);
      assert.equal(receipt.overflow,false);assert.match(receipt.text,/Avocado Latte/);assert.match(receipt.text,/Air Mineral/);
      assert.doesNotMatch(receipt.text,/Subtotal/);assert.match(receipt.text,/20.000/);assert.match(receipt.text,/5.000/);assert.match(receipt.text,/Ongkir/);assert.match(receipt.text,/10.000/);assert.match(receipt.text,/35.000/);assert.match(receipt.text,/Belum Lunas/);
      const capture=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
      fs.writeFileSync(path.join(artifacts,`customer-receipt-${width}.png`),Buffer.from(capture.data,'base64'));
    }
    const imageFunction=coreFunction('productImageOrToken');
    await evaluate(`${imageFunction}\nwindow.mediaImageTag=()=>'<img class="self-order-upsell-img" alt="Foto fixture" data-fixture-pending="1">';
      document.querySelector('#app').innerHTML='<section class="self-order-app"><span class="self-order-upsell-media">'+productImageOrToken({name:'Latte',imageName:'fixture'},'self-order-upsell-img',240)+'</span></section>';
    `);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.media-fallback-token')).display"),'none');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-self-order-photo]')).opacity"),'0');
    await evaluate("document.querySelector('[data-self-order-photo]').src=fixtureLogo");
    await waitFor(()=>evaluate("document.querySelector('[data-self-order-photo]').dataset.loaded==='1'"),'Photo did not finish loading');
    await delay(180);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-self-order-photo]')).opacity"),'1');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.media-fallback-token')).display"),'none');
    await evaluate("document.querySelector('[data-self-order-photo]').hidden=true;document.querySelector('.media-fallback-token').hidden=false");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-self-order-photo]')).display"),'none');
    assert.notEqual(await evaluate("getComputedStyle(document.querySelector('.media-fallback-token')).display"),'none');
    console.log('PASS receipt at 320/375/430px, customer total incl. shipping, and pending/loaded/failed photo states with no flashing fallback text.');
  }
  assert.deepEqual(exceptions, []);
  if (!process.argv.includes('--cash-only')) fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify(results, null, 2));
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    try { await send('Browser.close'); } catch { /* Browser closes its own socket. */ }
    socket.close();
  }
  if (browser.exitCode === null) browser.kill();
}
