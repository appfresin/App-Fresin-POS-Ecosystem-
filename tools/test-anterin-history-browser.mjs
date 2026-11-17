import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// This browser is isolated and visits only our authored fixture, never the live POS.
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = pathToFileURL(path.join(root, 'tests/fixtures/anterin-live-preview.html')).href;
const chrome = process.env.FRESIN_QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fresin-gateway-qa-'));
const artifacts = path.join(root, 'tests/artifacts/anterin-history');
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
  const portFile=path.join(profile,'DevToolsActivePort');
  const port=await waitFor(()=>{try{return Number(fs.readFileSync(portFile,'utf8').split('\n')[0]);}catch{return false;}},'Chrome did not start');
  const pages=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket=new WebSocket(pages.find(p=>p.type==='page'&&p.url==='about:blank').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',event=>{const result=JSON.parse(event.data);if(!result.id)return;const call=pending.get(result.id);pending.delete(result.id);if(result.error)call?.reject(Error(result.error.message));else call?.resolve(result.result);});
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setTimezoneOverride',{timezoneId:'Asia/Jakarta'});
  async function chooseDay(key) {
    for(let pass=0;pass<12;pass++) {
      const month=await evaluate('DriverOrder.state.datePickerMonth');
      if(month===key.slice(0,7)) break;
      await evaluate(`document.querySelector('[data-calendar-month="${month>key.slice(0,7)?'-1':'1'}"]').click()`);
    }
    await evaluate(`document.querySelector('[data-calendar-day="${key}"]').click()`);
  }
  async function screenshot(name) {
    const shot=await send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(artifacts,name+'.png'),Buffer.from(shot.data,'base64'));
  }
  for(const width of [310,343,372,430]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:width===343?641:900,deviceScaleFactor:1,mobile:true});
    await send('Page.navigate',{url:fixture});
    await waitFor(()=>evaluate('window.DriverOrder?.state.profile.id==="preview-driver"'),'Anterin preview did not load');
    await evaluate(`window.testDay=offset=>{const date=new Date();date.setDate(date.getDate()+offset);return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0')}`);
    const today=await evaluate('testDay(0)'),yesterday=await evaluate('testDay(-1)'),older=await evaluate('testDay(-3)');
    await waitFor(()=>evaluate('!!document.querySelector(".driver-alert-open")'),'Notification did not render');
    assert.equal(await evaluate('!!document.querySelector(".driver-day-filter")'),false,'The history card must be removed');
    assert.equal(await evaluate('document.querySelectorAll(".driver-period-chips [data-period-preset]").length'),5);
    assert.doesNotMatch(await evaluate('document.querySelector(".driver-incoming-alert").textContent'),/Lihat/);
    assert.equal(await evaluate('!!document.querySelector(".driver-alert-eyebrow")'),false);
    const arrow=await evaluate(`(()=>{const a=document.querySelector('.driver-alert-open').getBoundingClientRect(),c=document.querySelector('.driver-alert-chevron').getBoundingClientRect();return {offset:Math.abs(c.top+c.height/2-a.top-a.height/2),size:parseFloat(getComputedStyle(document.querySelector('.driver-alert-chevron')).fontSize)}})()`);
    assert.ok(arrow.offset<1&&arrow.size>=30,'Notification arrow must be centered and larger');
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    const layout=await evaluate(`(()=>{const a=document.querySelector('.driver-incoming-alert').getBoundingClientRect(),g=document.querySelector('.driver-shift-card').getBoundingClientRect(),c=document.querySelector('.driver-period-chips').getBoundingClientRect();return {gap:g.top-a.bottom,align:Math.abs(g.left-a.left)+Math.abs(g.right-a.right),chipGap:c.top-g.bottom,height:a.height}})()`);
    assert.ok(Math.abs(layout.gap-16)<1&&layout.align<1);
    assert.ok(layout.chipGap>=12&&layout.chipGap<=18);
    assert.ok(layout.height<110,'Notification should stay compact');
    if(width===372) await screenshot('compact-notification-and-chips');
    await evaluate('document.querySelector(".driver-alert-copy").click()');
    assert.equal(await evaluate('DriverOrder.state.selectedId'),'preview-ready','Clicking the notification must open its order');
    await evaluate('DriverOrder.setView("active")');
    await evaluate('document.querySelector("[data-period-preset=yesterday]").click()');
    await waitFor(()=>evaluate('DriverOrder.state.view==="history"&&!DriverOrder.state.historyPendingDate'),'Yesterday did not load');
    assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".driver-list [data-order-id]"),el=>el.dataset.orderId)'),['preview-yesterday']);
    await evaluate('document.querySelector("[data-period-preset=week]").click()');
    await waitFor(()=>evaluate('!DriverOrder.state.historyPendingDate'),'Week did not load');
    assert.equal(await evaluate('document.querySelectorAll(".driver-list [data-order-id]").length'),4);
    assert.equal(await evaluate('DriverOrder.state.historyDate'),await evaluate('testDay(-6)'));
    await evaluate('document.querySelector("[data-period-preset=custom]").click()');
    assert.equal(await evaluate('document.querySelector("#driverDateRangeDialog").open'),true);
    const dialogSize=await evaluate('(()=>{const d=document.querySelector("#driverDateRangeDialog");return {h:d.getBoundingClientRect().height,max:innerHeight*.85,overflow:d.scrollWidth>d.clientWidth||d.scrollHeight>d.clientHeight}})()');
    assert.ok(dialogSize.h<dialogSize.max&&!dialogSize.overflow,'Custom date dialog must fit as a small card');
    await chooseDay(older);
    assert.equal(await evaluate('document.querySelector(".driver-date-apply").disabled'),true);
    await chooseDay(yesterday);
    assert.equal(await evaluate('!!document.querySelector(".driver-date-selection,.driver-calendar-hint")'),false);
    assert.match(await evaluate('document.querySelector(".driver-date-range-chip").textContent'),/ - /);
    if(width===372) await screenshot('custom-date-dialog');
    await evaluate('document.querySelector(".driver-date-apply").click()');
    await waitFor(()=>evaluate('!DriverOrder.state.datePickerContext&&!DriverOrder.state.historyPendingDate'),'Custom order range did not apply');
    assert.equal(await evaluate('DriverOrder.state.historyDate'),older);
    assert.equal(await evaluate('DriverOrder.state.historyDateTo'),yesterday);
    assert.equal(await evaluate('document.querySelectorAll(".driver-list [data-order-id]").length'),2);
    await evaluate('document.querySelector("[data-view=earnings]").click()');
    await evaluate('document.querySelector("[data-period-context=wallet] [data-period-preset=today]").click()');
    await waitFor(()=>evaluate('!DriverOrder.state.historyPendingDate'),'Today wallet did not load');
    assert.equal(await evaluate('document.querySelector(".driver-earnings-hero").nextElementSibling.className'),'driver-period-chips');
    assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".driver-wallet-bars [data-open-order]"),el=>el.dataset.openOrder)'),['preview-today-1','preview-today-2']);
    assert.match(await evaluate('document.querySelector(".driver-earnings-hero").textContent'),/Rp29\.500/);
    if(width===372) await screenshot('wallet-per-order-and-chips');
    await evaluate('document.querySelector("[data-period-context=wallet] [data-period-preset=month]").click()');
    await waitFor(()=>evaluate('!DriverOrder.state.historyPendingDate'),'Month wallet did not load');
    assert.equal(await evaluate('DriverOrder.state.walletDate'),today.slice(0,7)+'-01');
    await evaluate('document.querySelector("[data-period-context=wallet] [data-period-preset=custom]").click()');
    await chooseDay(yesterday);await chooseDay(yesterday);
    assert.equal(await evaluate('!!document.querySelector(".driver-date-selection,.driver-calendar-hint")'),false);
    assert.equal(await evaluate('document.querySelectorAll(".driver-date-range-chip").length'),1);
    await evaluate('document.querySelector(".driver-date-apply").click()');
    await waitFor(()=>evaluate('!DriverOrder.state.datePickerContext&&!DriverOrder.state.historyPendingDate'),'Custom wallet range did not apply');
    assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".driver-wallet-bars [data-open-order]"),el=>el.dataset.openOrder)'),['preview-yesterday']);
    await evaluate('document.querySelector("[data-open-order=preview-yesterday]").click()');
    assert.equal(await evaluate('DriverOrder.state.selectedId'),'preview-yesterday','Wallet entries must open order details');
    await evaluate('DriverOrder.setView("active")');
    await waitFor(()=>evaluate('!DriverOrder.state.fetching'),'Active view did not reload');
    await evaluate('document.querySelector("[data-action=dismiss-ready-alert]").click()');
    assert.equal(await evaluate('DriverOrder.state.selectedId'),'','Dismissing the alert must not open order details');
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    console.log('PASS compact clickable alert, five chips, custom dialog, Order/Wallet ranges and per-order earnings at',width,'px');
  }
} finally {
  if(socket?.readyState===WebSocket.OPEN){try{await send('Browser.close');}catch{}socket.close();}
  if(browser.exitCode===null)browser.kill();
}
