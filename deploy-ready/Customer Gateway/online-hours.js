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

  function status(value, now = new Date(), service = "online") {
    const config = normalize(value);
    if (!config.enabled) return { open: true };
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: config.timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(now);
    const part = type => parts.find(item => item.type === type)?.value;
    const index = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(part("weekday"));
    const current = Number(part("hour")) * 60 + Number(part("minute"));
    const today = config.days[index];
    const start = minutes(today.open), end = minutes(today.close);
    const dineIn = service === "dinein";
    const windows = [];
    // Include yesterday's closing grace and tomorrow's pre-opening grace.
    // Minutes relative to today also cover overnight operating windows.
    for (let offset = -1; offset <= 7; offset++) {
      const day = config.days[(index + offset + 7) % 7];
      if (!day.enabled || day.open === day.close) continue;
      const open = minutes(day.open), close = minutes(day.close);
      windows.push({
        start: offset * 1440 + open - (dineIn ? 10 : 0),
        end: offset * 1440 + close + (open > close ? 1440 : 0) + (dineIn ? 30 : 0)
      });
    }
    if (windows.some(window => current >= window.start && current < window.end)) return { open: true };
    const schedule = today.enabled
      ? `${days[index]} ${today.open}–${today.close} WIB${start > end ? " (hingga hari berikutnya)" : ""}`
      : `${days[index]}: tutup`;
    let nextLabel = "Silahkan kembali pada hari operasional berikutnya";
    let nextTime = "";
    const nextWindow = windows.find(window => window.start > current);
    if (nextWindow) {
      const offset = Math.floor(nextWindow.start / 1440);
      // Before 05.01, retain the outlet's requested late-night wording.
      const when = offset === 0 ? (current <= 300 ? "besok" : "nanti")
        : offset === 1 ? "besok" : `hari ${days[(index + offset) % 7]}`;
      nextLabel = `Silahkan kembali ${when}`;
      const opening = nextWindow.start % 1440;
      nextTime = `jam ${String(Math.floor(opening / 60)).padStart(2, "0")}.${String(opening % 60).padStart(2, "0")} WIB`;
    }
    return { open: false, service, schedule, nextLabel, nextTime, next: [nextLabel, nextTime].filter(Boolean).join(" ") };
  }

  function showNotice(result) {
    let dialog = document.getElementById("onlineHoursNotice");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "onlineHoursNotice";
      dialog.className = "online-hours-notice";
      dialog.setAttribute("aria-labelledby", "onlineHoursNoticeTitle");
      dialog.setAttribute("aria-describedby", "onlineHoursNoticeDescription onlineHoursNoticeSchedule onlineHoursNoticeNext onlineHoursNoticeClosing");
      dialog.innerHTML = `
        <form method="dialog" class="online-hours-dismiss">
          <button type="submit" aria-label="Tutup pemberitahuan jam operasional">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
          </button>
        </form>
        <div class="online-hours-copy">
          <span class="online-hours-emblem" aria-hidden="true">
            <svg viewBox="0 0 36 36">
              <path d="M5 15 8 7h17l3 8M5 15c0 3 4 4 6 1 2 3 5 3 7 0 2 3 6 3 8 0M7 18v11h12M12 29v-7h4v7"/>
              <circle cx="27" cy="26" r="7"/>
              <path d="M27 22.5v4l2.5 1.5"/>
            </svg>
          </span>
          <h2 id="onlineHoursNoticeTitle" tabindex="-1" autofocus>Outlet sedang tutup</h2>
          <p id="onlineHoursNoticeDescription"></p>
          <div class="online-hours-details">
            <div class="online-hours-schedule-chip">
              <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4m8-4v4M4 10h16"/></svg>
              <span><span class="online-hours-chip-label">Jam operasional hari ini</span><strong id="onlineHoursNoticeSchedule"></strong></span>
            </div>
            <div id="onlineHoursNoticeNext" class="online-hours-next">
              <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 1.5"/></svg>
              <div><span></span><strong></strong></div>
            </div>
          </div>
          <p id="onlineHoursNoticeClosing" class="online-hours-closing"></p>
        </div>`;
      document.body.appendChild(dialog);
    }
    dialog.querySelector("#onlineHoursNoticeDescription").textContent = result.service === "dinein"
      ? "Pemesanan makan di sini belum tersedia."
      : "Pemesanan online mengikuti jam operasional outlet.";
    dialog.querySelector("#onlineHoursNoticeSchedule").textContent = result.schedule.replaceAll(":", ".");
    dialog.querySelector(".online-hours-next span").textContent = result.nextTime ? "Buka kembali" : "Jadwal buka berikutnya";
    dialog.querySelector(".online-hours-next strong").textContent = result.nextTime || "Belum tersedia";
    const invitation = result.nextLabel.replace(/^Silahkan kembali/, "Mohon kembali");
    dialog.querySelector("#onlineHoursNoticeClosing").textContent = `${invitation}. Terima kasih!`;
    if (!dialog.open) dialog.showModal();
  }

  function allow(service = "online") {
    const result = status(state.settings?.selfOrderOperatingHours, new Date(), service);
    if (result.open) {
      const dialog = document.getElementById("onlineHoursNotice");
      if (dialog?.open) dialog.close();
      return true;
    }
    showNotice(result);
    return false;
  }

  async function check(service = "online") {
    if (typeof loadStoreSettingsFromSupabase === "function") {
      await loadStoreSettingsFromSupabase({ reason: "online-hours", silent: true, force: true });
    }
    return allow(service);
  }

  function renderSettings(value) {
    const config = normalize(value);
    return `<section class="online-hours-settings" aria-labelledby="onlineHoursHeading">
      <header><span class="online-hours-clock" aria-hidden="true">◷</span><div><h4 id="onlineHoursHeading">Jam pemesanan online</h4><p>Jadwal outlet dalam WIB. Take away, pickup, dan delivery mengikuti jam ini.</p></div></header>
      <label class="online-hours-enable"><input type="checkbox" name="onlineHoursEnabled" ${config.enabled ? "checked" : ""}> Batasi pemesanan sesuai jadwal</label>
      <div class="online-hours-table-head"><span>Hari</span><span>Buka</span><span>Tutup</span></div>
      ${[1, 2, 3, 4, 5, 6, 0].map(index => `<div class="online-hours-day">
        <label><input type="checkbox" name="onlineHoursDay_${index}" ${config.days[index].enabled ? "checked" : ""}>${days[index]}</label>
        <input type="time" name="onlineHoursOpen_${index}" value="${config.days[index].open}" aria-label="Jam buka ${days[index]}">
        <input type="time" name="onlineHoursClose_${index}" value="${config.days[index].close}" aria-label="Jam tutup ${days[index]}">
      </div>`).join("")}
      <small>Makan di sini tersedia 10 menit sebelum buka sampai 30 menit setelah tutup. Hilangkan centang hari untuk libur. Jam tutup sebelum jam buka berarti tutup pada hari berikutnya. Simpan dengan tombol Simpan Setting.</small>
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
