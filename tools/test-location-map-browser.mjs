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
  const renderStart=customerSource.indexOf('    const baseRender = render;');
  const renderEnd=customerSource.indexOf('    const baseRenderSelfOrderTopbar',renderStart);
  const renderWrapper=customerSource.slice(renderStart,renderEnd);
  for(const width of [310,372,430]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:true});
    await send('Page.navigate',{url:fixture});
    await waitFor(()=>evaluate('!!window.FresinGateway'),'Fixture did not load');
    await evaluate(`
      window.checkout={method:'DELIVERY',latitude:5.37,longitude:95.95,locationStatus:'ready',locationSource:'gps'};
      window.homeCheckout=()=>checkout;window.homeSetCheckout=patch=>Object.assign(checkout,patch);
      window.homeCheckoutFieldError=()=>'';window.homeEscape=value=>escapeHtml(value);
      window.homeClearCheckoutErrors=()=>{};window.homeDeliveryRoute=null;window.quoteCalls=0;window.quoteError=false;
      window.fetch=async () => {quoteCalls++; return quoteError ? new Response(null,{status:503}) : Response.json({distanceMeters:4435,fee:11000});};
      window.homeParams=()=>({search:new URLSearchParams()});window.homeAutoLocationRequested=true;
      window.HOME_CONFIG={mapInitialZoom:16};
      window.homeMapLibreMap={jumpTo(value){window.camera=value;},remove(){window.removes++;}};
      window.homeMapLibreMarker={setLngLat(value){window.markerPoint=value;}};window.removes=0;
      ${['homeCoordinate','homeDeliveryConfig','homeLocationMapZoom','homeDeliveryRouteKey','homeDeliveryQuote','homeEnsureDeliveryRoute','homeHasPinnedLocation','homeLocationUiState','homeRefreshLocationPinState','homeUpdateLocationFromLatLng','homeRenderMapLoading','homeRenderLocationPin','homePinCurrentLocation','homeRenderReview'].map(extract).join('\n')}
      window.homeIsMode=()=>true;window.homePreventEmptyCartAccess=()=>{};window.homeScheduleDriverSearchTick=()=>{};
      window.homeMaybeAutoPinCurrentLocation=()=>{};window.homeInitMapLibreLocationMap=()=>{};
      window.homeMoney=n=>'Rp'+n.toLocaleString('id-ID');
      window.selfOrderStep=()=>fixtureCheckoutVisible?'payment':'menu';
      window.fixtureCheckoutVisible=true;
      render=function(){
        const quote=homeDeliveryQuote();
        const review=homeRenderReview({method:checkout.method,fee:quote?.fee,total:quote?25000+quote.fee:null,checkout,quote});
        document.querySelector('#app').innerHTML='<section class="self-order-app"><main class="self-order-main payment customer-home-checkout">'+(fixtureCheckoutVisible?homeRenderLocationPin()+review:'<p>Menu</p>')+'</main></section>';
      };
      {${renderWrapper}}
      render();
      homeEnsureDeliveryRoute(false, { confirmed: true });
      const map=document.querySelector('#customerHomeMapLibreMap');map.dataset.ready='1';map.innerHTML='<canvas aria-label="Isolated map canvas"></canvas>';
      window.retainedMap=map;window.retainedCanvas=map.firstChild;
    `);
    assert.equal(await evaluate('document.querySelector("#customerHomeCurrentLocationButton").textContent'),'Lokasi anda sudah dipilih');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#customerHomeLocationButton")).display'),'none');
    assert.equal(await evaluate('homeLocationMapZoom()'),15);
    const feeRow = 'document.querySelector(".customer-home-review-row").textContent';
    await waitFor(()=>evaluate(`${feeRow}.includes("Rp11.000")`),'Delivery fee did not render');
    assert.match(await evaluate(feeRow),/Biaya PengantaranRp11\.000/);
    assert.doesNotMatch(await evaluate('document.querySelector(".customer-home-review").textContent'),/Rute motor|4,4 km|Geoapify/i);
    for(let pass=0;pass<12;pass++) await evaluate('render()');
    assert.equal(await evaluate('document.querySelector("#customerHomeMapLibreMap")===retainedMap && retainedMap.firstChild===retainedCanvas && removes===0'),true,'Background renders remounted the map');
    await evaluate('homeUpdateLocationFromLatLng({lat:5.38,lng:95.96})');
    assert.equal(await evaluate('document.querySelector("#customerHomeLocationButton").hidden'),false);
    assert.equal(await evaluate('document.querySelector("#customerHomeLocationButton").textContent'),'Tetapkan Lokasi');
    assert.equal(await evaluate('document.querySelector("#customerHomeCurrentLocationButton").textContent'),'Pilih lokasi saya saat ini');
    assert.equal(await evaluate('quoteCalls'),1,'An adjusted pin requested a route before confirmation');
    assert.doesNotMatch(await evaluate('document.querySelector(".customer-home-review").textContent'),/Rp11\.000/);
    await evaluate(`Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(success){success({coords:{latitude:5.39,longitude:95.97,accuracy:8}});}}});homePinCurrentLocation()`);
    assert.equal(await evaluate('document.querySelector("#customerHomeLocationButton").hidden'),true);
    assert.deepEqual(await evaluate('markerPoint'),[95.97,5.39]);
    assert.deepEqual(await evaluate('camera'),{center:[95.97,5.39],zoom:15});
    assert.equal(await evaluate('document.querySelector("#customerHomeMapLibreMap")===retainedMap'),true,'GPS selection discarded the map');
    await evaluate(`quoteError=true;homeUpdateLocationFromLatLng({lat:5.40,lng:95.98});Object.assign(checkout,{locationStatus:'ready'});render();homeEnsureDeliveryRoute(false, { confirmed: true })`);
    assert.equal(await evaluate('document.querySelector("#customerHomeLocationButton").hidden'),false,'Manual confirmation masqueraded as GPS selection');
    assert.equal(await evaluate('homeLocationMapZoom()'),16);
    await waitFor(()=>evaluate('document.querySelector(".customer-home-review").textContent.includes("Coba lagi")'),'Route failure did not offer a retry');
    await evaluate('quoteError=false;homeEnsureDeliveryRoute(true, { confirmed: true })');
    assert.match(await evaluate('document.querySelector(".customer-home-review").textContent'),/Rp11\.000/);
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    await evaluate('fixtureCheckoutVisible=false;render()');
    assert.equal(await evaluate('removes'),1,'Leaving checkout did not release the map');
    console.log('PASS GPS, pin changes, route quote, retry, 12 refreshes and map cleanup at',width,'px');
  }
  await evaluate(`
    document.querySelector('#app').innerHTML='<div class="customer-home-maplibre-map" data-ready="loading">'+homeRenderMapLoading()+'<div class="maplibregl-canvas-container"><canvas></canvas><div class="customer-home-maplibre-pin"></div></div><div class="maplibregl-control-container"><button>+</button></div></div>';
  `);
  for (const selector of ['canvas', '.customer-home-maplibre-pin', '.maplibregl-control-container']) {
    assert.equal(await evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).visibility`),'hidden','Loading exposed a map element');
  }
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".customer-home-map-loading")).visibility'),'visible');
  const loadingScreenshot = await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(artifacts,'map-loading.png'),Buffer.from(loadingScreenshot.data,'base64'));
  console.log('PASS loading shows only the spinner and hides canvas, pin and controls');

  // The fallback must also wait for its actual image, including failed downloads.
  await evaluate(`
    ${extract('homeRenderStaticLocationMap')}
    window.homeGeoapifyStaticMapUrl=()=> 'https://map-loading-fixture.invalid/pending.png';
    document.querySelector('#app').innerHTML='<div class="customer-home-maplibre-map">'+homeRenderStaticLocationMap(5.37,95.95)+'</div>';
  `);
  assert.equal(await evaluate('!!document.querySelector(".customer-home-map-loading")'),true,'Fallback lost its spinner before the image loaded');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".customer-home-static-map img")).visibility'),'hidden');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".customer-home-static-map-action")).visibility'),'hidden');
  await evaluate(`document.querySelector('.customer-home-static-map img').src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="360"><rect width="400" height="360" fill="#dbe8cf"/></svg>')`);
  await waitFor(()=>evaluate('!document.querySelector(".customer-home-map-loading")'),'Loaded fallback kept its spinner');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".customer-home-static-map img")).visibility'),'visible');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".customer-home-static-map-action")).visibility'),'visible');
  await evaluate(`document.querySelector('#app').innerHTML='<div class="customer-home-maplibre-map">'+homeRenderStaticLocationMap(5.37,95.95)+'</div>';document.querySelector('.customer-home-static-map img').src='data:image/png;base64,invalid'`);
  await waitFor(()=>evaluate('document.querySelector(".customer-home-static-map img").complete'),'Failed fallback image did not settle');
  assert.equal(await evaluate('!!document.querySelector(".customer-home-map-loading")'),true,'A failed image exposed the blank fallback');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".customer-home-static-map img")).visibility'),'hidden');
  console.log('PASS fallback spinner waits for image loading and survives a failed download');
} finally {
  if(socket?.readyState===WebSocket.OPEN){try{await send('Browser.close');}catch{}socket.close();}
  if(browser.exitCode===null)browser.kill();
}
