const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
function read(file) {
  const local = path.join(root, file);
  const mapped = file === 'app.js' ? 'pos/app.js' : file;
  return fs.readFileSync(fs.existsSync(local) ? local : path.join(root, 'deploy-ready', mapped), 'utf8');
}
function fn(source, name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const next = /\n(?:async )?function \w+\(/.exec(source.slice(start + 10));
  return source.slice(start, next ? start + 10 + next.index : source.length);
}
function setup(config) {
  const messages = [];
  const context = vm.createContext({ window: {}, Intl, Date,
    state: { settings: { selfOrderOperatingHours: config } }, toast: message => messages.push(message) });
  vm.runInContext(read('Customer Gateway/online-hours.js'), context);
  return { api: context.window.FresinOnlineHours, context, messages };
}
const schedule = () => ({ enabled: true, days: Array.from({ length: 7 }, () => ({ enabled: true, open: '09:00', close: '22:00' })) });

test('operating hours are opt-in and use WIB regardless of device timezone', () => {
  const { api } = setup();
  assert.equal(api.status(null, new Date('2026-11-15T20:00:00Z')).open, true);
  const config = schedule();
  assert.equal(api.status(config, new Date('2026-11-16T01:59:00Z')).open, false);
  assert.equal(api.status(config, new Date('2026-11-16T02:00:00Z')).open, true);
  assert.equal(api.status(config, new Date('2026-11-16T14:59:00Z')).open, true);
  const closed = api.status(config, new Date('2026-11-16T15:00:00Z'));
  assert.equal(closed.open, false);
  assert.match(closed.schedule, /Senin 09:00–22:00 WIB/);
  assert.match(closed.next, /besok pukul 09:00 WIB/);
});

test('closed days and overnight windows use the previous calendar day correctly', () => {
  const { api } = setup(), config = schedule();
  config.days[1] = { enabled: true, open: '20:00', close: '02:00' };
  config.days[2].enabled = false;
  assert.equal(api.status(config, new Date('2026-11-16T13:00:00Z')).open, true);
  assert.equal(api.status(config, new Date('2026-11-16T18:59:00Z')).open, true);
  assert.equal(api.status(config, new Date('2026-11-16T19:00:00Z')).open, false);
  assert.match(api.status(config, new Date('2026-11-16T19:00:00Z')).next, /besok pukul 09:00/);
  config.days[0] = { enabled: true, open: '20:00', close: '02:00' };
  assert.equal(api.status(config, new Date('2026-11-15T18:00:00Z')).open, true);
  config.days.forEach(day => { day.enabled = false; });
  assert.equal(api.status(config, new Date('2026-11-16T10:00:00Z')).open, false);
});

test('settings have seven device-native time rows and reject invalid active windows before saving', () => {
  const { api } = setup(), values = new Map([['onlineHoursEnabled', 'on']]);
  for (let day = 0; day < 7; day++) {
    values.set(`onlineHoursDay_${day}`, 'on');
    values.set(`onlineHoursOpen_${day}`, day === 5 ? '13:00' : '09:00');
    values.set(`onlineHoursClose_${day}`, '22:00');
  }
  const form = { get: key => values.get(key) ?? null };
  const parsed = api.readForm(form);
  assert.equal(parsed.enabled, true);
  assert.equal(parsed.days[5].open, '13:00');
  assert.equal(parsed.timeZone, 'Asia/Jakarta');
  const html = api.renderSettings(parsed);
  assert.equal((html.match(/type="time"/g) || []).length, 14);
  assert.match(html, /Senin/); assert.match(html, /Minggu/);
  values.set('onlineHoursClose_1', '09:00');
  assert.throws(() => api.readForm(form), /hari Senin/);
  values.delete('onlineHoursDay_1');
  assert.equal(api.readForm(form).days[1].enabled, false);
});

test('schedule survives store settings serialization, normalization and restricted-browser settings reads', async () => {
  const { api, context } = setup(schedule());
  Object.assign(context, { normalizePersistedImageUrl: value => value || '',
    normalizeSelfOrderPromoSlides: value => value || [], normalizeSelfOrderUpsellProductIds: value => value || [],
    normalizeDeletedProductMarkers: () => [], normalizeDeletedNameMarkers: () => [], normalizeDeletedAddonMarkers: () => [],
    readSelfOrderPromoSlidesFromSettings: () => [], staffSyncPayload: () => ({}), STORE_SETTINGS_ROW_ID: 'fixture' });
  const core = read('app.js');
  vm.runInContext(['normalizeStoreSettingsRow', 'storeSettingsPayload', 'selectPublicSelfOrderSettingsRow'].map(name => fn(core, name)).join('\n'), context);
  const config = api.normalize(schedule());
  context.state.settings.selfOrderOperatingHours = config;
  const payload = context.storeSettingsPayload();
  assert.equal(JSON.stringify(payload.self_order_settings.onlineOperatingHours), JSON.stringify(config));
  assert.equal(JSON.stringify(context.normalizeStoreSettingsRow(payload).selfOrderOperatingHours), JSON.stringify(config));
  context.supabaseRestSelect = async (table, columns) => {
    assert.equal(table, 'store_settings'); assert.match(columns, /online_hours:self_order_settings->onlineOperatingHours/);
    assert.doesNotMatch(columns, /staff|notifications|sync_endpoint/);
    return [{ online_hours: config }];
  };
  const publicRow = await context.selectPublicSelfOrderSettingsRow();
  assert.equal(JSON.stringify(publicRow.self_order_settings.onlineOperatingHours), JSON.stringify(config));
});

test('submission rechecks the latest store schedule and shows a themed, apologetic message without changing orders', async () => {
  const { api, context, messages } = setup({ enabled: true, days: Array.from({ length: 7 }, () => ({ enabled: false })) });
  let reads = 0;
  context.loadStoreSettingsFromSupabase = async options => { reads++; assert.equal(options.silent, true); };
  assert.equal(await api.check(), false);
  assert.equal(reads, 1);
  assert.match(messages[0], /Mohon maaf/);
  assert.match(messages[0], /Jam operasional/);
  assert.match(messages[0], /Silakan kembali/);
  context.state.settings.selfOrderOperatingHours.enabled = false;
  assert.equal(await api.check(), true);
});
