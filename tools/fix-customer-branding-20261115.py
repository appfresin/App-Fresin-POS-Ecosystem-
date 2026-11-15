from pathlib import Path
import shutil

cores = ['app.js','delivery/app.js','deploy-ready/pos/app.js','deploy-ready/self-order/app.js','deploy-ready/delivery/app.js']
def change(content, old, new, file):
    assert content.count(old) == 1, (file, old[:70], content.count(old))
    return content.replace(old,new)

helper = '''function selfOrderBranding() {
  const settings = state.settings || {};
  const configuredName = String(settings.selfOrderAppName || settings.receiptStoreName || "").trim();
  const fallbackImage = "/Customer%20Gateway/assets/fresin-logo.png";
  const configuredImage = String(settings.selfOrderProfileImageDataUrl || settings.receiptLogoDataUrl || "").trim();
  // Serve the current Fresin mark locally instead of depending on Google Drive.
  const bundledImage = !configuredImage || mediaDriveId(configuredImage) === "1HrP-iW9Gc_N3FAjAKNxlpcwm34a6f2AB";
  return {
    name: configuredName && !/^kasirin(?:!| cafe)?$/i.test(configuredName) ? configuredName : "Fresin Indonesia",
    outlet: String(settings.selfOrderOutletName || state.outlet || "Outlet Utama").trim(),
    image: bundledImage ? fallbackImage : configuredImage,
    fallbackImage
  };
}

'''
public_settings = '''async function selectPublicSelfOrderSettingsRow() {
  const fields = [
    "id", "store_name", "store_address", "store_phone", "receipt_store_name", "receipt_footer",
    "receipt_width", "receipt_show_table", "receipt_show_qr", "updated_at",
    "app_name:self_order_settings->>appName", "outlet_name:self_order_settings->>outletName",
    "profile_image:self_order_settings->>profileImage", "promo_image:self_order_settings->>promoImage",
    "promo_target:self_order_settings->>promoTargetProductId", "promo_label:self_order_settings->>promoButtonLabel",
    "promo_slides:self_order_settings->promoSlides", "upsell_ids:self_order_settings->upsellProductIds",
    "receipt_logo:self_order_settings->receipt->>logoDataUrl"
  ];
  const rows = await supabaseRestSelect("store_settings", fields.join(","), { id: `eq.${STORE_SETTINGS_ROW_ID}`, limit: "1" });
  const row = rows?.[0];
  if (!row) return null;
  return { ...row, self_order_settings: {
    appName: row.app_name, outletName: row.outlet_name, profileImage: row.profile_image,
    promoImage: row.promo_image, promoTargetProductId: row.promo_target,
    promoButtonLabel: row.promo_label, promoSlides: row.promo_slides,
    upsellProductIds: row.upsell_ids, receipt: { logoDataUrl: row.receipt_logo }
  } };
}

'''
for file in cores:
    p=Path(file); s=p.read_text(encoding='utf-8')
    s=change(s, 'function renderSelfOrderTopbar() {', helper+'function renderSelfOrderTopbar() {',file)
    s=change(s, '''  const appName = state.settings.selfOrderAppName || state.settings.receiptStoreName || "Kasirin Cafe";
  const outletName = state.settings.selfOrderOutletName || state.outlet || "Outlet Utama";
  const profileImage = String(state.settings.selfOrderProfileImageDataUrl || state.settings.receiptLogoDataUrl || "").trim();''', '''  const branding = selfOrderBranding();
  const appName = branding.name;
  const outletName = branding.outlet;
  const profileImage = branding.image;''',file)
    s=change(s, 'mediaImageTag(profileImage, "Foto profil self order", "", 240)', 'mediaImageTag(profileImage, "Foto profil self order", "", 240, "eager", branding.fallbackImage)',file)
    s=change(s, '''  if (kind === "orders") return step === "success";
  return step === "menu" || step === "success";''', '''  if (kind === "orders") return step === "success";
  if (kind === "settings" && step === "gateway") return true;
  return step === "menu" || step === "success";''',file)
    s=change(s, 'async function loadStoreSettingsFromSupabase(options = {}) {', public_settings+'async function loadStoreSettingsFromSupabase(options = {}) {',file)
    s=change(s, '  if (!supabaseReadable() || storeSettingsLoading || !localDbReady) return;', '  if ((!supabaseReadable() && !(IS_SELF_ORDER_APP && supabaseRestReadable())) || storeSettingsLoading || !localDbReady) return;',file)
    start=s.index('async function loadStoreSettingsFromSupabase(options = {}) {')
    s=s[:start]+s[start:].replace('    const row = await selectStoreSettingsRow();',
        '    const row = supabaseReadable() ? await selectStoreSettingsRow() : await selectPublicSelfOrderSettingsRow();',1)
    p.write_text(s,encoding='utf-8',newline='\n')

for file in ['delivery/Customer Order/customer-order.js','deploy-ready/delivery/Customer Order/customer-order.js']:
    p=Path(file);s=p.read_text(encoding='utf-8')
    s=change(s, '''    const appName = state.settings.selfOrderAppName || state.settings.receiptStoreName || "Kasirin Cafe";
    const outletName = state.settings.selfOrderOutletName || state.outlet || "Outlet Utama";
    const profileImage = String(state.settings.selfOrderProfileImageDataUrl || state.settings.receiptLogoDataUrl || "").trim();''', '''    const branding = selfOrderBranding();
    const appName = branding.name;
    const outletName = branding.outlet;
    const profileImage = branding.image;''',file)
    s=change(s, 'mediaImageTag(profileImage, "Foto profil self order", "", 240)', 'mediaImageTag(profileImage, "Foto profil self order", "", 240, "eager", branding.fallbackImage)',file)
    s=change(s, 'mediaImageTag(profileImage, "Logo usaha", "", 240)', 'mediaImageTag(profileImage, "Logo usaha", "", 240, "eager", branding.fallbackImage)',file)
    p.write_text(s,encoding='utf-8',newline='\n')

for file in ['Customer Gateway/customer-gateway.js','deploy-ready/Customer Gateway/customer-gateway.js']:
    p=Path(file);s=p.read_text(encoding='utf-8')
    s=change(s, '    const profileImage = String(state.settings?.selfOrderProfileImageDataUrl || state.settings?.receiptLogoDataUrl || "").trim();', '''    const branding = typeof selfOrderBranding === "function" ? selfOrderBranding() : null;
    const profileImage = branding?.image || String(state.settings?.selfOrderProfileImageDataUrl || state.settings?.receiptLogoDataUrl || "").trim();''',file)
    s=change(s, 'mediaImageTag(profileImage, "Logo Fresin", "fresin-gateway-brand-image", 240)', 'mediaImageTag(profileImage, "Logo Fresin", "fresin-gateway-brand-image", 240, "eager", branding?.fallbackImage || "")',file)
    p.write_text(s,encoding='utf-8',newline='\n')

Path('deploy-ready/Customer Gateway/assets').mkdir(parents=True,exist_ok=True)
shutil.copy2('Customer Gateway/assets/fresin-logo.png','deploy-ready/Customer Gateway/assets/fresin-logo.png')
