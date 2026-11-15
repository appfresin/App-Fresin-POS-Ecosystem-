from pathlib import Path
source=Path('tools/test-customer-gateway-browser.mjs').read_text(encoding='utf-8')
prefix=source[:source.index('  const results = [];')]
prefix=prefix.replace("const fixture = pathToFileURL(path.join(root, 'tests/fixtures/customer-gateway.html')).href;", "const fixture = 'http://127.0.0.1:8001/tests/fixtures/customer-gateway.html';")
prefix=prefix.replace("const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fresin-gateway-qa-'));", "const qaDir=path.join(root,'tests/artifacts/confirmation-reorder');fs.mkdirSync(qaDir,{recursive:true});const profile=fs.mkdtempSync(path.join(qaDir,'profile-'));")
body=r'''
  function extract(source,name,indent=''){
    const m=new RegExp(`(?:async )?function ${name}\\(`).exec(source);assert.ok(m,name);
    const end=new RegExp(`\n${indent}(?:async )?function \\w+\\(`).exec(source.slice(m.index+m[0].length));
    return source.slice(m.index,end?m.index+m[0].length+end.index:source.length);
  }
  const home=extract(fs.readFileSync(path.join(root,'delivery/Customer Order/customer-order.js'),'utf8'),'homeStartNewOrder','  ');
  const takeaway=extract(fs.readFileSync(path.join(root,'SO Takeaway/so-takeaway.js'),'utf8'),'soTakeawayStartNewOrder','  ');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  for(const method of ['DELIVERY','PICKUP_PREORDER','TAKEAWAY']){
    await send('Page.navigate',{url:fixture});
    await waitFor(()=>evaluate("!!window.FresinGateway && !!document.querySelector('.fresin-gateway-choice')"),'Fixture not ready');
    await evaluate(`var HOME_CHECKOUT_KEY='customer_home_checkout'; var TAKEAWAY_ACTIVE_KEY='so_takeaway_active_order'; ${home}\n${takeaway}
      window.CustomerOrder.startNewOrder=homeStartNewOrder;
      if(${JSON.stringify(method)}==='TAKEAWAY'){
        window.CustomerOrder.isMode=()=>false;
        window.SOTakeaway={isMode:()=>true,newOrder:soTakeawayStartNewOrder};
      }
      sessionStorage.setItem('customer_home_checkout',JSON.stringify({method:${JSON.stringify(method)},note:'Previous note'}));
      sessionStorage.setItem('self_order_step','success');
      history.replaceState({selfOrderStep:'success',fresinService:'delivery'},'',location.href+'?mode=delivery');
      document.getElementById('app').innerHTML='<button id="qaReorder" onclick="${method==='TAKEAWAY'?'window.SOTakeaway.newOrder(event)':'CustomerOrder.startNewOrder()'}">Pesan Lagi</button>';
      document.getElementById('qaReorder').click();`);
    const result=await evaluate(`({step:selfOrderStep(),service:history.state.fresinService,path:location.pathname,
      search:location.search,choices:document.querySelectorAll('.fresin-gateway-choice').length,
      checkout:sessionStorage.getItem('customer_home_checkout'),cart:selfOrderCart.length})`);
    assert.equal(result.step,'gateway');assert.equal(result.service,null);assert.equal(result.choices,2);
    assert.equal(result.cart,0);assert.equal(result.checkout,null);assert.equal(result.search,'');
    assert.equal(result.path,method==='TAKEAWAY'?'/order/':'/pesan/');
    const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    fs.writeFileSync(path.join(qaDir,`reorder-${method}.png`),Buffer.from(screenshot.data,'base64'));
    console.log('Reorder returned to two choices:',method);
  }
  const settings=extract(fs.readFileSync(path.join(root,'pages/settings.js'),'utf8'),'renderNotificationSettingsTab');
  await evaluate(`function productCategories(){return ['Coffee','Donuts'];}
    function deviceKitchenNotificationCategories(){return ['Coffee','__confirmation__'];}
    function nativePushTokenRegistrationLooksRegistered(){return false;}
    function deviceOrderNotificationsEnabled(){return true;}
    function receiptSwitch(name,label,value){return '<label>'+label+'<input type="checkbox" '+(value?'checked':'')+'></label>';}
    ${settings}
    var qaStyle=document.createElement('link');qaStyle.rel='stylesheet';qaStyle.href='/styles/07-dashboard-overrides.css';document.head.append(qaStyle);
    document.documentElement.classList.remove('fresin-gateway-open');
    document.getElementById('app').innerHTML=renderNotificationSettingsTab();`);
  const settingState=await evaluate(`({checked:document.querySelector('input[value="__confirmation__"]').checked,
    product:document.querySelector('input[value="Coffee"]').checked,
    label:document.querySelector('input[value="__confirmation__"]').nextElementSibling.textContent})`);
  assert.deepEqual(settingState,{checked:true,product:true,label:'Konfirmasi'});
  await evaluate(`document.querySelector('input[value="__confirmation__"]').click()`);
  assert.equal(await evaluate(`document.querySelector('input[value="Coffee"]').checked`),true);
  await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}).then(image=>fs.writeFileSync(path.join(qaDir,'confirmation-settings.png'),Buffer.from(image.data,'base64')));
  const unexpected=exceptions.filter(message=>message!=='Uncaught ReferenceError: handleNotificationSettingsDraftChange is not defined');
  assert.deepEqual(unexpected,[]);
  console.log('Confirmation checkbox rendered independently of product selection.');
} finally {
  if(socket?.readyState===WebSocket.OPEN){try{await send('Browser.close');}catch{}socket.close();}
  if(browser.exitCode===null)browser.kill();
}
'''
body=body.replace(r'\\(',r'\(').replace(r'\\w',r'\w')
Path('tools/test-confirmation-reorder-browser.mjs').write_text(prefix+body,encoding='utf-8',newline='\n')
