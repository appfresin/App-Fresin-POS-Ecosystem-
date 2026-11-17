import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// This browser is isolated and visits only our authored fixture, never the live POS.
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = pathToFileURL(path.join(root, 'tests/fixtures/customer-gateway.html')).href;
const sourceRoot = fs.existsSync(path.join(root, 'delivery/Customer Order/customer-order.js')) ? root : path.join(root, 'deploy-ready');
const customerSource = fs.readFileSync(path.join(sourceRoot, 'delivery/Customer Order/customer-order.js'), 'utf8');
const emptyStart = customerSource.indexOf('  function homeRenderOrdersEmptyState()');
assert.ok(emptyStart >= 0, 'Empty orders renderer missing');
const emptyEnd = customerSource.indexOf('\n  function ', emptyStart + 3);
const emptyRenderer = customerSource.slice(emptyStart, emptyEnd).trim();
const chrome = process.env.FRESIN_QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fresin-gateway-qa-'));
const artifacts = path.join(root, 'tests/artifacts/location-map');
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
function extract(name) {
  const found=customerSource.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`,'m'));
  assert.ok(found,name);
  return found[0];
}
try {
  const portFile=path.join(profile,'DevToolsActivePort');
  const port=await waitFor(()=>{try{return Number(fs.readFileSync(portFile,'utf8').split('\n')[0]);}catch{return false;}},'Chrome did not start');
  const pages=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket=new WebSocket(pages.find(p=>p.type==='page'&&p.url==='about:blank').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',event=>{const result=JSON.parse(event.data);if(!result.id)return;const call=pending.get(result.id);pending.delete(result.id);if(result.error)call?.reject(Error(result.error.message));else call?.resolve(result.result);});
  await send('Page.enable');await send('Runtime.enable');

  for (const [width,height] of [[343,641],[343,568],[430,800]]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
    await send('Page.navigate',{url:fixture});
    await waitFor(()=>evaluate('!!window.FresinGateway'),'Fixture did not load');
    await evaluate(`
      sessionStorage.removeItem('customer_home_delivery_quote_v2');window.checkout={method:'DELIVERY',latitude:5.35,longitude:95.94,locationStatus:'adjusted',addressNote:'',deliveryStage:'location'};
      window.homeCheckout=()=>checkout;window.homeSetCheckout=patch=>Object.assign(checkout,patch);
      window.homeEscape=value=>escapeHtml(value);window.homeCoordinate=Number;
      window.homeCheckoutErrors={};window.homeCheckoutValidationAttempted=false;window.selfOrderSubmitError='';
      window.homeLocationNextLoading=false;window.homeDeliveryRoute=null;window.quoteCalls=0;
      window.homeCheckoutFieldError=key=>homeCheckoutErrors[key]?'<small role="alert">'+homeCheckoutErrors[key]+'</small>':'';
      window.homeCheckoutInvalidAttrs=()=>'';window.homeIsMode=()=>true;window.selfOrderStep=()=>'payment';
      window.fetch=async()=>{quoteCalls++;await new Promise(resolve=>setTimeout(resolve,100));return Response.json({distanceMeters:5631,fee:14000})};
      window.CustomerOrder={captureCheckout(){const field=document.getElementById('customerHomeAddressNote');if(field)checkout.addressNote=field.value.trim()},confirmPinnedLocation(){checkout.locationStatus='ready';render()},continueDeliveryLocation:()=>homeContinueDeliveryLocation(),pinCurrentLocation(){checkout.locationStatus='ready';render()}};
      ${['homeDeliveryRouteKey','homeDeliveryQuote','homeEnsureDeliveryRoute','homeHasPinnedLocation','homeLocationUiState','homeRenderMapLoading','homeRenderDeliveryLocationStep','homeContinueDeliveryLocation'].map(extract).join('\n')}
      window.render=()=>{document.querySelector('#app').innerHTML='<section class="self-order-app">'+renderSelfOrderTopbar()+(checkout.deliveryStage==='details'?'<main class="self-order-main"><h2>Detail penerima</h2><input placeholder="Nama penerima"><p>Ongkir Rp14.000</p></main>':homeRenderDeliveryLocationStep(checkout))+'</section>'};render();
    `);
    assert.equal(await evaluate('quoteCalls'),0);
    assert.equal(await evaluate('document.documentElement.scrollHeight>innerHeight'),false,'Location screen scrolls');
    assert.equal(await evaluate('document.querySelector(".customer-home-location-next").getBoundingClientRect().bottom<=innerHeight'),true,'Continue is outside viewport');
    await evaluate('CustomerOrder.continueDeliveryLocation()');
    assert.equal(await evaluate('quoteCalls'),0);
    assert.equal(await evaluate('!!homeCheckoutErrors.Location && !!homeCheckoutErrors.AddressNote'),true);
    await evaluate('CustomerOrder.confirmPinnedLocation();document.querySelector("#customerHomeAddressNote").value="Pagar hitam di depan apotek";CustomerOrder.captureCheckout();homeCheckoutErrors={};render()');
    assert.equal(await evaluate('quoteCalls'),0);
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    const screenshot=await send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(artifacts,'delivery-location-'+width+'.png'),Buffer.from(screenshot.data,'base64'));
    await evaluate('Promise.all([CustomerOrder.continueDeliveryLocation(),CustomerOrder.continueDeliveryLocation()])');
    assert.equal(await evaluate('quoteCalls'),1);
    assert.equal(await evaluate('checkout.deliveryStage'),'details');
    await evaluate('checkout.deliveryStage="location";render();CustomerOrder.continueDeliveryLocation()');
    assert.equal(await evaluate('quoteCalls'),1);
    assert.equal(await evaluate('checkout.deliveryStage'),'details');
    console.log('PASS location validation, one routing request, double tap protection and quote reuse at',width,'px');
  }
} finally {
  if(socket?.readyState===WebSocket.OPEN){try{await send('Browser.close');}catch{}socket.close();}
  if(browser.exitCode===null)browser.kill();
}

