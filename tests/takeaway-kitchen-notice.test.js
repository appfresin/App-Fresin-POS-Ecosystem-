const fs=require('node:fs');const vm=require('node:vm');const assert=require('node:assert/strict');const {test}=require('node:test');
const read=file=>fs.readFileSync(fs.existsSync(file)?file:'deploy-ready/pos/'+file,'utf8');
const core=read('app.js'),page=read('pages/kitchen.js');
function fn(source,name){const start=source.search(new RegExp(`(?:async )?function ${name}\\(`));assert.ok(start>=0,name);const next=/\n(?:async )?function \w+\(/.exec(source.slice(start+10));return source.slice(start,next?start+10+next.index:source.length);}
function setup(){const ctx=vm.createContext({state:{orders:[],products:[]},Date,escapeHtml:value=>String(value||'').replaceAll('<','&lt;'),customerDisplayName:value=>value,displayOrderNumber:value=>'#'+value,dateTime:()=> '14 Nov 2026, 10.00',kitchenFilter:'Pemberitahuan Takeaway',todayKey:()=> '2026-11-14',kitchenOrderActivityAt:order=>order.createdAt,kitchenCard:()=>{throw Error('Notice must not render a kitchen order');},navIcon:()=>'',empty:()=>'<p>Kosong</p>'});
vm.runInContext(['orderNeedsCashierConfirmation','orderIsCancelled','orderIsPaid','isNewOrderStatus','orderIsCustomerHomeOrder','orderUsesOutletPayment','orderVisibleInPosOrderList','orderNeedsTakeawayCashier','orderNavigationBadgeCount','renderOrderNavigationBadge','updateOrderNavigationBadges'].map(name=>fn(core,name)).join('\n'),ctx);vm.runInContext(page,ctx);return ctx;}
const pickup=(patch={})=>({id:'home',number:'P001',customer:'Pelanggan Contoh',customerOrderType:'PICKUP_PREORDER',paymentProvider:'cash_at_outlet',serviceInfo:'Takeaway-Rumah',status:'Pesanan Baru',pickupTime:'18:30',createdAt:'2026-11-13T23:00:00Z',items:[{name:'Must not appear',qty:1}],...patch});
test('online pickup and SO takeaway awaiting cashier produce informational notices',()=>{
 const ctx=setup(),home=pickup();assert.equal(ctx.orderNeedsTakeawayCashier(home),true);
 for(const patch of [{confirmedAt:'yes'},{status:'Sedang Disiapkan'},{cancelledAt:'yes'},{paymentProvider:'duitku',paymentStatus:'Belum dibayar'},{customerOrderType:'DELIVERY'}])assert.equal(ctx.orderNeedsTakeawayCashier({...home,...patch}),false);
 const so={...home,id:'so',source:'Self Order',customerOrderType:'TAKEAWAY',type:'Take Away',serviceInfo:'Takeaway Outlet'};
 assert.equal(ctx.orderNeedsTakeawayCashier(so),true);
 assert.equal(ctx.orderNeedsTakeawayCashier({...so,confirmedAt:'accepted'}),false);
 ctx.state.orders=[home];const before=JSON.stringify(home),html=ctx.renderKitchen();
 ctx.state.orders=[so];assert.match(ctx.renderKitchen(),/kitchen-takeaway-notice/);ctx.kitchenFilter='Pesanan Baru';assert.match(ctx.renderKitchen(),/kitchen-takeaway-notice/);ctx.kitchenFilter='Pemberitahuan Takeaway';ctx.state.orders=[home];
 assert.match(html,/Pemberitahuan Takeaway/);assert.match(html,/Menunggu diterima kasir/);assert.match(html,/Pelanggan Contoh/);assert.match(html,/18:30/);
 assert.doesNotMatch(html,/Must not appear|kitchen-prep-item|advanceOrder|Terima Pesanan|Batalkan|kitchen-takeaway-notice-copy|perlu diproses oleh kasir/);
 assert.equal(JSON.stringify(home),before);
 home.confirmedAt='accepted';assert.doesNotMatch(ctx.renderKitchen(),/aria-label="Pemberitahuan takeaway menunggu kasir"/);
});
test('navigation badges count new eligible orders and kitchen notices without counting hidden, cancelled or processed orders',()=>{
 const ctx=setup();ctx.kitchenOrderIsVisible=order=>order.status==='Pesanan Baru'&&(!order.customerOrderType||order.confirmedAt||order.customerOrderType==='DELIVERY');
 const home=pickup(),outlet=pickup({id:'outlet',serviceInfo:'Takeaway Outlet'}),delivery=pickup({id:'delivery',customerOrderType:'DELIVERY',paymentProvider:'courier_cash',driverId:'driver',confirmedAt:'processed'});
 ctx.state.orders=[home,outlet,delivery,pickup({id:'cancelled',status:'Dibatalkan'}),pickup({id:'prepaid',paymentProvider:'duitku',paymentStatus:'Belum dibayar'}),pickup({id:'processing',status:'Sedang Disiapkan'}),{...delivery,id:'search',driverId:null,customerOrderStatus:'SEARCHING_DRIVER'}];
 assert.equal(ctx.orderNavigationBadgeCount('orders'),3);assert.equal(ctx.orderNavigationBadgeCount('kitchen'),3);assert.equal(ctx.orderNavigationBadgeCount('reports'),0);
 assert.match(ctx.renderOrderNavigationBadge('orders'),/>3<\/span>/);assert.equal(ctx.renderOrderNavigationBadge('reports'),'');
 home.status='Sedang Disiapkan';assert.equal(ctx.orderNavigationBadgeCount('orders'),2);assert.equal(ctx.orderNavigationBadgeCount('kitchen'),2);
 const badge={dataset:{orderNavCount:'orders'},setAttribute(name,value){this[name]=value;}};ctx.document={querySelectorAll:()=>[badge]};ctx.updateOrderNavigationBadges();assert.equal(badge.textContent,'2');assert.equal(badge.hidden,false);
 ctx.state.orders=[];ctx.updateOrderNavigationBadges();assert.equal(badge.hidden,true);assert.equal(badge.textContent,'0');
});

test('courier cash stays outside POS until the assigned driver processes it',()=>{
 const ctx=setup(),order=pickup({customerOrderType:'DELIVERY',paymentProvider:'courier_cash',driverId:'driver',customerOrderStatus:'DRIVER_ASSIGNED'});
 assert.equal(ctx.orderVisibleInPosOrderList(order),false);
 assert.equal(ctx.orderVisibleInPosOrderList({...order,confirmedAt:'processed'}),true);
 assert.equal(ctx.orderVisibleInPosOrderList({...order,status:'Sedang Disiapkan'}),true);
 assert.equal(ctx.orderVisibleInPosOrderList({...order,status:'Dibatalkan',cancelledAt:'cancelled'}),true);
});
test('delivery success detail places product and courier amounts below customer without changing the total',()=>{
 const source=read('SO Takeaway/so-takeaway.js');const start=source.indexOf('  function soTakeawayDetailHtml('),end=source.indexOf('\n  function ',start+5);
 const ctx=vm.createContext({soTakeawayEscape:value=>String(value),soTakeawayMoney:value=>'Rp'+value,soTakeawayIsPaid:()=>false});vm.runInContext(source.slice(start,end),ctx);
 const order={type:'Delivery',subtotal:7000,deliveryFee:10000};const html=ctx.soTakeawayDetailHtml({number:'D002',customer:'Pelanggan',total:17000,order});
 assert.match(html,/Nominal pesanan<\/b><strong[^>]*>Rp7000/);assert.match(html,/Nominal ongkir<\/b><strong[^>]*>Rp10000/);assert.match(html,/Total pembayaran<\/b><strong>Rp17000/);
 assert.ok(html.indexOf('Nama pemesan')<html.indexOf('Nominal pesanan'));assert.equal(order.subtotal,7000);
 assert.doesNotMatch(ctx.soTakeawayDetailHtml({number:'P001',customer:'Pelanggan',total:7000,order:{type:'Take Away'}}),/Nominal ongkir/);
});
