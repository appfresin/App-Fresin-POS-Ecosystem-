import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Read-only verification. Uses only the public application config and GET requests.
const number=process.argv[2]||'D001';
const config=fs.readFileSync(new URL('../driver/app.js',import.meta.url),'utf8');
const base=config.match(/SUPABASE_URL\s*=\s*"([^"]+)"/)?.[1];
const key=config.match(/SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/)?.[1];
assert.ok(base&&key,'Public application config missing');
async function read(table,params){
 const url=new URL(`${base}/rest/v1/${table}`);url.search=new URLSearchParams(params);
 const response=await fetch(url,{headers:{apikey:key,Authorization:`Bearer ${key}`}});
 assert.ok(response.ok,`${table} read failed: ${response.status}`);
 return response.json();
}
const [orders,reportRows]=await Promise.all([
 read('orders',{select:'id,order_number,payment_provider,delivery_fee,grand_total,subtotal,discount,payment_status',order_number:`eq.${number}`,limit:'5'}),
 read('report_sales_records',{select:'id,number,created_at,paid_at,order_type,imported,total,subtotal,discount,profit,payment_status,order_status',number:`eq.${number}`,limit:'5'})
]);
assert.equal(orders.length,1,'Expected exactly one stored order');
assert.equal(orders[0].payment_provider,'courier_cash');
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
function extract(name){const start=source.search(new RegExp(`(?:async )?function ${name}\\(`));assert.ok(start>=0,name);const next=/\n(?:async )?function \w+\(/.exec(source.slice(start+10));return source.slice(start,next?start+10+next.index:source.length);}
const client={from:table=>({select:columns=>({in:async(column,ids)=>({data:await read(table,{select:columns,[column]:`in.(${ids.join(',')})`}),error:null})})})};
const ctx=vm.createContext({normalizePaymentBreakdown:value=>value||{},supabaseClient:client});
vm.runInContext(['normalizeSupabaseReportRecord','hydrateReportOutletRevenue'].map(extract).join('\n'),ctx);
const corrected=await ctx.hydrateReportOutletRevenue(reportRows);
const expected=Math.max(0,Number(orders[0].grand_total)-Number(orders[0].delivery_fee));
assert.equal(corrected.length,1);assert.equal(corrected[0].total,expected);
console.log(JSON.stringify({number,storedOrders:orders.length,reportViewRows:reportRows.length,rawReportRevenue:reportRows[0].total,customerTotal:orders[0].grand_total,driverDeliveryFee:orders[0].delivery_fee,correctedOutletRevenue:corrected[0].total}));
