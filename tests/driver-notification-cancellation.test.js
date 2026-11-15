const fs=require('node:fs');const vm=require('node:vm');const assert=require('node:assert/strict');const {test}=require('node:test');
const path=require('node:path');
function readSource(file){const local=path.join(__dirname,'..',file);return fs.readFileSync(fs.existsSync(local)?local:path.join(__dirname,'../deploy-ready',file),'utf8');}
const driver=readSource('driver/Driver Order/driver-order.js');
function extract(source,name){const start=source.search(new RegExp(`(?:async )?function ${name}\\(`));assert.ok(start>=0,name);const next=/\n  (?:async )?function \w+\(/.exec(source.slice(start+10));return source.slice(start,next?start+10+next.index:source.length);}
function setup(){const state={profile:{id:'driver'},orders:[],view:'active'};const ctx=vm.createContext({state,Date,Set,DRIVER_ACCEPT_WINDOW_MS:300000,hasProfile:()=>true,driverMatches:order=>order.driver_id==='driver',isToday:()=>true,escapeHtml:value=>String(value||'').replaceAll('<','&lt;'),render(){},processAssignedOrder(){throw Error('Cancelled order reached processing');},window:{DriverNotifications:{update:orders=>{ctx.alerts=orders;}}}});
vm.runInContext(['driverOrderCancelled','renderCancelledNotice','notifyNewDriverOrders','driverAcceptanceTime','acceptanceExpired','lifecycleStatus','statusRank','effectiveOrderStatus','kitchenReady','canShowActive','missedOrdersToday','filteredOrders','runAction'].map(name=>extract(driver,name)).join('\n'),ctx);return ctx;}
test('all cancellation markers override driver assignment, kitchen readiness and acceptance expiry',async()=>{
 const ctx=setup();
 for(const patch of [{status:'Dibatalkan'},{cancelled_at:new Date().toISOString()},{customer_order_status:'CANCELLED'}]){
  const order={id:'one',status:'Selesai',driver_id:'driver',customer_order_status:'DRIVER_ASSIGNED',...patch};ctx.state.orders=[order];
  assert.equal(ctx.effectiveOrderStatus(order),'CANCELLED');assert.equal(ctx.kitchenReady(order),false);assert.equal(ctx.canShowActive(order),false);
  assert.equal(ctx.filteredOrders().length,0);ctx.state.view='missed';assert.equal(ctx.filteredOrders().length,1);ctx.state.view='tasks';assert.equal(ctx.filteredOrders().length,0);ctx.state.view='active';
  for(const action of ['take','process','delivering','complete']){await ctx.runAction(action,'one');assert.match(ctx.state.error,/dibatalkan/);}
  assert.match(ctx.renderCancelledNotice(order),/Pesanan dibatalkan/);
 }
});
test('only unassigned, unexpired and noncancelled searches reach notification delivery',()=>{
 const ctx=setup();const current={id:'new',customer_order_status:'SEARCHING_DRIVER',updated_at:new Date().toISOString()};
 ctx.notifyNewDriverOrders([current,{...current,id:'cancelled',status:'Dibatalkan'},{...current,id:'assigned',driver_id:'other'},{...current,id:'old',updated_at:'2020-01-01T00:00:00Z'}]);
 assert.deepEqual(Array.from(ctx.alerts,order=>order.id),['new']);
});
const notifications=readSource('driver/Driver Order/driver-notifications.js');
test('new driver notifications deduplicate refresh and reload, while a new search session alerts again',async()=>{
 const storage=new Map(), delivered=[];let vibrations=0,permissions=0;
 class Notification {static permission='granted';static async requestPermission(){permissions++;return 'granted';}constructor(title,options){delivered.push({title,options});}}
 const ctx=vm.createContext({Map,Set,JSON,Notification,localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},navigator:{vibrate:()=>vibrations++},document:{addEventListener(){}},setTimeout:()=>1,clearTimeout(){},window:{}});
 vm.runInContext(notifications,ctx);const order={id:'one',order_number:'D001',updated_at:new Date().toISOString()},profile={id:'driver'};
 ctx.window.DriverNotifications.update([order],profile);await Promise.resolve();assert.equal(delivered.length,1);assert.equal(vibrations,1);assert.equal(permissions,0);
 ctx.window.DriverNotifications.update([order],profile);await Promise.resolve();assert.equal(delivered.length,1);
 vm.runInContext(notifications,ctx);ctx.window.DriverNotifications.update([order],profile);await Promise.resolve();assert.equal(delivered.length,1);
 ctx.window.DriverNotifications.update([{...order,updated_at:new Date(Date.now()+1000).toISOString()}],profile);await Promise.resolve();assert.equal(delivered.length,2);
 assert.equal(ctx.window.DriverNotifications.render(),"");
 ctx.window.DriverNotifications.update([],profile);assert.doesNotMatch(ctx.window.DriverNotifications.render(),/role="alert"/);
 assert.equal(delivered[0].options.requireInteraction,true);
 Notification.permission='default';await ctx.window.DriverNotifications.enable();assert.equal(permissions,1);
});
