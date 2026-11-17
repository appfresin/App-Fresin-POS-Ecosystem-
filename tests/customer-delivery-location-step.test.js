const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../deploy-ready/delivery/Customer Order/customer-order.js'),'utf8');
function extract(name) { const found=source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`,'m'));assert.ok(found,name);return found[0]; }
test('routing waits for an explicit Continue and reuses the same confirmed pin across navigation and reload',async()=>{
  let calls=0;
  const storage=new Map();
  const ctx=vm.createContext({AbortController,setTimeout,clearTimeout,Date,JSON,
    homeCheckout:()=>({method:'DELIVERY',latitude:5.35,longitude:95.94,locationStatus:'ready'}),
    homeCoordinate:Number,homeIsMode:()=>true,selfOrderStep:()=>'payment',render(){},
    sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    fetch:async()=>{calls++;return Response.json({distanceMeters:5631,fee:14000})}});
  vm.runInContext('let homeDeliveryRoute=null;'+['homeDeliveryRouteKey','homeDeliveryQuote','homeEnsureDeliveryRoute'].map(extract).join('\n'),ctx);
  await ctx.homeEnsureDeliveryRoute();assert.equal(calls,0,'Opening or rendering a map must not calculate a route');
  await ctx.homeEnsureDeliveryRoute(false,{confirmed:true});assert.equal(calls,1);
  await ctx.homeEnsureDeliveryRoute(false,{confirmed:true});assert.equal(calls,1);
  vm.runInContext('homeDeliveryRoute=null',ctx);
  await ctx.homeEnsureDeliveryRoute(false,{confirmed:true});assert.equal(calls,1,'A reloaded checkout must reuse its cached quote');
  assert.equal(ctx.homeDeliveryQuote().fee,14000);
});
