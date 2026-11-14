const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const localSource = path.join(__dirname, '../driver/Driver Order/driver-order.js');
const source = fs.readFileSync(fs.existsSync(localSource) ? localSource : path.join(__dirname, '../deploy-ready/driver/Driver Order/driver-order.js'), 'utf8');
function extract(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const next = /\n  (?:async )?function \w+\(/.exec(source.slice(start + 10));
  return source.slice(start, next ? start + 10 + next.index : source.length);
}
function fixture() {
  const order = {id:'order-1',customer_order_type:'DELIVERY',payment_provider:'courier_cash',
    customer_order_status:'DRIVER_ASSIGNED',driver_id:'own-driver',status:'Pesanan Baru',payment_status:'Belum dibayar'};
  const calls=[];
  const context=vm.createContext({state:{profile:{id:'own-driver'},orders:[order],rejectOrderId:order.id,actionLoading:''},
    hasProfile:()=>true,isCourierCash:o=>o.payment_provider==='courier_cash',isPaidOrder:o=>o.payment_status==='Lunas',
    driverOrderCancelled:o=>!!o.cancelled_at,acceptanceExpired:o=>!!o.expired,render:()=>{},
    localStorage:{setItem(){}},VIEW_KEY:'view',notifyNewDriverOrders:()=>{},fetchOrders:async()=>{},
    window:{DriverNotifications:{deviceCredentials:()=>({id:'verified-device',secret:'secret'})},
      DriverSupabase:{ready:async()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:{id:order.id,customer_order_status:'CANCELLED',cancel_reason:args.p_reason}};}})}}});
  vm.runInContext(extract('canRejectOrder')+'\n'+extract('rejectOrder'),context);
  return {context,order,calls};
}
test('only an unprocessed, unpaid offer or own assignment can be rejected',()=>{
  const {context:c,order}=fixture();
  assert.equal(c.canRejectOrder(order),true);
  for(const patch of [{driver_id:'other-driver'},{confirmed_at:'now'},{payment_status:'Lunas'},
    {cancelled_at:'now'},{customer_order_status:'DELIVERING'},{status:'Diproses'},{payment_provider:'qris'}])
    assert.equal(c.canRejectOrder({...order,...patch}),false,JSON.stringify(patch));
  const offer={...order,driver_id:null,customer_order_status:'SEARCHING_DRIVER'};
  assert.equal(c.canRejectOrder(offer),true);
  assert.equal(c.canRejectOrder({...offer,expired:true}),false);
  assert.equal(c.canRejectOrder({...offer,driver_name:'other-driver'}),false);
});
test('blank reason and missing verified session never send an update',async()=>{
  const {context:c,calls}=fixture();
  await c.rejectOrder(' \n ');assert.equal(calls.length,0);
  c.window.DriverNotifications.deviceCredentials=()=>null;
  await c.rejectOrder('Tidak dapat mengantar');assert.equal(calls.length,0);
  assert.match(c.state.rejectError,/Verifikasi PIN/);
});
test('rejection uses authenticated RPC and propagates reason only after success',async()=>{
  const {context:c,order,calls}=fixture();
  await c.rejectOrder('  Ban bocor  ');
  assert.equal(calls.length,1);
  assert.equal(calls[0].name,'driver_reject_order');
  assert.equal(calls[0].args.p_reason,'Ban bocor');
  assert.equal(calls[0].args.p_device_id,'verified-device');
  assert.equal(order.cancel_reason,'Ban bocor');
  assert.equal(order.customer_order_status,'CANCELLED');
  assert.equal(c.state.view,'missed');
});
test('server conflict keeps order and reason available for review',async()=>{
  const {context:c,order}=fixture();
  c.window.DriverSupabase.ready=async()=>({rpc:async()=>({error:{code:'55000'}})});
  await c.rejectOrder('Ban bocor');
  assert.equal(order.customer_order_status,'DRIVER_ASSIGNED');
  assert.equal(c.state.rejectOrderId,order.id);
  assert.equal(c.state.rejectReason,'Ban bocor');
  assert.match(c.state.rejectError,/sudah diambil/);
});
