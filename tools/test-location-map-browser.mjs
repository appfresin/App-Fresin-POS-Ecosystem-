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
  const start=customerSource.indexOf(`  function ${name}(`);
  assert.ok(start>=0,name);
  const next=customerSource.indexOf('\n  function ',start+10);
  return customerSource.slice(start,next<0?undefined:next);
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
      window.homeClearCheckoutErrors=()=>{};window.homeDeliveryQuote=()=>({distanceKm:1});window.homeCalculateDeliveryFee=()=>10000;
      window.homeParams=()=>({search:new URLSearchParams()});window.homeAutoLocationRequested=true;
      window.homeMapLibreMap={jumpTo(value){window.camera=value.center;},remove(){window.removes++;}};
      window.homeMapLibreMarker={setLngLat(value){window.markerPoint=value;}};window.removes=0;
      ${['homeCoordinate','homeHasPinnedLocation','homeLocationUiState','homeRefreshLocationPinState','homeUpdateLocationFromLatLng','homeRenderMapLoading','homeRenderLocationPin','homePinCurrentLocation'].map(extract).join('\n')}
      window.homeIsMode=()=>true;window.homePreventEmptyCartAccess=()=>{};window.homeScheduleDriverSearchTick=()=>{};
      window.homeMaybeAutoPinCurrentLocation=()=>{};window.homeInitMapLibreLocationMap=()=>{};
      window.fixtureCheckoutVisible=true;
      render=function(){document.querySelector('#app').innerHTML='<section class="self-order-app"><main class="self-order-main payment customer-home-checkout">'+(fixtureCheckoutVisible?homeRenderLocationPin():'<p>Menu</p>')+'</main></section>';};
      {${renderWrapper}}
      render();
      const map=document.querySelector('#customerHomeMapLibreMap');map.dataset.ready='1';map.innerHTML='<canvas aria-label="Isolated map canvas"></canvas>';
      window.retainedMap=map;window.retainedCanvas=map.firstChild;
    `);
    assert.equal(await evaluate('document.querySelector("#customerHomeCurrentLocationButton").textContent'),'Lokasi anda sudah dipilih');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#customerHomeLocationButton")).display'),'none');
    for(let pass=0;pass<12;pass++) await evaluate('render()');
    assert.equal(await evaluate('document.querySelector("#customerHomeMapLibreMap")===retainedMap && retainedMap.firstChild===retainedCanvas && removes===0'),true,'Background renders remounted the map');
    await evaluate('homeUpdateLocationFromLatLng({lat:5.38,lng:95.96})');
    assert.equal(await evaluate('document.querySelector("#customerHomeLocationButton").hidden'),false);
    assert.equal(await evaluate('document.querySelector("#customerHomeLocationButton").textContent'),'Tetapkan Lokasi');
    assert.equal(await evaluate('document.querySelector("#customerHomeCurrentLocationButton").textContent'),'Pilih lokasi saya saat ini');
    await evaluate(`Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(success){success({coords:{latitude:5.39,longitude:95.97,accuracy:8}});}}});homePinCurrentLocation()`);
    assert.equal(await evaluate('document.querySelector("#customerHomeLocationButton").hidden'),true);
    assert.deepEqual(await evaluate('markerPoint'),[95.97,5.39]);
    assert.equal(await evaluate('document.querySelector("#customerHomeMapLibreMap")===retainedMap'),true,'GPS selection discarded the map');
    await evaluate(`homeUpdateLocationFromLatLng({lat:5.40,lng:95.98});Object.assign(checkout,{locationStatus:'ready'});render()`);
    assert.equal(await evaluate('document.querySelector("#customerHomeLocationButton").hidden'),false,'Manual confirmation masqueraded as GPS selection');
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    await evaluate('fixtureCheckoutVisible=false;render()');
    assert.equal(await evaluate('removes'),1,'Leaving checkout did not release the map');
    console.log('PASS GPS, drag, confirmation, 12 refreshes and map cleanup at',width,'px');
  }
} finally {
  if(socket?.readyState===WebSocket.OPEN){try{await send('Browser.close');}catch{}socket.close();}
  if(browser.exitCode===null)browser.kill();
}
