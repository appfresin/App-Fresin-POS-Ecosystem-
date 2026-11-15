import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const CSV_DIR = path.join(ROOT, "Databse download 14 agustus");
const APP_JS = path.join(ROOT, "app.js");

const TABLES = [
  "store_settings",
  "categories",
  "addons",
  "products",
  "product_addons",
  "orders",
  "order_items",
  "order_item_addons",
  "payments",
  "stock_movements",
  "legacy_sales_imports",
  "limited_stock_commits",
  "legacy_sales"
];

const JSON_COLUMNS = new Set([
  "allowed_addon_ids",
  "sold_out_variants",
  "variant_options",
  "variant_data",
  "prepared_items",
  "payment_breakdown",
  "raw_data",
  "self_order_settings",
  "items"
]);

const ARRAY_COLUMNS = new Set(["notification_categories", "kitchen_categories"]);
const BOOLEAN_COLUMNS = new Set([
  "active",
  "sold_out",
  "track_stock",
  "channel_pos",
  "channel_self_order",
  "channel_delivery",
  "variant_required",
  "variant_required2",
  "print_receipt",
  "receipt_show_table",
  "receipt_show_qr",
  "auto_backup",
  "is_active",
  "ready",
  "stock_opname"
]);
const NUMERIC_COLUMNS = new Set([
  "price",
  "cost",
  "stock",
  "min_stock",
  "prep_minutes",
  "qty",
  "discount",
  "discount_rate",
  "service_fee",
  "delivery_fee",
  "tax_amount",
  "grand_total",
  "profit_total",
  "amount",
  "received_amount",
  "change_amount",
  "row_count",
  "sent_count",
  "failed_count",
  "balance_after",
  "subtotal",
  "total",
  "profit"
]);

const TABLE_CONFLICTS = {
  staff_profiles: "id",
  store_settings: "id",
  categories: "id",
  addons: "id",
  products: "id",
  product_addons: "product_id,addon_id",
  orders: "id",
  order_items: "id",
  order_item_addons: "id",
  payments: "id",
  stock_movements: "id",
  legacy_sales_imports: "id",
  legacy_sales: "id",
  limited_stock_commits: "cart_token",
  device_push_tokens: "id",
  push_notification_logs: "id"
};

const BATCH_SIZE = 500;

function parseSupabaseConfig() {
  return fs.readFile(APP_JS, "utf8").then(text => {
    const url = text.match(/SUPABASE_URL = "([^"]+)"/)?.[1];
    const key = text.match(/SUPABASE_ANON_KEY = "([^"]+)"/)?.[1];
    if (!url || !key) throw new Error("SUPABASE_URL/SUPABASE_ANON_KEY tidak ditemukan di app.js");
    return { url, key };
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parsePgArray(value) {
  const clean = String(value || "").trim();
  if (!clean || clean === "{}") return [];
  if (clean.startsWith("[") && clean.endsWith("]")) return JSON.parse(clean);
  const body = clean.startsWith("{") && clean.endsWith("}") ? clean.slice(1, -1) : clean;
  if (!body) return [];
  return body.split(",").map(item => item.replace(/^"|"$/g, "").replace(/\\"/g, '"'));
}

function normalizeValue(column, value) {
  if (value == null || value === "") return null;
  if (JSON_COLUMNS.has(column)) {
    const clean = String(value).trim();
    if (!clean) return null;
    try {
      return JSON.parse(clean);
    } catch {
      return clean;
    }
  }
  if (ARRAY_COLUMNS.has(column)) return parsePgArray(value);
  if (BOOLEAN_COLUMNS.has(column)) {
    const clean = String(value).trim().toLowerCase();
    if (["true", "t", "1", "yes"].includes(clean)) return true;
    if (["false", "f", "0", "no"].includes(clean)) return false;
    return null;
  }
  if (NUMERIC_COLUMNS.has(column)) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return value;
}

function normalizeRow(table, row) {
  if (table === "orders") {
    row.customer_name ||= "";
    if (!row.customer_name && String(row.source || "").toLowerCase() === "self order") {
      row.customer_name = "Customer";
    }
    row.service_info ||= "-";
    row.note ||= "";
    row.status ||= "Pesanan Baru";
    row.payment_status ||= "Belum dibayar";
    row.source ||= "Kasir";
    row.type ||= "Dine In";
    row.discount_mode ||= "amount";
    row.discount_rate ??= 0;
    row.prepared_items ||= {};
    row.sync_state ||= "synced";
    row.subtotal ??= 0;
    row.discount ??= 0;
    row.service_fee ??= 0;
    row.delivery_fee ??= 0;
    row.tax_amount ??= 0;
    row.grand_total ??= 0;
    row.profit_total ??= 0;
  }
  if (table === "order_items") {
    row.product_name ||= "None";
    row.sku ||= "";
    row.variant_data ||= {};
    row.note ||= "";
    row.discount_mode ||= "amount";
    row.discount_rate ??= 0;
    row.qty ??= 1;
    row.price ??= 0;
    row.cost ??= 0;
    row.discount ??= 0;
  }
  if (table === "order_item_addons") {
    row.addon_name ||= "None";
    row.qty ??= 1;
    row.price ??= 0;
    row.cost ??= 0;
  }
  if (table === "payments") {
    row.method ||= "Tunai";
    row.status ||= "Berhasil";
    row.note ||= "";
    row.payment_breakdown ||= {};
    row.amount ??= 0;
    row.received_amount ??= 0;
    row.change_amount ??= 0;
  }
  if (table === "stock_movements") {
    row.created_by = null;
    row.qty ??= 0;
    row.reason ||= "Migrasi stok";
    row.movement_type ||= "audit";
  }
  if (table === "legacy_sales") {
    row.customer_name ||= "-";
    row.cashier_name ||= "";
    row.order_type ||= "Import";
    row.payment_method ||= "Cash dan Piutang";
    row.payment_status ||= "Lunas";
    row.raw_data ||= {};
    row.subtotal ??= 0;
    row.discount ??= 0;
    row.total ??= 0;
    row.profit ??= 0;
  }
  if (table === "legacy_sales_imports") {
    row.file_name ||= "Import lama";
    row.row_count ??= 0;
    row.imported_by = null;
  }
  return row;
}

async function readCsvTable(table) {
  const file = path.join(CSV_DIR, `${table}_rows.csv`);
  try {
    const text = await fs.readFile(file, "utf8");
    const parsed = parseCsv(text);
    const headers = parsed.shift() || [];
    const rows = parsed
      .filter(row => row.some(value => String(value || "").trim()))
      .map(row => normalizeRow(table, Object.fromEntries(headers.map((header, index) => [header, normalizeValue(header, row[index] ?? "")]))));
    return rows;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function upsertBatch({ url, key }, table, rows, batchIndex) {
  const conflict = TABLE_CONFLICTS[table];
  const endpoint = new URL(`${url}/rest/v1/${table}`);
  if (conflict) endpoint.searchParams.set("on_conflict", conflict);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(rows)
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${table} batch ${batchIndex} HTTP ${response.status}: ${body.slice(0, 1000)}`);
  }
}

async function countTable({ url, key }, table) {
  const endpoint = `${url}/rest/v1/${table}?select=*&limit=1`;
  const response = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "count=exact"
    }
  });
  const range = response.headers.get("content-range") || "";
  return Number(range.split("/")[1] || 0);
}

async function main() {
  const config = await parseSupabaseConfig();
  for (const table of TABLES) {
    const rows = await readCsvTable(table);
    if (!rows) {
      console.log(`${table}: skipped, CSV tidak ada`);
      continue;
    }
    if (!rows.length) {
      console.log(`${table}: skipped, kosong`);
      continue;
    }
    for (let start = 0, batch = 1; start < rows.length; start += BATCH_SIZE, batch += 1) {
      const chunk = rows.slice(start, start + BATCH_SIZE);
      await upsertBatch(config, table, chunk, batch);
      console.log(`${table}: ${Math.min(start + chunk.length, rows.length)}/${rows.length}`);
    }
    const count = await countTable(config, table);
    console.log(`${table}: done, remote count=${count}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
