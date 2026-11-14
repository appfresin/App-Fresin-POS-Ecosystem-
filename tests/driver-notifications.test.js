const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
function setup(native = false) {
  let now = 1000000,
    id = 0,
    played = 0;
  const storage = new Map(),
    timers = new Map(),
    calls = [];
  const ctx = {
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    JSON,
    Map,
    Set,
    Math,
    Number,
    String,
    Boolean,
    Promise,
    localStorage: {
      getItem: (k) => storage.get(k) || null,
      setItem: (k, v) => storage.set(k, v),
      removeItem: (k) => storage.delete(k),
    },
    navigator: { vibrate: () => played++ },
    Notification: undefined,
    document: { hidden: false, addEventListener() {} },
    setTimeout: (fn, ms) => {
      timers.set(++id, { fn, at: now + ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    window: {
      DriverOrder: { renderUI() {} },
      crypto: require("node:crypto").webcrypto,
    },
  };
  ctx.window.setTimeout = ctx.setTimeout;
  ctx.window.clearTimeout = ctx.clearTimeout;
  if (native)
    ctx.window.KasirinAndroid = {
      configureDriverNotifications: (raw) =>
        calls.push(["configure", JSON.parse(raw)]),
      syncDriverOrders: (raw) => calls.push(["sync", JSON.parse(raw)]),
      testDriverNotification: () => calls.push(["test"]),
    };
  vm.runInNewContext(
    fs.readFileSync("deploy-ready/driver/Driver Order/driver-notifications.js", "utf8"),
    ctx,
  );
  return {
    api: ctx.window.DriverNotifications,
    window: ctx.window,
    calls,
    storage,
    get played() {
      return played;
    },
    async tick(ms) {
      now += ms;
      for (const [id, timer] of [...timers])
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
    },
    offer: (patch = {}) => ({
      id: "one",
      order_number: "D001",
      updated_at: new Date(now).toISOString(),
      ...patch,
    }),
  };
}
test("preferences validate intervals, survive reload and do not render a fake native-ready state", () => {
  const s = setup();
  s.api.configure({
    intervalSeconds: 1,
    durationSeconds: 99,
    sound: false,
    vibration: true,
    repeat: true,
  });
  assert.equal(s.api.settings().intervalSeconds, 15);
  assert.equal(s.api.settings().durationSeconds, 15);
  assert.match(s.api.renderSettings(), /Lama satu dering/);
  assert.equal(s.api.settings().sound, false);
  assert.match(s.api.renderSettings(), /Dering.*notifikasi/i);
  assert.match(s.api.renderSettings(), /APK|browser/i);
});

test("ready alerts use independent preferences and do not repeat after payment or refresh", async () => {
  const s = setup();
  s.api.configure({enabled:false,readyEnabled:true,readySound:false,readyVibration:true,readyTone:'soft',readyDurationSeconds:99});
  assert.equal(s.api.settings().readyDurationSeconds,15);
  assert.equal(s.api.settings().tone,'bell');
  const ready=s.offer({id:'ready-one'});
  s.api.update([], {id:'driver'}, [ready]);
  assert.equal(s.played,1);
  s.api.update([], {id:'driver'}, [{...ready,updated_at:new Date(1001000).toISOString()}]);
  await s.tick(60000);
  assert.equal(s.played,1);
  assert.match(s.api.render(),/siap dijemput/);
  s.api.update([], {id:'driver'}, []);
  assert.doesNotMatch(s.api.render(),/siap dijemput/);
  s.api.configure({readyEnabled:false});
  s.api.update([], {id:'driver'}, [s.offer({id:'ready-two'})]);
  assert.equal(s.played,1);
});

test("native ready snapshots and tests use separate bridge methods without web sound", () => {
  const s=setup(true);
  s.window.KasirinAndroid.syncDriverReadyOrders=raw=>s.calls.push(['ready-sync',JSON.parse(raw)]);
  s.window.KasirinAndroid.testDriverReadyNotification=()=>s.calls.push(['ready-test']);
  s.api.update([], {id:'driver'}, [s.offer({id:'ready'})]);
  assert.equal(s.played,0);
  assert.equal(s.calls.find(c=>c[0]==='ready-sync')[1][0].id,'ready');
  s.api.testReady();
  assert.ok(s.calls.some(c=>c[0]==='ready-test'));
  assert.equal(s.api.settings().intervalSeconds,30);
  assert.equal(s.api.settings().repeat,true);
});
test("older APKs request an update and native background restrictions are explained", () => {
  const s = setup(true);
  assert.match(s.api.renderSettings(), /Perbarui APK Anterin ke versi 1\.9/);
  s.window.KasirinAndroid.driverNotificationStatus = () => JSON.stringify({ allowed: true, durableAlerts: true, backgroundRestricted: true });
  s.window.KasirinAndroid.openDriverBackgroundSettings = () => {};
  const markup = s.api.renderSettings();
  assert.doesNotMatch(markup, /Perbarui APK Anterin ke versi 1\.9/);
  assert.match(markup, /Perbarui APK Anterin ke versi 1\.11/);
  assert.match(markup, /Android membatasi dering latar belakang/);
  assert.match(markup, /Baterai & latar belakang/);
});
test("new offers alert once, repeat locally and stop immediately when accepted or expired", async () => {
  const s = setup();
  s.api.configure({ intervalSeconds: 15 });
  const offer = s.offer();
  s.api.update([offer], { id: "driver" });
  assert.equal(s.played, 1);
  s.api.update([offer], { id: "driver" });
  assert.equal(s.played, 1);
  await s.tick(15000);
  assert.equal(s.played, 2);
  s.api.update([], { id: "driver" });
  await s.tick(15000);
  assert.equal(s.played, 2);
  s.api.update(
    [s.offer({ id: "expired", updated_at: new Date(1).toISOString() })],
    { id: "driver" },
  );
  assert.equal(s.played, 2);
});
test("disable and dismiss stop repeats without losing new-order detection", async () => {
  const s = setup();
  s.api.configure({ intervalSeconds: 15 });
  s.api.update([s.offer()], { id: "d" });
  s.api.dismiss();
  await s.tick(15000);
  assert.equal(s.played, 1);
  s.api.update([s.offer({ id: "two" })], { id: "d" });
  assert.equal(s.played, 2);
  s.api.configure({ enabled: false });
  await s.tick(15000);
  assert.equal(s.played, 2);
});
test("native receives bounded offers instead of duplicate web sounds and clears all on empty snapshots", () => {
  const s = setup(true);
  s.api.update([s.offer()], { id: "driver" });
  assert.equal(s.played, 0);
  const sync = s.calls.filter((c) => c[0] === "sync").at(-1)[1];
  assert.equal(sync[0].id, "one");
  assert.equal(sync[0].expiresAt, 1300000);
  s.api.update([], { id: "driver" });
  assert.equal(s.calls.filter((c) => c[0] === "sync").at(-1)[1].length, 0);
  s.api.test();
  assert.ok(s.calls.some((c) => c[0] === "test"));
});
test("native registration verifies staff once, stores no PIN, renews by device capability and disables on logout", async () => {
  const s = setup(true),
    requests = [];
  s.window.KasirinAndroid.getFcmToken = (id) =>
    s.window.__kasirinFcmTokenCallbacks[id]({
      ok: true,
      token: "device-token-for-testing-1234567890",
    });
  s.window.KasirinAndroid.setDriverPushRegistration = (raw) =>
    s.calls.push(["registration", JSON.parse(raw)]);
  s.window.DriverSupabase = {
    ready: async () => ({
      rpc: async (name, args) => {
        requests.push({ name, args });
        return { data: { ok: true } };
      },
    }),
  };
  assert.equal(await s.api.authorize("driver", "1234"), true);
  const stored = JSON.parse(s.storage.get("anterin_push_device_v1"));
  assert.match(stored.secret, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(stored), /1234|pin|token/);
  assert.equal(await s.api.authorize(), true);
  assert.equal(requests[1].args.p_pin, null);
  assert.equal(requests[1].args.p_secret, stored.secret);
  await s.api.logout();
  assert.equal(requests.at(-1).args.p_enabled, false);
  assert.equal(s.storage.has("anterin_push_device_v1"), false);
});
test("native registration errors remain visibly unregistered and never persist credentials", async () => {
  const s = setup(true);
  s.window.KasirinAndroid.getFcmToken = (id) =>
    s.window.__kasirinFcmTokenCallbacks[id]({
      ok: true,
      token: "token-for-testing-1234567890123456",
    });
  s.window.DriverSupabase = {
    ready: async () => ({ rpc: async () => ({ error: { code: "PGRST202" } }) }),
  };
  assert.equal(await s.api.authorize("driver", "1234"), false);
  assert.equal(s.storage.has("anterin_push_device_v1"), false);
  assert.match(
    s.api.renderSettings(),
    /belum diaktifkan di server|Push driver belum terdaftar/,
  );
});

test("browser drivers verify the same account feed without registering a fake push token", async () => {
  const s = setup(false),
    requests = [];
  s.window.DriverSupabase = {
    ready: async () => ({
      rpc: async (name, args) => {
        requests.push(args);
        return { data: { ok: true } };
      },
    }),
  };
  assert.equal(await s.api.authorize("driver", "1234"), true);
  assert.equal(requests[0].p_token, "");
  assert.equal(requests[0].p_enabled, false);
  assert.ok(s.api.deviceCredentials());
  assert.match(s.api.renderSettings(), /Akses data akun driver terverifikasi/);
});

test("an older logout finishing late cannot erase the next driver credentials", async () => {
  const s = setup(false);
  let release;
  s.window.DriverSupabase = {
    ready: async () => ({
      rpc: async (name, args) =>
        args.p_login
          ? { data: { ok: true } }
          : new Promise((resolve) => {
              release = resolve;
            }),
    }),
  };
  await s.api.authorize("first", "1234");
  const logout = s.api.logout();
  assert.equal(s.api.deviceCredentials(), null);
  await s.api.authorize("second", "5678");
  const next = s.api.deviceCredentials();
  release({ data: { ok: true } });
  await logout;
  assert.equal(s.api.deviceCredentials().id, next.id);
});
