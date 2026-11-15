const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('delivery/app.js', 'utf8');
function setting(name) {
  const match = new RegExp(`const ${name} = ["']([^"']+)["']`).exec(source);
  if (!match) throw Error(`Missing ${name}`);
  return match[1];
}
(async () => {
  const url = new URL('/rest/v1/store_settings', setting('SUPABASE_URL'));
  url.searchParams.set('id', 'eq.54a5801f-b78f-44a5-aca8-846d33fa292e');
  url.searchParams.set('select', 'store_name,app_name:self_order_settings->>appName,outlet_name:self_order_settings->>outletName,profile_image:self_order_settings->>profileImage,receipt_logo:self_order_settings->receipt->>logoDataUrl');
  const key = setting('SUPABASE_ANON_KEY');
  const response = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  const data = await response.json();
  if (!response.ok) { console.log({ status: response.status, code: data.code, message: data.message }); return; }
  fs.mkdirSync('tests/artifacts/branding', { recursive: true });
  fs.writeFileSync('tests/artifacts/branding/public-branding.json', JSON.stringify(data));
  console.log({ status: response.status, rows: data.length, branding: data.map(row => ({
    store_name: row.store_name, app_name: row.app_name, outlet_name: row.outlet_name,
    profile: (row.profile_image || '').startsWith('data:') ? `embedded ${row.profile_image.length} characters` : row.profile_image,
    receipt: (row.receipt_logo || '').startsWith('data:') ? `embedded ${row.receipt_logo.length} characters` : row.receipt_logo
  })) });
  const start=source.indexOf('async function selectPublicSelfOrderSettingsRow(');
  const end=source.indexOf('\nasync function loadStoreSettingsFromSupabase(',start);
  const ctx=vm.createContext({STORE_SETTINGS_ROW_ID:'54a5801f-b78f-44a5-aca8-846d33fa292e',
    supabaseRestSelect:async(table,select,params)=>{
      const url=new URL(`/rest/v1/${table}`,setting('SUPABASE_URL'));
      url.searchParams.set('select',select);
      for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
      const r=await fetch(url,{headers:{apikey:key,Authorization:`Bearer ${key}`}});
      if(!r.ok)throw Error(`Public settings REST ${r.status}`);
      return r.json();
    }});
  vm.runInContext(source.slice(start,end),ctx);
  const publicSettings=await ctx.selectPublicSelfOrderSettingsRow();
  console.log({realPublicSettingsFallback:!!publicSettings,selfOrderName:publicSettings?.self_order_settings?.appName,
    promoSlides:publicSettings?.self_order_settings?.promoSlides?.length||0});
})().catch(error => { console.error(error.message); process.exitCode = 1; });
