/* YUMI Japanese Lessons — booking flow + My Bookings
 *
 * Booking pane modeled on sakurajapaneselesson.com: one pane with a month
 * calendar (01 Choose a date), a start-time dropdown (02 Choose a start
 * time), a duration dropdown (30 / 50 / 80 / 120 min — the only choice besides
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
  mode: "single",   // "single" | "package" (课时包)
  pkgOrder: null,   // pending package record while checking out
  pkgBuyer: null,   // {name, email} from pane 2 for a package purchase
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

/* ---------- visitor-local display ----------
 * Bookings are anchored to JST (that is what gets stored and what the
 * calendar shows). For display we convert the JST instant into the
 * visitor's own timezone via Intl, so an 08:00 JST Monday lesson shows
 * as its true local equivalent — e.g. Sunday evening in the Americas. */
const localTZName = Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";
function jstInstantMs(dateStr, timeStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - 9 * 3600_000 + toMin(timeStr) * 60000;
}
function fmtLocalTime(ms) {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function fmtLocalDate(ms, long) {
  return new Date(ms).toLocaleDateString("en-US", long
    ? { weekday: "long", month: "long", day: "numeric", year: "numeric" }
    : { weekday: "short", month: "short", day: "numeric" });
}
function tzAbbr(ms) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
    .formatToParts(new Date(ms));
  return parts.find((p) => p.type === "timeZoneName")?.value || localTZName;
}
/** {start, end, text} for a lesson in the visitor's timezone. */
function localRange(dateStr, timeStr, minutes) {
  const start = jstInstantMs(dateStr, timeStr);
  const end = start + minutes * 60000;
  return { start, end, text: `${fmtLocalTime(start)}–${fmtLocalTime(end)}` };
}
/** JST "YYYY-MM-DD" of a local instant (to detect date shifts). */
function jstDateOfMs(ms) {
  return new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
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

let flowDone = false; // true once pane 4 (Done) has been shown

function showPane(n) {
  flowDone = n === 4;
  document.querySelectorAll(".bk-pane").forEach((p) =>
    p.classList.toggle("hidden", p.dataset.pane !== String(n)));
  document.querySelectorAll("#bk-steps li").forEach((li) => {
    const s = Number(li.dataset.step);
    li.classList.toggle("active", s === n);
    li.classList.toggle("done", s < n);
  });
}

/* ---------- Booking modal (Sakura-style pop-up) ----------
 * Selections (course / duration / date / time) live in `state` and in the
 * picker, so they survive a close + reopen within the same page visit.
 * Only a completed booking resets: the next open starts fresh at pane 1.
 */
function openBooking() {
  if ((state.booking || state.pkgOrder) && flowDone) {
    state.booking = null;
    state.pkgOrder = null;
    const extra = document.querySelector("#bk-done-extra");
    if (extra) extra.innerHTML = "";
    showPane(1);
  }
  applyAuthToForm();
  $("#book-modal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeBooking() {
  $("#book-modal").classList.add("hidden");
  document.body.style.overflow = "";
}

/* ---------- student account (drives My Bookings) ---------- */
let authUser = null; // {name, email, isAdmin} once /api/auth/me resolves

/** Prefill + lock the booking form's identity fields while logged in. */
function applyAuthToForm() {
  const nameEl = document.getElementById("bk-name");
  const emailEl = document.getElementById("bk-email");
  if (!nameEl || !emailEl) return;
  if (authUser) {
    nameEl.value = authUser.name;
    emailEl.value = authUser.email;
    emailEl.readOnly = true;
  } else {
    emailEl.readOnly = false;
  }
}

function escHtml(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

function courseName(id) {
  return state.config?.courses.find((c) => c.id === id)?.name || id;
}
function durationOf(id) {
  return state.config?.durations.find((d) => d.id === id) || null;
}
/* Homepage price table: rendered from the same /api/config the
 * booking modal uses, so admin-edited prices show up everywhere
 * with no hardcoded numbers in the HTML. */
function renderPrices() {
  const tb = $("#price-rows");
  if (!tb || !state.config) return;
  const ds = state.config.durations;
  tb.innerHTML = ds.map((d, i) => `
    <tr><td>${d.minutes} min</td><td>$${d.price}</td>${i === 0 ? `
      <td rowspan="${ds.length}">
        <strong>5 lessons</strong> — <em>10% OFF</em> the total<br />
        <strong>10 lessons</strong> — <em>10% OFF</em> the total<br />
        <small>Package students can freely adjust each lesson's
        duration from 30 minutes up to 2 hours.</small>
      </td>` : ""}</tr>`).join("");
  const note = $("#price-note-durations");
  if (note && ds.length) {
    const mins = ds.map((d) => d.minutes);
    note.textContent = mins.length > 1
      ? `${mins.slice(0, -1).join(", ")} or ${mins[mins.length - 1]} minutes`
      : `${mins[0]} minutes`;
  }
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

/* Page-session cache of /api/availability/month responses, keyed
 * "YYYY-MM|<minutes>" -> Promise<Map<date, dayInfo>>. Shared by every
 * picker on the page (booking + reschedule), so a month is fetched at
 * most once per duration per page visit. */
const monthAvailCache = new Map();
function fetchMonthAvail(month, minutes) {
  const key = `${month}|${minutes}`;
  if (!monthAvailCache.has(key)) {
    monthAvailCache.set(key, api(`/api/availability/month?month=${month}&duration=${minutes}`)
      .then((data) => new Map(data.days.map((d) => [d.date, d])))
      .catch((e) => { monthAvailCache.delete(key); throw e; }));
  }
  return monthAvailCache.get(key);
}

/* ---------- Date + start-time picker (Sakura-style) ----------
 * Builds a month calendar element and an "Available times" dropdown element;
 * the caller places them. onPick(date, time) fires whenever either changes.
 * Day enable/disable comes from the server's month map (full settings
 * resolution: one-off opened/closed days and real bookings included);
 * while that fetch is in flight the weekly template renders as fallback.
 */
function createPicker({ getMinutes, onPick }) {
  const todayStr = jstToday();
  let view = { y: Number(todayStr.slice(0, 4)), m: Number(todayStr.slice(5, 7)) };
  let date = null;
  let time = null;
  let loadToken = 0;
  let monthMap = null; // Map<date, {closed, hasAvailableSlot}> for view+duration
  let monthToken = 0;

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
      const entry = monthMap && monthMap.get(ds);
      const off = ds < min || (entry
        ? entry.closed || !entry.hasAvailableSlot
        : !state.config.openDays.includes(weekdayOf(ds)));
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
        loadMonth();
      };
    });
    calEl.querySelectorAll(".cal-day").forEach((b) => {
      b.onclick = () => pickDate(b.dataset.date);
    });
  }

  /* Fetch the viewed month's real availability (per duration) and
   * re-render with it. Until it lands, renderCal uses the weekly
   * template as the instant fallback. */
  async function loadMonth() {
    const token = ++monthToken;
    const month = `${view.y}-${String(view.m).padStart(2, "0")}`;
    monthMap = null;
    try {
      const map = await fetchMonthAvail(month, getMinutes());
      if (token !== monthToken) return;
      monthMap = map;
      renderCal();
    } catch { /* keep the weekly-template rendering */ }
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
        note.textContent = data.blocked
          ? "Not available on this date — please pick another day."
          : "Closed on this day.";
        return;
      }
      const open = data.slots.filter((s) => s.available);
      if (!open.length) {
        select.innerHTML = "<option>No times available</option>";
        note.textContent = "No times are available on this date.";
        return;
      }
      const minutes = getMinutes();
      select.innerHTML = open.map((s) => {
        const lr = localRange(date, s.time, minutes);
        // Show the local date too when it differs from the JST calendar day
        // (e.g. an 08:00 JST Monday slot is Sunday evening in the Americas).
        const dayPrefix = jstDateOfMs(lr.start) !== date ? `${fmtLocalDate(lr.start)} · ` : "";
        return `<option value="${s.time}">${dayPrefix}${lr.text} ${tzAbbr(lr.start)} · JST ${s.time}</option>`;
      }).join("");
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
  loadMonth();
  return {
    calEl, timesEl,
    setMinutes() { if (date) loadTimes(); loadMonth(); },
    get date() { return date; },
    get time() { return time; },
  };
}

/* ---------- Summary ---------- */

function summaryRows(b) {
  const minutes = minutesOfBooking(b);
  const lr = localRange(b.date, b.time, minutes);
  const rows = [["Course", courseName(b.courseId)]];
  if (b.lessonTypeId && !b.durationId) rows.push(["Lesson type", legacyName(b.lessonTypeId)]);
  rows.push(
    ["Duration", `${minutes} min`],
    ["Date", `${fmtLocalDate(lr.start, true)} · JST ${b.date}`],
    ["Time", `${lr.text} ${tzAbbr(lr.start)} · JST ${rangeText(toMin(b.time), minutes)} (${b.time}–${minToHHMM(toMin(b.time) + minutes)})`],
    ["Name", b.name],
    ["Email", b.email],
    ["Total", money(b.amount)],
  );
  // Students never see the booking reference or a payment status on
  // the website (the reference lives in the emails); the only status
  // ever rendered here is "Cancelled".
  if (b.effectiveStatus === "cancelled") {
    rows.push(["Status", "Cancelled"]);
  }
  if (b.meetLink) {
    rows.push(["Online meeting", `<a href="${b.meetLink}" target="_blank" rel="noopener">${b.meetLink}</a>`]);
  } else if (b.needsPayment) {
    rows.push(["Online meeting", "The meeting link will appear here once payment is complete."]);
  } else if (b.status === "paid") {
    rows.push(["Online meeting", "Your teacher will send the meeting link before the lesson."]);
  }
  return rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("");
}

/* ---------- Wire up ---------- */

document.addEventListener("DOMContentLoaded", async () => {
  /* Modal open/close wiring (works even if the config fetch below fails) */
  document.querySelectorAll(".open-booking").forEach((a) => {
    a.addEventListener("click", (e) => { e.preventDefault(); openBooking(); });
  });
  $("#book-modal-close").addEventListener("click", closeBooking);
  const overlay = $("#book-modal");
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeBooking();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) closeBooking();
  });
  // Pane 4's "Go to My Bookings" button: close the modal, then jump to #my.
  const goMy = document.querySelector('.bk-pane[data-pane="4"] .bk-nav a[href="#my"]');
  if (goMy) goMy.addEventListener("click", closeBooking);

  try {
    state.config = await api("/api/config");
    renderPrices();
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
      b.onclick = () => { state.courseId = c.id; renderCourses(); refreshSummary();
        if (state.mode === "package") renderPkgSummary(); };
      cg.appendChild(b);
    }
  }

  function renderDurations() {
    const opts = state.config.durations.map((d) =>
      `<option value="${d.id}"${d.id === state.durationId ? " selected" : ""}>${d.minutes} min lesson</option>`).join("");
    $("#bk-duration").innerHTML = opts;
    $("#bk-pkg-duration").innerHTML = opts;
  }

  function refreshSummary() {
    if (state.mode === "package") {
      renderPkgSummary();
      $("#bk-to-2").disabled = !(state.courseId && pkgComplete());
      return;
    }
    const dur = durationOf(state.durationId);
    const sel = $("#bk-selected");
    if (state.date && state.time && dur) {
      const lr = localRange(state.date, state.time, dur.minutes);
      sel.textContent = `Selected: ${fmtLocalDate(lr.start, true)}, ${lr.text} (${tzAbbr(lr.start)} · ${localTZName}) · JST ${state.date} ${state.time}`;
    } else {
      sel.textContent = "Selected: choose a date and a time";
    }
    $("#bk-total").innerHTML = dur ? `
      <div class="bk-total-row"><span>${state.courseId ? courseName(state.courseId) : "Course — pick one above"}</span></div>
      <div class="bk-total-row"><span>${dur.minutes} min lesson</span><span>${money(dur.price)}</span></div>
      <div class="bk-total-row bk-total-sum"><span>Total</span><span>${money(dur.price)}</span></div>
      <p class="note">Lessons are online: your meeting link is sent after booking and payment.</p>` : "";
    $("#bk-to-2").disabled = !(state.courseId && state.date && state.time);
  }


  /* ---------- Lesson packages (课时包 · 每周固定时间) ----------
   * Pane 1 in package mode: package size (6/10/20), 1–3 fixed weekly
   * slots (weekday + start time, duration-aware via the availability
   * API), and a plan summary. Checkout creates a pending package via
   * POST /api/packages and pays it via POST /api/subscriptions/:id/pay,
   * which materializes every lesson at once. */
  const pkg = { size: 10, freq: 1, slots: [{ weekday: "", time: "" }] };
  const pkgTimeCache = {};
  const WEEKDAY_LABELS = ["Sunday 周日", "Monday 周一", "Tuesday 周二",
    "Wednesday 周三", "Thursday 周四", "Friday 周五", "Saturday 周六"];
  const WEEKDAY_CN = ["日", "一", "二", "三", "四", "五", "六"];

  function pkgComplete() {
    if (pkg.slots.length !== pkg.freq) return false;
    const keys = pkg.slots.map((s) => `${s.weekday}|${s.time}`);
    return pkg.slots.every((s) => s.weekday !== "" && s.time) &&
      new Set(keys).size === keys.length;
  }

  function pkgFirstDate(weekday, time) {
    const minMs = Date.now() + 72 * 3600_000;
    for (let i = 0; i < 21; i++) {
      const d = addDays(jstToday(), i);
      if (weekdayOf(d) === weekday && jstInstantMs(d, time) >= minMs) return d;
    }
    return addDays(jstToday(), 21);
  }

  /** Planned lesson dates ignoring conflicts (materialization skips
   *  and extends taken dates, so the real last lesson may be later). */
  function pkgPlanDates() {
    if (!pkg.slots.every((s) => s.weekday !== "" && s.time)) return null;
    const cursors = pkg.slots.map((s) => pkgFirstDate(Number(s.weekday), s.time));
    const dates = [];
    let guard = 0;
    while (dates.length < pkg.size && guard++ < 120) {
      let idx = 0;
      for (let i = 1; i < cursors.length; i++) if (cursors[i] < cursors[idx]) idx = i;
      dates.push(cursors[idx]);
      cursors[idx] = addDays(cursors[idx], 7);
    }
    return dates;
  }

  async function pkgSlotTimes(weekday, minutes) {
    const cacheKey = `${weekday}|${minutes}`;
    if (pkgTimeCache[cacheKey]) return pkgTimeCache[cacheKey];
    const p = (async () => {
      let d = addDays(jstToday(), 3);
      while (weekdayOf(d) !== weekday) d = addDays(d, 1);
      for (let tries = 0; tries < 4; tries++) {
        try {
          const data = await api(`/api/availability?date=${d}&duration=${minutes}`);
          const times = (data.slots || []).filter((s) => s.available).map((s) => s.time);
          if (times.length) return times;
        } catch { /* try the next week */ }
        d = addDays(d, 7);
      }
      return [];
    })();
    pkgTimeCache[cacheKey] = p;
    return p;
  }

  function renderPkgSizes() {
    const dur = durationOf(state.durationId);
    $("#bk-pkg-sizes").innerHTML = "";
    for (const size of [6, 10, 20]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "choice" + (pkg.size === size ? " selected" : "");
      b.innerHTML = `${size} 节课 · ${size} lessons` +
        (dur ? `<span class="choice-price">${money(size * dur.price)}</span>` : "");
      b.onclick = () => { pkg.size = size; renderPkgSizes(); renderPkgSummary(); };
      $("#bk-pkg-sizes").appendChild(b);
    }
  }

  function renderPkgFreq() {
    $("#bk-pkg-freq").innerHTML = "";
    for (const f of [1, 2, 3]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "choice" + (pkg.freq === f ? " selected" : "");
      b.textContent = `一周${f}节 · ${f}× / week`;
      b.onclick = () => {
        pkg.freq = f;
        while (pkg.slots.length < f) pkg.slots.push({ weekday: "", time: "" });
        pkg.slots.length = f;
        renderPkgFreq(); renderPkgSlots(); renderPkgSummary();
        $("#bk-to-2").disabled = !(state.courseId && pkgComplete());
      };
      $("#bk-pkg-freq").appendChild(b);
    }
  }

  function renderPkgSlots() {
    const box = $("#bk-pkg-slots");
    box.innerHTML = "";
    pkg.slots.forEach((slot, i) => {
      const row = document.createElement("div");
      row.className = "pkg-slot";
      row.innerHTML = `
        <span class="pkg-slot-title">固定时间 ${i + 1} · Weekly slot ${i + 1}</span>
        <label class="field">星期 · Weekday
          <select class="pkg-weekday">
            <option value="">选择星期…</option>
            ${WEEKDAY_LABELS.map((label, wd) =>
              `<option value="${wd}"${String(wd) === String(slot.weekday) ? " selected" : ""}>${label}</option>`).join("")}
          </select></label>
        <label class="field">开始时间 (JST) · Start time
          <select class="pkg-time"><option value="">先选星期…</option></select></label>`;
      box.appendChild(row);
      const wdSel = row.querySelector(".pkg-weekday");
      const timeSel = row.querySelector(".pkg-time");
      const fillTimes = async () => {
        if (slot.weekday === "") { timeSel.innerHTML = `<option value="">先选星期…</option>`; return; }
        timeSel.innerHTML = `<option value="">加载中…</option>`;
        const minutes = durationOf(state.durationId)?.minutes || 50;
        const times = await pkgSlotTimes(Number(slot.weekday), minutes);
        timeSel.innerHTML = times.length
          ? `<option value="">选择时间…</option>` + times.map((t) =>
              `<option value="${t}"${t === slot.time ? " selected" : ""}>${t} JST</option>`).join("")
          : `<option value="">这一天暂时没有可约时间</option>`;
        if (slot.time && !times.includes(slot.time)) slot.time = "";
        renderPkgSummary();
        $("#bk-to-2").disabled = !(state.courseId && pkgComplete());
      };
      wdSel.onchange = () => { slot.weekday = wdSel.value; slot.time = ""; fillTimes(); };
      timeSel.onchange = () => {
        slot.time = timeSel.value;
        renderPkgSummary();
        $("#bk-to-2").disabled = !(state.courseId && pkgComplete());
      };
      if (slot.weekday !== "") fillTimes();
    });
  }

  function renderPkgSummary() {
    const dur = durationOf(state.durationId);
    const dates = pkgPlanDates();
    const summary = $("#bk-pkg-summary");
    if (!dur) { summary.textContent = "请选择每周固定的上课时间"; return; }
    if (dates && pkgComplete()) {
      summary.textContent =
        `每周 ${pkg.freq} 节 · 共 ${pkg.size} 节 · 预计从 ${dates[0]} 上到 ${dates[dates.length - 1]} · 合计 ${money(pkg.size * dur.price)}`;
    } else if (dates) {
      summary.textContent = "两个固定时间不能完全相同，请调整其中一个。";
    } else {
      summary.textContent = "请选择每周固定的上课时间（先选星期，再选开始时间）";
    }
    $("#bk-pkg-total").innerHTML = `
      <div class="bk-total-row"><span>${state.courseId ? courseName(state.courseId) : "Course — pick one above"}</span></div>
      <div class="bk-total-row"><span>课时包 ${pkg.size} 节 × ${dur.minutes} min</span><span>${money(pkg.size * dur.price)}</span></div>
      <div class="bk-total-row bk-total-sum"><span>Total</span><span>${money(pkg.size * dur.price)}</span></div>
      <p class="note">支付后系统会一次性排好全部 ${pkg.size} 节课；个别日期被占用时会自动顺延一周。</p>`;
  }

  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll(".bk-mode-btn").forEach((b) =>
      b.classList.toggle("selected", b.dataset.mode === mode));
    $("#bk-single").classList.toggle("hidden", mode !== "single");
    $("#bk-package").classList.toggle("hidden", mode !== "package");
    refreshSummary();
  }
  document.querySelectorAll(".bk-mode-btn").forEach((b) => {
    b.addEventListener("click", () => setMode(b.dataset.mode));
  });
  $("#bk-pkg-duration").addEventListener("change", (e) => {
    state.durationId = e.target.value;
    $("#bk-duration").value = state.durationId;
    renderPkgSizes();
    renderPkgSlots();
    renderPkgSummary();
  });

  state.durationId = state.config.durations.find((d) => d.minutes === 50)?.id || state.config.durations[0].id;
  renderCourses();
  renderDurations();
  renderPkgSizes();
  renderPkgFreq();
  renderPkgSlots();
  refreshSummary();

  $("#bk-duration").addEventListener("change", (e) => {
    state.durationId = e.target.value;
    $("#bk-pkg-duration").value = state.durationId;
    picker.setMinutes();
    renderPkgSizes();
    renderPkgSlots();
    refreshSummary();
  });

  document.querySelectorAll(".book-course").forEach((btn) => {
    btn.addEventListener("click", () => {
      openBooking(); // resets first if a previous booking was completed
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
    if (state.mode === "package") {
      if (!pkgComplete()) {
        return setMsg("#bk-msg-1", "请选择课时包，并为每一节固定课选好星期和开始时间。", false);
      }
      setMsg("#bk-msg-1", "");
      showPane(2);
      return;
    }
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
    if (state.mode === "package") {
      try {
        const { subscription } = await api("/api/packages", {
          method: "POST",
          body: JSON.stringify({
            name, email,
            courseId: state.courseId, durationId: state.durationId,
            packageSize: pkg.size,
            slots: pkg.slots.map((s) => ({ weekday: Number(s.weekday), time: s.time })),
          }),
        });
        state.pkgOrder = subscription;
        state.pkgBuyer = { name, email };
        const dur = durationOf(state.durationId);
        const dates = pkgPlanDates() || [];
        const slotsText = subscription.slots.map((sl) =>
          `周${WEEKDAY_CN[sl.weekday]} ${sl.time}`).join(" · ");
        const rows = [
          ["Course", courseName(subscription.courseId)],
          ["课时包 Package", `${subscription.totalLessons} 节 · ${dur.minutes} min each`],
          ["每周固定时间 Weekly", `${slotsText} (JST)`],
          ["预计安排 Planned", dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : ""],
          ["Name", name],
          ["Email", email],
          ["Total", money(subscription.totalPrice)],
        ];
        $("#bk-summary").innerHTML =
          rows.map(([k, v]) => `<tr><th>${k}</th><td>${escHtml(v)}</td></tr>`).join("");
        $("#bk-pay").textContent = `Pay ${money(subscription.totalPrice)}`;
        setMsg("#bk-msg-2", "");
        showPane(3);
      } catch (e) {
        setMsg("#bk-msg-2", e.message, false);
      }
      return;
    }
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
    setMsg("#bk-msg-3", "Processing (mock)…", true);
    if (state.pkgOrder) {
      try {
        const data = await api(`/api/subscriptions/${state.pkgOrder.id}/pay`, {
          method: "POST",
          body: JSON.stringify({ email: state.pkgBuyer?.email || "" }),
        });
        const sub = data.subscription;
        const dur = durationOf(state.durationId);
        const slotsText = sub.slots.map((sl) =>
          `周${WEEKDAY_CN[sl.weekday]} ${sl.time}`).join(" · ");
        const rows = [
          ["Course", courseName(sub.courseId)],
          ["课时包 Package", `${sub.totalLessons} 节 · ${dur.minutes} min each`],
          ["每周固定时间 Weekly", `${slotsText} (JST)`],
          ["Name", sub.name],
          ["Email", sub.email],
          ["Total", money(sub.totalPrice)],
        ];
        $("#bk-done").innerHTML =
          rows.map(([k, v]) => `<tr><th>${k}</th><td>${escHtml(v)}</td></tr>`).join("");
        const lessons = data.lessons || [];
        $("#bk-done-extra").innerHTML = `
          <h4 class="bk-sub">你的课程安排 · Your ${lessons.length} lessons</h4>
          <ul class="done-lessons">${lessons.map((l) =>
            `<li>${dateLong(l.date)} · ${l.time} JST</li>`).join("")}</ul>
          ${(data.skippedDates || []).length
            ? `<p class="note">这些日期已被占用或老师休息，对应课程已自动顺延一周：${data.skippedDates.join(", ")}</p>` : ""}`;
        state.pkgOrder = null;
        showPane(4);
        if (authUser) { await loadMyBookings(); await loadMySubscriptions(); }
      } catch (e) {
        setMsg("#bk-msg-3", e.message, false);
      }
      return;
    }
    if (!state.booking) return;
    try {
      const { booking } = await api(`/api/bookings/${state.booking.id}/pay`, {
        method: "POST", body: "{}",
      });
      state.booking = booking;
      $("#bk-done").innerHTML = summaryRows(booking);
      showPane(4);
      if (authUser) { await loadMyBookings(); await loadMySubscriptions(); }
    } catch (e) {
      setMsg("#bk-msg-3", e.message, false);
    }
  };

  /* ---------- My Bookings (account-based) ----------
   * Students log in with email + password; bookings are matched to the
   * account by email and split into "Upcoming lessons" (manageable) and
   * "Lesson history" (completed + cancelled, read-only, newest first).
   * Lessons booked as a guest appear automatically once the student
   * creates an account with the same email. */

  let myActionMsg = "";

  function renderAuthForms(mode) {
    const box = $("#my-auth");
    if (mode === "register") {
      box.innerHTML = `
      <div class="lookup-box">
        <label class="field">Your name
          <input type="text" id="auth-name" autocomplete="name" /></label>
        <label class="field">Email
          <input type="email" id="auth-email" autocomplete="email" /></label>
        <label class="field">Password (at least 8 characters)
          <input type="password" id="auth-password" autocomplete="new-password" /></label>
        <button class="btn" id="auth-submit">Create account</button>
        <p class="msg" id="auth-msg"></p>
        <p class="note">Already have an account?
          <a href="#my" id="auth-switch">Log in</a></p>
      </div>`;
      $("#auth-switch").onclick = (e) => { e.preventDefault(); renderAuthForms("login"); };
      $("#auth-submit").onclick = () => submitAuth("register");
    } else {
      box.innerHTML = `
      <div class="lookup-box">
        <label class="field">Email
          <input type="email" id="auth-email" autocomplete="email" /></label>
        <label class="field">Password
          <input type="password" id="auth-password" autocomplete="current-password" /></label>
        <button class="btn" id="auth-submit">Log in</button>
        <p class="msg" id="auth-msg"></p>
        <p class="note">New here? You can book a lesson first and create
          the account afterwards with the same email — your bookings will
          show up here automatically.
          <a href="#my" id="auth-switch">Create an account</a></p>
      </div>`;
      $("#auth-switch").onclick = (e) => { e.preventDefault(); renderAuthForms("register"); };
      $("#auth-submit").onclick = () => submitAuth("login");
    }
  }

  async function submitAuth(kind) {
    const email = $("#auth-email").value.trim();
    const password = $("#auth-password").value;
    const payload = { email, password };
    if (kind === "register") payload.name = $("#auth-name").value.trim();
    setMsg("#auth-msg", kind === "register" ? "Creating your account…" : "Logging in…", true);
    try {
      const data = await api(`/api/auth/${kind}`, {
        method: "POST", body: JSON.stringify(payload),
      });
      authUser = data.user;
      applyAuthToForm();
      myActionMsg = kind === "register" ? "Account created — welcome! 🌸" : "";
      renderAccountBar();
      await loadMyBookings();
      await loadMySubscriptions();
    } catch (e) {
      setMsg("#auth-msg", e.message, false);
    }
  }

  /* The nav's Admin shortcut shows only for whitelisted accounts
   * (worker-side settings.adminEmails → user.isAdmin). It is just a
   * link: /admin itself still asks for the admin key. */
  function renderNavAdmin() {
    const link = $("#nav-admin");
    if (link) link.hidden = !(authUser && authUser.isAdmin);
  }

  function renderAccountBar() {
    renderNavAdmin();
    const box = $("#my-auth");
    if (!authUser) { renderAuthForms("login"); return; }
    box.innerHTML = `
      <p class="note">Logged in as <strong>${escHtml(authUser.name)}</strong>
      (${escHtml(authUser.email)}) ·
      <a href="#my" id="auth-logout">Log out</a></p>`;
    $("#auth-logout").onclick = async (e) => {
      e.preventDefault();
      await api("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => {});
      authUser = null;
      applyAuthToForm();
      $("#my-result").innerHTML = "";
      $("#my-subs").innerHTML = "";
      renderAccountBar();
    };
  }

  /* ---------- My lesson packages (课时包) ---------- */
  async function loadMySubscriptions() {
    const box = $("#my-subs");
    if (!box) return;
    if (!authUser) { box.innerHTML = ""; return; }
    try {
      const data = await api("/api/my/subscriptions");
      renderMySubscriptions(data.subscriptions || []);
    } catch { box.innerHTML = ""; }
  }

  function renderMySubscriptions(subs) {
    const box = $("#my-subs");
    const visible = subs.filter((s) => s.status !== "pending_payment");
    if (!visible.length) { box.innerHTML = ""; return; }
    box.innerHTML = `
      <h3 class="my-section-title">我的课时包 · My lesson packages</h3>
      ${visible.map(subCard).join("")}`;
    visible.forEach(wireSubCard);
  }

  function subCard(s) {
    const slotsText = (s.slots || []).map((sl) =>
      `周${WEEKDAY_CN[sl.weekday]} ${sl.time}`).join(" · ");
    const stopped = s.status === "stopped";
    return `
    <div class="my-card">
      <table class="summary">
        <tr><th>课时包 Package</th><td>${s.totalLessons} 节 · ${escHtml(courseName(s.courseId))} · ${s.durationMinutes} min</td></tr>
        <tr><th>每周固定时间</th><td>${escHtml(slotsText)} (JST)</td></tr>
        <tr><th>状态 Status</th><td>${stopped ? "已停止 Stopped" : "进行中 Active"}</td></tr>
        ${!stopped ? `<tr><th>还剩 Remaining</th><td>${s.remainingLessons} 节</td></tr>` : ""}
        ${!stopped && s.nextLesson ? `<tr><th>下一节 Next lesson</th><td>${s.nextLesson.date} · ${s.nextLesson.time} JST</td></tr>` : ""}
      </table>
      ${(s.lastSkippedDates || []).length
        ? `<p class="note">这些日期已被占用或老师休息，对应课程已自动顺延一周：${s.lastSkippedDates.join(", ")}</p>` : ""}
      ${!stopped ? `
      <p class="msg" id="sub-msg-${s.id}"></p>
      <div class="my-actions">
        <button class="btn btn-ghost" id="sub-buy-${s.id}">续购课时包</button>
        <button class="btn btn-ghost" id="sub-stop-${s.id}">退掉剩余课时并退款</button>
      </div>` : ""}
    </div>`;
  }

  function wireSubCard(s) {
    const buyBtn = document.getElementById(`sub-buy-${s.id}`);
    if (buyBtn) {
      buyBtn.onclick = () => {
        openBooking();
        state.courseId = s.courseId;
        state.durationId = s.durationId;
        renderCourses();
        renderDurations();
        setMode("package");
        showPane(1);
      };
    }
    const stopBtn = document.getElementById(`sub-stop-${s.id}`);
    if (stopBtn) {
      stopBtn.onclick = async () => {
        const inside = s.insideWindowLessons || 0;
        const text = `退掉剩余课时并退款？\n将取消剩余 ${s.remainingLessons} 节课，` +
          `退款 ${money(s.refundableTotal || 0)}（mock）` +
          (inside > 0 ? `；其中 ${inside} 节在开课前 12 小时内，不退款` : "") +
          `。已上过的课不受影响，停止后不能恢复。`;
        if (!confirm(text)) return;
        try {
          const data = await api(`/api/subscriptions/${s.id}/stop`, {
            method: "POST", body: "{}",
          });
          myActionMsg = `课时包已停止，共退款 ${money(data.refundTotal || 0)}（mock）。`;
          await loadMyBookings();
          await loadMySubscriptions();
        } catch (e) { setMsg(`#sub-msg-${s.id}`, e.message, false); }
      };
    }
  }

  async function loadMyBookings() {
    const box = $("#my-result");
    try {
      const data = await api("/api/my/bookings");
      renderMyBookings(data);
    } catch (e) {
      box.innerHTML = `<p class="msg msg-err">${escHtml(e.message)}</p>`;
    }
  }

  function renderMyBookings({ upcoming, history }) {
    const box = $("#my-result");
    const section = (title, list, render) => list.length ? `
      <h3 class="my-section-title">${title}</h3>
      ${list.map(render).join("")}` : "";
    box.innerHTML = `
      <p class="msg" id="my-action-msg"></p>
      ${section("Upcoming lessons", upcoming, (b) => myCard(b, true))}
      ${section("Lesson history", history, (b) => myCard(b, false))}
      ${!upcoming.length && !history.length ? "<p class='note'>No bookings found.</p>" : ""}`;
    if (myActionMsg) setMsg("#my-action-msg", myActionMsg, true);
    upcoming.forEach((b) => wireMyCard(b));
  }

  function myCard(b, manageable) {
    const canManage = manageable &&
      (b.status === "paid" || b.status === "unpaid");
    return `
    <div class="my-card">
      <table class="summary">${summaryRows(b)}</table>
      ${b.status === "paid" && b.effectiveStatus === "upcoming"
        ? `<p class="note">Reschedules used: ${b.reschedules} / 2 ·
          开课前 12 小时以上取消可全额退款；12 小时内取消不退款。</p>` : ""}
      ${b.status === "cancelled" && b.refundAmount > 0
        ? `<p class="note">已退款 · Refunded ${money(b.refundAmount)} (mock)</p>` : ""}
      ${b.status === "cancelled" && !(b.refundAmount > 0) &&
        String(b.refund || "").includes("12-hour")
        ? `<p class="note">已取消（未退款）· Cancelled inside the 12-hour window — no refund</p>` : ""}
      ${canManage ? `
      <p class="msg" id="my-msg-${b.id}"></p>
      <div class="my-actions">
        <button class="btn btn-ghost" id="my-cancel-${b.id}">Cancel this booking</button>
        ${b.status === "paid" ? `<button class="btn btn-ghost" id="my-refund-${b.id}">申请退款</button>
        <button class="btn btn-ghost" id="my-resched-${b.id}">Reschedule</button>` : ""}
      </div>
      <div id="my-resched-box-${b.id}" class="hidden">
        <h4 class="bk-sub">Pick a new date &amp; time (${minutesOfBooking(b)} min lesson)</h4>
        <div id="my-picker-${b.id}"></div>
        <button class="btn" id="my-resched-go-${b.id}" disabled>Confirm new time</button>
      </div>` : ""}
    </div>`;
  }

  function wireMyCard(b) {
    const cancelBtn = document.getElementById(`my-cancel-${b.id}`);
    if (!cancelBtn) return;
    cancelBtn.onclick = async () => {
      if (!confirm("Cancel this booking? 开课前 12 小时以上取消可全额退款；12 小时内取消不退款。")) return;
      try {
        const data = await api(`/api/bookings/${b.id}/cancel`, {
          method: "POST", body: "{}",
        });
        myActionMsg = `Booking ${b.id} cancelled. Refund: ${data.booking.refund}.`;
        await loadMyBookings();
        await loadMySubscriptions();
      } catch (e) { setMsg(`#my-msg-${b.id}`, e.message, false); }
    };

    const refundBtn = document.getElementById(`my-refund-${b.id}`);
    if (refundBtn) {
      refundBtn.onclick = async () => {
        const msLeft = jstInstantMs(b.date, b.time) - Date.now();
        const ok = msLeft >= 12 * 3600_000
          ? confirm(`取消这节课并全额退款 ${money(b.amount)}？`)
          : confirm("这节课距开课不足 12 小时，取消后不退款，确定取消吗？");
        if (!ok) return;
        try {
          const data = await api(`/api/bookings/${b.id}/cancel`, {
            method: "POST", body: "{}",
          });
          myActionMsg = data.booking.refundAmount > 0
            ? `已取消并退款 ${money(data.booking.refundAmount)}（mock）。Booking ${b.id} cancelled and refunded.`
            : `已取消（未退款）。Booking ${b.id} cancelled without a refund.`;
          await loadMyBookings();
          await loadMySubscriptions();
        } catch (e) { setMsg(`#my-msg-${b.id}`, e.message, false); }
      };
    }

    const reschedBtn = document.getElementById(`my-resched-${b.id}`);
    if (reschedBtn) {
      let newDate = null, newTime = null, picker = null;
      reschedBtn.onclick = () => {
        document.getElementById(`my-resched-box-${b.id}`).classList.toggle("hidden");
        if (!picker) {
          picker = createPicker({
            getMinutes: () => minutesOfBooking(b),
            onPick: (date, time) => {
              newDate = date; newTime = time;
              document.getElementById(`my-resched-go-${b.id}`).disabled = !(newDate && newTime);
            },
          });
          const mount = document.getElementById(`my-picker-${b.id}`);
          mount.appendChild(picker.calEl);
          mount.appendChild(picker.timesEl);
        }
      };
      document.getElementById(`my-resched-go-${b.id}`).onclick = async () => {
        try {
          await api(`/api/bookings/${b.id}/reschedule`, {
            method: "POST",
            body: JSON.stringify({ date: newDate, time: newTime }),
          });
          myActionMsg = `Booking ${b.id} rescheduled. See you then!`;
          await loadMyBookings();
          await loadMySubscriptions();
        } catch (e) { setMsg(`#my-msg-${b.id}`, e.message, false); }
      };
    }
  }

  /* Session restore: if the student is already logged in, show their
   * bookings right away; otherwise show the login form. */
  try {
    const data = await api("/api/auth/me");
    authUser = data.user;
    applyAuthToForm();
  } catch { authUser = null; }
  renderAccountBar();
  if (authUser) { await loadMyBookings(); await loadMySubscriptions(); }
});

/* ---------- Student voices: all 16 reviews, paged ----------
 * Data: verbatim capture of Yumi's Preply reviews (newest first);
 * texts are display-only — no links back to Preply anywhere.
 * Desktop (>=861px): card grid, 6 per page, prev/next + dots + count.
 * Mobile (<=860px): the same cards in the scroll-snap carousel,
 * dots track the scroll position, arrows scroll by one card. */
const REVIEWS = [
  {
    "name": "Philippe",
    "date": "October 29, 2026",
    "text": "Friendly and very helpful!",
    "avatar": "images/reviews/philippe.jpg"
  },
  {
    "name": "Monique",
    "date": "October 28, 2026",
    "text": "Yumi is very patient and attentive to your progress. I really appreciate how she encourages and challenges you throughout the learning process, introducing new topics at just the right pace. Highly recommended",
    "avatar": "images/reviews/monique.jpg"
  },
  {
    "name": "Charles",
    "date": "October 2, 2026",
    "text": "Yumi is a great tutor. She is patient and kind. She gives clear answers to any questions I have. She also educates not only on language, but also the culture. All in all, I've had a great experience with her teaching.",
    "avatar": "images/reviews/charles.jpg"
  },
  {
    "name": "Maryarver",
    "date": "September 9, 2026",
    "text": "I have been living in Japan for two and a half years and studied for 2 years at a Japanese school in Tokyo; however, my level of knowledge of Japanese for business is quite limited. After working for 1 year for a Japanese company and now changing careers and companies within Japan to a larger, international company, learning Japanese for interviews, sales, communication with clients, presentations, team interactions, and all that has become extremely necessary. Yumi is helping me to be prepared for my selection processes, expand my vocabulary, understanding, and perspective on how to present myself and communicate my experience in interviews and everything that comes after. We are learning with classes designed for my goal, 100% personalized for the companies where I have advanced in my selection process. I am very grateful and happy with my classes. I am learning 4 times a week with her. I highly recommend her.",
    "avatar": "images/reviews/maryarver.jpg"
  },
  {
    "name": "Sandra",
    "date": "August 28, 2026",
    "text": "Yumi is very helpful and supportive. She is patient and kind and the lessons are well structured and fun.",
    "avatar": "images/reviews/sandra.jpg"
  },
  {
    "name": "Anonymous",
    "date": "August 24, 2026",
    "text": "Yumi is a fantastic tutor. I started learning with very little knowledge and she knew exactly where to start. Very patient, can answer every question I have, and goes at a pace that works for me. I recommend her for anyone wanting to start to learn Japanese from little to no experience.",
    "avatar": null
  },
  {
    "name": "yc",
    "date": "August 11, 2026",
    "text": "The teaching is meticulous and patient.",
    "avatar": "images/reviews/yc.jpg"
  },
  {
    "name": "Alexis",
    "date": "August 5, 2026",
    "text": "Yumi is a great teacher! She is always on time and ready for every class, as well as kind and helpful! I feel like I learn a lot during every lesson and she works at a good pace for beginners! I definitely recommend taking classes with Yumi!",
    "avatar": "images/reviews/alexis.jpg"
  },
  {
    "name": "Sabrina",
    "date": "July 30, 2026",
    "text": "She is very help full and willing to repeat things so you understand. I enjoy working with her.",
    "avatar": "images/reviews/sabrina.jpg"
  },
  {
    "name": "Daniel",
    "date": "July 29, 2026",
    "text": "Have got much progress! Thanks teacher. Don't pick my schedule, guys. Thanks.",
    "avatar": "images/reviews/daniel.jpg"
  },
  {
    "name": "Joshua",
    "date": "April 14, 2026",
    "text": "Yumi has been a great teacher and very accommodating to our specific learning goals. Classes have always been fun and engaging. Her explanations are clear and focused on daily Japanese rather than textbook Japanese which is exactly what we need.",
    "avatar": "images/reviews/joshua.jpg"
  },
  {
    "name": "Connor",
    "date": "April 4, 2026",
    "text": "Yumi is an excellent Japanese tutor who makes learning enjoyable and effective. She explains concepts clearly, is very patient, and always adapts lessons to match my pace and goals. I especially appreciate how she balances grammar, writing, conversation practice, and cultural insights, which makes each session feel well-rounded and engaging. I highly recommend Yumi to anyone looking to learn Japanese, whether you're a complete beginner or trying to improve your fluency.",
    "avatar": "images/reviews/connor.jpg"
  },
  {
    "name": "フリーダ",
    "date": "March 19, 2026",
    "text": "I highly recommend this tutor! She manages to make every lesson engaging and fun while maintaining a very clear and structured plan for the following classes. I never feel lost because she is really patient and takes her time to thoroughly answer every question, no matter how small. ゆみ先生ありがとうございます😊",
    "avatar": "images/reviews/furida.jpg"
  },
  {
    "name": "Pilou",
    "date": "February 24, 2026",
    "text": "Yumi is a fantastic Japanese tutor !! She is patient, helpful and has a great personality. I've learned many things so far ! Thank you !!",
    "avatar": "images/reviews/pilou.jpg"
  },
  {
    "name": "Jason",
    "date": "February 21, 2026",
    "text": "Yumi is so patient and friendly to students. She could make the class so active and interesting. Every time when you join her class， you can get relaxed rather than be stressed，so I strongly recommend her，thanks.",
    "avatar": null
  },
  {
    "name": "Chris",
    "date": "February 17, 2026",
    "text": "Really well prepared follow up lesson - Clear and will walk you though the way it should be pronounced - good follow up questions to combine words for everyday use",
    "avatar": null
  }
];

document.addEventListener("DOMContentLoaded", () => {
  const grid = document.getElementById("voices-grid");
  if (!grid) return;
  const esc = (s) => String(s).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  grid.innerHTML = REVIEWS.map((r) => `
    <blockquote>
      <p class="stars" aria-label="5 out of 5 stars">★★★★★</p>
      <p>“${esc(r.text)}”</p>
      <footer class="reviewer">
        ${r.avatar
          ? `<img class="reviewer-avatar" src="${r.avatar}" alt="${esc(r.name)}" width="44" height="44" loading="lazy" />`
          : `<span class="reviewer-avatar reviewer-initial" aria-hidden="true">${esc(r.name.charAt(0).toUpperCase())}</span>`}
        <span class="reviewer-meta"><strong>${esc(r.name)}</strong><small>${esc(r.date)}</small></span>
      </footer>
    </blockquote>`).join("");
  const cards = [...grid.querySelectorAll("blockquote")];
  const dotsBox = document.getElementById("vp-dots");
  const count = document.getElementById("vp-count");
  const prevBtn = document.getElementById("vp-prev");
  const nextBtn = document.getElementById("vp-next");
  const PAGE = 6;
  const PAGES = Math.ceil(REVIEWS.length / PAGE);
  let page = 0;
  const mq = window.matchMedia("(max-width: 860px)");

  function setDots(n, active) {
    dotsBox.innerHTML = "";
    for (let i = 0; i < n; i++) {
      const d = document.createElement("button");
      d.type = "button";
      d.className = "vp-dot" + (i === active ? " active" : "");
      d.setAttribute("aria-label", "Go to " + (i + 1));
      d.addEventListener("click", () => {
        if (mq.matches) scrollToCard(i);
        else applyPage(i);
      });
      dotsBox.appendChild(d);
    }
  }
  function markDot(i) {
    [...dotsBox.children].forEach((d, j) => d.classList.toggle("active", j === i));
  }
  function applyPage(p) {
    page = Math.max(0, Math.min(PAGES - 1, p));
    cards.forEach((c, i) =>
      c.classList.toggle("vp-off", i < page * PAGE || i >= (page + 1) * PAGE));
    count.textContent = `${page + 1} / ${PAGES}`;
    prevBtn.disabled = page === 0;
    nextBtn.disabled = page === PAGES - 1;
    setDots(PAGES, page);
    grid.classList.remove("vp-fade");
    void grid.offsetWidth;
    grid.classList.add("vp-fade");
  }
  function cardStep() {
    const c = cards[0];
    return c ? c.offsetWidth + 14 : 300;
  }
  function scrollToCard(i) {
    grid.scrollTo({ left: i * cardStep(), behavior: "smooth" });
    markDot(i);
  }
  let scrollTick = false;
  grid.addEventListener("scroll", () => {
    if (!mq.matches || scrollTick) return;
    scrollTick = true;
    requestAnimationFrame(() => {
      scrollTick = false;
      markDot(Math.max(0, Math.min(REVIEWS.length - 1,
        Math.round(grid.scrollLeft / cardStep()))));
    });
  }, { passive: true });
  function setup() {
    if (mq.matches) {
      cards.forEach((c) => c.classList.remove("vp-off"));
      count.textContent = "";
      prevBtn.disabled = false;
      nextBtn.disabled = false;
      setDots(REVIEWS.length,
        Math.round(grid.scrollLeft / cardStep()));
    } else {
      applyPage(page);
    }
  }
  prevBtn.addEventListener("click", () => {
    if (mq.matches) {
      grid.scrollBy({ left: -cardStep(), behavior: "smooth" });
    } else applyPage(page - 1);
  });
  nextBtn.addEventListener("click", () => {
    if (mq.matches) {
      grid.scrollBy({ left: cardStep(), behavior: "smooth" });
    } else applyPage(page + 1);
  });
  mq.addEventListener("change", setup);
  setup();
});
