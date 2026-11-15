const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const files = ['app.js','delivery/app.js','deploy-ready/pos/app.js','deploy-ready/self-order/app.js','deploy-ready/delivery/app.js'];
function read(file) { return fs.readFileSync(fs.existsSync(file) ? file : 'deploy-ready/delivery/app.js','utf8'); }
function fn(name, file='delivery/app.js') {
  const source=read(file);
  const match=new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(match,name);
  const tail=source.slice(match.index+match[0].length);
  const end=/\n(?:async )?function \w+\(/.exec(tail);
  return source.slice(match.index,end?match.index+match[0].length+end.index:source.length);
}
test('a fresh customer browser has Fresin branding without stored settings or external requests',()=>{
  const ctx=vm.createContext({state:{settings:{receiptStoreName:'Kasirin!'}},mediaDriveId:()=>''});
  vm.runInContext(fn('selfOrderBranding'),ctx);
  const brand=ctx.selfOrderBranding();
  assert.equal(brand.name,'Fresin Indonesia');
  assert.equal(brand.outlet,'Outlet Utama');
  assert.equal(brand.image,'/Customer%20Gateway/assets/fresin-logo.png');
  assert.equal(fs.readFileSync('deploy-ready/Customer Gateway/assets/fresin-logo.png').readUInt32BE(0),0x89504e47);
});
test('the current Google Drive logo uses its bundled copy, and future custom branding is respected',()=>{
  const settings={selfOrderAppName:'Nama Baru',selfOrderOutletName:'Outlet Baru',selfOrderProfileImageDataUrl:'https://drive.google.com/uc?id=1HrP-iW9Gc_N3FAjAKNxlpcwm34a6f2AB'};
  const ctx=vm.createContext({state:{settings},mediaDriveId:value=>new URL(value).searchParams.get('id')||''});
  vm.runInContext(fn('selfOrderBranding'),ctx);
  assert.equal(ctx.selfOrderBranding().image,'/Customer%20Gateway/assets/fresin-logo.png');
  settings.selfOrderProfileImageDataUrl='https://images.example/new-logo.png';
  const brand=ctx.selfOrderBranding();
  assert.equal(brand.image,settings.selfOrderProfileImageDataUrl);
  assert.equal(brand.name,'Nama Baru');
  assert.equal(brand.outlet,'Outlet Baru');
  assert.equal(brand.fallbackImage,'/Customer%20Gateway/assets/fresin-logo.png');
});
test('settings arriving after the gateway paint request a safe rerender',()=>{
  let blocked=false,step='gateway';
  const ctx=vm.createContext({isBlockingInteractionActive:()=>blocked,view:'selforder',selfOrderStep:()=>step,deferredRealtimeRender:false});
  vm.runInContext(fn('shouldRenderAfterRealtimeLoad'),ctx);
  assert.equal(ctx.shouldRenderAfterRealtimeLoad('settings'),true);
  assert.equal(ctx.shouldRenderAfterRealtimeLoad('orders'),false);
  step='payment';
  assert.equal(ctx.shouldRenderAfterRealtimeLoad('settings'),false);
  step='gateway';blocked=true;
  assert.equal(ctx.shouldRenderAfterRealtimeLoad('settings'),false);
  assert.equal(ctx.deferredRealtimeRender,true);
});
test('a blocked Supabase SDK still loads customer settings by REST, with a 60-second cache',async()=>{
  let reads=0,renders=0;
  const ctx=vm.createContext({console,IS_SELF_ORDER_APP:true,state:{settings:{}},storeSettingsLoading:false,
    storeSettingsLoadedAt:0,localDbReady:true,supabaseReadable:()=>false,supabaseRestReadable:()=>true,
    selectPublicSelfOrderSettingsRow:async()=>{reads++;return {store_name:'Fresin Terbaru'};},
    normalizeStoreSettingsRow:row=>({selfOrderAppName:row.store_name}),
    mergeDeletedProductMarkers(){},mergeDeletedCategoryMarkers(){},mergeDeletedAddonMarkers(){},
    applyStaffSyncPayload(){},normalizeState(){},saveState(){},shouldRenderAfterRealtimeLoad:()=>true,render(){renders++;}});
  vm.runInContext(fn('loadStoreSettingsFromSupabase'),ctx);
  await ctx.loadStoreSettingsFromSupabase();
  await ctx.loadStoreSettingsFromSupabase();
  assert.equal(reads,1);
  assert.equal(ctx.state.settings.selfOrderAppName,'Fresin Terbaru');
  assert.equal(renders,1);
  assert.equal(ctx.storeSettingsLoading,false);
});
test('the customer REST fallback requests only customer-facing settings, not the staff JSON',async()=>{
  let projection;
  const ctx=vm.createContext({STORE_SETTINGS_ROW_ID:'canonical',supabaseRestSelect:async(table,fields,params)=>{
    assert.equal(table,'store_settings');assert.equal(params.id,'eq.canonical');assert.equal(params.limit,'1');
    projection=fields;return [{store_name:'Fresin',app_name:'Fresin Indonesia',profile_image:'logo',promo_slides:[{image:'banner'}]}];
  }});
  vm.runInContext(fn('selectPublicSelfOrderSettingsRow'),ctx);
  const row=await ctx.selectPublicSelfOrderSettingsRow();
  assert.equal(row.self_order_settings.appName,'Fresin Indonesia');
  assert.equal(row.self_order_settings.profileImage,'logo');
  assert.equal(row.self_order_settings.promoSlides[0].image,'banner');
  assert.ok(!projection.split(',').includes('self_order_settings'));
  assert.doesNotMatch(projection,/staff|pin|sync_endpoint|database_mode/);
});
test('a blocked SDK script is handled without an unhandled promise rejection',async()=>{
  const ctx=vm.createContext({window:{},SUPABASE_JS_CDN:'https://cdn.example/sdk.js',supabaseStatus:'',
    console:{warn(){}},loadExternalScriptOnce:async()=>{throw Error('BlockedByClient');}});
  vm.runInContext(fn('loadSupabaseLibraryAsync'),ctx);
  assert.equal(await ctx.loadSupabaseLibraryAsync(),null);
  assert.match(ctx.supabaseStatus,/gagal dimuat/);
});
test('all application packages share branding and late-settings behavior',()=>{
  for (const file of files.filter(file=>fs.existsSync(file))) {
    for (const name of ['selfOrderBranding','shouldRenderAfterRealtimeLoad','selectPublicSelfOrderSettingsRow'])
      assert.equal(fn(name,file),fn(name),`${file}: ${name}`);
    assert.match(fn('loadStoreSettingsFromSupabase',file), /IS_SELF_ORDER_APP && supabaseRestReadable\(\)/);
    assert.match(fn('loadStoreSettingsFromSupabase',file), /await selectPublicSelfOrderSettingsRow\(\)/);
  }
});
