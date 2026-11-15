const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const source = fs.readFileSync(fs.existsSync('app.js') ? 'app.js' : 'deploy-ready/pos/app.js', 'utf8');
function fn(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const next = /\n(?:async )?function \w+\(/.exec(source.slice(start + 10));
  return source.slice(start, next ? start + 10 + next.index : source.length);
}
function setup() {
  const ctx = vm.createContext({
    Set, normalizeOrderBatches() {}, areAllKitchenItemsPrepared: () => false,
    orderIsCancelled: order => order.status === 'Dibatalkan' || Boolean(order.cancelledAt),
    orderServiceInfoDisplay: order => order.serviceInfo || order.type,
    customerDisplayName: value => value,
    kitchenOrderIsCarryover: () => true,
    groupedOrderItems: order => order.groups || [{ batch: 1, items: order.items }],
    orderCorrectionRecords: () => [], correctionBatch: value => value,
    isKitchenItemPrepared: () => false, canCancelOrder: () => true,
    orderSequenceBadge: value => `<span class="order-sequence-badge">${value}</span>`,
    escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    dateTime: () => '14 Nov 2026, 00.30', statusPill: value => `<span class="pill">${value}</span>`,
    orderCorrectionBadgeHtml: () => '', displayOrderNumber: value => '#' + value,
    orderGroupNote: (order, group) => group.note ?? order.note,
    kitchenOrderItemKey: (_, index) => 'item-' + index, kitchenItemIsLocked: () => false,
    orderItemInlineLabel: item => `${item.qty}x ${item.name}`,
    orderItemNoteHtml: item => item.note ? `<small>${item.note}</small>` : '',
    correctionRecordsForBatch: () => []
  });
  vm.runInContext(['kitchenOrderNoteDisplay', 'kitchenCard', 'nextKitchenAction'].map(fn).join('\n'), ctx);
  return ctx;
}
const base = () => ({ id: 'fixture', number: 'P002', type: 'Take Away', customerOrderType: 'PICKUP_PREORDER',
  serviceInfo: 'Takeaway-Rumah', customer: 'Pelanggan Contoh', status: 'Pesanan Baru', pickupTime: '17:57',
  note: 'Bungkus terpisah\nJam pengambilan: 17:57', items: [{ name: 'Air Mineral', qty: 1, note: 'Dingin' }] });

test('kitchen heading uses service then customer, with separate order reference and blue pickup note', () => {
  const ctx = setup();
  const html = ctx.kitchenCard(base(), 1);
  const head = html.split('<div class="kitchen-order-meta">')[0];
  assert.match(head, /kitchen-service-chip">Takeaway Online<\/span>\s*<strong>Pelanggan Contoh<\/strong>/);
  assert.doesNotMatch(head, /P002|TAKEAWAY ·/);
  assert.match(html, /<span class="pill">#P002<\/span>/);
  assert.match(html, /Transaksi Kemarin/);
  assert.match(html, /so-takeaway-pickup-note"><b>Jam pengambilan:<\/b> 17:57/);
  assert.equal(html.split('Bungkus terpisah').length - 1, 1);
  assert.equal(html.split('Jam pengambilan:').length - 1, 1);
  assert.equal(html.split('Pelanggan Contoh').length - 1, 1);
  for (const text of ['1x Air Mineral', 'Dingin', 'Terima Pesanan', 'Batalkan', 'advanceOrder', 'openCancelOrderDialog']) assert.ok(html.includes(text), text);
});

test('kitchen service chips distinguish POS takeaway, online takeaway, delivery and dine-in tables', () => {
  const ctx = setup();
  for (const [patch, label] of [
    [{ type: 'Delivery', customerOrderType: 'DELIVERY' }, 'Delivery'],
    [{ serviceInfo: 'Takeaway Outlet' }, 'Takeaway Online'],
    [{ serviceInfo: undefined, service_info: 'Takeaway Outlet' }, 'Takeaway Online'],
    [{ customerOrderType: '', serviceInfo: 'Takeaway Outlet', source: 'Kasir' }, 'Takeaway'],
    [{ customerOrderType: '', serviceInfo: 'Takeaway Outlet', source: 'Self Order' }, 'Takeaway Online'],
    [{ type: 'Dine In', customerOrderType: '', serviceInfo: 'D-3' }, 'D-3']
  ]) assert.ok(ctx.kitchenCard({ ...base(), ...patch }).includes(`kitchen-service-chip">${label}</span>`));
});

test('kitchen preserves distinct batch notes and item preparation controls', () => {
  const ctx = setup();
  const order = base();
  order.groups = [{ batch: 1, label: 'Awal', note: 'Tanpa es', items: order.items }, { batch: 2, label: 'Tambahan', note: 'Bungkus terpisah', items: [] }];
  order.status = 'Sedang Disiapkan';
  const html = ctx.kitchenCard(order);
  assert.equal(html.split('Tanpa es').length - 1, 1);
  assert.equal(html.split('Bungkus terpisah').length - 1, 1);
  assert.match(html, /toggleKitchenItemPrepared/); assert.match(html, /data-kitchen-finish-button/);
  assert.match(html, /0\/1 item siap/); assert.match(html, /disabled>Selesai/);
});

test('kitchen metadata is escaped and generated delivery instructions stay out of customer notes', () => {
  const ctx = setup();
  const order = { ...base(), customer: '<img>', note: 'Catatan pelanggan\nKurir membayar harga produk di outlet\nPin lokasi: https://maps.google.com/?q=1,2' };
  const html = ctx.kitchenCard(order);
  assert.match(html, /&lt;img&gt;/); assert.doesNotMatch(html, /<img>|maps.google|Kurir membayar/);
  assert.match(html, /Catatan pelanggan/);
});
