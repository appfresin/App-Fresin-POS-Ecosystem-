from pathlib import Path
def change(s,old,new,file):
    assert s.count(old)==1,(file,s.count(old),old[:65]);return s.replace(old,new)
module=Path('supabase/functions/notify-new-order/cashier-confirmation.mjs').read_text(encoding='utf-8')
helper=module[module.index('export function orderNeedsCashierConfirmation'):module.index('\nexport function tokenMatchesOrderCategories')].replace('export function','function',1)+'\n'
for file in ['app.js','delivery/app.js','deploy-ready/pos/app.js','deploy-ready/self-order/app.js','deploy-ready/delivery/app.js']:
    p=Path(file);s=p.read_text(encoding='utf-8')
    s=change(s,'function orderMatchesKitchenNotificationCategories(order = {}) {',helper+'\nfunction orderMatchesKitchenNotificationCategories(order = {}) {',file)
    s=change(s,'''  const selected = deviceKitchenNotificationCategories();
  if (!selected.length) return true;''','''  const selected = deviceKitchenNotificationCategories();
  if (orderNeedsCashierConfirmation(order)) return selected.some(category => category.toLowerCase() === "__confirmation__");
  if (!selected.length) return true;''',file)
    s=change(s,'return [base, String(order?.status || ""), orderNotificationItemRevision(order)].join("|");',
      'return [base, String(order?.status || ""), orderNotificationItemRevision(order), orderNeedsCashierConfirmation(order) ? "confirmation" : "production"].join("|");',file)
    s=change(s,'return [base, String(order?.status || ""), `batch:${maxBatch}`].join("|");',
      'return [base, String(order?.status || ""), `batch:${maxBatch}`, orderNeedsCashierConfirmation(order) ? "confirmation" : "production"].join("|");',file)
    p.write_text(s,encoding='utf-8',newline='\n')
for file in ['pages/settings.js','deploy-ready/pos/pages/settings.js']:
    p=Path(file);s=p.read_text(encoding='utf-8')
    s=change(s,'`${selectedKitchenCategories.length} kategori dipilih di perangkat ini` : "Kosongkan untuk bunyi semua kategori"',
        '`${selectedKitchenCategories.length} pilihan aktif di perangkat ini` : "Semua kategori produk; Konfirmasi dipilih terpisah"',file)
    s=change(s,'<div class="notification-category-grid">','''<div class="notification-category-grid">
            <label title="Bunyi untuk pesanan yang menunggu diterima kasir">
              <input type="checkbox" name="orderKitchenNotificationCategories" value="__confirmation__" ${selectedKitchenKeys.has("__confirmation__") ? "checked" : ""} />
              <span>Konfirmasi</span>
            </label>''',file)
    p.write_text(s,encoding='utf-8',newline='\n')
for file in ['SO Takeaway/so-takeaway.js','delivery/SO Takeaway/so-takeaway.js','deploy-ready/pos/SO Takeaway/so-takeaway.js','deploy-ready/self-order/SO Takeaway/so-takeaway.js','deploy-ready/delivery/SO Takeaway/so-takeaway.js']:
    p=Path(file);s=p.read_text(encoding='utf-8')
    s=change(s,'if (soTakeawayIsOrder(order) && !soTakeawayIsReleasedToKitchen(order)) return [];',
      '''if (soTakeawayIsOrder(order) && !soTakeawayIsReleasedToKitchen(order)
        && !(typeof orderNeedsCashierConfirmation === "function" && orderNeedsCashierConfirmation(order))) return [];''',file)
    s=change(s,'if (soTakeawayIsOrder(order) && !soTakeawayIsReleasedToKitchen(order)) return false;\n      return baseNotifyNativePushForOrder',
      '''if (soTakeawayIsOrder(order) && !soTakeawayIsReleasedToKitchen(order)
        && !(typeof orderNeedsCashierConfirmation === "function" && orderNeedsCashierConfirmation(order))) return false;
      return baseNotifyNativePushForOrder''',file)
    s=change(s,'.filter(order => view !== "kitchen" || !soTakeawayIsOrder(order) || soTakeawayIsReleasedToKitchen(order));',
      '''.filter(order => view !== "kitchen" || !soTakeawayIsOrder(order) || soTakeawayIsReleasedToKitchen(order)
            || (typeof orderNeedsCashierConfirmation === "function" && orderNeedsCashierConfirmation(order)));''',file)
    p.write_text(s,encoding='utf-8',newline='\n')
file='supabase/functions/notify-new-order/index.ts';p=Path(file);s=p.read_text(encoding='utf-8')
s=change(s,'import { notifyDriverOrder } from "./driver-push.mjs";',
  'import { notifyDriverOrder } from "./driver-push.mjs";\nimport { CONFIRMATION_CATEGORY, orderNeedsCashierConfirmation, tokenMatchesOrderCategories } from "./cashier-confirmation.mjs";',file)
s=change(s,'''  const targets = targetList(payload.target);
  const scopeKey = normalizeScopeKey(payload.scopeKey);
  const admin = createClient(supabaseUrl, serviceRoleKey);''','''  const scopeKey = normalizeScopeKey(payload.scopeKey);
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const orderCategories = await resolveOrderCategories(admin, payload);
  const confirmation = orderCategories.includes(CONFIRMATION_CATEGORY);
  const targets = targetList(confirmation ? "all" : payload.target);''',file)
s=change(s,'  const orderCategories = await resolveOrderCategories(admin, payload);\n  const dedupedTokens', '  const dedupedTokens',file)
start=s.index('function tokenMatchesOrderCategories(');end=s.index('async function resolveOrderCategories(',start)
s=s[:start]+s[end:]
s=change(s,'''  const direct = normalizeCategoryList(payload.orderCategories);
  if (direct.length) return direct;
  const orderId = String(payload.orderId || "").trim();''','''  const orderId = String(payload.orderId || "").trim();
  if (orderId) {
    const { data: order, error } = await admin.from("orders")
      .select("status,source,type,customer_order_type,customer_order_status,payment_provider,payment_status,driver_id,confirmed_at,cancelled_at,prepared_at,ready_at")
      .eq("id", orderId).maybeSingle();
    if (error) { console.error("order confirmation lookup failed", error); return []; }
    if (order && orderNeedsCashierConfirmation(order)) return [CONFIRMATION_CATEGORY];
  }
  const direct = normalizeCategoryList(payload.orderCategories).filter(category => category !== CONFIRMATION_CATEGORY);
  if (direct.length) return direct;''',file)
s=change(s,'const title = payload.title || (eventType === "additional_order" ? "Pesanan tambahan masuk" : "Pesanan baru masuk");',
  'const title = payload.title || (confirmation ? "Pesanan menunggu konfirmasi kasir" : eventType === "additional_order" ? "Pesanan tambahan masuk" : "Pesanan baru masuk");',file)
p.write_text(s,encoding='utf-8',newline='\n')
