const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function read(file) {
  const published = { 'app.js': 'deploy-ready/pos/app.js',
    'SO Takeaway/so-takeaway.js': 'deploy-ready/self-order/SO Takeaway/so-takeaway.js' };
  return fs.readFileSync(fs.existsSync(file) ? file : published[file], 'utf8');
}
function extract(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const next = /\n(?:async )?function \w+\(/.exec(source.slice(start + 10));
  return source.slice(start, next ? start + 10 + next.index : source.length);
}
test('new order URLs and existing printed QR formats keep the selected table', () => {
  for (const file of ['app.js', 'deploy-ready/self-order/app.js']) {
    const source = read(file);
    const code = ['normalizeSelfOrderTableCode', 'selfOrderTableCodeFromUrl'].map(name => extract(source, name)).join('\n');
    for (const [url, expected] of [['/order/?1', 'A-1'], ['/order/?table=D-3', 'D-3'],
      ['/order/12', 'A-12'], ['/self-order/12', 'A-12'], ['/order/?mode=takeaway', '']]) {
      const location = new URL(url, 'https://www.fresin.id');
      assert.equal(vm.runInNewContext(`${code}\nselfOrderTableCodeFromUrl()`, { location, URLSearchParams, console }), expected, `${file}: ${url}`);
    }
  }
});
test('order entry uses the existing assets and legacy page redirects do not catch assets', () => {
  const entry = fs.readFileSync('deploy-ready/order/index.html', 'utf8');
  assert.match(entry, /<base href="\/self-order\/"/);
  assert.match(entry, /KASIRIN_APP_MODE = "self-order"/);
  const config = JSON.parse(fs.readFileSync('deploy-ready/vercel.json', 'utf8'));
  assert.ok(config.redirects.some(rule => rule.source === '/self-order/' && rule.destination === '/order/'));
  assert.ok(!config.redirects.some(rule => rule.source === '/self-order/:path*'));
  assert.ok(config.redirects.some(rule => rule.source.startsWith('/order/:table') && rule.destination === '/order/?table=:table'));
});

test('bare order entry opens the two-choice takeaway gateway, while printed table QR stays dine-in', () => {
  const core = read('app.js');
  const takeaway = read('SO Takeaway/so-takeaway.js');
  const modeCode = takeaway.slice(takeaway.indexOf('  function soTakeawayUrlParams()'),
    takeaway.indexOf('  function soTakeawayEscape('));
  const tableCode = ['normalizeSelfOrderTableCode', 'selfOrderTableCodeFromUrl'].map(name => extract(core, name)).join('\n');
  for (const [url, expected] of [['/order', true], ['/order/', true], ['/order/?origin=outlet', true],
    ['/order/?table=D-3', false], ['/order/?1', false], ['/order/12', false],
    ['/self-order.html', false], ['/order/?mode=dinein', false], ['/order/?mode=delivery', false],
    ['/order/?mode=takeaway', true]]) {
    const location = new URL(url, 'https://www.fresin.id');
    assert.equal(vm.runInNewContext(`${tableCode}\n${modeCode}\nsoTakeawayIsMode()`,
      { location, URLSearchParams, console }), expected, url);
  }
});
