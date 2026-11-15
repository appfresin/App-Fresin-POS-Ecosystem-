import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {CONFIRMATION_CATEGORY,orderNeedsCashierConfirmation,tokenMatchesOrderCategories} from '../supabase/functions/notify-new-order/cashier-confirmation.mjs';
const core=fs.readFileSync(fs.existsSync('app.js')?'app.js':'deploy-ready/pos/app.js','utf8');
function fn(source,name){const m=new RegExp(`(?:async )?function ${name}\\(`).exec(source);assert.ok(m,name);const tail=source.slice(m.index+m[0].length),n=/\n(?:async )?function \w+\(/.exec(tail);return source.slice(m.index,n?m.index+m[0].length+n.index:source.length);}
const pickup={id:'one',source:'Self Order',type:'Take Away',customerOrderType:'PICKUP_PREORDER',
  paymentProvider:'cash_at_outlet',status:'Pesanan Baru',customerOrderStatus:'WAITING_ACCEPTANCE',items:[{category:'Coffee'}]};
test('confirmation classification matches web and server, excluding unprocessed driver offers and production orders',()=>{
 const c=vm.createContext({});vm.runInContext(fn(core,'orderNeedsCashierConfirmation'),c);
 const cases=[[pickup,true],[{...pickup,customerOrderType:'TAKEAWAY',paymentProvider:''},true],
   [{...pickup,confirmedAt:'accepted'},false],[{...pickup,cancelledAt:'cancelled'},false],
   [{...pickup,status:'Sedang Disiapkan'},false],[{...pickup,paymentProvider:'duitku',paymentStatus:'Belum dibayar'},false],
   [{...pickup,type:'Delivery',customerOrderType:'DELIVERY',paymentProvider:'courier_cash',driverId:'driver',customerOrderStatus:'DRIVER_ASSIGNED'},false],
   [{...pickup,type:'Delivery',customerOrderType:'DELIVERY',driverId:'driver',customerOrderStatus:'WAITING_CASHIER'},true],
   [{status:'Pesanan Baru',type:'Take Away',source:'Kasir'},false]];
 for(const [order,want] of cases){assert.equal(orderNeedsCashierConfirmation(order),want);assert.equal(c.orderNeedsCashierConfirmation(order),want);}
});
test('kitchen confirmation is opt-in and independent of the product categories',()=>{
 let selected=[];
 const c=vm.createContext({deviceKitchenNotificationCategories:()=>selected,
   orderKitchenNotificationCategories:order=>order.items.map(item=>item.category)});
 vm.runInContext(fn(core,'orderNeedsCashierConfirmation')+'\n'+fn(core,'orderMatchesKitchenNotificationCategories'),c);
 assert.equal(c.orderMatchesKitchenNotificationCategories(pickup),false);
 selected=['Coffee'];assert.equal(c.orderMatchesKitchenNotificationCategories(pickup),false);
 selected=[CONFIRMATION_CATEGORY];assert.equal(c.orderMatchesKitchenNotificationCategories(pickup),true);
 assert.equal(c.orderMatchesKitchenNotificationCategories({...pickup,confirmedAt:'accepted'}),false);
 selected=[CONFIRMATION_CATEGORY,'Coffee'];assert.equal(c.orderMatchesKitchenNotificationCategories({...pickup,confirmedAt:'accepted'}),true);
 selected=[];assert.equal(c.orderMatchesKitchenNotificationCategories({...pickup,confirmedAt:'accepted'}),true);
});
test('native kitchen tokens receive confirmation only when checked; cashier alerts still work',()=>{
 for(const kitchen_categories of [[],['Coffee']])assert.equal(tokenMatchesOrderCategories({target:'dapur',kitchen_categories},[CONFIRMATION_CATEGORY]),false);
 assert.equal(tokenMatchesOrderCategories({target:'dapur',kitchen_categories:[CONFIRMATION_CATEGORY]},[CONFIRMATION_CATEGORY]),true);
 assert.equal(tokenMatchesOrderCategories({target:'kasir',kitchen_categories:[]},[CONFIRMATION_CATEGORY]),true);
 assert.equal(tokenMatchesOrderCategories({target:'dapur',kitchen_categories:[CONFIRMATION_CATEGORY]},['Coffee']),false);
 assert.equal(tokenMatchesOrderCategories({target:'dapur',kitchen_categories:['Coffee']},['Coffee']),true);
});
test('cashier acceptance changes dedupe phase so the kitchen production alert is not swallowed',()=>{
 const c=vm.createContext({orderVisibleInPosOrderList:()=>true,orderNotificationItemRevision:()=>1,orderItemBatch:()=>1});
 vm.runInContext(['orderNeedsCashierConfirmation','orderNotificationKey','orderNotificationDeliveryKey'].map(name=>fn(core,name)).join('\n'),c);
 assert.notEqual(c.orderNotificationKey(pickup),c.orderNotificationKey({...pickup,confirmedAt:'accepted'}));
 assert.notEqual(c.orderNotificationDeliveryKey(pickup),c.orderNotificationDeliveryKey({...pickup,confirmedAt:'accepted'}));
});
test('server derives confirmation from the current order instead of trusting supplied categories',async()=>{
 const source=fs.readFileSync('supabase/functions/notify-new-order/index.ts','utf8');
 const code=stripTypeScriptTypes(fn(source,'resolveOrderCategories'),{mode:'transform'});
 const row={source:'Self Order',type:'Take Away',customer_order_type:'PICKUP_PREORDER',payment_provider:'cash_at_outlet',status:'Pesanan Baru'};
 const ctx=vm.createContext({CONFIRMATION_CATEGORY,orderNeedsCashierConfirmation,
   normalizeCategoryList:value=>Array.isArray(value)?value:[],console,
   ORDER_CATEGORY_LOOKUP_ATTEMPTS:1,ORDER_CATEGORY_LOOKUP_DELAY_MS:0});
 vm.runInContext(code,ctx);
 const admin={from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:row,error:null})})};
 assert.deepEqual(Array.from(await ctx.resolveOrderCategories(admin,{orderId:'one',orderCategories:['Coffee']})),[CONFIRMATION_CATEGORY]);
 row.confirmed_at='accepted';
 assert.deepEqual(Array.from(await ctx.resolveOrderCategories(admin,{orderId:'one',orderCategories:['Coffee']})),['Coffee']);
});
