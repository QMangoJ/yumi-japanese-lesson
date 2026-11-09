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
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale(),
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
  return new Date(ms).toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit" });
}
function fmtLocalDate(ms, long) {
  return new Date(ms).toLocaleDateString(locale(), long
    ? { weekday: "long", month: "long", day: "numeric", year: "numeric" }
    : { weekday: "short", month: "short", day: "numeric" });
}
function tzAbbr(ms) {
  const parts = new Intl.DateTimeFormat(locale(), { timeZoneName: "short" })
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
/** Visitor-local "YYYY-MM-DD" of an instant (browser timezone, DST-aware
 * via the platform tz database — getFullYear/Month/Date are local). */
function localDateOfMs(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** True when the visitor's own clock shows this instant at exactly
 * the same wall time as JST (same date, same hour and minute). The
 * comparison uses the actual conversion result for THIS instant —
 * never a timezone-name list — so a UTC+9 zone whose own DST rules
 * ever diverge from JST stops matching on its own. Wherever this
 * holds, the single local-time line (task 9: chips and cards show
 * ONE line of visitor-local time, the JST second line is gone)
 * simply carries a "JST" suffix instead of a foreign tz label —
 * a visitor in Tokyo was shown "8:00 AM GMT+9" stacked over
 * "JST 8:00 AM" for one and the same time, which reads as a bug. */
function localMatchesJst(ms) {
  const loc = new Date(ms);
  const jst = new Date(ms + 9 * 3600_000);
  return loc.getFullYear() === jst.getUTCFullYear() &&
    loc.getMonth() === jst.getUTCMonth() &&
    loc.getDate() === jst.getUTCDate() &&
    loc.getHours() === jst.getUTCHours() &&
    loc.getMinutes() === jst.getUTCMinutes();
}


/* ---------- i18n: en / zh / fr, ONE language at a time ----------
 * Dictionaries live in i18n.js (window.YUMI_I18N), keyed by the
 * current source string. The engine walks visible text nodes and
 * swaps each for the active language; a MutationObserver re-applies
 * it to dynamically rendered content. Review bodies (#voices-grid)
 * are real Preply reviews and are never translated. Dates/times are
 * formatted with the active locale via Intl — the JST anchoring and
 * timezone conversion logic itself is untouched. */
const I18N_LOCALES = { en: "en-US", zh: "zh-CN", fr: "fr-FR" };
const LANG_NAMES = { en: "English", zh: "中文", fr: "Français" };
let LANG = (() => { try { const s = localStorage.getItem("yumi_lang"); return ["en", "zh", "fr"].includes(s) ? s : "en"; } catch { return "en"; } })();
function locale() { return I18N_LOCALES[LANG]; }
function L3(en, zh, fr) { return LANG === "zh" ? zh : LANG === "fr" ? fr : en; }
const _i18nNorm = (s) => s.replace(/\s+/g, " ").trim();
const I18N_PATTERNS = [
  { re: /^(\d+) start times? available$/,
    en: (m) => `${m[1]} start time${m[1] === "1" ? "" : "s"} available`,
    zh: (m) => `有 ${m[1]} 个可选开始时间`,
    fr: (m) => `${m[1]} horaire${m[1] === "1" ? "" : "s"} disponible${m[1] === "1" ? "" : "s"}` },
  { re: /^Pay (.+)$/,
    en: (m) => `Pay ${m[1]}`, zh: (m) => `支付 ${m[1]}`, fr: (m) => `Payer ${m[1]}` },
  { re: /^Pick a new date & time \((\d+) min lesson\)$/,
    en: (m) => `Pick a new date & time (${m[1]} min lesson)`,
    zh: (m) => `选择新的日期和时间（${m[1]} 分钟课程）`,
    fr: (m) => `Choisir une nouvelle date et heure (cours de ${m[1]} min)` },
  { re: /^Reschedules used: (\d+) \/ 2 · .+$/,
    en: (m) => `Reschedules used: ${m[1]} / 2 · Cancel 12+ hours ahead for a full refund; inside 12 hours there is no refund.`,
    zh: (m) => `已改期：${m[1]} / 2 · 开课前 12 小时以上取消可全额退款；12 小时内取消不退款。`,
    fr: (m) => `Déplacements utilisés : ${m[1]} / 2 · Annulez 12 h ou plus à l'avance pour un remboursement intégral ; à moins de 12 h, aucun remboursement.` },
  { re: /^Hello, (.+)\.$/,
    en: (m) => `Hello, ${m[1]}.`, zh: (m) => `你好，${m[1]}。`, fr: (m) => `Bonjour, ${m[1]}.` },
];
function _i18nLookup(key) {
  const dict = (window.YUMI_I18N || {})[LANG] || {};
  if (dict[key] !== undefined) return dict[key];
  for (const p of I18N_PATTERNS) { const m = key.match(p.re); if (m) return p[LANG](m); }
  return null;
}
/* Source (English) text of every translated node / placeholder, so
 * switching between two non-source languages (fr -> zh) restores
 * the English source first instead of looking up French strings. */
const _i18nSrc = new WeakMap();
const _i18nPhSrc = new WeakMap();
let _i18nApplying = false;
function applyI18n() {
  if (!document.body || _i18nApplying) return;
  _i18nApplying = true;
  try {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const el = node.parentElement;
        if (!el || el.closest("script, style, #voices-grid, .lang-pop")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      let src = _i18nSrc.get(n);
      if (src === undefined) { src = n.nodeValue; _i18nSrc.set(n, src); }
      const srcKey = _i18nNorm(src);
      const rep = _i18nLookup(srcKey);
      /* Replace the whole trimmed core (raw whitespace inside a
       * multi-line node never matches the normalized key). */
      let target = src;
      if (rep != null) {
        const m = src.match(/^(\s*)[\s\S]*?(\s*)$/);
        target = (m ? m[1] : "") + rep + (m ? m[2] : "");
      }
      if (target !== n.nodeValue) n.nodeValue = target;
    }
    document.querySelectorAll("[placeholder]").forEach((el) => {
      let src = _i18nPhSrc.get(el);
      if (src === undefined) { src = el.getAttribute("placeholder"); _i18nPhSrc.set(el, src); }
      if (!src) return;
      const dict = (window.YUMI_I18N || {})[LANG] || {};
      const target = dict[src] !== undefined ? dict[src] : src;
      if (target !== el.getAttribute("placeholder")) el.setAttribute("placeholder", target);
    });
  } finally { _i18nApplying = false; }
}
function setLang(l) {
  if (!["en", "zh", "fr"].includes(l)) return;
  LANG = l;
  try { localStorage.setItem("yumi_lang", l); } catch { /* private mode */ }
  document.documentElement.lang = I18N_LOCALES[l];
  document.querySelectorAll(".lang-switch").forEach((w) => {
    w.querySelector(".lang-cur").textContent = LANG_NAMES[l];
    w.querySelectorAll("[data-lang]").forEach((b) => b.classList.toggle("active", b.dataset.lang === l));
  });
  applyI18n();
}
function buildLangSwitch() {
  document.querySelectorAll(".site-header").forEach((h) => {
    if (h.querySelector(".lang-switch")) return;
    const wrap = document.createElement("div");
    wrap.className = "lang-switch";
    wrap.innerHTML = `<button type="button" class="lang-btn" aria-haspopup="true" aria-expanded="false">🌐 <span class="lang-cur">${LANG_NAMES[LANG]}</span> <span aria-hidden="true">▾</span></button>` +
      `<div class="lang-pop" hidden>${["en", "zh", "fr"].map((l) => `<button type="button" data-lang="${l}" class="${l === LANG ? "active" : ""}">${LANG_NAMES[l]}</button>`).join("")}</div>`;
    h.insertBefore(wrap, h.querySelector(".open-booking") || null);
    const btn = wrap.querySelector(".lang-btn");
    const pop = wrap.querySelector(".lang-pop");
    btn.addEventListener("click", (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; btn.setAttribute("aria-expanded", String(!pop.hidden)); });
    document.addEventListener("click", () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); });
    pop.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => { setLang(b.dataset.lang); pop.hidden = true; }));
  });
}
const WEEKDAYS_LONG = { en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  zh: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"],
  fr: ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"] };
const WEEKDAYS_SHORT = { en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  zh: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"],
  fr: ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."] };
function weekdayLong(wd) { return WEEKDAYS_LONG[LANG][Number(wd)]; }
function weekdayShort(wd) { return WEEKDAYS_SHORT[LANG][Number(wd)]; }
document.documentElement.lang = I18N_LOCALES[LANG];
document.addEventListener("DOMContentLoaded", () => {
  buildLangSwitch();
  applyI18n();
  new MutationObserver(() => applyI18n())
    .observe(document.body, { childList: true, subtree: true, characterData: true });
});

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

/* ---------- custom confirm dialog (uiConfirm) ----------
 * Promise-based replacement for native confirm(): resolves true
 * only via the OK button; Cancel, Esc and backdrop clicks resolve
 * false — the exact semantics the old `if (!confirm(...)) return;`
 * call sites relied on. Destructive actions pass { danger: true }
 * (red OK button, focus starts on Cancel). One lazily-built overlay
 * element is shared by every call site (homepage + /account). */

let uiConfirmResolve = null;
let uiConfirmPrevOverflow = "";
function uiConfirmKey(e) {
  if (e.key === "Escape") { e.preventDefault(); uiConfirmClose(false); }
}
function uiConfirmClose(result) {
  const overlay = document.getElementById("ui-confirm");
  if (overlay) {
    overlay.classList.remove("show");
    setTimeout(() => overlay.classList.remove("open"), 190);
  }
  document.removeEventListener("keydown", uiConfirmKey, true);
  document.body.style.overflow = uiConfirmPrevOverflow;
  if (uiConfirmResolve) { const r = uiConfirmResolve; uiConfirmResolve = null; r(result); }
}
function uiConfirm(message, opts = {}) {
  return new Promise((resolve) => {
    let overlay = document.getElementById("ui-confirm");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "ui-confirm";
      overlay.className = "ui-confirm-overlay";
      overlay.setAttribute("role", "alertdialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.innerHTML = `
        <div class="ui-confirm-card">
          <p class="ui-confirm-msg"></p>
          <div class="ui-confirm-actions">
            <button type="button" class="btn btn-ghost ui-confirm-cancel"></button>
            <button type="button" class="btn ui-confirm-ok"></button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector(".ui-confirm-ok").addEventListener("click", () => uiConfirmClose(true));
      overlay.querySelector(".ui-confirm-cancel").addEventListener("click", () => uiConfirmClose(false));
      overlay.addEventListener("click", (e) => { if (e.target === overlay) uiConfirmClose(false); });
    }
    if (uiConfirmResolve) uiConfirmClose(false);
    uiConfirmResolve = resolve;
    overlay.querySelector(".ui-confirm-msg").textContent = message;
    const ok = overlay.querySelector(".ui-confirm-ok");
    const cancel = overlay.querySelector(".ui-confirm-cancel");
    ok.textContent = L3("OK", "确定", "OK");
    cancel.textContent = L3("Cancel", "取消", "Annuler");
    ok.classList.toggle("ui-confirm-danger", !!opts.danger);
    uiConfirmPrevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    overlay.classList.add("open");
    requestAnimationFrame(() => overlay.classList.add("show"));
    document.addEventListener("keydown", uiConfirmKey, true);
    (opts.danger ? cancel : ok).focus();
  });
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

/** The sign-in gate pane: shown instead of pane 3 when a signed-out
 *  student advances from Details to Payment. The stepper treats it
 *  as step 3 (steps 1–2 done, 3 active). */
function showGate() {
  flowDone = false;
  document.querySelectorAll(".bk-pane").forEach((p) =>
    p.classList.toggle("hidden", p.dataset.pane !== "gate"));
  document.querySelectorAll("#bk-steps li").forEach((li) => {
    const s = Number(li.dataset.step);
    li.classList.toggle("active", s === 3);
    li.classList.toggle("done", s < 3);
  });
}

/* ==== BK-DRAFT-BEGIN ==== */
/* Booking draft for the payment sign-in gate (Daniel's decision,
 * 2026-11-06: sign-in BEFORE payment, with the in-progress state
 * preserved across the OAuth redirect in browser local storage —
 * he approved local storage explicitly). When a signed-out student
 * advances from Details to Payment, the draft is saved, the student
 * goes through Google sign-in, and on return the draft is restored
 * and the flow resumes at the Payment step. Drafts expire after 24
 * hours and are cleared once a booking completes. The helpers take
 * the storage object as a parameter so the harness can drive them
 * directly against a fake store. */
const BK_DRAFT_KEY = "yumi_booking_draft_v1";
const BK_DRAFT_MAX_AGE_MS = 24 * 3600 * 1000;

/** The gate applies only when Google sign-in is actually on. */
function bkNeedsGate(googleAuth, user) {
  return !!googleAuth && !user;
}
function bkDraftSave(store, draft) {
  try {
    store.setItem(BK_DRAFT_KEY,
      JSON.stringify({ ...draft, savedAt: Date.now() }));
    return true;
  } catch { return false; }
}
function bkDraftLoad(store, now = Date.now()) {
  try {
    const raw = store.getItem(BK_DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d !== "object" || typeof d.savedAt !== "number" ||
        d.savedAt > now || now - d.savedAt > BK_DRAFT_MAX_AGE_MS) {
      store.removeItem(BK_DRAFT_KEY);
      return null;
    }
    return d;
  } catch { return null; }
}
function bkDraftClear(store) {
  try { store.removeItem(BK_DRAFT_KEY); } catch { /* ignore */ }
}
/* ==== BK-DRAFT-END ==== */

/* ---------- Booking modal (Sakura-style pop-up) ----------
 * Selections (course / duration / date / time) live in `state` and in the
 * picker, so they survive a close + reopen within the same page visit.
 * Only a completed booking resets: the next open starts fresh at pane 1.
 */
/* Full-reset hook for a COMPLETED flow, installed by the booking
 * wiring (resetBookingFlow) once it runs. Resetting on close —
 * not on open — is the fix for the stale Done page: the old
 * open-time reset was gated on (state.booking || state.pkgOrder),
 * but the package pay path nulls pkgOrder before showing Done,
 * so the condition never held and the result page survived. */
let bkResetHook = null;

function openBooking() {
  if (flowDone && bkResetHook) bkResetHook();
  else if ((state.booking || state.pkgOrder) && flowDone) {
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
  /* Any close path (×, overlay, Esc, the Done pane's button) after
   * a completed booking resets the whole flow, so the next open is
   * a fresh Step 1. Mid-flow closes (panes 1–3, gate) are NOT
   * touched: their selections survive a close + reopen as before. */
  if (flowDone && bkResetHook) bkResetHook();
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
/* Package sizes offered by the worker (PACKAGE_SIZES in worker.js).
 * Package totals are ALWAYS size × the per-lesson price for the chosen
 * duration — exactly how the worker computes totalPrice in
 * POST /api/packages (priceFor × size). There is no package discount,
 * so no discount badge is ever shown here. */
const PACKAGE_SIZES = [6, 10, 20];
function renderPrices() {
  const tb = $("#price-rows");
  if (!tb || !state.config) return;
  const ds = state.config.durations;
  tb.innerHTML = ds.map((d) => `
    <div class="price-row" role="row" data-duration="${d.id}">
      <span class="price-dur">${d.minutes} min</span>
      <span class="price-amt">$${d.price}</span>
      <span class="price-per">$${d.price} per lesson</span>
      <span class="price-action"><button type="button" class="btn btn-small" data-book-duration="${d.id}">Book</button></span>
    </div>`).join("");
  const pkgBox = $("#price-packages");
  if (pkgBox) {
    pkgBox.innerHTML = PACKAGE_SIZES.map((size) => `
      <div class="price-pkg-row">
        <div class="price-pkg-main">
          <strong>${size} lessons</strong>
          <span class="price-pkg-per">per lesson: ${ds.map((d) => `$${d.price} (${d.minutes} min)`).join(" · ")}</span>
        </div>
        <div class="price-pkg-totals">${ds.map((d) =>
          `<span><small>${d.minutes} min</small><b>$${size * d.price}</b></span>`).join("")}</div>
        <button type="button" class="btn btn-small" data-buy-package="${size}">Buy</button>
      </div>`).join("");
  }
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
 * Builds a month calendar element and an "Available times" chip-grid
 * element; the caller places them. onPick(date, time) fires whenever
 * either changes.
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
    <div class="field">Available times
      <p class="note picker-tznote"></p>
      <div class="time-grid"><p class="time-hint">Choose a date first</p></div>
    </div>
    <p class="note picker-note"></p>`;
  const grid = timesEl.querySelector(".time-grid");
  const note = timesEl.querySelector(".picker-note");
  const tzNote = timesEl.querySelector(".picker-tznote");

  /* Task 9 (Daniel's final call): chips show ONE line — the
   * visitor's own local time — and this note, pinned above the
   * grid, says whose clock that is. When the picked JST date lands
   * on a different local date, a second sentence spells out the
   * correspondence ("Japan Nov 16 = your Nov 15") so the day shift
   * is never a silent surprise. A visitor whose clock IS JST gets
   * the plain JST wording instead. */
  function renderTzNote(crossMs) {
    const noonJst = jstInstantMs(jstToday(), "12:00");
    if (localMatchesJst(crossMs ?? noonJst)) {
      tzNote.textContent = L3(
        "Times are shown in Japan time (JST).",
        "时间按日本时间（JST）显示。",
        "Les horaires sont affichés à l'heure du Japon (JST).");
      return;
    }
    let text = L3(
      `Times are shown in your timezone (${localTZName}).`,
      `时间按你的时区显示（${localTZName}）。`,
      `Les horaires sont affichés dans votre fuseau horaire (${localTZName}).`);
    if (crossMs != null) {
      const jstDay = new Intl.DateTimeFormat(locale(),
        { timeZone: "Asia/Tokyo", weekday: "short", month: "short", day: "numeric" }).format(crossMs);
      text += " " + L3(
        `Japan ${jstDay} = your ${fmtLocalDate(crossMs)}.`,
        `日本 ${jstDay} = 你的 ${fmtLocalDate(crossMs)}。`,
        `Japon : ${jstDay} = votre ${fmtLocalDate(crossMs)}.`);
    }
    tzNote.textContent = text;
  }
  renderTzNote(null);

  function markSelectedChip() {
    grid.querySelectorAll(".time-chip").forEach((chip) => {
      const on = !chip.disabled && chip.dataset.time === time;
      chip.classList.toggle("selected", on);
      chip.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  const minDate = () => addDays(jstToday(), 3); // 72-hour rule, at date level
  const maxMonth = () => {
    const t = jstToday();
    const idx = Number(t.slice(0, 4)) * 12 + Number(t.slice(5, 7)) - 1 + 3;
    return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
  };

  function renderCal() {
    const { y, m } = view;
    const title = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale(),
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
    grid.innerHTML = `<p class="time-hint">Checking availability…</p>`;
    note.textContent = "Checking availability…";
    renderTzNote(null);
    try {
      const data = await api(`/api/availability?date=${date}&duration=${getMinutes()}`);
      if (token !== loadToken) return;
      if (data.closed) {
        grid.innerHTML = `<p class="time-hint">Closed on this day</p>`;
        note.textContent = data.blocked
          ? "Not available on this date — please pick another day."
          : "Closed on this day.";
        return;
      }
      if (!data.slots.length) {
        grid.innerHTML = `<p class="time-hint">No times available</p>`;
        note.textContent = "No times are available on this date.";
        return;
      }
      const open = data.slots.filter((s) => s.available);
      // Sakura-style: pre-select the first available start time.
      time = open.length ? open[0].time : null;
      const minutes = getMinutes();
      grid.innerHTML = "";
      for (const s of data.slots) {
        const lr = localRange(date, s.time, minutes);
        // Show the local date too when it differs from the JST calendar day
        // (e.g. an 08:00 JST Monday slot is Sunday evening in the Americas).
        // NB: compare against the visitor-LOCAL date — comparing the
        // JST date of the instant with `date` is a tautology (the
        // instant was built from `date`), which silently suppressed
        // this prefix until the 2026-11-07 DST audit caught it.
        const dayPrefix = localDateOfMs(lr.start) !== date ? `${fmtLocalDate(lr.start)} · ` : "";
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "time-chip";
        chip.dataset.time = s.time;
        chip.disabled = !s.available;
        // Task 9: ONE line only — the visitor's local range (with
        // the local-date prefix when the day shifts). The JST
        // second line is gone by Daniel's decision; the pinned
        // tz note above the grid carries the timezone context.
        chip.innerHTML = localMatchesJst(lr.start)
          ? `<span class="tc-main">${lr.text} JST</span>`
          : `<span class="tc-main">${dayPrefix}${lr.text} ${tzAbbr(lr.start)}</span>`;
        if (s.available) {
          chip.onclick = () => { time = s.time; markSelectedChip(); onPick(date, time); };
        }
        grid.appendChild(chip);
      }
      markSelectedChip();
      // Cross-day? The first open slot whose local date differs
      // from the JST calendar date drives the tz note's second
      // sentence ("Japan Mon, Nov 16 = your Sun, Nov 15").
      const cross = open.length
        ? localRange(date, open[0].time, minutes) : null;
      renderTzNote(cross && localDateOfMs(cross.start) !== date ? cross.start : null);
      if (!open.length) {
        note.textContent = "No times are available on this date.";
        return;
      }
      note.textContent = `${open.length} start time${open.length === 1 ? "" : "s"} available`;
      onPick(date, time);
    } catch (e) {
      if (token !== loadToken) return;
      grid.innerHTML = `<p class="time-hint">Could not load times</p>`;
      note.textContent = e.message;
    }
  }

  function pickDate(ds) {
    date = ds;
    renderCal();
    loadTimes();
  }

  renderCal();
  loadMonth();
  return {
    calEl, timesEl,
    setMinutes() { if (date) loadTimes(); loadMonth(); },
    get date() { return date; },
    get time() { return time; },
    /* Restore a previously picked date+time (booking-draft resume
     * after the sign-in round-trip): jump the calendar to that
     * month, load its times, then select the requested time.
     * loadTimes pre-selects the first available slot, so the
     * requested time is applied after it settles. Resolves true
     * only when the requested time ended up selected. */
    async setSelection(ds, ts) {
      date = ds;
      view = { y: Number(ds.slice(0, 4)), m: Number(ds.slice(5, 7)) };
      renderCal();
      loadMonth();
      await loadTimes();
      if (!ts) return true;
      const chip = [...grid.querySelectorAll(".time-chip")]
        .find((c) => c.dataset.time === ts && !c.disabled);
      if (!chip) return false;
      time = ts;
      markSelectedChip();
      onPick(date, time);
      return true;
    },
    /* Full reset (a completed booking flow starts over): back to
     * the current month with nothing picked. */
    reset() {
      date = null;
      time = null;
      const t = jstToday();
      view = { y: Number(t.slice(0, 4)), m: Number(t.slice(5, 7)) };
      grid.innerHTML = `<p class="time-hint">Choose a date first</p>`;
      note.textContent = "";
      renderTzNote(null);
      renderCal();
      loadMonth();
      onPick(null, null);
    },
  };
}

/* ---------- Summary ---------- */

function summaryRows(b) {
  const minutes = minutesOfBooking(b);
  const lr = localRange(b.date, b.time, minutes);
  const rows = [["Course", courseName(b.courseId)]];
  if (b.lessonTypeId && !b.durationId) rows.push(["Lesson type", legacyName(b.lessonTypeId)]);
  // Task 9: Date/Time rows are ONE line of the visitor's local
  // time everywhere (booking summary, Done pane, My bookings /
  // /account cards) — no JST second value. A visitor whose clock
  // IS JST just gets the JST suffix on the same single line.
  const sameTz = localMatchesJst(lr.start);
  rows.push(
    ["Duration", `${minutes} min`],
    ["Date", fmtLocalDate(lr.start, true)],
    ["Time", sameTz ? `${lr.text} JST`
      : `${lr.text} ${tzAbbr(lr.start)}`],
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
  // Pane 4's "Go to My Bookings" button: close the modal, then go to /account.
  const goMy = document.querySelector('.bk-pane[data-pane="4"] .bk-nav a[href="/account"]');
  if (goMy) goMy.addEventListener("click", closeBooking);

  /* Contact form — posts to /api/contact (archive + teacher email).
   * The success state shows ONLY after the server confirms; a failed
   * send surfaces an error and keeps the visitor's text. The hidden
   * #contact-website honeypot rides along (bots fill it, the server
   * silently drops those). */
  const contactForm = $("#contact-form");
  if (contactForm) {
    contactForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = $("#contact-name").value.trim();
      const email = $("#contact-email").value.trim();
      const message = $("#contact-message").value.trim();
      if (!name) return setMsg("#contact-msg", "Please enter your name.", false);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return setMsg("#contact-msg", "Please enter a valid email address.", false);
      }
      if (!message) return setMsg("#contact-msg", "Please write a message.", false);
      setMsg("#contact-msg", "");
      const btn = $("#contact-submit");
      const btnLabel = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Sending…";
      try {
        await api("/api/contact", {
          method: "POST",
          body: JSON.stringify({ name, email, message,
            website: $("#contact-website")?.value || "" }),
        });
        btn.textContent = "Message sent ✓";
        $("#contact-success").classList.remove("hidden");
        contactForm.querySelectorAll("input, textarea").forEach((el) => { el.value = ""; });
      } catch (err) {
        btn.disabled = false;
        btn.textContent = btnLabel;
        setMsg("#contact-msg",
          err.message || "Something went wrong while sending — please try again.", false);
      }
    });
  }

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

  /* Duration pickers are chip groups (no native selects): both the
   * single-lesson and package containers render the same options
   * with the CONFIGURED prices, and stay in sync. */
  function renderDurations() {
    for (const [sel, fromPackage] of [["#bk-duration", false], ["#bk-pkg-duration", true]]) {
      const box = $(sel);
      box.innerHTML = "";
      for (const d of state.config.durations) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "dur-chip" + (d.id === state.durationId ? " selected" : "");
        b.setAttribute("aria-pressed", d.id === state.durationId ? "true" : "false");
        b.innerHTML = `<span class="dur-min">${d.minutes} min</span>` +
          `<span class="dur-price">${money(d.price)}</span>`;
        b.onclick = () => applyDuration(d.id, fromPackage);
        box.appendChild(b);
      }
    }
  }

  function applyDuration(id, fromPackage) {
    state.durationId = id;
    renderDurations();
    if (!fromPackage) picker.setMinutes();
    renderPkgSizes();
    renderPkgSlots();
    refreshSummary();
  }

  function refreshSummary() {
    if (state.mode === "package") {
      renderPkgSummary();
      refreshContinue();
      return;
    }
    const dur = durationOf(state.durationId);
    const sel = $("#bk-selected");
    if (state.date && state.time && dur) {
      const lr = localRange(state.date, state.time, dur.minutes);
      sel.textContent = localMatchesJst(lr.start)
        ? `${L3("Selected", "已选", "Sélection")} : ${fmtLocalDate(lr.start, true)}, ${lr.text} JST`
        : `${L3("Selected", "已选", "Sélection")} : ${fmtLocalDate(lr.start, true)}, ${lr.text} (${tzAbbr(lr.start)} · ${localTZName})`;
    } else {
      sel.textContent = "Selected: choose a date and a time";
    }
    $("#bk-total").innerHTML = dur ? `
      <div class="bk-total-row"><span>${courseName(state.courseId || "other")}</span></div>
      <div class="bk-total-row"><span>${dur.minutes} min lesson</span><span>${money(dur.price)}</span></div>
      <div class="bk-total-row bk-total-sum"><span>Total</span><span>${money(dur.price)}</span></div>
      <p class="note">Lessons are online: your meeting link is sent after booking and payment.</p>` : "";
    refreshContinue();
  }


  /* ---------- Lesson packages (课时包 · 每周固定时间) ----------
   * Pane 1 in package mode: package size (6/10/20), 1–3 fixed weekly
   * slots (weekday + start time, duration-aware via the availability
   * API), and a plan summary. Checkout creates a pending package via
   * POST /api/packages and pays it via POST /api/subscriptions/:id/pay,
   * which materializes every lesson at once. */
  const pkg = { size: 10, freq: 1, slots: [{ weekday: "", time: "" }] };
  const pkgTimeCache = {};
  const WEEKDAY_LABELS = WEEKDAYS_LONG.en;
  const WEEKDAY_CN = ["日", "一", "二", "三", "四", "五", "六"];

  /* ---------- package slot conflicts (task 3) ----------
   * Two fixed slots clash when they share a weekday and their
   * lesson ranges intersect: identical starts are the special case
   * "same"; a 120-min slot at 19:00 also collides with one at
   * 20:00. (The worker rejects both cases too — the front end now
   * catches them at pick time and says exactly where.) */
  function pkgConflicts() {
    const minutes = durationOf(state.durationId)?.minutes || 50;
    const out = [];
    for (let i = 0; i < pkg.slots.length; i++) {
      for (let j = i + 1; j < pkg.slots.length; j++) {
        const a = pkg.slots[i], b = pkg.slots[j];
        if (a.weekday === "" || b.weekday === "" || !a.time || !b.time) continue;
        if (String(a.weekday) !== String(b.weekday)) continue;
        const as = toMin(a.time), bs = toMin(b.time);
        if (as === bs) {
          out.push({ i, j, kind: "same", weekday: a.weekday, time: a.time });
        } else if (as < bs + minutes && bs < as + minutes) {
          out.push({ i, j, kind: "overlap", weekday: a.weekday,
            time: a.time, time2: b.time });
        }
      }
    }
    return out;
  }

  /** One sentence naming both slots of a conflict (summary banner,
   *  Continue tooltip). */
  function pkgConflictText(c) {
    const minutes = durationOf(state.durationId)?.minutes || 50;
    const wd = weekdayLong(c.weekday);
    if (c.kind === "same") {
      return L3(
        `Weekly slots ${c.i + 1} and ${c.j + 1} are set to the same time: ${wd} ${c.time} — please change one of them.`,
        `固定时间 ${c.i + 1} 和 ${c.j + 1} 设成了完全相同的时间：${wd} ${c.time}，请改掉其中一个。`,
        `Les créneaux hebdomadaires ${c.i + 1} et ${c.j + 1} sont réglés à la même heure : ${wd} ${c.time} — veuillez en modifier un.`);
    }
    const e1 = minToHHMM(toMin(c.time) + minutes);
    const e2 = minToHHMM(toMin(c.time2) + minutes);
    return L3(
      `Weekly slots ${c.i + 1} and ${c.j + 1} overlap: ${wd} ${c.time}–${e1} and ${c.time2}–${e2} run into each other — please change one of them.`,
      `固定时间 ${c.i + 1} 和 ${c.j + 1} 时间重叠：${wd} ${c.time}–${e1} 与 ${c.time2}–${e2} 相撞，请改掉其中一个。`,
      `Les créneaux hebdomadaires ${c.i + 1} et ${c.j + 1} se chevauchent : ${wd} ${c.time}–${e1} et ${c.time2}–${e2} se percutent — veuillez en modifier un.`);
  }

  /** The inline line under ONE conflicting slot, naming the other. */
  function pkgSlotErrorText(k, other, c) {
    const minutes = durationOf(state.durationId)?.minutes || 50;
    const wd = weekdayLong(c.weekday);
    if (c.kind === "same") {
      return L3(
        `Same as Weekly slot ${other + 1}: ${wd} ${c.time} — the two fixed times cannot be identical, please change one of them.`,
        `与固定时间 ${other + 1} 相同：${wd} ${c.time}——两个固定时间不能完全相同，请改掉其中一个。`,
        `Identique au créneau hebdomadaire ${other + 1} : ${wd} ${c.time} — les deux horaires fixes ne peuvent pas être identiques, veuillez en modifier un.`);
    }
    const own = pkg.slots[k], oth = pkg.slots[other];
    const oe = minToHHMM(toMin(own.time) + minutes);
    const xe = minToHHMM(toMin(oth.time) + minutes);
    return L3(
      `Overlaps Weekly slot ${other + 1}: ${wd} ${own.time}–${oe} runs into ${oth.time}–${xe} — please change one of them.`,
      `与固定时间 ${other + 1} 时间重叠：${wd} ${own.time}–${oe} 与 ${oth.time}–${xe} 相撞，请改掉其中一个。`,
      `Chevauche le créneau hebdomadaire ${other + 1} : ${wd} ${own.time}–${oe} percute ${oth.time}–${xe} — veuillez en modifier un.`);
  }

  function flashEl(el) {
    el.classList.remove("flash");
    void el.offsetWidth; // restart the CSS animation
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1800);
  }

  let pkgConflictSeen = false;
  /** Paint conflict state onto the slot rows + summary banner.
   *  Called from renderPkgSummary, which every slot interaction
   *  funnels through. A NEWLY appearing conflict scrolls the first
   *  offending slot into view and flashes it. */
  function refreshPkgSlotErrors() {
    const conflicts = pkgConflicts();
    const rows = [...document.querySelectorAll("#bk-pkg-slots .pkg-slot")];
    const bySlot = new Map();
    for (const c of conflicts) {
      bySlot.set(c.i, { other: c.j, c });
      bySlot.set(c.j, { other: c.i, c });
    }
    rows.forEach((row, k) => {
      const hit = bySlot.get(k);
      row.classList.toggle("conflict", !!hit);
      const err = row.querySelector(".pkg-slot-err");
      if (err) {
        err.textContent = hit ? pkgSlotErrorText(k, hit.other, hit.c) : "";
        err.classList.toggle("hidden", !hit);
      }
    });
    const summary = $("#bk-pkg-summary");
    if (summary) summary.classList.toggle("alert", conflicts.length > 0);
    if (conflicts.length && !pkgConflictSeen) {
      const first = rows[Math.min(...conflicts.map((c) => c.i))];
      if (first) {
        first.scrollIntoView({ block: "nearest", behavior: "smooth" });
        flashEl(first);
      }
    }
    pkgConflictSeen = conflicts.length > 0;
    return conflicts;
  }

  /* ---------- Continue gating (tasks 3 + 4) ----------
   * One place decides whether Step 1's Continue is enabled, and
   * WHY not — the reason rides on the wrapper (#bk-to-2-wrap) as a
   * hover tooltip, and a tap on the disabled button scrolls to the
   * problem. Course is deliberately NOT a reason: an unpicked
   * course silently defaults to Other on Continue (task 4). */
  function continueBlockReason() {
    if (state.mode === "package") {
      const bad = pkg.slots.findIndex((s) => s.weekday === "" || !s.time);
      if (bad >= 0) {
        return L3(
          `Weekly slot ${bad + 1} is not set yet — pick a weekday and a start time for it.`,
          `固定时间 ${bad + 1} 还没选好——请为它选择星期和开始时间。`,
          `Le créneau hebdomadaire ${bad + 1} n'est pas encore réglé — choisissez un jour et une heure de début.`);
      }
      const cs = pkgConflicts();
      if (cs.length) return pkgConflictText(cs[0]);
      return "";
    }
    if (!state.date || !state.time) {
      return L3("Please pick a date and a time first.",
        "请先选择日期和时间。",
        "Veuillez d'abord choisir une date et une heure.");
    }
    return "";
  }

  function refreshContinue() {
    const reason = continueBlockReason();
    const btn = $("#bk-to-2");
    if (btn) btn.disabled = !!reason;
    const wrap = $("#bk-to-2-wrap");
    if (wrap) {
      wrap.classList.toggle("has-reason", !!reason);
      if (reason) wrap.dataset.reason = reason;
      else delete wrap.dataset.reason;
    }
  }

  /** Task 4: no course picked → Continue books "Other", silently. */
  function ensureCourseDefault() {
    if (state.courseId) return;
    const other = state.config?.courses.find((c) => c.id === "other");
    if (!other) return;
    state.courseId = other.id;
    renderCourses();   // the Other chip lights up as it takes effect
    refreshSummary();
  }

  function pkgComplete() {
    if (pkg.slots.length !== pkg.freq) return false;
    return pkg.slots.every((s) => s.weekday !== "" && s.time) &&
      pkgConflicts().length === 0;
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
      b.innerHTML = L3(`${size} lessons`, `${size} 节课`, `${size} cours`) +
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
      b.textContent = L3(`${f}× / week`, `一周${f}节`, `${f}× / semaine`);
      b.onclick = () => {
        pkg.freq = f;
        while (pkg.slots.length < f) pkg.slots.push({ weekday: "", time: "" });
        pkg.slots.length = f;
        renderPkgFreq(); renderPkgSlots(); renderPkgSummary();
        refreshContinue();
      };
      $("#bk-pkg-freq").appendChild(b);
    }
  }

  function renderPkgSlots() {
    const box = $("#bk-pkg-slots");
    box.innerHTML = "";
    const WD_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    pkg.slots.forEach((slot, i) => {
      const row = document.createElement("div");
      row.className = "pkg-slot";
      row.innerHTML = `
        <span class="pkg-slot-title">${L3("Weekly slot", "固定时间", "Créneau hebdomadaire")} ${i + 1}</span>
        <div class="field">${L3("Weekday", "星期", "Jour de la semaine")}
          <div class="wd-chips" role="group" aria-label="Weekday"></div></div>
        <div class="field">${L3("Start time (JST)", "开始时间 (JST)", "Heure de début (JST)")}
          <div class="time-chips-sm"><p class="time-hint">${L3("Pick a weekday first…", "先选星期…", "Choisissez d'abord un jour…")}</p></div></div>
        <p class="pkg-slot-err hidden" role="alert"></p>`;
      box.appendChild(row);
      const wdBox = row.querySelector(".wd-chips");
      const timeBox = row.querySelector(".time-chips-sm");
      WEEKDAY_LABELS.forEach((label, wd) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "wd-chip" + (String(wd) === String(slot.weekday) ? " selected" : "");
        b.setAttribute("aria-pressed", String(wd) === String(slot.weekday) ? "true" : "false");
        b.textContent = weekdayShort(wd);
        b.title = weekdayLong(wd);
        b.onclick = () => {
          slot.weekday = String(wd);
          slot.time = "";
          wdBox.querySelectorAll(".wd-chip").forEach((c, ci) => {
            c.classList.toggle("selected", ci === wd);
            c.setAttribute("aria-pressed", ci === wd ? "true" : "false");
          });
          fillTimes();
        };
        wdBox.appendChild(b);
      });
      const fillTimes = async () => {
        if (slot.weekday === "") {
          timeBox.innerHTML = `<p class="time-hint">${L3("Pick a weekday first…", "先选星期…", "Choisissez d'abord un jour…")}</p>`;
          return;
        }
        timeBox.innerHTML = `<p class="time-hint">${L3("Loading…", "加载中…", "Chargement…")}</p>`;
        const minutes = durationOf(state.durationId)?.minutes || 50;
        const times = await pkgSlotTimes(Number(slot.weekday), minutes);
        if (slot.time && !times.includes(slot.time)) slot.time = "";
        if (!times.length) {
          timeBox.innerHTML = `<p class="time-hint">${L3("No times available on this weekday for now", "这一天暂时没有可约时间", "Aucun horaire disponible ce jour-là pour le moment")}</p>`;
        } else {
          timeBox.innerHTML = "";
          for (const t of times) {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "time-chip sm" + (t === slot.time ? " selected" : "");
            chip.setAttribute("aria-pressed", t === slot.time ? "true" : "false");
            chip.innerHTML = `<span class="tc-main">${t} JST</span>`;
            chip.onclick = () => {
              slot.time = t;
              timeBox.querySelectorAll(".time-chip").forEach((c) => {
                const on = c === chip;
                c.classList.toggle("selected", on);
                c.setAttribute("aria-pressed", on ? "true" : "false");
              });
              renderPkgSummary();
              refreshContinue();
            };
            timeBox.appendChild(chip);
          }
        }
        renderPkgSummary();
        refreshContinue();
      };
      if (slot.weekday !== "") fillTimes();
    });
  }

  function renderPkgSummary() {
    const dur = durationOf(state.durationId);
    const dates = pkgPlanDates();
    const summary = $("#bk-pkg-summary");
    if (!dur) { summary.textContent = L3("Please choose your fixed weekly lesson times", "请选择每周固定的上课时间", "Veuillez choisir vos horaires hebdomadaires fixes"); return; }
    if (dates && pkgComplete()) {
      summary.textContent =
        L3(`${pkg.freq}× / week · ${pkg.size} lessons · planned ${dates[0]} → ${dates[dates.length - 1]} · total ${money(pkg.size * dur.price)}`,
          `每周 ${pkg.freq} 节 · 共 ${pkg.size} 节 · 预计从 ${dates[0]} 上到 ${dates[dates.length - 1]} · 合计 ${money(pkg.size * dur.price)}`,
          `${pkg.freq}× / semaine · ${pkg.size} cours · prévu du ${dates[0]} au ${dates[dates.length - 1]} · total ${money(pkg.size * dur.price)}`);
    } else if (dates) {
      const cs = pkgConflicts();
      summary.textContent = cs.length
        ? "⚠ " + pkgConflictText(cs[0])
        : L3("The two fixed times cannot be identical — please adjust one of them.", "两个固定时间不能完全相同，请调整其中一个。", "Les deux horaires fixes ne peuvent pas être identiques — veuillez en ajuster un.");
    } else {
      summary.textContent = L3("Please choose your fixed weekly lesson times (weekday first, then a start time)", "请选择每周固定的上课时间（先选星期，再选开始时间）", "Veuillez choisir vos horaires hebdomadaires fixes (le jour d'abord, puis l'heure de début)");
    }
    refreshPkgSlotErrors();
    $("#bk-pkg-total").innerHTML = `
      <div class="bk-total-row"><span>${courseName(state.courseId || "other")}</span></div>
      <div class="bk-total-row"><span>${L3(`Package ${pkg.size} lessons × ${dur.minutes} min`, `课时包 ${pkg.size} 节 × ${dur.minutes} 分钟`, `Forfait ${pkg.size} cours × ${dur.minutes} min`)}</span><span>${money(pkg.size * dur.price)}</span></div>
      <div class="bk-total-row bk-total-sum"><span>Total</span><span>${money(pkg.size * dur.price)}</span></div>
      <p class="note">${L3(`After payment, all ${pkg.size} lessons are scheduled at once; if a date is taken, that lesson moves one week later automatically.`, `支付后系统会一次性排好全部 ${pkg.size} 节课；个别日期被占用时会自动顺延一周。`, `Après le paiement, les ${pkg.size} cours sont tous programmés d'un coup ; si une date est prise, le cours est automatiquement décalé d'une semaine.`)}</p>`;
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
  state.durationId = state.config.durations.find((d) => d.minutes === 50)?.id || state.config.durations[0].id;
  renderCourses();
  renderDurations();
  renderPkgSizes();
  renderPkgFreq();
  renderPkgSlots();
  refreshSummary();

  document.querySelectorAll(".book-course").forEach((btn) => {
    btn.addEventListener("click", () => {
      openBooking(); // resets first if a previous booking was completed
      state.courseId = btn.dataset.course;
      renderCourses();
      refreshSummary();
      showPane(1);
    });
  });

  /* Price section actions (rendered dynamically by renderPrices, so
   * they are wired by delegation): a duration row's Book opens the
   * modal in single mode with that duration preselected; a package
   * row's Buy opens the modal in package mode with that package size
   * preselected — the same preselect path My Bookings repurchase uses. */
  const priceSection = $("#price");
  if (priceSection) {
    priceSection.addEventListener("click", (e) => {
      const durBtn = e.target.closest("[data-book-duration]");
      if (durBtn) {
        openBooking();
        setMode("single");
        applyDuration(durBtn.dataset.bookDuration, false);
        showPane(1);
        return;
      }
      const pkgBtn = e.target.closest("[data-buy-package]");
      if (pkgBtn) {
        openBooking();
        pkg.size = Number(pkgBtn.dataset.buyPackage);
        renderPkgSizes();
        setMode("package");
        renderPkgSummary();
        showPane(1);
      }
    });
  }

  document.querySelectorAll("[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => showPane(Number(btn.dataset.back)));
  });

  $("#bk-to-2").onclick = () => {
    /* Task 4 (Daniel): course is optional — no pick means the
     * booking silently goes ahead as "Other". No error, no nag. */
    ensureCourseDefault();
    if (state.mode === "package") {
      if (!pkgComplete()) {
        return setMsg("#bk-msg-1", L3("Please choose a package size and pick a weekday and start time for every weekly slot.", "请选择课时包，并为每一节固定课选好星期和开始时间。", "Veuillez choisir un forfait et, pour chaque créneau, un jour et une heure de début."), false);
      }
      setMsg("#bk-msg-1", "");
      showPane(2);
      return;
    }
    if (!state.date || !state.time) return setMsg("#bk-msg-1", "Please pick a date and a time.", false);
    setMsg("#bk-msg-1", "");
    showPane(2);
  };

  /* Disabled-Continue tap (touch has no hover for the tooltip):
   * tapping the disabled button's wrapper scrolls the actual
   * problem into view and flashes it. Enabled clicks pass through
   * to the button itself. */
  const to2Wrap = $("#bk-to-2-wrap");
  if (to2Wrap) {
    to2Wrap.addEventListener("click", () => {
      if (!$("#bk-to-2").disabled) return;
      let target = null;
      if (state.mode === "package") {
        const rows = document.querySelectorAll("#bk-pkg-slots .pkg-slot");
        const cs = pkgConflicts();
        if (cs.length) target = rows[cs[0].i];
        if (!target) {
          const bad = pkg.slots.findIndex((s) => s.weekday === "" || !s.time);
          if (bad >= 0) target = rows[bad];
        }
      } else {
        target = $("#bk-cal");
      }
      if (target) {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
        flashEl(target);
      }
    });
  }

  /* ---------- completed-flow reset (task 7) ----------
   * Installed as bkResetHook: closeBooking() runs this whenever
   * the modal closes from the Done pane, by ANY path. Everything
   * goes back to factory: step 1, no course/duration/package/slot
   * picks, blank form + payment fields, no created-booking refs,
   * and the sign-in-gate draft is cleared too — a completed
   * booking's draft must never resurrect its data next time. */
  function resetBookingFlow() {
    state.courseId = null;
    state.durationId = state.config.durations.find((d) => d.minutes === 50)?.id ||
      state.config.durations[0].id;
    state.date = null;
    state.time = null;
    state.booking = null;
    state.pkgOrder = null;
    state.pkgBuyer = null;
    pkg.size = 10;
    pkg.freq = 1;
    pkg.slots = [{ weekday: "", time: "" }];
    pkgConflictSeen = false;
    $("#bk-name").value = "";
    $("#bk-email").value = "";
    $("#bk-notes").value = "";
    for (const id of ["#pay-card", "#pay-exp", "#pay-cvc"]) {
      const el = $(id);
      if (el) el.value = "";
    }
    const extra = $("#bk-done-extra");
    if (extra) extra.innerHTML = "";
    setMsg("#bk-msg-1", "");
    setMsg("#bk-msg-2", "");
    setMsg("#bk-msg-3", "");
    bkDraftClear(localStorage);
    renderCourses();
    renderDurations();
    renderPkgSizes();
    renderPkgFreq();
    renderPkgSlots();
    picker.reset();
    setMode("single");
    showPane(1);
  }
  bkResetHook = resetBookingFlow;

  /* ---------- Payment sign-in gate + draft ----------
   * Advancing from Step 2 to Payment is where a booking gets
   * created, so that is where the gate sits: with Google sign-in
   * configured and no session, the student signs in FIRST (nothing
   * is created, nothing is charged), the in-progress draft is kept
   * in local storage, and the round-trip resumes at Payment. */
  function collectDraft() {
    return {
      mode: state.mode,
      courseId: state.courseId,
      durationId: state.durationId,
      date: state.date,
      time: state.time,
      pkg: state.mode === "package"
        ? { size: pkg.size, freq: pkg.freq,
            slots: pkg.slots.map((s) => ({ weekday: s.weekday, time: s.time })) }
        : null,
      name: $("#bk-name").value.trim(),
      email: $("#bk-email").value.trim(),
      notes: $("#bk-notes").value.trim(),
    };
  }

  function enterGate() {
    bkDraftSave(localStorage, collectDraft());
    const link = $("#bk-gate-google");
    if (link) {
      link.href = "/api/auth/google?next=" +
        encodeURIComponent(`${location.pathname}?bkresume=1`);
    }
    setMsg("#bk-msg-2", "");
    showGate();
  }

  /* Step 2 -> Step 3: create the booking/package and show the
   * review + payment pane. Resolves true on success; on failure the
   * error is left in #bk-msg-2 and it resolves false. Callers gate
   * on sign-in before calling this (see #bk-to-3). */
  async function proceedToPayment() {
    const name = $("#bk-name").value.trim();
    const email = $("#bk-email").value.trim();
    const notes = $("#bk-notes").value.trim();
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
          `${weekdayShort(sl.weekday)} ${sl.time}`).join(" · ");
        const rows = [
          ["Course", courseName(subscription.courseId)],
          [L3("Package", "课时包", "Forfait"), `${subscription.totalLessons} ${L3("lessons", "节课", "cours")} · ${dur.minutes} min`],
          [L3("Fixed weekly times", "每周固定时间", "Horaires hebdomadaires fixes"), `${slotsText} (JST)`],
          [L3("Planned", "预计安排", "Prévu"), dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : ""],
          ["Name", name],
          ["Email", email],
          ["Total", money(subscription.totalPrice)],
        ];
        $("#bk-summary").innerHTML =
          rows.map(([k, v]) => `<tr><th>${k}</th><td>${escHtml(v)}</td></tr>`).join("");
        $("#bk-pay").textContent = `Pay ${money(subscription.totalPrice)}`;
        setMsg("#bk-msg-2", "");
        showPane(3);
        return true;
      } catch (e) {
        setMsg("#bk-msg-2", e.message, false);
        return false;
      }
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
      return true;
    } catch (e) {
      setMsg("#bk-msg-2", e.message, false);
      return false;
    }
  }

  /* Step 2: details -> gate or create booking */
  $("#bk-to-3").onclick = async () => {
    const name = $("#bk-name").value.trim();
    const email = $("#bk-email").value.trim();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return setMsg("#bk-msg-2", "Please enter your name and a valid email.", false);
    }
    if (bkNeedsGate(state.config.googleAuth, authUser)) {
      enterGate();
      return;
    }
    await proceedToPayment();
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
          `${weekdayShort(sl.weekday)} ${sl.time}`).join(" · ");
        const rows = [
          ["Course", courseName(sub.courseId)],
          [L3("Package", "课时包", "Forfait"), `${sub.totalLessons} ${L3("lessons", "节课", "cours")} · ${dur.minutes} min`],
          [L3("Fixed weekly times", "每周固定时间", "Horaires hebdomadaires fixes"), `${slotsText} (JST)`],
          ["Name", sub.name],
          ["Email", sub.email],
          ["Total", money(sub.totalPrice)],
        ];
        $("#bk-done").innerHTML =
          rows.map(([k, v]) => `<tr><th>${k}</th><td>${escHtml(v)}</td></tr>`).join("");
        const lessons = data.lessons || [];
        $("#bk-done-extra").innerHTML = `
          <h4 class="bk-sub">${L3(`Your ${lessons.length} lessons`, `你的课程安排 · 共 ${lessons.length} 节`, `Vos ${lessons.length} cours`)}</h4>
          <ul class="done-lessons">${lessons.map((l) => {
            const llr = localRange(l.date, l.time, minutesOfBooking(l));
            return `<li>${fmtLocalDate(llr.start, true)} · ${llr.text} ${localMatchesJst(llr.start) ? "JST" : tzAbbr(llr.start)}</li>`;
          }).join("")}</ul>
          ${(data.skippedDates || []).length
            ? `<p class="note">${L3(`These dates were taken or the teacher is off, so those lessons moved one week later: ${data.skippedDates.join(", ")}`, `这些日期已被占用或老师休息，对应课程已自动顺延一周：${data.skippedDates.join(", ")}`, `Ces dates étaient prises ou la professeure est en congé : ces cours ont été décalés d'une semaine : ${data.skippedDates.join(", ")}`)}</p>` : ""}`;
        state.pkgOrder = null;
        showPane(4);
        bkDraftClear(localStorage);
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
      bkDraftClear(localStorage);
      if (authUser) { await loadMyBookings(); await loadMySubscriptions(); }
    } catch (e) {
      setMsg("#bk-msg-3", e.message, false);
    }
  };

  /* ---------- Draft resume after the sign-in round-trip ----------
   * The gate sent the student to Google with ?bkresume=1 in the
   * return path; a failed round-trip lands with ?login_error (the
   * flag below is captured before renderAuthForms consumes it).
   * Restore rules (Daniel's spec): everything the student picked
   * and typed comes back; a signed-in return lands on the Payment
   * step; if the chosen slot stopped being bookable meanwhile, the
   * rest is kept and only the time must be re-picked; a failed or
   * cancelled sign-in returns to the Details step, draft intact. */
  let draftReturnFailed = false;

  async function draftSlotStillValid(d) {
    const dur = durationOf(d.durationId);
    if (!dur || !d.date || !d.time) return false;
    try {
      const data = await api(`/api/availability?date=${d.date}&duration=${dur.minutes}`);
      if (data.closed) return false;
      const s = (data.slots || []).find((x) => x.time === d.time);
      return !!s && !!s.available;
    } catch { return false; }
  }

  function restoreDraftSelections(d) {
    if (state.config.courses.some((c) => c.id === d.courseId)) {
      state.courseId = d.courseId;
    }
    if (state.config.durations.some((x) => x.id === d.durationId)) {
      state.durationId = d.durationId;
    }
    renderCourses();
    renderDurations();
    if (d.mode === "package" && d.pkg) {
      pkg.size = [6, 10, 20].includes(d.pkg.size) ? d.pkg.size : 10;
      pkg.freq = [1, 2, 3].includes(d.pkg.freq) ? d.pkg.freq : 1;
      const slots = (Array.isArray(d.pkg.slots) ? d.pkg.slots : [])
        .map((s) => ({ weekday: String(s?.weekday ?? ""), time: String(s?.time || "") }));
      while (slots.length < pkg.freq) slots.push({ weekday: "", time: "" });
      pkg.slots = slots.slice(0, pkg.freq);
      renderPkgSizes();
      renderPkgFreq();
      renderPkgSlots();
    }
    setMode(d.mode === "package" ? "package" : "single");
    $("#bk-name").value = d.name || "";
    $("#bk-email").value = d.email || "";
    $("#bk-notes").value = d.notes || "";
    refreshSummary();
  }

  function rePickTime(d) {
    state.date = null;
    state.time = null;
    refreshSummary();
    showPane(1);
    setMsg("#bk-msg-1",
      "That time was just taken or is no longer bookable — please pick a new time. Your course and details were kept.",
      false);
  }

  async function resumeBookingDraft() {
    const returning =
      new URLSearchParams(location.search).get("bkresume") === "1";
    if (!returning && !draftReturnFailed) return;
    const draft = bkDraftLoad(localStorage);
    if (!draft) return;
    if (returning) {
      history.replaceState(null, "", location.pathname + location.hash);
    }
    restoreDraftSelections(draft);
    openBooking();
    if (!authUser) {
      showPane(2);
      setMsg("#bk-msg-2",
        "Google sign-in didn't complete — everything you entered is still here. When you're ready, continue to sign in and pay.",
        false);
      return;
    }
    applyAuthToForm(); // identity locks to the verified account
    if (draft.mode !== "package") {
      if (!(await draftSlotStillValid(draft))) return rePickTime(draft);
      if (!(await picker.setSelection(draft.date, draft.time))) {
        return rePickTime(draft);
      }
    }
    const ok = await proceedToPayment();
    if (!ok) {
      if (draft.mode !== "package") rePickTime(draft);
      else showPane(2); // the creation error already sits in #bk-msg-2
    }
  }

  /* ---------- My Bookings (account-based) ----------
   * Students sign in with Google; bookings are matched to the account
   * by email and split into "Upcoming lessons" (manageable) and
   * "Lesson history" (completed + cancelled, read-only, newest first).
   * Older guest bookings (made before sign-in-before-payment) appear
   * automatically once the student signs in with the same email. */

  let myActionMsg = "";

  /* Sign-in is Google-only (Sakura-style): one button, no password
   * forms anywhere. Until the teacher configures the Google OAuth
   * client (worker settings.google), /api/config reports
   * googleAuth=false and this area shows a neutral note instead of a
   * dead button. */
  let loginErrorPending = false;

  function renderAuthForms() {
    const box = $("#my-auth");
    if (!box) return; // pages without a My Bookings section (e.g. /account)
    if (!state.config?.googleAuth) {
      box.innerHTML = `
      <div class="lookup-box">
        <p class="note">Sign-in will be available soon. You can still book
        lessons as a guest — just book with the email you will sign in
        with later, and your bookings will show up here automatically.</p>
      </div>`;
      return;
    }
    box.innerHTML = `
    <div class="lookup-box auth-google">
      <a class="google-btn" href="/api/auth/google?next=${encodeURIComponent("/#my")}">
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34.3 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34.3 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>
        <span>Continue with Google</span></a>
      <p class="note">New here? Sign in with Google to create your account.
      Booked as a guest before? Sign in with the same email and your
      bookings appear here automatically.</p>
      <p class="msg" id="auth-msg"></p>
    </div>`;
    if (loginErrorPending) {
      loginErrorPending = false;
      setMsg("#auth-msg",
        "Google sign-in didn't complete — please try again.", false);
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
    if (!box) return; // /account renders its own account bar (account.js)
    if (!authUser) { renderAuthForms(); return; }
    box.innerHTML = `
      <p class="note">${authUser.picture
        ? `<img class="auth-avatar" src="${escHtml(authUser.picture)}" alt="" referrerpolicy="no-referrer" />`
        : ""}Logged in as <strong>${escHtml(authUser.name)}</strong>
      (${escHtml(authUser.email)}) ·
      <a href="/account">Go to My Account →</a> ·
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
      <h3 class="my-section-title">${L3("My lesson packages", "我的课时包", "Mes forfaits")}</h3>
      ${visible.map(subCard).join("")}`;
    visible.forEach(wireSubCard);
  }

  function subCard(s) {
    const slotsText = (s.slots || []).map((sl) =>
      `${weekdayShort(sl.weekday)} ${sl.time}`).join(" · ");
    const stopped = s.status === "stopped";
    return `
    <div class="my-card">
      <table class="summary">
        <tr><th>${L3("Package", "课时包", "Forfait")}</th><td>${s.totalLessons} ${L3("lessons", "节课", "cours")} · ${escHtml(courseName(s.courseId))} · ${s.durationMinutes} min</td></tr>
        <tr><th>${L3("Fixed weekly times", "每周固定时间", "Horaires hebdomadaires fixes")}</th><td>${escHtml(slotsText)} (JST)</td></tr>
        <tr><th>${L3("Status", "状态", "Statut")}</th><td>${stopped ? L3("Stopped", "已停止", "Arrêté") : L3("Active", "进行中", "Actif")}</td></tr>
        ${!stopped ? `<tr><th>${L3("Remaining", "还剩", "Restants")}</th><td>${s.remainingLessons} ${L3("lessons", "节", "cours")}</td></tr>` : ""}
        ${!stopped && s.nextLesson ? (() => { const nlr = localRange(s.nextLesson.date, s.nextLesson.time, s.durationMinutes || 50); return `<tr><th>${L3("Next lesson", "下一节", "Prochain cours")}</th><td>${fmtLocalDate(nlr.start, true)} · ${nlr.text} ${localMatchesJst(nlr.start) ? "JST" : tzAbbr(nlr.start)}</td></tr>`; })() : ""}
      </table>
      ${(s.lastSkippedDates || []).length
        ? `<p class="note">${L3(`These dates were taken or the teacher is off, so those lessons moved one week later: ${s.lastSkippedDates.join(", ")}`, `这些日期已被占用或老师休息，对应课程已自动顺延一周：${s.lastSkippedDates.join(", ")}`, `Ces dates étaient prises ou la professeure est en congé : ces cours ont été décalés d'une semaine : ${s.lastSkippedDates.join(", ")}`)}</p>` : ""}
      ${!stopped ? `
      <p class="msg" id="sub-msg-${s.id}"></p>
      <div class="my-actions">
        <button class="btn btn-ghost" id="sub-buy-${s.id}">${L3("Buy this package again", "续购课时包", "Racheter ce forfait")}</button>
        <button class="btn btn-ghost" id="sub-stop-${s.id}">${L3("Stop & refund remaining lessons", "退掉剩余课时并退款", "Arrêter et rembourser les cours restants")}</button>
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
        const text = L3(`Stop the package and refund the rest?\nThis cancels the remaining ${s.remainingLessons} lessons and refunds ${money(s.refundableTotal || 0)} (mock)` + (inside > 0 ? `; ${inside} of them start within 12 hours and are not refunded` : "") + `. Lessons already taken are unaffected, and stopping cannot be undone.`,
          `退掉剩余课时并退款？\n将取消剩余 ${s.remainingLessons} 节课，退款 ${money(s.refundableTotal || 0)}（mock）` + (inside > 0 ? `；其中 ${inside} 节在开课前 12 小时内，不退款` : "") + `。已上过的课不受影响，停止后不能恢复。`,
          `Arrêter le forfait et rembourser le reste ?\nCela annule les ${s.remainingLessons} cours restants et rembourse ${money(s.refundableTotal || 0)} (démo)` + (inside > 0 ? ` ; ${inside} d'entre eux commencent dans moins de 12 h et ne sont pas remboursés` : "") + `. Les cours déjà suivis ne sont pas affectés, et l'arrêt est définitif.`);
        if (!(await uiConfirm(text, { danger: true }))) return;
        try {
          const data = await api(`/api/subscriptions/${s.id}/stop`, {
            method: "POST", body: "{}",
          });
          myActionMsg = L3(`Package stopped. Total refunded: ${money(data.refundTotal || 0)} (mock).`, `课时包已停止，共退款 ${money(data.refundTotal || 0)}（mock）。`, `Forfait arrêté. Total remboursé : ${money(data.refundTotal || 0)} (démo).`);
          await loadMyBookings();
          await loadMySubscriptions();
        } catch (e) { setMsg(`#sub-msg-${s.id}`, e.message, false); }
      };
    }
  }

  async function loadMyBookings() {
    const box = $("#my-result");
    if (!box) return;
    try {
      const data = await api("/api/my/bookings");
      renderMyBookings(data);
    } catch (e) {
      box.innerHTML = `<p class="msg msg-err">${escHtml(e.message)}</p>`;
    }
  }

  /* ---------- Upcoming lessons: month calendar ----------
   * One tall card per lesson was mostly empty space (Daniel:
   * information density too low). The upcoming list is now a month
   * calendar: days are keyed by the STUDENT'S local date — the same
   * Intl conversion the cards use; bookings stay JST-anchored —
   * lesson chips sit in the day cells. Tapping a day slides in a
   * right-side drawer with that day's lessons as compact cards
   * (myCardCompact/wireMyCard, management rules unchanged); the
   * calendar itself no longer grows a giant detail area. Default
   * selection is the soonest lesson's day (highlight only — the
   * drawer opens on tap). Only /account renders this calendar now:
   * the homepage My Bookings section was removed (Daniel). */
  let upcalCursor = null;   // {y, m} month on screen (visitor-local)
  let upcalSelected = null; // visitor-local "YYYY-MM-DD" chosen day
  let upcalList = [];       // latest upcoming list, for re-renders

  const UPCAL_SHORT = {
    conversation: "Conversation", beginners: "Beginners", jlpt: "JLPT",
    travel: "Travel", business: "Business", other: "Lesson",
    trial: "Trial", single: "Lesson", pack5: "Package",
  };
  function courseShort(b) {
    return UPCAL_SHORT[b.courseId] || UPCAL_SHORT[b.lessonTypeId] ||
      courseName(b.courseId).split(" ")[0];
  }
  function upcalDayKey(b) {
    return localDateOfMs(jstInstantMs(b.date, b.time));
  }
  function upcalByDay(list) {
    const byDay = new Map();
    const sorted = [...list].sort((a, b) =>
      jstInstantMs(a.date, a.time) - jstInstantMs(b.date, b.time));
    for (const b of sorted) {
      const k = upcalDayKey(b);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(b);
    }
    return { byDay, sorted };
  }

  function upcomingCalendarHtml() {
    const { byDay } = upcalByDay(upcalList);
    if (!upcalSelected) {
      upcalSelected = upcalDayKey(upcalByDay(upcalList).sorted[0]);
    }
    if (!upcalCursor) {
      const [y, m] = upcalSelected.split("-").map(Number);
      upcalCursor = { y, m: m - 1 };
    }
    const { y, m } = upcalCursor;
    const title = new Date(Date.UTC(y, m, 1)).toLocaleDateString(locale(),
      { month: "long", year: "numeric", timeZone: "UTC" });
    const wdNames = [...Array(7)].map((_, i) =>
      new Date(Date.UTC(2024, 0, 7 + i)).toLocaleDateString(locale(),
        { weekday: "short", timeZone: "UTC" }));
    const start = new Date(y, m, 1 - new Date(y, m, 1).getDay());
    const todayKey = localDateOfMs(Date.now());
    let cells = "";
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(),
        start.getDate() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const list = byDay.get(key) || [];
      const chips = list.slice(0, 2).map((b) => {
        const lr = localRange(b.date, b.time, minutesOfBooking(b));
        return `<span class="upcal-chip"><span class="upcal-chip-time">${fmtLocalTime(lr.start)}</span> <span>${escHtml(courseShort(b))}</span></span>`;
      }).join("") + (list.length > 2
        ? `<span class="upcal-chip upcal-more">+${list.length - 2}</span>` : "");
      const dots = list.slice(0, 3)
        .map(() => `<span class="upcal-dot"></span>`).join("") +
        (list.length > 3 ? `<span class="upcal-count">${list.length}</span>` : "");
      cells += `<button type="button" class="upcal-day${d.getMonth() !== m ? " outside" : ""}${key === todayKey ? " today" : ""}${key === upcalSelected ? " selected" : ""}" data-day="${key}">
        <span class="upcal-num">${d.getDate()}</span>
        ${list.length ? `<span class="upcal-chips">${chips}</span><span class="upcal-dots">${dots}</span>` : ""}
      </button>`;
    }
    return `
    <div class="upcal" id="upcal">
      <div class="upcal-head">
        <button type="button" class="cal-nav" id="upcal-prev" aria-label="Previous month">‹</button>
        <span class="cal-title">${title}</span>
        <button type="button" class="cal-nav" id="upcal-next" aria-label="Next month">›</button>
      </div>
      <div class="upcal-grid upcal-week">${wdNames.map((w) => `<span>${w}</span>`).join("")}</div>
      <div class="upcal-grid">${cells}</div>
    </div>`;
  }

  /* ---------- Upcoming day drawer (/account) ----------
   * The selected day's lessons live in a right-side drawer (full
   * screen on small phones) instead of a full-width detail block
   * under the calendar. Compact cards show only what the student
   * needs; the refund policy is stated once — in the drawer's
   * footer line and, case-specifically, in the cancel confirm. */
  let upcalDrawerOpen = false;

  function upcalSelectedMs() {
    const { byDay } = upcalByDay(upcalList);
    const dayList = byDay.get(upcalSelected) || [];
    if (dayList.length) return jstInstantMs(dayList[0].date, dayList[0].time);
    const [sy, sm, sd] = (upcalSelected || "").split("-").map(Number);
    return new Date(sy, (sm || 1) - 1, sd || 1, 12).getTime();
  }

  function ensureUpcalDrawer() {
    if (document.getElementById("upcal-drawer")) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="upcal-overlay hidden" id="upcal-overlay"></div>
      <aside class="upcal-drawer" id="upcal-drawer" aria-hidden="true">
        <div class="upcal-drawer-head">
          <h4 class="upcal-drawer-title" id="upcal-drawer-title"></h4>
          <button type="button" class="upcal-drawer-close" id="upcal-drawer-close"
            aria-label="${L3("Close", "关闭", "Fermer")}">×</button>
        </div>
        <div class="upcal-drawer-list" id="upcal-drawer-list"></div>
        <p class="upcal-drawer-note">${L3(
          "Cancel 12+ hours before the lesson for a full refund; inside 12 hours there is no refund. Rescheduling is free up to 24 hours before, max. 2 times.",
          "开课前 12 小时以上取消可全额退款；12 小时内取消不退款。改期请在开课前 24 小时以上，最多 2 次。",
          "Annulation 12 h ou plus avant le cours : remboursement intégral ; à moins de 12 h, aucun remboursement. Report gratuit jusqu'à 24 h avant, 2 fois max.")}</p>
      </aside>`;
    document.body.appendChild(wrap);
    document.getElementById("upcal-overlay")
      .addEventListener("click", closeUpcalDrawer);
    document.getElementById("upcal-drawer-close")
      .addEventListener("click", closeUpcalDrawer);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && upcalDrawerOpen) closeUpcalDrawer();
    });
  }

  function renderUpcalDrawer() {
    const list = document.getElementById("upcal-drawer-list");
    if (!list) return;
    document.getElementById("upcal-drawer-title").textContent =
      fmtLocalDate(upcalSelectedMs(), true);
    const { byDay } = upcalByDay(upcalList);
    const dayList = byDay.get(upcalSelected) || [];
    list.innerHTML = dayList.length
      ? dayList.map((b) => myCardCompact(b)).join("")
      : `<p class="note">${L3("No lessons this day.", "这一天没有课程。", "Aucun cours ce jour-là.")}</p>`;
    dayList.forEach((b) => wireMyCard(b));
  }

  function openUpcalDrawer() {
    ensureUpcalDrawer();
    renderUpcalDrawer();
    upcalDrawerOpen = true;
    document.getElementById("upcal-overlay").classList.remove("hidden");
    const dr = document.getElementById("upcal-drawer");
    dr.classList.add("open");
    dr.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeUpcalDrawer() {
    upcalDrawerOpen = false;
    const ov = document.getElementById("upcal-overlay");
    const dr = document.getElementById("upcal-drawer");
    if (ov) ov.classList.add("hidden");
    if (dr) {
      dr.classList.remove("open");
      dr.setAttribute("aria-hidden", "true");
    }
    document.body.style.overflow = "";
  }

  /* Compact lesson card for the day drawer: local time range big,
   * course · duration · status on one line, price folded into a
   * small line, Meet as a real button (paid only — meetLink is
   * only ever set for paid bookings), reschedule/cancel as small
   * text buttons. No name/email rows, no per-card policy text. */
  function myCardCompact(b) {
    const minutes = minutesOfBooking(b);
    const lr = localRange(b.date, b.time, minutes);
    const sameTz = localMatchesJst(lr.start);
    const canManage = b.status === "paid" || b.status === "unpaid";
    const status = b.effectiveStatus === "cancelled"
      ? L3("Cancelled", "已取消", "Annulé")
      : b.effectiveStatus === "completed"
        ? L3("Completed", "已完成", "Terminé")
        : b.status === "paid"
          ? L3("Confirmed", "已确认", "Confirmé")
          : L3("Awaiting payment", "待付款", "En attente de paiement");
    const sub = [money(b.amount)];
    if (b.subscriptionId) sub.push(L3("Package lesson", "课时包课次", "Cours du forfait"));
    if (canManage && b.status === "paid" && b.reschedules)
      sub.push(L3(`Rescheduled ${b.reschedules} / 2`, `已改期 ${b.reschedules} / 2 次`, `Reporté ${b.reschedules} / 2`));
    return `
    <div class="my-card my-card-compact">
      <div class="mcc-time">${lr.text} <span class="mcc-tz">${sameTz ? "JST" : tzAbbr(lr.start)}</span></div>
      <div class="mcc-meta">${escHtml(courseName(b.courseId))} · ${minutes} min · ${status}</div>
      <div class="mcc-sub">${sub.map(escHtml).join(" · ")}</div>
      ${b.status === "cancelled" && b.refundAmount > 0
        ? `<p class="note">${L3(`Refunded ${money(b.refundAmount)} (mock)`, `已退款 ${money(b.refundAmount)}（mock）`, `Remboursé : ${money(b.refundAmount)} (démo)`)}</p>` : ""}
      ${b.status === "cancelled" && !(b.refundAmount > 0) &&
        String(b.refund || "").includes("12-hour")
        ? `<p class="note">${L3("Cancelled inside the 12-hour window — no refund", "已取消（未退款）——在开课前 12 小时内取消，不退款", "Annulé dans les 12 h précédant le cours — aucun remboursement")}</p>` : ""}
      ${b.meetLink
        ? `<a class="btn mcc-meet" href="${b.meetLink}" target="_blank" rel="noopener">${L3("Join the meeting", "进入会议", "Rejoindre la réunion")} →</a>`
        : b.needsPayment
          ? `<p class="note">${L3("The meeting link will appear here once payment is complete.", "完成付款后，会议链接会显示在这里。", "Le lien de réunion apparaîtra ici une fois le paiement terminé.")}</p>`
          : b.status === "paid"
            ? `<p class="note">${L3("Your teacher will send the meeting link before the lesson.", "老师会在课前发送会议链接。", "Votre professeur enverra le lien de réunion avant le cours.")}</p>` : ""}
      ${canManage ? `
      <p class="msg" id="my-msg-${b.id}"></p>
      <div class="mcc-actions">
        ${b.status === "paid" ? `<button type="button" class="mcc-btn" id="my-resched-${b.id}">${L3("Reschedule", "改期", "Reporter")}</button>` : ""}
        <button type="button" class="mcc-btn mcc-btn-danger" id="my-cancel-${b.id}">${L3("Cancel lesson", "取消课程", "Annuler le cours")}</button>
      </div>
      <div id="my-resched-box-${b.id}" class="hidden">
        <h4 class="bk-sub">${L3(`Pick a new date & time (${minutes} min lesson)`, `选择新的日期和时间（${minutes} 分钟课程）`, `Choisissez une nouvelle date et heure (cours de ${minutes} min)`)}</h4>
        <div id="my-picker-${b.id}"></div>
        <button type="button" class="btn" id="my-resched-go-${b.id}" disabled>${L3("Confirm new time", "确认新时间", "Confirmer le nouvel horaire")}</button>
      </div>` : ""}
    </div>`;
  }

  function wireUpcomingCalendar() {
    const cal = document.getElementById("upcal");
    if (!cal) return;
    const rerender = () => {
      cal.outerHTML = upcomingCalendarHtml();
      wireUpcomingCalendar();
    };
    const shift = (delta) => {
      const nm = upcalCursor.m + delta;
      upcalCursor = { y: upcalCursor.y + Math.floor(nm / 12),
        m: ((nm % 12) + 12) % 12 };
      // Keep the detail in step with the month on screen: if the
      // selected day is not in this month, select its 1st.
      const [sy, sm] = (upcalSelected || "").split("-").map(Number);
      if (sy !== upcalCursor.y || sm - 1 !== upcalCursor.m) {
        upcalSelected = `${upcalCursor.y}-${String(upcalCursor.m + 1).padStart(2, "0")}-01`;
      }
      rerender();
    };
    const prev = document.getElementById("upcal-prev");
    const next = document.getElementById("upcal-next");
    if (prev) prev.onclick = () => shift(-1);
    if (next) next.onclick = () => shift(1);
    cal.querySelectorAll(".upcal-day").forEach((btn) => {
      btn.onclick = () => {
        upcalSelected = btn.dataset.day;
        const [y, m] = upcalSelected.split("-").map(Number);
        upcalCursor = { y, m: m - 1 };
        rerender();
        openUpcalDrawer();
      };
    });
  }

  function renderMyBookings({ upcoming, history }) {
    const box = $("#my-result");
    upcalList = upcoming || [];
    // Fresh data: if the chosen day no longer has lessons (its
    // lesson was cancelled or rescheduled away), fall back to the
    // soonest lesson's day and show that month.
    if (upcoming.length) {
      const { byDay, sorted } = upcalByDay(upcoming);
      if (!upcalSelected || !byDay.has(upcalSelected)) {
        upcalSelected = upcalDayKey(sorted[0]);
        const [y, m] = upcalSelected.split("-").map(Number);
        upcalCursor = { y, m: m - 1 };
      }
    }
    const section = (title, list, render) => list.length ? `
      <h3 class="my-section-title">${title}</h3>
      ${list.map(render).join("")}` : "";
    // The /account page splits the two lists into separate sections:
    // upcoming stays in #my-result, history goes to #my-history, and
    // the page supplies its own section headings (cards only here).
    // The homepage has no #my-history and renders exactly as before.
    const histBox = $("#my-history");
    if (histBox) {
      box.innerHTML = `
      <p class="msg" id="my-action-msg"></p>
      ${upcoming.length
        ? upcomingCalendarHtml()
        : `<p class="note">You have no upcoming lessons.</p>`}`;
      histBox.innerHTML = history.length
        ? history.map((b) => myCard(b, false)).join("")
        : `<p class="note">No past bookings yet.</p>`;
    } else {
      box.innerHTML = `
      <p class="msg" id="my-action-msg"></p>
      ${upcoming.length
        ? `<h3 class="my-section-title">Upcoming lessons</h3>${upcomingCalendarHtml()}`
        : ""}
      ${section("Lesson history", history, (b) => myCard(b, false))}
      ${!upcoming.length && !history.length ? "<p class='note'>No bookings found.</p>" : ""}`;
    }
    if (myActionMsg) setMsg("#my-action-msg", myActionMsg, true);
    wireUpcomingCalendar();
    // Fresh data after a drawer action (cancel/reschedule): refresh
    // the open drawer so it never shows a stale card.
    if (upcalDrawerOpen) renderUpcalDrawer();
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
        ? `<p class="note">${L3(`Refunded ${money(b.refundAmount)} (mock)`, `已退款 ${money(b.refundAmount)}（mock）`, `Remboursé : ${money(b.refundAmount)} (démo)`)}</p>` : ""}
      ${b.status === "cancelled" && !(b.refundAmount > 0) &&
        String(b.refund || "").includes("12-hour")
        ? `<p class="note">${L3("Cancelled inside the 12-hour window — no refund", "已取消（未退款）——在开课前 12 小时内取消，不退款", "Annulé dans les 12 h précédant le cours — aucun remboursement")}</p>` : ""}
      ${canManage ? `
      <p class="msg" id="my-msg-${b.id}"></p>
      <div class="my-actions">
        <button class="btn btn-ghost" id="my-cancel-${b.id}">Cancel this booking</button>
        ${b.status === "paid" ? `<button class="btn btn-ghost" id="my-refund-${b.id}">${L3("Request a refund", "申请退款", "Demander un remboursement")}</button>
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
      // The refund policy is stated ONCE, here, in the form that
      // applies to THIS lesson: paid + 12h or more away → full
      // refund of the amount; paid + inside 12h → no refund.
      const msLeft = jstInstantMs(b.date, b.time) - Date.now();
      const confirmText = b.status !== "paid"
        ? L3("Cancel this booking?", "取消这节预约？", "Annuler cette réservation ?")
        : msLeft >= 12 * 3600_000
          ? L3(`Cancel this lesson? You will receive a full refund of ${money(b.amount)}.`,
              `取消这节课？将全额退款 ${money(b.amount)}。`,
              `Annuler ce cours ? Vous serez intégralement remboursé (${money(b.amount)}).`)
          : L3("This lesson starts in less than 12 hours, so cancelling means no refund. Are you sure?",
              "这节课距开课不足 12 小时，取消后不退款，确定取消吗？",
              "Ce cours commence dans moins de 12 h : l'annulation ne donnera lieu à aucun remboursement. Confirmer ?");
      if (!(await uiConfirm(confirmText, { danger: true }))) return;
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
        const ok = await (msLeft >= 12 * 3600_000
          ? uiConfirm(L3(`Cancel this lesson and refund ${money(b.amount)} in full?`, `取消这节课并全额退款 ${money(b.amount)}？`, `Annuler ce cours et rembourser intégralement ${money(b.amount)} ?`), { danger: true })
          : uiConfirm(L3("This lesson starts in less than 12 hours, so cancelling means no refund. Are you sure?", "这节课距开课不足 12 小时，取消后不退款，确定取消吗？", "Ce cours commence dans moins de 12 h : l'annulation ne donnera lieu à aucun remboursement. Confirmer ?"), { danger: true }));
        if (!ok) return;
        try {
          const data = await api(`/api/bookings/${b.id}/cancel`, {
            method: "POST", body: "{}",
          });
          myActionMsg = data.booking.refundAmount > 0
            ? L3(`Booking ${b.id} cancelled and refunded ${money(data.booking.refundAmount)} (mock).`, `已取消并退款 ${money(data.booking.refundAmount)}（mock）。预约 ${b.id} 已取消。`, `Réservation ${b.id} annulée et remboursée : ${money(data.booking.refundAmount)} (démo).`)
            : L3(`Booking ${b.id} cancelled without a refund.`, `已取消（未退款）。预约 ${b.id} 已取消。`, `Réservation ${b.id} annulée sans remboursement.`);
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
   * bookings right away; otherwise show the sign-in area. A failed
   * Google round-trip lands back here with ?login_error=google. */
  if (new URLSearchParams(location.search).has("login_error")) {
    loginErrorPending = true;
    draftReturnFailed = true; // a booking draft, if any, resumes on pane 2
    history.replaceState(null, "",
      location.pathname + location.hash);
  }
  try {
    const data = await api("/api/auth/me");
    authUser = data.user;
    applyAuthToForm();
  } catch { authUser = null; }
  /* Header nav account item is auth-state-aware: signed-out
   * visitors see "Login" and are sent through Google sign-in,
   * landing on /account afterwards (the OAuth returnTo carries
   * them there); signed-in users see "Account" and the link
   * itself points straight at /account (plain navigation,
   * new-tab friendly). If Google sign-in is not configured, the
   * plain #my section anchor stays as fallback. */
  const navMy = document.querySelector('.site-header nav a[href="/account"]');
  if (navMy) {
    if (authUser) {
      navMy.href = "/account";
      navMy.textContent = "Account";
    }
    navMy.addEventListener("click", (e) => {
      if (!authUser && state.config?.googleAuth) {
        e.preventDefault();
        location.href = "/api/auth/google?next=" +
          encodeURIComponent("/account");
      }
    });
  }
  renderAccountBar();
  if (authUser) { await loadMyBookings(); await loadMySubscriptions(); }
  /* Last: a booking draft returning from the sign-in gate reopens
   * the modal (needs config + auth + renderers all settled). */
  await resumeBookingDraft();
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
  /* Height lock (Daniel: 翻页后保持区域高度不变）: on desktop the
   * grid's height used to follow whichever 6 (or 4) reviews were
   * visible — page heights measured 704 / 731 / 678px, shoving the
   * pager and everything below up and down on every flip. Measure
   * every page's height once (synchronously, so nothing paints in
   * between) and pin the grid's min-height to the tallest page.
   * Re-measured on resize (column widths change text wrapping) and
   * when webfonts land. Mobile is a horizontal carousel whose
   * height never depends on paging — the lock clears there. */
  function lockVoicesHeight() {
    if (mq.matches) { grid.style.minHeight = ""; return; }
    const cur = page;
    grid.style.minHeight = "";
    let max = 0;
    for (let p = 0; p < PAGES; p++) {
      cards.forEach((c, i) =>
        c.classList.toggle("vp-off", i < p * PAGE || i >= (p + 1) * PAGE));
      max = Math.max(max, grid.offsetHeight);
    }
    cards.forEach((c, i) =>
      c.classList.toggle("vp-off", i < cur * PAGE || i >= (cur + 1) * PAGE));
    if (max) grid.style.minHeight = max + "px";
  }
  let vpLockRaf = 0;
  function scheduleVoicesLock() {
    cancelAnimationFrame(vpLockRaf);
    vpLockRaf = requestAnimationFrame(lockVoicesHeight);
  }
  window.addEventListener("resize", scheduleVoicesLock);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(scheduleVoicesLock);
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
    lockVoicesHeight();
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

/* ---------- Homepage reveal (motion pass) ----------
 * Content used to teleport in while scrolling; now it bridges in:
 * opacity + a small rise (cards scale from 0.97), the shared
 * --ease-out curve, 300ms, siblings staggered 60ms. All styling
 * lives in styles.css (.rv [data-reveal]); this only observes and
 * flips .rv-in. Every failure path reveals everything — content
 * must never stay hidden because of an animation. */
(function initReveal() {
  var els;
  try {
    els = Array.prototype.slice.call(document.querySelectorAll("[data-reveal]"));
  } catch (err) {
    document.documentElement.classList.remove("rv");
    return;
  }
  if (!els.length) { window.__rvReady = true; return; }
  // Stagger siblings: 60ms steps within the same parent, capped.
  var counts = new Map();
  els.forEach(function (el) {
    var p = el.parentElement || document.body;
    var i = counts.get(p) || 0;
    counts.set(p, i + 1);
    el.style.setProperty("--rvd", Math.min(i * 60, 300) + "ms");
  });
  function revealAll() {
    els.forEach(function (el) { el.classList.add("rv-in"); });
  }
  if (!("IntersectionObserver" in window)) {
    revealAll();
    window.__rvReady = true;
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        e.target.classList.add("rv-in");
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
  els.forEach(function (el) { io.observe(el); });
  window.__rvReady = true;
  // Safety net: anything already in the viewport that IO somehow
  // missed still appears; below-fold items keep their animation.
  setTimeout(function () {
    var vh = window.innerHeight || 0;
    els.forEach(function (el) {
      if (el.classList.contains("rv-in")) return;
      var r = el.getBoundingClientRect();
      if (r.top < vh && r.bottom > 0) el.classList.add("rv-in");
    });
  }, 2600);
})();
