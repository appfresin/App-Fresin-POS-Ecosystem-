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
const artifacts = path.join(root, 'tests/artifacts/driver-resume');
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
  for (const width of [310, 372, 430]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:true});
    await send('Page.navigate',{url:fixture});
    await waitFor(()=>evaluate('!!window.FresinGateway'),'Fixture did not load');
    await evaluate(`
      window.HOME_DRIVER_SEARCH_DURATION_MS=300000;window.HOME_STATUS_REFRESH_MS=15000;
      window.homeStatusRefreshLoading=false;window.homeStatusRefreshAt=0;
      window.homeStatusNeedsRefresh=false;window.homeStatusRefreshFailed=false;window.homeStatusRefreshRevision=0;
      window.homeDriverSearchTickTimer=null;window.fixtureHidden=false;
      Object.defineProperty(document,'hidden',{configurable:true,get:()=>fixtureHidden});
      window.checkoutOrder={id:'local',supabaseId:'remote',number:'D123',customerOrderType:'DELIVERY',
        paymentProvider:'courier_cash',paymentStatus:'Belum dibayar',status:'Pesanan Baru',customerOrderStatus:'SEARCHING_DRIVER',
        driverSearchStartedAt:new Date().toISOString(),driverSearchExpiresAt:new Date(Date.now()+300000).toISOString()};
      window.homeCurrentOrder=()=>checkoutOrder;window.homeIsMode=()=>true;window.selfOrderStep=()=>'success';
      window.homeIsPaid=order=>order.paymentStatus==='Lunas';window.homeIsPayLaterOrder=()=>true;
      window.homeOrderKind=order=>order.customerOrderType;
      window.homeEscape=value=>escapeHtml(value);window.homeRenderSupportContact=()=>'';
      window.homeDriverCard=()=>'';window.homeCashProgress=()=>'';window.homeOrderTotal=()=>35000;
      window.SOTakeaway={renderHero:({title})=>'<h2>'+title+'</h2>',renderDetails:()=>'<p>Pesanan D123</p>',renderSuccessActions:()=>''};
      window.saveState=()=>{};window.broadcastRealtimeEvent=()=>{};window.supabaseReadable=()=>true;
      window.homePaymentUrlFromPayload=()=>'';
      window.normalizeSupabaseLiveOrder=row=>({id:'local',supabaseId:row.id,number:row.order_number,status:row.status,
        paymentStatus:row.payment_status,customerOrderStatus:row.customer_order_status});
      window.mergeSupabaseLiveOrders=orders=>{checkoutOrder=orders[0]};
      window.remoteReply=new Promise(resolve=>{window.reply=resolve});
      window.reads=0;window.writes=0;window.paints=[];
      window.supabaseClient={from(table){
        const q={select(){return q},eq(){return q},order(){return q},limit(){return q},
          update(){writes++;throw Error('Assigned order must never be expired')},
          then(resolve,reject){if(table==='orders'){reads++;return remoteReply.then(resolve,reject)}return Promise.resolve({data:[],error:null}).then(resolve,reject)}};
        return q;
      }};
      ${['homeDriverSearchTimestamp','homeDriverSearchRemainingMs','homeDriverSearchProgress','homeDriverSearchTimeLabel',
         'homeStartDriverSearchSession','homeExpireDriverSearchSession','homeEnsureDriverSearchSession',
         'homeStatusRank','homeLifecycleCustomerStatus','homePreferAdvancedCustomerStatus','homeCustomerStatus',
         'homeRenderDriverSearchPanel','homeRenderCashStatus','homeRenderStatusSync','homeRenderStatus',
         'homeRefreshActiveOrderFromSupabase','homeScheduleDriverSearchTick','homeResumeOrderStatus'].map(extract).join('\n')}
      render=function(){document.querySelector('#app').innerHTML=homeRenderStatus();paints.push(document.querySelector('#app').textContent);homeScheduleDriverSearchTick()};
      ${customerSource.match(/^      document.addEventListener\("visibilitychange", homeResumeOrderStatus\);/m)[0]}
      render();
    `);
    assert.match(await evaluate('document.querySelector("#app").textContent'),/Menghubungi driver terdekat/);
    await evaluate(`fixtureHidden=true;document.dispatchEvent(new Event('visibilitychange'));checkoutOrder.driverSearchExpiresAt=new Date(Date.now()-60000).toISOString();fixtureHidden=false;document.dispatchEvent(new Event('visibilitychange'))`);
    assert.match(await evaluate('document.querySelector("#app").textContent'),/Memperbarui status pesanan/);
    await delay(3500);
    assert.match(await evaluate('document.querySelector("#app").textContent'),/Memperbarui status pesanan/);
    if (width===372) {
      const shot=await send('Page.captureScreenshot',{format:'png'});
      fs.writeFileSync(path.join(artifacts,'refreshing-status.png'),Buffer.from(shot.data,'base64'));
    }
    await evaluate(`reply({data:[{id:'remote',order_number:'D123',customer_order_status:'DRIVER_ASSIGNED',driver_id:'driver-1',status:'Sedang Disiapkan',payment_status:'Belum dibayar'}],error:null})`);
    await waitFor(()=>evaluate('document.querySelector("#app").textContent.includes("Pesanan sedang disiapkan oleh dapur")'),'Driver assignment did not render');
    assert.equal(await evaluate('paints.some(text=>/Driver belum tersedia|Belum ada kurir|Coba Cari Driver Lagi/.test(text))'),false,'A stale failure flashed during resume');
    assert.equal(await evaluate('writes'),0);
    assert.equal(await evaluate('reads'),1,'Resume started duplicate status requests');
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    console.log('PASS background/resume, delayed status, assigned driver and no failure flash at',width,'px');
  }
} finally {
  if(socket?.readyState===WebSocket.OPEN){try{await send('Browser.close');}catch{}socket.close();}
  if(browser.exitCode===null)browser.kill();
}
