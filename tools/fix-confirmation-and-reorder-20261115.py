from pathlib import Path
def edit(file,old,new):
    p=Path(file);s=p.read_text(encoding='utf-8');assert s.count(old)==1,(file,s.count(old),old[:65]);p.write_text(s.replace(old,new),encoding='utf-8',newline='\n')

restart='''  function restart() {
    if (!enabled() || selfOrderSubmitting) return;
    for (const key of [HANDOFF_KEY, DRAFTS_KEY, DRAFT_CONTEXT_KEY, "customer_home_checkout",
      "customer_home_last_token", "self_order_checkout_note", "self_order_payment", "self_order_product_id"]) {
      sessionStorage.removeItem(key);
    }
    selfOrderCart = [];
    saveSelfOrderCart();
    const url = new URL(homeMode() ? "/pesan/" : "/order/", location.href);
    if (new URL(location.href).searchParams.get("origin") === "outlet") url.searchParams.set("origin", "outlet");
    sessionStorage.setItem("self_order_step", "gateway");
    history.pushState({ ...(history.state || {}), selfOrderStep: "gateway", fresinService: null }, "", url.href);
    render();
    window.scrollTo?.({ top: 0, behavior: "smooth" });
  }

'''
for file in ['Customer Gateway/customer-gateway.js','deploy-ready/Customer Gateway/customer-gateway.js']:
    edit(file,'  function showOrders() {',restart+'  function showOrders() {')
    edit(file,'window.FresinGateway = { choose, open, showOrders,','window.FresinGateway = { choose, open, restart, showOrders,')
for file in ['delivery/Customer Order/customer-order.js','deploy-ready/delivery/Customer Order/customer-order.js']:
    edit(file,'''    sessionStorage.removeItem(HOME_CHECKOUT_KEY);
    sessionStorage.setItem("self_order_step", "menu");''','''    sessionStorage.removeItem(HOME_CHECKOUT_KEY);
    if (window.FresinGateway?.restart) return window.FresinGateway.restart();
    sessionStorage.setItem("self_order_step", "menu");''')
for file in ['SO Takeaway/so-takeaway.js','delivery/SO Takeaway/so-takeaway.js','deploy-ready/pos/SO Takeaway/so-takeaway.js','deploy-ready/self-order/SO Takeaway/so-takeaway.js','deploy-ready/delivery/SO Takeaway/so-takeaway.js']:
    edit(file,'''    sessionStorage.removeItem("self_order_payment");
    sessionStorage.setItem("self_order_step", "menu");''','''    sessionStorage.removeItem("self_order_payment");
    if (window.FresinGateway?.restart) return window.FresinGateway.restart();
    sessionStorage.setItem("self_order_step", "menu");''')
