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
  if (state.booking && flowDone) {
    state.booking = null;
    showPane(1);
  }
  $("#book-modal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeBooking() {
  $("#book-modal").classList.add("hidden");
  document.body.style.overflow = "";
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
  if (b.id) rows.unshift(["Booking reference", b.id]);
  if (b.status) {
    const label = b.effectiveStatus && b.effectiveStatus !== b.status
      ? b.effectiveStatus : b.status.replace("_", " ");
    rows.push(["Status", label]);
  }
  if (b.meetLink) {
    rows.push(["Online meeting", `<a href="${b.meetLink}" target="_blank" rel="noopener">${b.meetLink}</a>`]);
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

  /* ---------- My Bookings ----------
   * One valid email + booking reference unlocks all of the student's own
   * bookings, split into "Upcoming lessons" (manageable) and "Lesson
   * history" (completed + cancelled, read-only, newest first). */

  let myCreds = null; // {email, ref} of the last successful lookup
  let myActionMsg = "";

  $("#my-find").onclick = async () => {
    const email = $("#my-email").value.trim();
    const ref = $("#my-ref").value.trim().toUpperCase();
    if (!email || !ref) return setMsg("#my-msg", "Enter your email and booking reference.", false);
    myCreds = { email, ref };
    myActionMsg = "";
    await loadMyBookings();
  };

  async function loadMyBookings() {
    const box = $("#my-result");
    try {
      const data = await api(
        `/api/my-bookings?email=${encodeURIComponent(myCreds.email)}&ref=${encodeURIComponent(myCreds.ref)}`);
      setMsg("#my-msg", "");
      renderMyBookings(data);
    } catch (e) {
      box.innerHTML = "";
      setMsg("#my-msg", e.message, false);
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
      (b.status === "paid" || b.status === "pending_payment");
    return `
    <div class="my-card">
      <table class="summary">${summaryRows(b)}</table>
      ${b.status === "paid" && b.effectiveStatus === "upcoming"
        ? `<p class="note">Reschedules used: ${b.reschedules} / 2</p>` : ""}
      ${canManage ? `
      <p class="msg" id="my-msg-${b.id}"></p>
      <div class="my-actions">
        <button class="btn btn-ghost" id="my-cancel-${b.id}">Cancel this booking</button>
        ${b.status === "paid" ? `<button class="btn btn-ghost" id="my-resched-${b.id}">Reschedule</button>` : ""}
      </div>
      <div id="my-resched-box-${b.id}" class="hidden">
        <h4 class="bk-sub">Pick a new date &amp; time (${minutesOfBooking(b)} min lesson)</h4>
        <div id="my-picker-${b.id}"></div>
        <button class="btn" id="my-resched-go-${b.id}" disabled>Confirm new time</button>
      </div>` : ""}
    </div>`;
  }

  function wireMyCard(b) {
    const email = myCreds.email;
    const cancelBtn = document.getElementById(`my-cancel-${b.id}`);
    if (!cancelBtn) return;
    cancelBtn.onclick = async () => {
      if (!confirm("Cancel this booking? The policy in the FAQ applies.")) return;
      try {
        const data = await api(`/api/bookings/${b.id}/cancel`, {
          method: "POST", body: JSON.stringify({ email }),
        });
        myActionMsg = `Booking ${b.id} cancelled. Refund: ${data.booking.refund}.`;
        await loadMyBookings();
      } catch (e) { setMsg(`#my-msg-${b.id}`, e.message, false); }
    };

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
            body: JSON.stringify({ email, date: newDate, time: newTime }),
          });
          myActionMsg = `Booking ${b.id} rescheduled. See you then!`;
          await loadMyBookings();
        } catch (e) { setMsg(`#my-msg-${b.id}`, e.message, false); }
      };
    }
  }
});
