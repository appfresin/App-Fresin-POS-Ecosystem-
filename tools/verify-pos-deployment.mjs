import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const local = process.argv.includes('--local');
const target = 'https://www.fresin.id/pos/';
const source = local
  ? fs.readFileSync(new URL('../deploy-ready/pos/app.js', import.meta.url), 'utf8')
  : await (await fetch(new URL(`app.js?verify=${Date.now()}`, target), { cache: 'no-store' })).text();
function extract(name, optional = false) {
  const start = source.indexOf(`function ${name}(`);
  if (optional && start < 0) return '';
  assert.ok(start >= 0, `${name} is missing`);
  const next = /\n(?:async )?function \w+\(/.exec(source.slice(start + 10));
  return source.slice(start, next ? start + 10 + next.index : source.length);
}
const helpers = ['orderIsPaid', 'orderIsCustomerHomeOrder', 'orderUsesOutletPayment', 'orderVisibleInPosOrderList']
  .map(name => extract(name, name === 'orderUsesOutletPayment')).join('\n');
const visible = vm.runInNewContext(`${helpers}\norderVisibleInPosOrderList`, {}, { timeout: 1000 });
const delivery = { source: 'Self Order', type: 'Delivery', number: 'D001', customerOrderType: 'DELIVERY',
  paymentProvider: 'courier_cash', paymentStatus: 'Belum dibayar', status: 'Pesanan Baru' };
assert.equal(visible({ ...delivery, customerOrderStatus: 'SEARCHING_DRIVER' }), false);
assert.equal(visible({ ...delivery, customerOrderStatus: 'DRIVER_ASSIGNED', driverId: 'fixture-driver' }), false,
  'POS must wait until the assigned driver processes the courier order');
assert.equal(visible({ ...delivery, customerOrderStatus: 'DRIVER_ASSIGNED', driverId: 'fixture-driver', confirmedAt: 'processed' }), true,
  'POS must show courier delivery after driver processing');
assert.match(source, /success-icon pos-success-asik/);
console.log(`PASS ${local ? 'deployment package' : target}: courier delivery waits for driver processing, then becomes visible before settlement; illustrated POS success is installed.`);
