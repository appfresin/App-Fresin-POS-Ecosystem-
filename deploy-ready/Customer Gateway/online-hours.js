(function () {
  "use strict";
  const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

  function normalize(value) {
    const config = value && typeof value === "object" ? value : {};
    return {
      enabled: config.enabled === true,
      timeZone: "Asia/Jakarta",
      days: days.map((_, index) => {
        const day = config.days?.[index] || {};
        return {
          enabled: day.enabled !== false,
          open: timePattern.test(day.open) ? day.open : "09:00",
          close: timePattern.test(day.close) ? day.close : "22:00"
        };
      })
    };
  }

  function status(value, now = new Date()) {
    const config = normalize(value);
    if (!config.enabled) return { open: true };
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: config.timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(now);
    const part = type => parts.find(item => item.type === type)?.value;
    const index = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(part("weekday"));
    const current = Number(part("hour")) * 60 + Number(part("minute"));
    const today = config.days[index], yesterday = config.days[(index + 6) % 7];
    const start = minutes(today.open), end = minutes(today.close);
    const regularOpen = today.enabled && start !== end
      && (start < end ? current >= start && current < end : current >= start);
    const previousOpen = yesterday.enabled && minutes(yesterday.open) > minutes(yesterday.close)
      && current < minutes(yesterday.close);
    if (regularOpen || previousOpen) return { open: true };
    const schedule = today.enabled
      ? `${days[index]} ${today.open}–${today.close} WIB${start > end ? " (hingga hari berikutnya)" : ""}`
      : `${days[index]}: tutup`;
    let next = "Silakan kembali pada hari operasional berikutnya, ya.";
    for (let offset = 0; offset <= 7; offset++) {
      const candidate = config.days[(index + offset) % 7];
      if (!candidate.enabled || candidate.open === candidate.close || (offset === 0 && current >= minutes(candidate.open))) continue;
      const when = offset === 0 ? "hari ini" : offset === 1 ? "besok" : `hari ${days[(index + offset) % 7]}`;
      next = `Silakan kembali ${when} pukul ${candidate.open} WIB, ya.`;
      break;
    }
    return { open: false, schedule, next };
  }

  function allow() {
    const result = status(state.settings?.selfOrderOperatingHours);
    if (result.open) return true;
    toast(`Pemesanan online sedang tutup\nMohon maaf, pemesanan sedang di luar jam operasional toko.\nJam operasional ${result.schedule}\n${result.next}`, 8500);
    if (typeof ensureToastElement === "function") ensureToastElement().classList.add("online-hours-toast");
    return false;
  }

  async function check() {
    if (typeof loadStoreSettingsFromSupabase === "function") {
      await loadStoreSettingsFromSupabase({ reason: "online-hours", silent: true });
    }
    return allow();
  }

  function renderSettings(value) {
    const config = normalize(value);
    return `<section class="online-hours-settings" aria-labelledby="onlineHoursHeading">
      <header><span class="online-hours-clock" aria-hidden="true">◷</span><div><h4 id="onlineHoursHeading">Jam pemesanan online</h4><p>Berlaku untuk SO takeaway, ambil di outlet, dan delivery. Zona waktu WIB.</p></div></header>
      <label class="online-hours-enable"><input type="checkbox" name="onlineHoursEnabled" ${config.enabled ? "checked" : ""}> Batasi pemesanan sesuai jadwal</label>
      <div class="online-hours-table-head"><span>Hari</span><span>Buka</span><span>Tutup</span></div>
      ${[1, 2, 3, 4, 5, 6, 0].map(index => `<div class="online-hours-day">
        <label><input type="checkbox" name="onlineHoursDay_${index}" ${config.days[index].enabled ? "checked" : ""}>${days[index]}</label>
        <input type="time" name="onlineHoursOpen_${index}" value="${config.days[index].open}" aria-label="Jam buka ${days[index]}">
        <input type="time" name="onlineHoursClose_${index}" value="${config.days[index].close}" aria-label="Jam tutup ${days[index]}">
      </div>`).join("")}
      <small>Hilangkan centang hari untuk libur. Jam tutup sebelum jam buka berarti tutup pada hari berikutnya. Simpan dengan tombol Simpan Setting.</small>
    </section>`;
  }

  function readForm(form) {
    const enabled = form.get("onlineHoursEnabled") === "on";
    const entries = days.map((name, index) => {
      const day = { enabled: form.get(`onlineHoursDay_${index}`) === "on", open: form.get(`onlineHoursOpen_${index}`), close: form.get(`onlineHoursClose_${index}`) };
      if (enabled && day.enabled && (!timePattern.test(day.open) || !timePattern.test(day.close) || day.open === day.close)) {
        throw new Error(`Periksa jam buka dan tutup hari ${name}. Keduanya harus berbeda.`);
      }
      return day;
    });
    return normalize({ enabled, days: entries });
  }

  window.FresinOnlineHours = { normalize, status, allow, check, renderSettings, readForm };
}());
