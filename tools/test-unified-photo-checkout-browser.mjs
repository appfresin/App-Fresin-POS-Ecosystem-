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


  const appSource=fs.readFileSync(path.join(root,fs.existsSync(path.join(root,'app.js'))?'app.js':'deploy-ready/self-order/app.js'),'utf8');
  const takeawaySource=fs.readFileSync(path.join(root,fs.existsSync(path.join(root,'SO Takeaway/so-takeaway.js'))?'SO Takeaway/so-takeaway.js':'deploy-ready/self-order/SO Takeaway/so-takeaway.js'),'utf8');
  function sourceFunction(source,name,indent='') {
    const match=source.match(new RegExp('^'+indent+'function '+name+'\\([\\s\\S]*?^'+indent+'}', 'm'));
    assert.ok(match,name);return match[0];
  }
  for(const mode of ['so','takeaway']) for(const width of [343,430]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:true});
    await send('Page.navigate',{url:fixture+(mode==='so'?'?table=A1':'?mode=takeaway')});
    await waitFor(()=>evaluate('!!window.FresinGateway'),'Fixture did not load');
    await evaluate(`
      window.CustomerOrder.isMode=()=>false;window.SOTakeaway={isMode:()=>${mode==='takeaway'}};
      window.selfOrderSubmitting=false;window.selfOrderSubmitError='';
      window.syncSelfOrderTableFromUrl=()=>{};window.selfOrderOpenTableOrder=()=>null;window.selfOrderOpenTableChoice=()=>'';
      window.soTakeawayActiveOrder=()=>null;window.soTakeawayEscape=escapeHtml;window.soTakeawayMoney=value=>money(value);
      window.money=value=>'Rp '+Number(value).toLocaleString('id-ID');window.cartItemTotal=item=>item.price*item.qty+(item.addons||[]).reduce((sum,a)=>sum+a.price*a.qty,0);
      selfOrderCart=[{productId:'a',name:'Aren Latte',qty:1,price:20000},{productId:'b',name:'Avocado Latte',qty:2,price:20000,addons:[{name:'Salt Cream',price:5000,qty:1}],note:'Sedikit es, topping dipisah'},{productId:'c',name:'Choco Latte',qty:3,price:20000,note:'Kurangi gula'},{productId:'d',name:'Fresin Latte',qty:1,price:20000,addons:[{name:'Salt Cream',price:5000,qty:2}],note:'Topping dipisah'},{productId:'e',name:'Fresh Lemonade',qty:4,price:10000,addons:[{name:'Jelly',price:2000,qty:1},{name:'Nata de Coco',price:3000,qty:1}],note:'Dua gelas tanpa es'}];
      state.products=selfOrderCart.map(item=>({id:item.productId,name:item.name}));window.imageSizes=[];
      window.productImageOrToken=(product,cls,size)=>{imageSizes.push(size);return '<img class="'+cls+'" alt="Foto '+product.name+'" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2260%22%3E%3Crect width=%2260%22 height=%2260%22 rx=%2214%22 fill=%22%23e4edf9%22/%3E%3C/svg%3E">'};
      window.selfOrderSubtotal=()=>selfOrderCart.reduce((sum,item)=>sum+cartItemTotal(item),0);window.selfOrderItemsTotal=()=>11;
      window.orderItemNoteHtml=item=>item.note?'<small>'+escapeHtml(item.note)+'</small>':'';window.renderSelfOrderUpsellCard=()=>'';
      sessionStorage.setItem('self_order_customer','Pelanggan uji');sessionStorage.setItem('so_takeaway_customer_phone','08000000000');sessionStorage.setItem('self_order_checkout_note','Catatan uji checkout');
      ${sourceFunction(appSource,'renderSelfOrderPayment')}
      ${sourceFunction(takeawaySource,'soTakeawayRenderPayment','  ')}
      window.paintPayment=()=>{document.querySelector('#app').innerHTML='<section class="self-order-app">'+renderSelfOrderTopbar()+(${mode==='so'}?renderSelfOrderPayment():soTakeawayRenderPayment())+'</section>'};
      document.querySelector('#app').innerHTML='<section class="self-order-app">'+FresinGateway.renderCart()+'</section>';
    `);
    assert.equal(await evaluate('document.querySelectorAll(".customer-home-cart-visual img").length'),5);
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,'Cart overflow');
    await evaluate('paintPayment()');
    assert.equal(await evaluate('document.querySelectorAll(".customer-home-checkout-item").length'),5);
    assert.equal(await evaluate('document.querySelectorAll(".customer-home-checkout-item-visual img").length'),5);
    assert.equal(await evaluate('document.querySelector(".customer-home-checkout-items").innerText.includes("Salt Cream ×2")'),true);
    assert.equal(await evaluate('document.querySelector(".customer-home-checkout-items").innerText.includes("Kurangi gula")'),true);
    assert.equal(await evaluate('document.querySelector(".customer-home-review").innerText.includes("200.000")'),true);
    assert.equal(await evaluate('document.querySelector(".customer-home-checkout-items").innerText.includes("11 item")'),true);
    assert.equal(await evaluate('document.querySelector("#selfOrderCustomer").value'),'Pelanggan uji');
    assert.equal(await evaluate('!!document.querySelector("#soTakeawayCustomerPhone")'),mode==='takeaway');
    assert.equal(await evaluate('imageSizes.every(size=>size===420)'),true,'Photo sizes must reuse the menu source');
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,'Checkout overflow');
    if(mode==='so') {
      await evaluate('selfOrderOpenTableOrder=()=>({customer:"Nama meja terkunci"});selfOrderOpenTableChoice=()=>"append";paintPayment()');
      assert.equal(await evaluate('document.querySelector("#selfOrderCustomer").readOnly'),true);
      assert.equal(await evaluate('document.querySelector("#selfOrderCustomer").value'),'Nama meja terkunci');
    }
    const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,'unified-'+mode+'-'+width+'.png'),Buffer.from(shot.data,'base64'));
    console.log('PASS',mode,width,'px: five photos, quantities, toppings, notes, totals, field preservation and menu photo reuse');
  }
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await evaluate(`document.querySelector('#app').innerHTML=['delivery','pickup','dinein'].map(service=>FresinGateway.checkoutServiceArt(service)).join('')`);
  assert.equal(await evaluate('document.querySelectorAll(".fresin-checkout-art img").length'),0,'Service icons must not download extra images');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".is-delivery .is-first")).animationName'),'fresinServiceFirst');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".is-pickup .is-second")).animationName'),'fresinServiceSecond');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".is-dinein .fresin-utensil-fork")).animationName'),'fresinForkSlide');
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".is-delivery .is-first")).animationName'),'none');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".is-dinein .fresin-utensil-fork")).animationName'),'none');
  await send('Emulation.setEmulatedMedia',{features:[]});
  await evaluate(`document.querySelectorAll('.fresin-checkout-art').forEach(el=>el.dataset.motion='off')`);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".is-pickup .is-second")).animationName'),'none');
  console.log('PASS gateway SVG and keyframe reuse for all three services, reduced motion and explicit motion off');
} finally {
  if(socket?.readyState===WebSocket.OPEN){try{await send('Browser.close');}catch{}socket.close();}
  if(browser.exitCode===null)browser.kill();
}

