import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// This browser is isolated and visits only our authored fixture, never the live POS.
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = 'http://127.0.0.1:8001/tests/fixtures/customer-gateway.html';
const customerSource = fs.readFileSync(path.join(root, 'delivery/Customer Order/customer-order.js'), 'utf8');
const emptyStart = customerSource.indexOf('  function homeRenderOrdersEmptyState()');
assert.ok(emptyStart >= 0, 'Empty orders renderer missing');
const emptyEnd = customerSource.indexOf('\n  function ', emptyStart + 3);
const emptyRenderer = customerSource.slice(emptyStart, emptyEnd).trim();
const chrome = process.env.FRESIN_QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const qaDir=path.join(root,'tests/artifacts/confirmation-reorder');fs.mkdirSync(qaDir,{recursive:true});const profile=fs.mkdtempSync(path.join(qaDir,'profile-'));
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

  function extract(source,name,indent=''){
    const start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);
    const end=/\n(?:  )?(?:async )?function \w+\(/.exec(source.slice(start+10));
    return source.slice(start,end?start+10+end.index:source.length);
  }
  const home=extract(fs.readFileSync(path.join(root,'delivery/Customer Order/customer-order.js'),'utf8'),'homeStartNewOrder','  ');
  const takeaway=extract(fs.readFileSync(path.join(root,'SO Takeaway/so-takeaway.js'),'utf8'),'soTakeawayStartNewOrder','  ');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  for(const method of ['DELIVERY','PICKUP_PREORDER','TAKEAWAY']){
    await send('Page.navigate',{url:fixture});
    await waitFor(()=>evaluate("!!window.FresinGateway && !!document.querySelector('.fresin-gateway-choice')"),'Fixture not ready');
    await evaluate(`var HOME_CHECKOUT_KEY='customer_home_checkout'; var TAKEAWAY_ACTIVE_KEY='so_takeaway_active_order'; ${home}\n${takeaway}
      window.CustomerOrder.startNewOrder=homeStartNewOrder;
      if(${JSON.stringify(method)}==='TAKEAWAY'){
        window.CustomerOrder.isMode=()=>false;
        window.SOTakeaway={isMode:()=>true,newOrder:soTakeawayStartNewOrder};
      }
      sessionStorage.setItem('customer_home_checkout',JSON.stringify({method:${JSON.stringify(method)},note:'Previous note'}));
      sessionStorage.setItem('self_order_step','success');
      history.replaceState({selfOrderStep:'success',fresinService:'delivery'},'',location.href+'?mode=delivery');
      document.getElementById('app').innerHTML='<button id="qaReorder" onclick="${method==='TAKEAWAY'?'window.SOTakeaway.newOrder(event)':'CustomerOrder.startNewOrder()'}">Pesan Lagi</button>';
      document.getElementById('qaReorder').click();`);
    const result=await evaluate(`({step:selfOrderStep(),service:history.state.fresinService,path:location.pathname,
      search:location.search,choices:document.querySelectorAll('.fresin-gateway-choice').length,
      checkout:sessionStorage.getItem('customer_home_checkout'),cart:selfOrderCart.length})`);
    assert.equal(result.step,'gateway');assert.equal(result.service,null);assert.equal(result.choices,2);
    assert.equal(result.cart,0);assert.equal(result.checkout,null);assert.equal(result.search,'');
    assert.equal(result.path,method==='TAKEAWAY'?'/order/':'/pesan/');
    const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    fs.writeFileSync(path.join(qaDir,`reorder-${method}.png`),Buffer.from(screenshot.data,'base64'));
    console.log('Reorder returned to two choices:',method);
  }
  const settings=extract(fs.readFileSync(path.join(root,'pages/settings.js'),'utf8'),'renderNotificationSettingsTab');
  await evaluate(`function productCategories(){return ['Coffee','Donuts'];}
    function handleNotificationSettingsDraftChange(){window.qaNotificationDraftChanged=true;}
    function deviceKitchenNotificationCategories(){return ['Coffee','__confirmation__'];}
    function nativePushTokenRegistrationLooksRegistered(){return false;}
    function deviceOrderNotificationsEnabled(){return true;}
    function receiptSwitch(name,label,value){return '<label>'+label+'<input type="checkbox" '+(value?'checked':'')+'></label>';}
    ${settings}
    var qaStyle=document.createElement('link');qaStyle.rel='stylesheet';qaStyle.href='/styles/07-dashboard-overrides.css';document.head.append(qaStyle);
    document.documentElement.classList.remove('fresin-gateway-open');
    document.getElementById('app').innerHTML=renderNotificationSettingsTab();`);
  const settingState=await evaluate(`({checked:document.querySelector('input[value="__confirmation__"]').checked,
    product:document.querySelector('input[value="Coffee"]').checked,
    label:document.querySelector('input[value="__confirmation__"]').nextElementSibling.textContent})`);
  assert.deepEqual(settingState,{checked:true,product:true,label:'Konfirmasi'});
  await evaluate(`document.querySelector('input[value="__confirmation__"]').click()`);
  assert.equal(await evaluate(`document.querySelector('input[value="Coffee"]').checked`),true);
  await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}).then(image=>fs.writeFileSync(path.join(qaDir,'confirmation-settings.png'),Buffer.from(image.data,'base64')));
  assert.equal(await evaluate('window.qaNotificationDraftChanged'),true);
  assert.deepEqual(exceptions,[]);
  console.log('Confirmation checkbox rendered independently of product selection.');
} finally {
  if(socket?.readyState===WebSocket.OPEN){try{await send('Browser.close');}catch{}socket.close();}
  if(browser.exitCode===null)browser.kill();
}
