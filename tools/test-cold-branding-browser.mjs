import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

// Own isolated QA browser. All remote requests are intercepted; no real orders or auth.
const out=path.resolve('tests/artifacts/branding');
fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(out,'isolated-profile-'));
const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--disable-gpu','--no-first-run','--disable-default-apps','--no-default-browser-check',
  '--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',`--user-data-dir=${profile}`,'about:blank'
],{stdio:'ignore'});
let socket,serial=0;
const pending=new Map(),blocked=[],errors=[],logs=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(callback,label){const end=Date.now()+15000;while(Date.now()<end){const v=await callback();if(v)return v;await delay(100);}throw Error(label);}
function send(method,params={}){return new Promise((resolve,reject)=>{
  const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(Error(`Timed out: ${method}`));},12000);
  pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject});socket.send(JSON.stringify({id,method,params}));
});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result?.value;}
try{
  const port=await until(()=>{try{return Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);}catch{return false;}},'Own Chrome did not start');
  const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const own=tabs.find(tab=>tab.url==='about:blank'&&tab.type==='page');assert.ok(own);
  socket=new WebSocket(own.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if(message.id){const p=pending.get(message.id);pending.delete(message.id);message.error?p?.reject(Error(message.error.message)):p?.resolve(message.result);return;}
    if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);
    if(message.method==='Runtime.consoleAPICalled')logs.push(message.params.args.map(arg=>arg.value||arg.description||'').join(' '));
    if(message.method==='Fetch.requestPaused'){
      const {requestId,request}=message.params;
      if(request.method==='OPTIONS'){
        send('Fetch.fulfillRequest',{requestId,responseCode:204,responseHeaders:[
          {name:'Access-Control-Allow-Origin',value:'*'},
          {name:'Access-Control-Allow-Headers',value:'apikey,authorization,content-type,x-client-info'},
          {name:'Access-Control-Allow-Methods',value:'GET,OPTIONS'}]}).catch(console.error);
      }else if(request.url.includes('/rest/v1/store_settings')){
        const body=JSON.stringify([{id:'54a5801f-b78f-44a5-aca8-846d33fa292e',store_name:'Fresin Indonesia',
          receipt_store_name:'Fresin Indonesia',app_name:'Fresin Instagram QA',outlet_name:'Outlet QA',
          profile_image:'https://drive.google.com/uc?id=1HrP-iW9Gc_N3FAjAKNxlpcwm34a6f2AB',promo_slides:[],upsell_ids:[]}]);
        send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[
          {name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'}],body:Buffer.from(body).toString('base64')}).catch(console.error);
      }else if(request.url.includes('/rest/v1/')){
        send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[
          {name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'}],body:Buffer.from('[]').toString('base64')}).catch(console.error);
      }else{
        blocked.push(new URL(request.url).hostname);
        send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'}).catch(console.error);
      }
    }
  });
  await send('Page.enable');await send('Runtime.enable');
  await send('Fetch.enable',{patterns:[{urlPattern:'https://*'}]});
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await send('Page.navigate',{url:'http://127.0.0.1:8001/pesan/?branding-qa=1'});
  await until(()=>evaluate("document.querySelector('.self-order-topbar strong')?.textContent==='Fresin Instagram QA'"),'REST branding never reached the gateway');
  const result=await evaluate(`(() => {
    const images=[...document.querySelectorAll('.self-order-topbar img,.fresin-gateway-stamp img')];
    return {name:document.querySelector('.self-order-topbar strong').textContent,
      outlet:document.querySelector('.self-order-topbar div span').textContent,
      imageUrls:images.map(i=>i.getAttribute('src')),loaded:images.every(i=>i.complete&&i.naturalWidth>0),
      sdkAvailable:!!window.supabase,choices:document.querySelectorAll('.fresin-gateway-choice').length};
  })()`);
  if(!result.loaded)await until(()=>evaluate("[...document.querySelectorAll('.self-order-topbar img,.fresin-gateway-stamp img')].every(i=>i.complete&&i.naturalWidth>0)"),'Local logos failed');
  assert.equal(result.name,'Fresin Instagram QA');assert.equal(result.outlet,'Outlet QA');
  assert.equal(result.sdkAvailable,false);assert.equal(result.choices,2);assert.equal(result.imageUrls.length,2);
  assert.ok(result.imageUrls.every(url=>url==='/Customer%20Gateway/assets/fresin-logo.png'));
  assert.ok(blocked.includes('cdn.jsdelivr.net'));
  const image=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(out,'cold-browser-without-sdk.png'),Buffer.from(image.data,'base64'));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({...result,loaded:true,blockedRemoteHosts:[...new Set(blocked)],errors}));
}catch(error){
  console.log({error:error.message,errors,logs,blocked:[...new Set(blocked)]});
  if(socket?.readyState===WebSocket.OPEN)console.log(await evaluate('document.body.innerText'));
  throw error;
}finally{
  socket?.close();browser.kill();
}
