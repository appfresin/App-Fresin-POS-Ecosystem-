(function () {
  "use strict";
  const PREF_KEY = "anterin_notification_preferences_v1",
    DEVICE_KEY = "anterin_push_device_v1";
  const defaults = {
    enabled: true,
    sound: true,
    vibration: true,
    repeat: true,
    intervalSeconds: 30,
    tone: "bell",
  };
  let preferences = read(PREF_KEY, defaults),
    audio = null,
    notice = null,
    message = "",
    timer = null;
  let currentOffers = [],
    muted = new Set(),
    seen = new Set(),
    profileId = "",
    registered = false,
    busy = false;
  const escape = (value) =>
    String(value || "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const renderUI = () => window.DriverOrder?.renderUI();
  const native = () =>
    typeof window.KasirinAndroid?.configureDriverNotifications === "function"
      ? window.KasirinAndroid
      : null;
  function read(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value && typeof value === "object"
        ? { ...fallback, ...value }
        : { ...fallback };
    } catch {
      return { ...fallback };
    }
  }
  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      message = "Pengaturan belum dapat disimpan di perangkat ini.";
    }
  }
  function settings() {
    return { ...defaults, ...preferences };
  }
  function configure(patch = {}) {
    const next = { ...settings(), ...patch };
    preferences = {
      enabled: next.enabled !== false,
      sound: next.sound !== false,
      vibration: next.vibration !== false,
      repeat: next.repeat !== false,
      intervalSeconds: Math.max(
        15,
        Math.min(120, Math.round(Number(next.intervalSeconds) || 30)),
      ),
      tone: ["bell", "chime", "soft"].includes(next.tone) ? next.tone : "bell",
    };
    write(PREF_KEY, preferences);
    syncNative();
    schedule();
    return settings();
  }
  function syncNative() {
    try {
      native()?.configureDriverNotifications(JSON.stringify(settings()));
    } catch {
      message = "Pengaturan native belum tersinkron. Coba buka ulang aplikasi.";
    }
  }
  function prepareAudio() {
    if (native() || !settings().sound) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (Audio && !audio) audio = new Audio();
      if (audio?.state === "suspended") audio.resume().catch(() => {});
    } catch {
      /* Banner still works. */
    }
  }
  function play() {
    const pref = settings();
    if (!pref.enabled) return;
    try {
      if (pref.sound && audio?.state === "running") {
        const start = audio.currentTime,
          notes =
            pref.tone === "soft"
              ? [660, 880]
              : pref.tone === "chime"
                ? [1046, 1318, 1568]
                : [880, 1174, 880];
        notes.forEach((frequency, index) => {
          const oscillator = audio.createOscillator(),
            gain = audio.createGain();
          oscillator.frequency.value = frequency;
          gain.gain.setValueAtTime(0.08, start + index * 0.22);
          gain.gain.exponentialRampToValueAtTime(
            0.001,
            start + index * 0.22 + 0.18,
          );
          oscillator.connect(gain);
          gain.connect(audio.destination);
          oscillator.start(start + index * 0.22);
          oscillator.stop(start + index * 0.22 + 0.2);
        });
      }
      if (pref.vibration) navigator.vibrate?.([200, 100, 200]);
    } catch {
      /* Device settings take precedence. */
    }
  }
  const offerKey = (order) => `${order.id}:${order.revision}`;
  function activeOffers() {
    return currentOffers.filter(
      (order) => order.expiresAt > Date.now() && !muted.has(offerKey(order)),
    );
  }
  function schedule() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (native() || !settings().enabled || !activeOffers().length) return;
    const remaining = Math.min(
      ...activeOffers().map((order) => order.expiresAt - Date.now()),
    );
    timer = setTimeout(
      () => {
        timer = null;
        if (!activeOffers().length) {
          notice = null;
          renderUI();
          return;
        }
        if (settings().repeat) play();
        schedule();
      },
      Math.min(
        settings().repeat ? settings().intervalSeconds * 1000 : remaining,
        remaining,
      ),
    );
  }
  async function show(order, count) {
    if (
      native() ||
      typeof Notification === "undefined" ||
      Notification.permission !== "granted"
    )
      return;
    const title =
      count > 1 ? `${count} pesanan delivery baru` : "Pesanan delivery baru";
    const options = {
      body: `Pesanan ${order.number || "baru"} menunggu driver. Segera periksa batas terima pesanan.`,
      tag: `anterin-order-${order.id}`,
      renotify: true,
      requireInteraction: true,
      data: { orderId: order.id },
      silent: !settings().sound,
    };
    try {
      const registration = await navigator.serviceWorker?.getRegistration();
      if (registration) await registration.showNotification(title, options);
      else new Notification(title, options);
    } catch {
      /* Banner still works. */
    }
  }
  function update(available, profile) {
    if (profileId !== profile.id) {
      profileId = profile.id;
      seen = new Set();
      muted = new Set();
      try {
        const saved = JSON.parse(
          localStorage.getItem(`kasirin_driver_alerted_${profileId}`) || "[]",
        );
        seen = new Set(Array.isArray(saved) ? saved : []);
      } catch {
        /* No saved history. */
      }
    }
    currentOffers = available
      .map((order) => {
        const revision = order.updated_at || order.created_at;
        return {
          id: order.id,
          number: order.order_number || "",
          revision,
          revisionAt: Date.parse(revision),
          expiresAt: Date.parse(revision) + 300000,
        };
      })
      .filter(
        (order) =>
          order.id &&
          Number.isFinite(order.expiresAt) &&
          order.expiresAt > Date.now(),
      );
    const fresh = currentOffers.filter((order) => !seen.has(offerKey(order)));
    fresh.forEach((order) => seen.add(offerKey(order)));
    write(`kasirin_driver_alerted_${profileId}`, [...seen].slice(-160));
    if (native()) {
      syncNative();
      try {
        native().syncDriverOrders(JSON.stringify(currentOffers));
      } catch {
        message = "Sinkronisasi peringatan native belum berhasil.";
      }
    }
    if (notice && !currentOffers.some((order) => notice.ids.includes(order.id)))
      notice = null;
    if (fresh.length && settings().enabled) {
      notice = {
        ids: fresh.map((order) => order.id),
        orderId: fresh[0].id,
        count: fresh.length,
      };
      if (!native()) {
        play();
        show(fresh[0], fresh.length);
      }
    }
    schedule();
  }
  function requestToken() {
    return new Promise((resolve, reject) => {
      const bridge = native();
      if (!bridge?.getFcmToken) {
        reject(
          Error(
            "Gunakan APK Anterin terbaru untuk notifikasi saat aplikasi tertutup.",
          ),
        );
        return;
      }
      const callbackId = `driver_fcm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      window.__kasirinFcmTokenCallbacks =
        window.__kasirinFcmTokenCallbacks || {};
      const timeout = setTimeout(() => {
        delete window.__kasirinFcmTokenCallbacks[callbackId];
        reject(
          Error(
            "Token perangkat belum tersedia. Periksa koneksi lalu coba lagi.",
          ),
        );
      }, 12000);
      window.__kasirinFcmTokenCallbacks[callbackId] = (result) => {
        clearTimeout(timeout);
        delete window.__kasirinFcmTokenCallbacks[callbackId];
        result?.ok && result.token
          ? resolve(result.token)
          : reject(Error("Token notifikasi perangkat belum tersedia."));
      };
      try {
        bridge.getFcmToken(callbackId);
      } catch {
        clearTimeout(timeout);
        delete window.__kasirinFcmTokenCallbacks[callbackId];
        reject(Error("APK belum mendukung token notifikasi driver."));
      }
    });
  }
  async function authorize(login = "", pin = "") {
    if (!native()) return false;
    busy = true;
    renderUI();
    syncNative();
    try {
      const token = await requestToken();
      let device = read(DEVICE_KEY, {});
      if (!device.id || !device.secret) {
        const bytes = new Uint8Array(32);
        window.crypto.getRandomValues(bytes);
        device = {
          id: window.crypto.randomUUID(),
          secret: Array.from(bytes, (b) =>
            b.toString(16).padStart(2, "0"),
          ).join(""),
        };
      }
      const client = await window.DriverSupabase.ready();
      const { data, error } = await client.rpc("register_driver_push_device", {
        p_device_id: device.id,
        p_secret: device.secret,
        p_token: token,
        p_enabled: settings().enabled,
        p_login: login || null,
        p_pin: pin || null,
      });
      if (error || !data?.ok)
        throw Error(
          error?.code === "PGRST202"
            ? "Layanan push driver belum diaktifkan di server."
            : login
              ? "Pendaftaran notifikasi gagal. Periksa akun, PIN, dan koneksi."
              : "Verifikasi akun untuk mengaktifkan push di perangkat ini.",
        );
      write(DEVICE_KEY, device);
      registered = true;
      native().setDriverPushRegistration?.(
        JSON.stringify({ ...device, enabled: settings().enabled }),
      );
      message = "Perangkat terdaftar untuk notifikasi pesanan driver.";
      return true;
    } catch (error) {
      registered = false;
      message = error.message || "Notifikasi native belum dapat diaktifkan.";
      return false;
    } finally {
      busy = false;
      renderUI();
    }
  }
  async function enable() {
    prepareAudio();
    syncNative();
    if (native()) {
      native().requestDriverNotificationPermission?.();
      await authorize();
    } else {
      try {
        const permission =
          typeof Notification === "undefined"
            ? "unavailable"
            : Notification.permission === "default"
              ? await Notification.requestPermission()
              : Notification.permission;
        if (permission === "granted" && navigator.serviceWorker)
          await navigator.serviceWorker.register("driver-notifications-sw.js", {
            scope: "./",
          });
        message =
          permission === "granted"
            ? "Notifikasi browser diaktifkan. Push saat tertutup memerlukan APK."
            : "Bunyi aplikasi aktif. Periksa izin notifikasi perangkat.";
      } catch {
        message = "Periksa izin notifikasi perangkat.";
      }
    }
    renderUI();
  }
  function test() {
    prepareAudio();
    syncNative();
    if (native()) native().testDriverNotification();
    else play();
    message = settings().enabled
      ? "Tes dering dikirim. Suara mengikuti pengaturan perangkat."
      : "Aktifkan notifikasi terlebih dahulu untuk tes dering.";
    renderUI();
  }
  function dismiss() {
    currentOffers.forEach((order) => muted.add(offerKey(order)));
    notice = null;
    native()?.silenceDriverNotifications?.();
    schedule();
    renderUI();
  }
  async function logout() {
    configure({ enabled: false });
    currentOffers = [];
    dismiss();
    try {
      if (native() && read(DEVICE_KEY, {}).id) await authorize();
    } finally {
      localStorage.removeItem(DEVICE_KEY);
      native()?.clearDriverPushRegistration?.();
      registered = false;
      profileId = "";
    }
  }
  function bellIcon() {
    return '<svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><circle cx="32" cy="32" r="29" fill="#fff2d3"/><path d="M18 41h28l-4-7V25a10 10 0 0 0-20 0v9l-4 7Z" fill="#ecd09a" stroke="#9a7137" stroke-width="2.3" stroke-linejoin="round"/><path d="M28 46a4 4 0 0 0 8 0M32 12v3M16 22l-4-3M48 22l4-3" stroke="#9a7137" stroke-width="2.3" stroke-linecap="round"/><circle cx="47" cy="44" r="10" fill="#e7f2d9" stroke="#6c9244" stroke-width="2"/><path d="m43 44 3 3 5-6" stroke="#6c9244" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  function renderSettings() {
    const p = settings(),
      bridge = native();
    let permission = "Izin browser belum aktif";
    if (bridge) {
      try {
        const status = JSON.parse(bridge.driverNotificationStatus?.() || "{}");
        permission = status.allowed
          ? "Izin notifikasi perangkat aktif"
          : "Izin notifikasi perangkat belum aktif";
      } catch {
        permission = "Periksa izin notifikasi perangkat";
      }
    } else if (
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    )
      permission = "Izin notifikasi browser aktif";
    const toggle = (key, title, copy) =>
      `<label class="driver-setting-row"><span><strong>${title}</strong><small>${copy}</small></span><input type="checkbox" role="switch" data-notification-setting="${key}" ${p[key] ? "checked" : ""}/></label>`;
    return `<section class="driver-content driver-settings-page"><button class="driver-settings-back" type="button" data-action="close-settings">‹ Kembali ke order</button>
      <header class="driver-settings-hero">${bellIcon()}<div><h1>Dering & notifikasi</h1><p>Selalu siap menyambut pesanan baru.</p></div></header>
      <section class="driver-settings-card"><div class="driver-settings-section-title">Peringatan pesanan</div>
        ${toggle("enabled", "Notifikasi pesanan", "Aktifkan peringatan pesanan di perangkat ini.")}${toggle("sound", "Bunyi dering", "Gunakan volume notifikasi perangkat.")}${toggle("vibration", "Getaran", "Getarkan perangkat saat pesanan masuk.")}${toggle("repeat", "Dering berulang", "Ulangi selama pesanan belum diterima.")}
        <label class="driver-setting-row"><span><strong>Jeda pengulangan</strong><small>Berhenti otomatis saat batas terima habis.</small></span><select aria-label="Jeda pengulangan" data-notification-setting="intervalSeconds" ${!p.repeat ? "disabled" : ""}>${[15, 30, 45, 60, 90, 120].map((seconds) => `<option value="${seconds}" ${p.intervalSeconds === seconds ? "selected" : ""}>${seconds} detik</option>`).join("")}</select></label>
        <label class="driver-setting-row"><span><strong>Nada dering</strong><small>Suara diputar dari perangkat.</small></span><select aria-label="Nada dering" data-notification-setting="tone">${[
          ["bell", "Bell"],
          ["chime", "Chime"],
          ["soft", "Lembut"],
        ]
          .map(
            ([value, label]) =>
              `<option value="${value}" ${p.tone === value ? "selected" : ""}>${label}</option>`,
          )
          .join("")}</select></label>
        <button class="driver-primary driver-setting-test" type="button" data-action="test-notification">Tes dering & getaran</button>
      </section>
      <section class="driver-settings-card driver-device-status"><div class="driver-settings-section-title">Kesiapan perangkat</div><p><span class="driver-status-dot ${bridge && registered ? "is-ready" : ""}"></span>${bridge ? (registered ? "Push driver terdaftar" : "Push driver belum terdaftar") : "Mode browser"}</p><small>${escape(permission)}</small>
        <p class="driver-settings-help">${bridge ? "Notifikasi tertutup memakai layanan native APK. Pastikan izin notifikasi aktif." : "Notifikasi saat aplikasi tertutup memerlukan APK Anterin terbaru. Browser mendukung peringatan selama halaman masih berjalan."}</p>
        <div class="driver-setting-buttons"><button class="driver-secondary" type="button" data-action="enable-notifications" ${busy ? "disabled" : ""}>${busy ? "Memeriksa…" : "Aktifkan / periksa izin"}</button>${bridge ? '<button class="driver-secondary" type="button" data-action="device-notification-settings">Pengaturan Android</button>' : ""}</div>
        ${bridge && !registered ? '<form data-driver-form="notification-auth" class="driver-notification-auth"><input name="pin" type="password" aria-label="PIN akun driver" inputmode="numeric" autocomplete="current-password" minlength="4" required placeholder="PIN akun driver untuk verifikasi"/><button class="driver-secondary" type="submit">Daftarkan perangkat</button></form>' : ""}
        ${message ? `<p class="driver-settings-message" role="status">${escape(message)}</p>` : ""}<small class="driver-settings-help">Pengaturan tersimpan otomatis. Mode senyap, Jangan Ganggu, dan pembatasan baterai Android tetap berlaku.</small>
      </section><button class="driver-settings-logout" type="button" data-action="logout">Keluar dari akun driver</button></section>`;
  }
  function render() {
    return notice
      ? `<aside class="driver-incoming-alert" role="alert"><div><strong>${notice.count > 1 ? `${notice.count} pesanan delivery baru` : "Pesanan delivery baru masuk"}</strong><small>Segera periksa batas terima pesanan.</small></div><button type="button" data-open-order="${escape(notice.orderId)}">Lihat</button><button type="button" data-action="dismiss-alert" aria-label="Hentikan peringatan">×</button></aside>`
      : "";
  }
  configure(preferences);
  window.DriverNotifications = {
    update,
    render,
    renderSettings,
    settings,
    configure,
    enable,
    prepareAudio,
    dismiss,
    test,
    authorize,
    logout,
    syncNative,
  };
  navigator.serviceWorker?.addEventListener("message", (event) => {
    if (event.data?.type === "driver-open-orders") {
      window.DriverOrder?.setView("tasks");
      window.DriverOrder?.refresh({ force: true, quiet: true });
    }
  });
  document.addEventListener("kasirin-native-ready", () => {
    syncNative();
    if (read(DEVICE_KEY, {}).id) authorize();
  });
})();
