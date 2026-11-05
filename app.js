/* YUMI Japanese Lessons — booking flow + My Bookings */
"use strict";

const $ = (sel) => document.querySelector(sel);

const state = {
  config: null,
  courseId: null,
  lessonTypeId: null,
  date: null,
  time: null,
  booking: null,
};

function jstTodayPlus(days) {
  const now = new Date(Date.now() + 9 * 3600_000 + days * 86400_000);
  return now.toISOString().slice(0, 10);
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
  return state.config.courses.find((c) => c.id === id)?.name || id;
}
function typeName(id) {
  return state.config.lessonTypes.find((t) => t.id === id)?.name || id;
}
function money(n) {
  return `$${n}`;
}

/* ---------- Step 1: course & lesson type ---------- */

function renderChoices() {
  const cg = $("#bk-courses");
  cg.innerHTML = "";
  for (const c of state.config.courses) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "choice" + (state.courseId === c.id ? " selected" : "");
    b.textContent = c.name;
    b.onclick = () => { state.courseId = c.id; renderChoices(); };
    cg.appendChild(b);
  }
  const tg = $("#bk-types");
  tg.innerHTML = "";
  for (const t of state.config.lessonTypes) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "choice choice-row" + (state.lessonTypeId === t.id ? " selected" : "");
    b.innerHTML = `<span>${t.name}</span><strong>${money(t.price)}</strong>`;
    b.onclick = () => { state.lessonTypeId = t.id; renderChoices(); };
    tg.appendChild(b);
  }
}

/* ---------- Step 2: date & slots ---------- */

async function loadSlots() {
  const grid = $("#bk-slots");
  const date = $("#bk-date").value;
  state.date = date || null;
  state.time = null;
  grid.innerHTML = "";
  if (!date) return;
  grid.innerHTML = "<p class='note'>Loading times…</p>";
  try {
    const data = await api(`/api/availability?date=${date}`);
    grid.innerHTML = "";
    if (data.closed) {
      grid.innerHTML = "<p class='note'>Closed on this day — I teach Tuesday to Saturday.</p>";
      return;
    }
    for (const s of data.slots) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "slot" + (s.available ? "" : " off");
      b.textContent = s.time;
      b.disabled = !s.available;
      b.onclick = () => {
        state.time = s.time;
        grid.querySelectorAll(".slot").forEach((x) => x.classList.remove("selected"));
        b.classList.add("selected");
      };
      grid.appendChild(b);
    }
  } catch (e) {
    grid.innerHTML = `<p class='msg msg-err'>${e.message}</p>`;
  }
}

/* ---------- Summary ---------- */

function summaryRows(b) {
  const rows = [
    ["Course", courseName(b.courseId)],
    ["Lesson type", typeName(b.lessonTypeId)],
    ["Date", `${b.date} (JST)`],
    ["Time", `${b.time} JST`],
    ["Name", b.name],
    ["Email", b.email],
    ["Total", money(b.amount)],
  ];
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
  renderChoices();

  const dateInput = $("#bk-date");
  dateInput.min = jstTodayPlus(3); // 72-hour rule
  dateInput.addEventListener("change", loadSlots);

  document.querySelectorAll(".book-course").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.courseId = btn.dataset.course;
      renderChoices();
      showPane(1);
    });
  });

  document.querySelectorAll("[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => showPane(Number(btn.dataset.back)));
  });

  $("#bk-to-2").onclick = () => {
    if (!state.courseId) return setMsg("#bk-msg-1", "Please choose a course.", false);
    if (!state.lessonTypeId) return setMsg("#bk-msg-1", "Please choose a lesson type.", false);
    setMsg("#bk-msg-1", "");
    showPane(2);
  };

  $("#bk-to-3").onclick = () => {
    if (!state.date || !state.time) {
      return setMsg("#bk-msg-2", "Please pick a date and a time.", false);
    }
    setMsg("#bk-msg-2", "");
    showPane(3);
  };

  $("#bk-to-4").onclick = async () => {
    const name = $("#bk-name").value.trim();
    const email = $("#bk-email").value.trim();
    const notes = $("#bk-notes").value.trim();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return setMsg("#bk-msg-3", "Please enter your name and a valid email.", false);
    }
    setMsg("#bk-msg-3", "Creating your booking…", true);
    try {
      const { booking } = await api("/api/bookings", {
        method: "POST",
        body: JSON.stringify({
          courseId: state.courseId, lessonTypeId: state.lessonTypeId,
          date: state.date, time: state.time, name, email, notes,
        }),
      });
      state.booking = booking;
      $("#bk-summary").innerHTML = summaryRows(booking);
      $("#bk-pay").textContent = `Pay ${money(booking.amount)}`;
      setMsg("#bk-msg-3", "");
      showPane(4);
    } catch (e) {
      setMsg("#bk-msg-3", e.message, false);
    }
  };

  $("#bk-pay").onclick = async () => {
    if (!state.booking) return;
    setMsg("#bk-msg-4", "Processing (mock)…", true);
    try {
      const { booking } = await api(`/api/bookings/${state.booking.id}/pay`, {
        method: "POST", body: "{}",
      });
      state.booking = booking;
      $("#bk-done").innerHTML = summaryRows(booking);
      showPane(5);
    } catch (e) {
      setMsg("#bk-msg-4", e.message, false);
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
        <label class="field">New date <input type="date" id="my-date" /></label>
        <div class="slot-grid" id="my-slots"></div>
        <button class="btn" id="my-resched-go" disabled>Confirm new time</button>
      </div>` : ""}`;

    if (!canManage) return;

    $("#my-cancel").onclick = async () => {
      if (!confirm("Cancel this booking? The policy in the FAQ applies.")) return;
      try {
        const data = await api(`/api/bookings/${b.id}/cancel`, {
          method: "POST", body: JSON.stringify({ email }),
        });
        setMsg("#my-action-msg",
          `Booking cancelled. Refund: ${data.booking.refund}.`, true);
        renderMyBooking(data.booking, email);
      } catch (e) { setMsg("#my-action-msg", e.message, false); }
    };

    const reschedBtn = $("#my-resched");
    if (reschedBtn) {
      let newDate = null, newTime = null;
      reschedBtn.onclick = () => $("#my-resched-box").classList.toggle("hidden");
      const dateEl = $("#my-date");
      dateEl.min = jstTodayPlus(3);
      dateEl.onchange = async () => {
        newDate = dateEl.value; newTime = null;
        $("#my-resched-go").disabled = true;
        const grid = $("#my-slots");
        grid.innerHTML = "<p class='note'>Loading times…</p>";
        try {
          const data = await api(`/api/availability?date=${newDate}`);
          grid.innerHTML = data.closed
            ? "<p class='note'>Closed on this day (Tue–Sat only).</p>" : "";
          for (const s of data.slots || []) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "slot" + (s.available ? "" : " off");
            btn.textContent = s.time;
            btn.disabled = !s.available;
            btn.onclick = () => {
              newTime = s.time;
              grid.querySelectorAll(".slot").forEach((x) => x.classList.remove("selected"));
              btn.classList.add("selected");
              $("#my-resched-go").disabled = false;
            };
            grid.appendChild(btn);
          }
        } catch (e) { grid.innerHTML = `<p class='msg msg-err'>${e.message}</p>`; }
      };
      $("#my-resched-go").onclick = async () => {
        try {
          const { booking } = await api(`/api/bookings/${b.id}/reschedule`, {
            method: "POST",
            body: JSON.stringify({ email, date: newDate, time: newTime }),
          });
          setMsg("#my-action-msg", "Rescheduled. See you then!", true);
          renderMyBooking(booking, email);
        } catch (e) { setMsg("#my-action-msg", e.message, false); }
      };
    }
  }
});
