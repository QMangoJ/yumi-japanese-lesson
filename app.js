/* YUMI Japanese Lessons — booking flow + My Bookings
 *
 * Booking pane modeled on sakurajapaneselesson.com: one pane with a month
 * calendar (01 Choose a date), a start-time dropdown (02 Choose a start
 * time), a duration dropdown (30 / 50 / 120 min — the only choice besides
 * the course), and a live summary + checkout total that update as you pick.
 */
"use strict";

const $ = (sel) => document.querySelector(sel);

const state = {
  config: null,
  courseId: null,
  durationId: null,
  date: null,
  time: null,
  booking: null,
};

/* ---------- date / time helpers (all JST, dates as "YYYY-MM-DD") ---------- */

function jstToday() {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}
function addDays(ds, n) {
  const [y, m, d] = ds.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function weekdayOf(ds) {
  const [y, m, d] = ds.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function dateLong(ds) {
  const [y, m, d] = ds.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US",
    { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}
function toMin(time) {
  const [h, m] = String(time).split(":").map(Number);
  return h * 60 + (m || 0);
}
function minToHHMM(min) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
function minTo12(min) {
  let h = Math.floor(min / 60);
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(min % 60).padStart(2, "0")} ${ap}`;
}
function rangeText(startMin, minutes) {
  return `${minTo12(startMin)}–${minTo12(startMin + minutes)}`;
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function setMsg(id, text, ok) {
  const el = $(id);
  if (!el) return;
  el.textContent = text || "";
  el.className = "msg" + (text ? (ok ? " msg-ok" : " msg-err") : "");
}

function showPane(n) {
  document.querySelectorAll(".bk-pane").forEach((p) =>
    p.classList.toggle("hidden", p.dataset.pane !== String(n)));
  document.querySelectorAll("#bk-steps li").forEach((li) => {
    const s = Number(li.dataset.step);
    li.classList.toggle("active", s === n);
    li.classList.toggle("done", s < n);
  });
  $("#book").scrollIntoView({ behavior: "smooth", block: "start" });
}

function courseName(id) {
  return state.config?.courses.find((c) => c.id === id)?.name || id;
}
function durationOf(id) {
  return state.config?.durations.find((d) => d.id === id) || null;
}
function legacyName(id) {
  return state.config?.legacyLessonTypes.find((t) => t.id === id)?.name || id;
}
function minutesOfBooking(b) {
  if (b.durationMinutes) return b.durationMinutes;
  const legacy = state.config?.legacyLessonTypes.find((t) => t.id === b.lessonTypeId);
  return legacy ? legacy.minutes : 60;
}
function money(n) {
  return `$${n}`;
}

/* ---------- Date + start-time picker (Sakura-style) ----------
 * Builds a month calendar element and an "Available times" dropdown element;
 * the caller places them. onPick(date, time) fires whenever either changes.
 */
function createPicker({ getMinutes, onPick }) {
  const todayStr = jstToday();
  let view = { y: Number(todayStr.slice(0, 4)), m: Number(todayStr.slice(5, 7)) };
  let date = null;
  let time = null;
  let loadToken = 0;

  const calEl = document.createElement("div");
  calEl.className = "cal";
  const timesEl = document.createElement("div");
  timesEl.innerHTML = `
    <label class="field">Available times
      <select disabled><option>Choose a date first</option></select></label>
    <p class="note picker-note"></p>`;
  const select = timesEl.querySelector("select");
  const note = timesEl.querySelector(".picker-note");

  const minDate = () => addDays(jstToday(), 3); // 72-hour rule, at date level
  const maxMonth = () => {
    const t = jstToday();
    const idx = Number(t.slice(0, 4)) * 12 + Number(t.slice(5, 7)) - 1 + 3;
    return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
  };

  function renderCal() {
    const { y, m } = view;
    const title = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US",
      { month: "long", year: "numeric", timeZone: "UTC" });
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const today = jstToday();
    const min = minDate();
    const max = maxMonth();
    const prevOff = y * 12 + m <= Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7));
    const nextOff = y * 12 + m >= max.y * 12 + max.m;
    let cells = "";
    for (let i = 0; i < first; i++) cells += "<span></span>";
    for (let d = 1; d <= days; d++) {
      const ds = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const off = ds < min || !state.config.openDays.includes(weekdayOf(ds));
      cells += `<button type="button" class="cal-day${ds === date ? " selected" : ""}${ds === today ? " today" : ""}"
        data-date="${ds}" ${off ? "disabled" : ""} aria-label="${dateLong(ds)}">${d}</button>`;
    }
    calEl.innerHTML = `
      <div class="cal-head">
        <button type="button" class="cal-nav" data-nav="-1" ${prevOff ? "disabled" : ""} aria-label="Previous month">‹</button>
        <span class="cal-title">${title}</span>
        <button type="button" class="cal-nav" data-nav="1" ${nextOff ? "disabled" : ""} aria-label="Next month">›</button>
      </div>
      <div class="cal-grid cal-week"><span>SUN</span><span>MON</span><span>TUE</span><span>WED</span><span>THU</span><span>FRI</span><span>SAT</span></div>
      <div class="cal-grid">${cells}</div>`;
    calEl.querySelectorAll(".cal-nav").forEach((b) => {
      b.onclick = () => {
        const idx = view.y * 12 + (view.m - 1) + Number(b.dataset.nav);
        view = { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
        renderCal();
      };
    });
    calEl.querySelectorAll(".cal-day").forEach((b) => {
      b.onclick = () => pickDate(b.dataset.date);
    });
  }

  async function loadTimes() {
    const token = ++loadToken;
    time = null;
    onPick(date, time);
    select.innerHTML = "<option>Checking availability…</option>";
    select.disabled = true;
    note.textContent = "Checking availability…";
    try {
      const data = await api(`/api/availability?date=${date}&duration=${getMinutes()}`);
      if (token !== loadToken) return;
      if (data.closed) {
        select.innerHTML = "<option>Closed on this day</option>";
        note.textContent = "Closed on this day — I teach Tuesday to Saturday.";
        return;
      }
      const open = data.slots.filter((s) => s.available);
      if (!open.length) {
        select.innerHTML = "<option>No times available</option>";
        note.textContent = "No times are available on this date.";
        return;
      }
      const minutes = getMinutes();
      select.innerHTML = open.map((s) =>
        `<option value="${s.time}">${rangeText(toMin(s.time), minutes)} · JST ${s.time}</option>`).join("");
      select.disabled = false;
      time = open[0].time; // Sakura pre-selects the first available start time
      select.value = time;
      note.textContent = `${open.length} start time${open.length === 1 ? "" : "s"} available`;
      onPick(date, time);
    } catch (e) {
      if (token !== loadToken) return;
      select.innerHTML = "<option>Could not load times</option>";
      note.textContent = e.message;
    }
  }

  function pickDate(ds) {
    date = ds;
    renderCal();
    loadTimes();
  }

  select.addEventListener("change", () => {
    time = select.value || null;
    onPick(date, time);
  });

  renderCal();
  return {
    calEl, timesEl,
    setMinutes() { if (date) loadTimes(); },
    get date() { return date; },
    get time() { return time; },
  };
}

/* ---------- Summary ---------- */

function summaryRows(b) {
  const minutes = minutesOfBooking(b);
  const rows = [["Course", courseName(b.courseId)]];
  if (b.lessonTypeId && !b.durationId) rows.push(["Lesson type", legacyName(b.lessonTypeId)]);
  rows.push(
    ["Duration", `${minutes} min`],
    ["Date", `${b.date} (JST)`],
    ["Time", `${rangeText(toMin(b.time), minutes)} JST (${b.time}–${minToHHMM(toMin(b.time) + minutes)})`],
    ["Name", b.name],
    ["Email", b.email],
    ["Total", money(b.amount)],
  );
  if (b.id) rows.unshift(["Booking reference", b.id]);
  if (b.status) rows.push(["Status", b.status.replace("_", " ")]);
  if (b.meetLink) rows.push(["Google Meet", `<a href="${b.meetLink}" target="_blank" rel="noopener">${b.meetLink}</a>`]);
  return rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("");
}

/* ---------- Wire up ---------- */

document.addEventListener("DOMContentLoaded", async () => {
  try {
    state.config = await api("/api/config");
  } catch {
    setMsg("#bk-msg-1", "Could not load booking options. Please refresh the page.", false);
    return;
  }

  /* Step 1: course + duration + picker */
  const picker = createPicker({
    getMinutes: () => durationOf(state.durationId)?.minutes || 50,
    onPick: (date, time) => {
      state.date = date;
      state.time = time;
      refreshSummary();
    },
  });
  $("#bk-cal").appendChild(picker.calEl);
  $("#bk-times").appendChild(picker.timesEl);

  function renderCourses() {
    const cg = $("#bk-courses");
    cg.innerHTML = "";
    for (const c of state.config.courses) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "choice" + (state.courseId === c.id ? " selected" : "");
      b.textContent = c.name;
      b.onclick = () => { state.courseId = c.id; renderCourses(); refreshSummary(); };
      cg.appendChild(b);
    }
  }

  function renderDurations() {
    const sel = $("#bk-duration");
    sel.innerHTML = state.config.durations.map((d) =>
      `<option value="${d.id}"${d.id === state.durationId ? " selected" : ""}>${d.minutes} min lesson</option>`).join("");
  }

  function refreshSummary() {
    const dur = durationOf(state.durationId);
    const sel = $("#bk-selected");
    if (state.date && state.time && dur) {
      sel.textContent = `Selected: ${dateLong(state.date)}, ${rangeText(toMin(state.time), dur.minutes)} (Asia/Tokyo) · ${state.date} ${state.time} JST`;
    } else {
      sel.textContent = "Selected: choose a date and a time";
    }
    $("#bk-total").innerHTML = dur ? `
      <div class="bk-total-row"><span>${state.courseId ? courseName(state.courseId) : "Course — pick one above"}</span></div>
      <div class="bk-total-row"><span>${dur.minutes} min lesson</span><span>${money(dur.price)}</span></div>
      <div class="bk-total-row bk-total-sum"><span>Total</span><span>${money(dur.price)}</span></div>
      <p class="note">Lessons are online: your Google Meet link is sent after booking and payment.</p>` : "";
    $("#bk-to-2").disabled = !(state.courseId && state.date && state.time);
  }

  state.durationId = state.config.durations.find((d) => d.minutes === 50)?.id || state.config.durations[0].id;
  renderCourses();
  renderDurations();
  refreshSummary();

  $("#bk-duration").addEventListener("change", (e) => {
    state.durationId = e.target.value;
    picker.setMinutes();
    refreshSummary();
  });

  document.querySelectorAll(".book-course").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.courseId = btn.dataset.course;
      renderCourses();
      refreshSummary();
      showPane(1);
    });
  });

  document.querySelectorAll("[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => showPane(Number(btn.dataset.back)));
  });

  $("#bk-to-2").onclick = () => {
    if (!state.courseId) return setMsg("#bk-msg-1", "Please choose a course.", false);
    if (!state.date || !state.time) return setMsg("#bk-msg-1", "Please pick a date and a time.", false);
    setMsg("#bk-msg-1", "");
    showPane(2);
  };

  /* Step 2: details -> create booking */
  $("#bk-to-3").onclick = async () => {
    const name = $("#bk-name").value.trim();
    const email = $("#bk-email").value.trim();
    const notes = $("#bk-notes").value.trim();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return setMsg("#bk-msg-2", "Please enter your name and a valid email.", false);
    }
    setMsg("#bk-msg-2", "Creating your booking…", true);
    try {
      const { booking } = await api("/api/bookings", {
        method: "POST",
        body: JSON.stringify({
          courseId: state.courseId, durationId: state.durationId,
          date: state.date, time: state.time, name, email, notes,
        }),
      });
      state.booking = booking;
      $("#bk-summary").innerHTML = summaryRows(booking);
      $("#bk-pay").textContent = `Pay ${money(booking.amount)}`;
      setMsg("#bk-msg-2", "");
      showPane(3);
    } catch (e) {
      setMsg("#bk-msg-2", e.message, false);
    }
  };

  /* Step 3: mock payment */
  $("#bk-pay").onclick = async () => {
    if (!state.booking) return;
    setMsg("#bk-msg-3", "Processing (mock)…", true);
    try {
      const { booking } = await api(`/api/bookings/${state.booking.id}/pay`, {
        method: "POST", body: "{}",
      });
      state.booking = booking;
      $("#bk-done").innerHTML = summaryRows(booking);
      showPane(4);
    } catch (e) {
      setMsg("#bk-msg-3", e.message, false);
    }
  };

  /* ---------- My Bookings ---------- */

  $("#my-find").onclick = async () => {
    const email = $("#my-email").value.trim();
    const ref = $("#my-ref").value.trim().toUpperCase();
    const box = $("#my-result");
    box.innerHTML = "";
    if (!email || !ref) return setMsg("#my-msg", "Enter your email and booking reference.", false);
    try {
      const { booking } = await api(
        `/api/bookings/${encodeURIComponent(ref)}?email=${encodeURIComponent(email)}`);
      setMsg("#my-msg", "");
      renderMyBooking(booking, email);
    } catch (e) {
      setMsg("#my-msg", e.message, false);
    }
  };

  function renderMyBooking(b, email) {
    const box = $("#my-result");
    const canManage = b.status === "paid" || b.status === "pending_payment";
    box.innerHTML = `
      <table class="summary">${summaryRows(b)}</table>
      ${b.status === "paid" ? `<p class="note">Reschedules used: ${b.reschedules} / 2</p>` : ""}
      <p class="msg" id="my-action-msg"></p>
      ${canManage ? `
      <div class="my-actions">
        <button class="btn btn-ghost" id="my-cancel">Cancel this booking</button>
        ${b.status === "paid" ? `<button class="btn btn-ghost" id="my-resched">Reschedule</button>` : ""}
      </div>
      <div id="my-resched-box" class="hidden">
        <h4 class="bk-sub">Pick a new date &amp; time (${minutesOfBooking(b)} min lesson)</h4>
        <div id="my-picker"></div>
        <button class="btn" id="my-resched-go" disabled>Confirm new time</button>
      </div>` : ""}`;

    if (!canManage) return;

    $("#my-cancel").onclick = async () => {
      if (!confirm("Cancel this booking? The policy in the FAQ applies.")) return;
      try {
        const data = await api(`/api/bookings/${b.id}/cancel`, {
          method: "POST", body: JSON.stringify({ email }),
        });
        renderMyBooking(data.booking, email);
        setMsg("#my-action-msg",
          `Booking cancelled. Refund: ${data.booking.refund}.`, true);
      } catch (e) { setMsg("#my-action-msg", e.message, false); }
    };

    const reschedBtn = $("#my-resched");
    if (reschedBtn) {
      let newDate = null, newTime = null, picker = null;
      reschedBtn.onclick = () => {
        $("#my-resched-box").classList.toggle("hidden");
        if (!picker) {
          picker = createPicker({
            getMinutes: () => minutesOfBooking(b),
            onPick: (date, time) => {
              newDate = date; newTime = time;
              $("#my-resched-go").disabled = !(newDate && newTime);
            },
          });
          const mount = $("#my-picker");
          mount.appendChild(picker.calEl);
          mount.appendChild(picker.timesEl);
        }
      };
      $("#my-resched-go").onclick = async () => {
        try {
          const { booking } = await api(`/api/bookings/${b.id}/reschedule`, {
            method: "POST",
            body: JSON.stringify({ email, date: newDate, time: newTime }),
          });
          renderMyBooking(booking, email);
          setMsg("#my-action-msg", "Rescheduled. See you then!", true);
        } catch (e) { setMsg("#my-action-msg", e.message, false); }
      };
    }
  }
});
