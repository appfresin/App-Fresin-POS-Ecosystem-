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
    let nextLabel = "Silahkan kembali pada hari operasional berikutnya";
    let nextTime = "";
    for (let offset = 0; offset <= 7; offset++) {
      const candidate = config.days[(index + offset) % 7];
      if (!candidate.enabled || candidate.open === candidate.close || (offset === 0 && current >= minutes(candidate.open))) continue;
      // Before 05.01, retain the outlet's requested late-night wording.
      const when = offset === 0 ? (current <= 300 ? "besok" : "nanti")
        : offset === 1 ? "besok" : `hari ${days[(index + offset) % 7]}`;
      nextLabel = `Silahkan kembali ${when}`;
      nextTime = `jam ${candidate.open.replace(":", ".")} WIB`;
      break;
    }
    return { open: false, schedule, nextLabel, nextTime, next: [nextLabel, nextTime].filter(Boolean).join(" ") };
  }

  function showNotice(result) {
    let dialog = document.getElementById("onlineHoursNotice");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "onlineHoursNotice";
      dialog.className = "online-hours-notice";
      dialog.setAttribute("aria-labelledby", "onlineHoursNoticeTitle");
      dialog.setAttribute("aria-describedby", "onlineHoursNoticeDescription onlineHoursNoticeSchedule onlineHoursNoticeNext onlineHoursNoticeThanks");
      dialog.innerHTML = `
        <div class="online-hours-art" aria-hidden="true">
          <span class="online-hours-orbit"></span>
          <span class="online-hours-spark online-hours-spark-one">✦</span>
          <span class="online-hours-spark online-hours-spark-two">✧</span>
          <span class="online-hours-emblem">
            <svg viewBox="0 0 80 80" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round">
              <path d="M53 12a12 12 0 0 0 15 15 12 12 0 1 1-15-15Z" fill="#ffdc98" stroke="#bf8b36"/>
              <path d="M14 38h44v28H14z" fill="#fffaf1"/>
              <path d="m12 38 6-15h34l8 15" fill="#abccef"/>
              <path d="M12 38c0 9 12 9 12 0 0 9 12 9 12 0 0 9 12 9 12 0 0 9 12 9 12 0M24 24l-1 14m12-14v14m10-14 3 14"/>
              <path d="M21 66V51h12v15m8-15h10v8H41zM10 67h52"/>
              <path d="M68 42v6m-3-3h6" stroke="#bf8b36"/>
            </svg>
          </span>
        </div>
        <form method="dialog" class="online-hours-dismiss"><button type="submit" aria-label="Tutup pemberitahuan jam operasional">×</button></form>
        <div class="online-hours-copy">
          <h2 id="onlineHoursNoticeTitle" tabindex="-1" autofocus>Mohon maaf,</h2>
          <p id="onlineHoursNoticeDescription">saat ini di luar jam operasional outlet.</p>
          <div class="online-hours-schedule-chip">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
            <span><span class="online-hours-chip-label">Jam operasional hari ini</span><strong id="onlineHoursNoticeSchedule"></strong></span>
          </div>
          <p id="onlineHoursNoticeNext" class="online-hours-next"><span></span><strong></strong></p>
          <p id="onlineHoursNoticeThanks" class="online-hours-thanks"><svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-9-5.4-9-12a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6.6-9 12-9 12Z"/></svg><span>Terima kasih, teman Fresin!<small>Kami tunggu di jam buka, ya.</small></span></p>
        </div>`;
      document.body.appendChild(dialog);
    }
    dialog.querySelector("#onlineHoursNoticeSchedule").textContent = result.schedule.replaceAll(":", ".");
    dialog.querySelector(".online-hours-next span").textContent = result.nextLabel;
    dialog.querySelector(".online-hours-next strong").textContent = result.nextTime;
    if (!dialog.open) dialog.showModal();
  }

  function allow() {
    const result = status(state.settings?.selfOrderOperatingHours);
    if (result.open) {
      const dialog = document.getElementById("onlineHoursNotice");
      if (dialog?.open) dialog.close();
      return true;
    }
    showNotice(result);
    return false;
  }

  async function check() {
    if (typeof loadStoreSettingsFromSupabase === "function") {
      await loadStoreSettingsFromSupabase({ reason: "online-hours", silent: true, force: true });
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
