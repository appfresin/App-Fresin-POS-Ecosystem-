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
  const fields = new Map();
  let notice;
  const document = {
    getElementById: () => notice,
    createElement: () => ({ open: false, innerHTML: '', setAttribute() {},
      querySelector(selector) {
        if (!fields.has(selector)) fields.set(selector, { textContent: '' });
        return fields.get(selector);
      },
      showModal() { this.open = true; }, close() { this.open = false; }
    }),
    body: { appendChild(element) { notice = element; } }
  };
  const context = vm.createContext({ window: {}, Intl, Date,
    document, state: { settings: { selfOrderOperatingHours: config } }, toast: message => messages.push(message) });
  vm.runInContext(read('Customer Gateway/online-hours.js'), context);
  return { api: context.window.FresinOnlineHours, context, messages, document, fields };
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
  assert.match(closed.next, /besok jam 09\.00 WIB/);
});

test('closed days and overnight windows use the previous calendar day correctly', () => {
  const { api } = setup(), config = schedule();
  config.days[1] = { enabled: true, open: '20:00', close: '02:00' };
  config.days[2].enabled = false;
  assert.equal(api.status(config, new Date('2026-11-16T13:00:00Z')).open, true);
  assert.equal(api.status(config, new Date('2026-11-16T18:59:00Z')).open, true);
  assert.equal(api.status(config, new Date('2026-11-16T19:00:00Z')).open, false);
  assert.match(api.status(config, new Date('2026-11-16T19:00:00Z')).next, /besok jam 09\.00/);
  config.days[0] = { enabled: true, open: '20:00', close: '02:00' };
  assert.equal(api.status(config, new Date('2026-11-15T18:00:00Z')).open, true);
  config.days.forEach(day => { day.enabled = false; });
  assert.equal(api.status(config, new Date('2026-11-16T10:00:00Z')).open, false);
});

test('return copy switches after 05.00 WIB and respects the configured opening minute', () => {
  const { api } = setup(), config = schedule();
  config.days.forEach(day => { day.open = '11:10'; });
  for (const time of ['00:00', '04:59', '05:00']) {
    assert.equal(api.status(config, new Date(`2026-11-16T${time}:00+07:00`)).next,
      'Silahkan kembali besok jam 11.10 WIB');
  }
  for (const time of ['05:01', '08:30', '11:09']) {
    assert.equal(api.status(config, new Date(`2026-11-16T${time}:00+07:00`)).next,
      'Silahkan kembali nanti jam 11.10 WIB');
  }
  assert.equal(api.status(config, new Date('2026-11-16T11:10:00+07:00')).open, true);
  config.days[1].enabled = false;
  config.days[2].enabled = false;
  assert.equal(api.status(config, new Date('2026-11-16T08:30:00+07:00')).next,
    'Silahkan kembali hari Rabu jam 11.10 WIB');
  config.days.forEach(day => { day.enabled = false; });
  assert.equal(api.status(config, new Date('2026-11-16T08:30:00+07:00')).next,
    'Silahkan kembali pada hari operasional berikutnya');
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

test('submission rechecks the latest schedule and reuses a modal without replacing ordinary toasts', async () => {
  const { api, context, messages, document, fields } = setup({ enabled: true, days: Array.from({ length: 7 }, () => ({ enabled: false })) });
  let reads = 0;
  context.loadStoreSettingsFromSupabase = async options => { reads++; assert.equal(options.silent, true); assert.equal(options.force, true); };
  assert.equal(await api.check(), false);
  assert.equal(reads, 1);
  const notice = document.getElementById('onlineHoursNotice');
  assert.equal(notice.open, true);
  assert.match(notice.innerHTML, /Mohon maaf/);
  assert.match(notice.innerHTML, /Jam operasional hari ini/);
  assert.match(notice.innerHTML, /Terima kasih, teman Fresin!/);
  assert.match(fields.get('.online-hours-next span').textContent, /Silahkan kembali/);
  assert.equal(fields.get('.online-hours-next strong').textContent, '');
  assert.equal(messages.length, 0);
  assert.equal(api.allow(), false);
  assert.equal(document.getElementById('onlineHoursNotice'), notice);
  context.state.settings.selfOrderOperatingHours.enabled = false;
  assert.equal(await api.check(), true);
  assert.equal(notice.open, false);
});
