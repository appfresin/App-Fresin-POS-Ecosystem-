from pathlib import Path

def replace(file, old, new):
    path = Path(file)
    content = path.read_text(encoding='utf-8')
    assert content.count(old) == 1, (file, content.count(old), old[:100])
    path.write_text(content.replace(old, new), encoding='utf-8', newline='\n')

for file in ['driver/Driver Order/driver-order.js', 'deploy-ready/driver/Driver Order/driver-order.js']:
    replace(file, 'if (action === "complete") state.view = "earnings";', '''if (action === "complete") {
        state.view = "active";
        state.selectedId = "";
      }''')

for file in ['pages/reports.js', 'deploy-ready/pos/pages/reports.js']:
    replace(file, '>Hapus struk</button>', '>Hapus Transaksi</button>')

for file in ['SO Takeaway/so-takeaway.js', 'delivery/SO Takeaway/so-takeaway.js',
             'deploy-ready/pos/SO Takeaway/so-takeaway.js', 'deploy-ready/self-order/SO Takeaway/so-takeaway.js',
             'deploy-ready/delivery/SO Takeaway/so-takeaway.js']:
    replace(file, 'return values.includes("takeaway") || path.includes("takeaway");', '''const defaultOrderEntry = /^\\/order\\/?$/.test(path)
      && !values.some(Boolean)
      && !selfOrderTableCodeFromUrl();
    return values.includes("takeaway") || path.includes("takeaway") || defaultOrderEntry;''')

for file in ['delivery/Customer Order/customer-order.js', 'deploy-ready/delivery/Customer Order/customer-order.js']:
    path = Path(file)
    content = path.read_text(encoding='utf-8')
    start = content.index('  function homeGenerateNumber(prefix) {')
    end = content.index('\n  function homeCoordinate', start)
    content = content[:start] + '''  async function homeGenerateNumber(prefix) {
    if (!["D", "P"].includes(prefix)) throw new Error("Jenis nomor pesanan tidak valid.");
    const { data, error } = await supabaseClient.rpc("allocate_customer_order_number", { p_prefix: prefix });
    if (error || typeof data !== "string" || !new RegExp(`^${prefix}\\\\d{3,18}$`).test(data)) {
      console.warn("Customer order number allocation failed", error || "Invalid number response");
      const failure = new Error("Gagal menyiapkan nomor pesanan.");
      failure.userMessage = "Belum bisa menyiapkan nomor pesanan. Periksa koneksi lalu coba lagi.";
      throw failure;
    }
    return data;
  }
''' + content[end:]
    content = content.replace('const number = homeGenerateNumber(prefix);', 'const number = await homeGenerateNumber(prefix);')
    path.write_text(content, encoding='utf-8', newline='\n')

for file in ['app.js', 'delivery/app.js', 'deploy-ready/pos/app.js', 'deploy-ready/self-order/app.js', 'deploy-ready/delivery/app.js']:
    replace(file, 'await upsertSupabaseOrderPayload(orderPayload);', 'await upsertSupabaseOrderPayload(orderPayload, order);')
    replace(file, '''async function upsertSupabaseOrderPayload(orderPayload) {
  const { data: current, error: readError } = await supabaseClient.from("orders")
    .select("id,payment_status,updated_at").eq("order_number", orderPayload.order_number).maybeSingle();
  if (readError) return { data: null, error: readError };''', '''async function upsertSupabaseOrderPayload(orderPayload, order = {}) {
  const { data: current, error: readError } = await supabaseClient.from("orders")
    .select("id,payment_status,updated_at,public_order_token").eq("order_number", orderPayload.order_number).maybeSingle();
  if (readError) return { data: null, error: readError };
  // A number alone must never identify a different customer's new order.
  if (current && ((order.supabaseId && current.id !== order.supabaseId)
    || (!order.supabaseId && order.publicOrderToken && current.public_order_token !== order.publicOrderToken))) {
    return { data: null, error: { code: "ORDER_NUMBER_CONFLICT", message: "Nomor pesanan sudah digunakan. Silakan coba lagi." } };
  }''')
