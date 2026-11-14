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
    durationSeconds: 8,
    tone: "bell",
    readyEnabled: true,
    readySound: true,
    readyVibration: true,
    readyTone: "chime",
    readyDurationSeconds: 5,
  };
  let preferences = read(PREF_KEY, defaults),
    audio = null,
    notice = null,
    message = "",
    timer = null;
  let currentOffers = [],
    readySeen = new Set(),
    readyNotice = null,
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
      durationSeconds: Math.max(5, Math.min(15, Math.round(Number(next.durationSeconds) || 8))),
      tone: ["bell", "chime", "soft"].includes(next.tone) ? next.tone : "bell",
      readyEnabled: next.readyEnabled !== false,
      readySound: next.readySound !== false,
      readyVibration: next.readyVibration !== false,
      readyTone: ["bell", "chime", "soft"].includes(next.readyTone) ? next.readyTone : "chime",
      readyDurationSeconds: Math.max(5, Math.min(15, Math.round(Number(next.readyDurationSeconds) || 5))),
    };
    write(PREF_KEY, preferences);
    if (!preferences.readyEnabled) readyNotice = null;
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
    if (native() || (!settings().sound && !settings().readySound)) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (Audio && !audio) audio = new Audio();
      if (audio?.state === "suspended") audio.resume().catch(() => {});
    } catch {
      /* Banner still works. */
    }
  }
  function play(ready = false) {
    const base = settings();
    const pref = ready ? {enabled:base.readyEnabled,sound:base.readySound,vibration:base.readyVibration,tone:base.readyTone} : base;
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
  function update(available, profile, readyOrders = []) {
    if (profileId !== profile.id) {
      profileId = profile.id;
      seen = new Set();
      readySeen = new Set();
      readyNotice = null;
      muted = new Set();
      try {
        const saved = JSON.parse(
          localStorage.getItem(`kasirin_driver_alerted_${profileId}`) || "[]",
        );
        seen = new Set(Array.isArray(saved) ? saved : []);
        const readySaved = JSON.parse(localStorage.getItem(`anterin_ready_alerted_${profileId}`) || "[]");
        readySeen = new Set(Array.isArray(readySaved) ? readySaved : []);
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
    updateReady(readyOrders);
  }

  function updateReady(orders) {
    const ready = orders.map(order => ({id:order.id,number:order.order_number || "",
      revisionAt:Date.parse(order.ready_at || order.updated_at || order.created_at)}))
      .filter(order => order.id && Number.isFinite(order.revisionAt));
    const fresh = ready.filter(order => !readySeen.has(order.id));
    fresh.forEach(order => readySeen.add(order.id));
    write(`anterin_ready_alerted_${profileId}`, [...readySeen].slice(-160));
    try {
      if (native()?.syncDriverReadyOrders) native().syncDriverReadyOrders(JSON.stringify(ready));
    } catch { message = "Sinkronisasi notifikasi pesanan selesai belum berhasil. Coba buka ulang aplikasi."; }
    if (readyNotice && !ready.some(order => order.id === readyNotice.orderId)) readyNotice = null;
    if (fresh.length && settings().readyEnabled) {
      readyNotice = {orderId:fresh[0].id,number:fresh[0].number,count:fresh.length};
      if (!native()) { play(true); showReady(fresh[0]); }
    }
  }

  async function showReady(order) {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const options = {body:`Pesanan ${order.number} selesai disiapkan dapur. Silakan jemput ke outlet.`,
      tag:`anterin-ready-${order.id}`,data:{orderId:order.id},silent:!settings().readySound};
    try {
      const registration = await navigator.serviceWorker?.getRegistration();
      if (registration) await registration.showNotification("Pesanan siap dijemput", options);
      else new Notification("Pesanan siap dijemput", options);
    } catch { /* In-app banner remains available. */ }
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
    busy = true;
    renderUI();
    syncNative();
    try {
      let token = "";
      let tokenError = "";
      if (native()) {
        try {
          token = await requestToken();
        } catch (error) {
          tokenError = error.message;
        }
      }
      let device = read(DEVICE_KEY, {});
      if ((login && pin) || !device.id || !device.secret) {
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
        p_enabled: Boolean(native()) && (settings().enabled || settings().readyEnabled),
        p_login: login || null,
        p_pin: pin || null,
      });
      if (error || !data?.ok)
        throw Error(
          error?.code === "PGRST202"
            ? "Layanan akun dan push driver belum diaktifkan di server."
            : login
              ? "Pendaftaran notifikasi gagal. Periksa akun, PIN, dan koneksi."
              : "Verifikasi akun untuk mengaktifkan push di perangkat ini.",
        );
      write(DEVICE_KEY, device);
      registered = Boolean(native() && token);
      native()?.setDriverPushRegistration?.(
        JSON.stringify({ ...device, enabled: settings().enabled || settings().readyEnabled }),
      );
      message =
        tokenError ||
        (registered
          ? "Perangkat terdaftar untuk notifikasi pesanan driver."
          : "Akses data akun driver terverifikasi.");
      window.DriverOrder?.refresh?.({ force: true, quiet: true });
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
  function testReady() {
    prepareAudio(); syncNative();
    if (native()?.testDriverReadyNotification) native().testDriverReadyNotification();
    else if (!native()) play(true);
    message = native() && !native().testDriverReadyNotification ? "Perbarui APK Anterin ke versi 1.11 untuk notifikasi pesanan siap dijemput."
      : settings().readyEnabled ? "Tes suara pesanan siap dijemput dikirim." : "Aktifkan notifikasi pesanan siap dijemput terlebih dahulu.";
    renderUI();
  }
  function dismissReady() { readyNotice = null; renderUI(); }
  async function logout() {
    const device = deviceCredentials();
    configure({ enabled: false, readyEnabled: false });
    currentOffers = [];
    dismiss();
    localStorage.removeItem(DEVICE_KEY);
    native()?.clearDriverPushRegistration?.();
    registered = false;
    profileId = "";
    if (!device) return;
    try {
      const client = await window.DriverSupabase.ready();
      await client.rpc("register_driver_push_device", {
        p_device_id: device.id,
        p_secret: device.secret,
        p_token: "",
        p_enabled: false,
        p_login: null,
        p_pin: null,
      });
    } catch {
      /* The native alert is already disabled locally, including while offline. */
    }
  }
  function bellIcon() {
    return '<svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><circle cx="32" cy="32" r="29" fill="#fff2d3"/><path d="M18 41h28l-4-7V25a10 10 0 0 0-20 0v9l-4 7Z" fill="#ecd09a" stroke="#9a7137" stroke-width="2.3" stroke-linejoin="round"/><path d="M28 46a4 4 0 0 0 8 0M32 12v3M16 22l-4-3M48 22l4-3" stroke="#9a7137" stroke-width="2.3" stroke-linecap="round"/><circle cx="47" cy="44" r="10" fill="#e7f2d9" stroke="#6c9244" stroke-width="2"/><path d="m43 44 3 3 5-6" stroke="#6c9244" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  function renderSettings() {
    const p = settings(),
      bridge = native();
    let permission = "Izin browser belum aktif";
    let backgroundHelp = "", nativeNeedsUpdate = false;
    if (bridge) {
      try {
        const status = JSON.parse(bridge.driverNotificationStatus?.() || "{}");
        nativeNeedsUpdate = status.durableAlerts !== true;
        if (status.backgroundRestricted || status.backgroundStartBlocked) backgroundHelp = "Android membatasi dering latar belakang. Buka pengaturan baterai aplikasi dan pilih Tanpa batas.";
        else if (status.batteryOptimized) backgroundHelp = "Agar pengulangan tetap berjalan saat layar mati, atur baterai Anterin ke Tanpa batas.";
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
      <section class="driver-settings-card"><div class="driver-settings-section-title">Pesanan baru masuk</div>
        ${toggle("enabled", "Notifikasi pesanan", "Aktifkan peringatan pesanan di perangkat ini.")}${toggle("sound", "Bunyi dering", "Gunakan volume notifikasi perangkat.")}${toggle("vibration", "Getaran", "Getarkan perangkat saat pesanan masuk.")}${toggle("repeat", "Dering berulang", "Ulangi selama pesanan belum diterima.")}
        <label class="driver-setting-row"><span><strong>Jeda pengulangan</strong><small>Berhenti otomatis saat batas terima habis.</small></span><select aria-label="Jeda pengulangan" data-notification-setting="intervalSeconds" ${!p.repeat ? "disabled" : ""}>${[15, 30, 45, 60, 90, 120].map((seconds) => `<option value="${seconds}" ${p.intervalSeconds === seconds ? "selected" : ""}>${seconds} detik</option>`).join("")}</select></label>
        <label class="driver-setting-row"><span><strong>Lama satu dering</strong><small>Durasi bunyi native APK; dijeda sebelum pengulangan berikutnya.</small></span><select aria-label="Lama satu dering" data-notification-setting="durationSeconds" ${nativeNeedsUpdate ? "disabled" : ""}>${[5, 8, 10, 15].map(seconds => `<option value="${seconds}" ${p.durationSeconds === seconds ? "selected" : ""}>${seconds} detik</option>`).join("")}</select></label>
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
      <section class="driver-settings-card"><div class="driver-settings-section-title">Pesanan selesai disiapkan</div>
        <p class="driver-settings-help">Peringatan saat dapur menyelesaikan pesanan yang kamu tangani. Berbunyi sekali untuk setiap pesanan.</p>
        ${toggle("readyEnabled", "Notifikasi siap dijemput", "Terpisah dari peringatan pesanan baru.")}
        ${toggle("readySound", "Bunyi pesanan selesai", "Gunakan suara khusus pesanan siap dijemput.")}
        ${toggle("readyVibration", "Getaran pesanan selesai", "Getarkan perangkat saat dapur selesai.")}
        <label class="driver-setting-row"><span><strong>Nada pesanan selesai</strong><small>Suara berbeda dari pesanan baru.</small></span><select aria-label="Nada pesanan selesai" data-notification-setting="readyTone">${[["bell","Bell"],["chime","Chime"],["soft","Lembut"]].map(([value,label])=>`<option value="${value}" ${p.readyTone===value?"selected":""}>${label}</option>`).join("")}</select></label>
        <label class="driver-setting-row"><span><strong>Lama dering pesanan selesai</strong><small>Durasi satu peringatan.</small></span><select aria-label="Lama dering pesanan selesai" data-notification-setting="readyDurationSeconds">${[5,8,10,15].map(value=>`<option value="${value}" ${p.readyDurationSeconds===value?"selected":""}>${value} detik</option>`).join("")}</select></label>
        <button class="driver-primary driver-setting-test" type="button" data-action="test-ready-notification">Tes suara pesanan selesai</button>
        ${bridge && !bridge.syncDriverReadyOrders ? '<p class="driver-settings-message">Perbarui APK Anterin ke versi 1.11 agar notifikasi pesanan selesai tetap berbunyi saat aplikasi tertutup.</p>' : ""}
      </section>
      <section class="driver-settings-card driver-device-status"><div class="driver-settings-section-title">Kesiapan perangkat</div><p><span class="driver-status-dot ${bridge && registered ? "is-ready" : ""}"></span>${bridge ? (registered ? "Push driver terdaftar" : "Push driver belum terdaftar") : "Mode browser"}</p><small>${escape(permission)}</small>
        <p class="driver-settings-help">${bridge ? "Notifikasi tertutup memakai layanan native APK. Pastikan izin notifikasi aktif." : "Notifikasi saat aplikasi tertutup memerlukan APK Anterin terbaru. Browser mendukung peringatan selama halaman masih berjalan."}</p>
        <div class="driver-setting-buttons"><button class="driver-secondary" type="button" data-action="enable-notifications" ${busy ? "disabled" : ""}>${busy ? "Memeriksa…" : "Aktifkan / periksa izin"}</button>${bridge ? '<button class="driver-secondary" type="button" data-action="device-notification-settings">Pengaturan Android</button>' : ""}</div>
        ${nativeNeedsUpdate ? '<p class="driver-settings-message">Perbarui APK Anterin ke versi 1.9 agar durasi dering dan pemulihan pengulangan latar belakang tersedia.</p>' : ""}
        ${backgroundHelp ? `<p class="driver-settings-help">${escape(backgroundHelp)}</p>` : ""}
        ${bridge?.openDriverBackgroundSettings ? '<button class="driver-secondary" type="button" data-action="driver-background-settings">Baterai & latar belakang</button>' : ""}
        ${!deviceCredentials() || (bridge && !registered) ? '<form data-driver-form="notification-auth" class="driver-notification-auth"><input name="pin" type="password" aria-label="PIN akun driver" inputmode="numeric" autocomplete="current-password" minlength="4" required placeholder="PIN akun driver untuk verifikasi"/><button class="driver-secondary" type="submit">Verifikasi akun driver</button></form>' : ""}
        ${message ? `<p class="driver-settings-message" role="status">${escape(message)}</p>` : ""}<small class="driver-settings-help">Pengaturan tersimpan otomatis. Mode senyap, Jangan Ganggu, dan pembatasan baterai Android tetap berlaku.</small>
      </section><button class="driver-settings-logout" type="button" data-action="logout">Keluar dari akun driver</button></section>`;
  }
  function render() {
    const incoming = notice
      ? `<aside class="driver-incoming-alert" role="alert"><div><strong>${notice.count > 1 ? `${notice.count} pesanan delivery baru` : "Pesanan delivery baru masuk"}</strong><small>Segera periksa batas terima pesanan.</small></div><button type="button" data-open-order="${escape(notice.orderId)}">Lihat</button><button type="button" data-action="dismiss-alert" aria-label="Hentikan peringatan">×</button></aside>`
      : "";
    return incoming + (readyNotice ? `<aside class="driver-incoming-alert is-ready" role="alert"><div><strong>Pesanan ${escape(readyNotice.number)} siap dijemput</strong><small>Dapur sudah selesai menyiapkan pesananmu.</small></div><button type="button" data-open-order="${escape(readyNotice.orderId)}">Lihat</button><button type="button" data-action="dismiss-ready-alert" aria-label="Tutup pemberitahuan pesanan selesai">×</button></aside>` : "");
  }
  configure(preferences);
  function deviceCredentials() {
    const value = read(DEVICE_KEY, {});
    return value.id && value.secret
      ? { id: value.id, secret: value.secret }
      : null;
  }
  function invalidateSession() {
    localStorage.removeItem(DEVICE_KEY);
    registered = false;
    message = "Sesi driver berakhir. Verifikasi PIN kembali di pengaturan.";
  }
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
    testReady,
    dismissReady,
    authorize,
    logout,
    syncNative,
    deviceCredentials,
    invalidateSession,
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
