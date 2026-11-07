/**
 * YUMI Japanese Lessons — Worker
 *
 * Serves the static site (ASSETS binding) and the booking API.
 *
 * Booking model (modeled on sakurajapaneselesson.com's flow):
 *   one booking pane: choose course & lesson duration (30 / 50 / 120 min)
 *   -> pick a date on the month calendar -> pick a start time ->
 *   your details -> pay (MOCK checkout) -> confirmed.
 *   Students manage bookings in My Bookings, which requires an account
 *   (email + password, PBKDF2-hashed; sessions in KV): cancel / reschedule
 *   under the policy in CONFIG.policy, split into upcoming vs. history
 *   (completed / cancelled). Guest bookings are claimed automatically
 *   when the student registers with the same email. The teacher can list
 *   and cancel bookings from the admin page, and can subscribe to all
 *   paid lessons in Google Calendar via a secret ICS feed
 *   (/api/calendar.ics?key=<settings.calendarKey>).
 *
 * Runtime settings live in KV under `meta:settings` (weekly hours, blocked
 * dates, the fixed online-meeting link, Resend email config, teacher
 * notification email) and are edited through the admin page (admin.html).
 * Admin access has two channels: the key in KV `meta:admin_key`, or a
 * site session whose account email is on settings.adminEmails. When no
 * settings are stored, DEFAULT_SETTINGS below reproduce the original
 * hardcoded schedule.
 *
 * Emails are never faked: every booking event writes an outbox record to KV
 * (`email:<id>`, status "queued"); only when a Resend API key + sender are
 * configured in settings do we attempt a real send and mark it sent/failed.
 *
 * Still MOCK (Daniel/Yumi to settle): prices in CONFIG and the payment step.
 *
 * Bindings: ASSETS (static assets), BOOKINGS (KV namespace).
 */

const CONFIG = {
  currency: "USD",
  // MOCK prices (USD). One place to change them later.
  courses: [
    { id: "conversation", name: "Conversational Japanese", minutes: 60 },
    { id: "beginners", name: "Japanese for Complete Beginners", minutes: 60 },
    { id: "jlpt", name: "JLPT N5–N4 Preparation", minutes: 60 },
    { id: "travel", name: "Japanese for Travel", minutes: 60 },
    { id: "business", name: "Business Japanese", minutes: 60 },
    { id: "other", name: "Other", minutes: 60 },
  ],
  // The only choice besides the course: how long the lesson is.
  // MOCK prices follow the old rate of $30 / 60 min, pro-rated.
  durations: [
    { id: "d30", minutes: 30, price: 15 },
    { id: "d50", minutes: 50, price: 25 },
    { id: "d80", minutes: 80, price: 40 },
    { id: "d120", minutes: 120, price: 60 },
  ],
  // Bookings made before the duration model (kept so My Bookings can still
  // name and time them). No longer offered for new bookings.
  legacyLessonTypes: [
    { id: "trial", name: "Trial lesson", minutes: 25, price: 10, lessons: 1 },
    { id: "single", name: "Single lesson", minutes: 60, price: 30, lessons: 1 },
    { id: "pack5", name: "Package · 5 × 60 min", minutes: 60, price: 135, lessons: 5 },
    { id: "pack10", name: "Package · 10 × 60 min", minutes: 60, price: 270, lessons: 10 },
  ],
  policy: {
    bookAheadHours: 72,       // new bookings/reschedules at least 72h ahead
    rescheduleBeforeHours: 24, // rescheduling only (refunds no longer use it)
    maxReschedules: 2,         // rescheduling only
    // Refunds (Feature G): cancelling a paid lesson at least this many
    // hours before it starts refunds in full; inside the window the
    // lesson counts as used. Reschedule history never affects refunds.
    // Teacher-initiated cancels always refund in full.
    refundCutoffHours: 12,
  },
};

/** Fallback schedule when KV has no `meta:settings` yet:
 *  Mon–Fri 08:00–22:00 JST, Sat/Sun closed. Bookings are always anchored
 *  to JST; only the student-facing display converts to local time. */
const DEFAULT_SETTINGS = {
  weekly: {
    0: null,
    1: { start: "08:00", end: "22:00" },
    2: { start: "08:00", end: "22:00" },
    3: { start: "08:00", end: "22:00" },
    4: { start: "08:00", end: "22:00" },
    5: { start: "08:00", end: "22:00" },
    6: null,
  },
  // Hour-set weekly template (Task: block-grid editor): weekday ->
  // sorted array of available start-hours (integers 0–23). {} means
  // "not set": the engine then derives the set from the legacy weekly
  // ranges above (see weeklyHoursFor), so pre-existing settings keep
  // behaving identically. Once the admin saves from the grid editor,
  // all seven weekdays are present and this is the source of truth.
  weeklyHours: {},
  // Admin-configurable per-lesson prices (USD), keyed by duration
  // minutes as strings. Defaults reproduce the CONFIG rates; bookings
  // and subscriptions snapshot the price at creation, so edits here
  // only affect new purchases.
  pricing: { "30": 15, "50": 25, "80": 40, "120": 60 },
  // Google sign-in (the site's only login): OAuth client credentials,
  // admin-editable like the Resend key. Both empty = sign-in disabled
  // and the frontend hides every sign-in entry point.
  google: { clientId: "", clientSecret: "" },
  blockedDates: [],
  meeting: { type: "fixed", url: "" },
  // Daniel's decision: sending is via Resend, sender
  // "Yumi Japanese Lessons <yumi-lesson@ki-toko.com>" (his own domain
  // ki-toko.com, already on Cloudflare; verify it in Resend). The API
  // key stays empty until he provides it — until then the outbox only queues.
  resend: { apiKey: "", from: "yumi-lesson@ki-toko.com" },
  teacherEmail: "",
  // Where student replies to outgoing mail should land (the From address
  // itself cannot receive — Resend is send-only). Set by Daniel to his
  // own inbox for now.
  replyTo: "",
  // Secret key for the teacher's ICS calendar feed (/api/calendar.ics).
  // Empty disables the feed (404). Anyone with the URL can see booking
  // names, so it is never exposed outside the admin page.
  calendarKey: "",
  // Site accounts whose email is on this list see an "Admin" entry in
  // the top nav (a shortcut link to /admin), and a session for one of
  // these accounts authorizes /admin and its APIs on its own (Daniel's
  // decision 2026-11-06: whitelisted Google sign-ins enter the admin
  // without the key — both Yumi's project account and Daniel's own
  // Gmail). The X-Admin-Key gate stays as the fallback channel.
  adminEmails: ["yumi.japan2026@gmail.com", "danieljj2026@gmail.com"],
  // Per-date availability overrides, on top of the weekly template:
  // dateOverrides["YYYY-MM-DD"] = null closes that specific day, and
  // {start, end} gives it special hours (even on a normally-closed
  // weekday). blockedHours["YYYY-MM-DD"] = ["10:00", ...] removes
  // individual start times on a day that is otherwise open.
  dateOverrides: {},
  blockedHours: {},
};

const JST = 9 * 60; // minutes offset

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Parse "YYYY-MM-DD" + hour in JST into a Date (UTC instant). */
function slotInstant(dateStr, hour) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour, 0) - JST * 60000);
}

function jstWeekday(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "HH:MM" -> minutes since midnight. */
function toMin(time) {
  const [h, m] = String(time).split(":").map(Number);
  return h * 60 + (m || 0);
}
function toHHMM(min) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** How long a stored booking occupies, whichever model created it. */
function minutesOfBooking(b) {
  if (b.durationMinutes) return b.durationMinutes;
  const legacy = CONFIG.legacyLessonTypes.find((t) => t.id === b.lessonTypeId);
  return legacy ? legacy.minutes : 60;
}

/** UTC instant a lesson starts / ends (booking times are JST wall times). */
function lessonStartMs(b) {
  const [y, m, d] = b.date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - JST * 60000 + toMin(b.time) * 60000;
}
function lessonEndMs(b) {
  return lessonStartMs(b) + minutesOfBooking(b) * 60000;
}

/** Lifecycle view of a booking: what the student should see it as. */
function effectiveStatus(b, now = Date.now()) {
  if (b.status === "cancelled") return "cancelled";
  if (b.status === "paid") return lessonEndMs(b) <= now ? "completed" : "upcoming";
  return b.status; // pending_payment stays pending_payment
}

/** Student-facing display status: students never see a payment
 *  state — a pending-payment booking simply reads as "upcoming";
 *  "cancelled" is the only special state ever shown. */
function studentEffectiveStatus(b) {
  if (b.status === "cancelled") return "cancelled";
  if (b.status === "pending_payment") return "upcoming";
  return effectiveStatus(b);
}

function publicBooking(b, settings, audience = "student") {
  if (!b) return null;
  const { id, courseId, lessonTypeId, durationId, durationMinutes, date, time,
    name, email, status, amount, currency, reschedules,
    lessonsTotal, createdAt } = b;
  // The meeting link is resolved at read time so the teacher can change
  // it in settings and existing bookings pick up the new link — but a
  // student only receives it once the booking is PAID. The teacher
  // (audience "admin") always sees it.
  const paid = status === "paid";
  const meetLink = (audience === "admin" || paid)
    ? (b.meetLink || (settings && settings.meeting.url) || null)
    : null;
  const base = { id, courseId, lessonTypeId, durationId, durationMinutes,
    date, time, name, email, amount, currency, meetLink, reschedules,
    lessonsTotal, createdAt, paidAt: b.paidAt || null,
    subscriptionId: b.subscriptionId || null,
    refund: b.refund || null,
    refundAmount: b.refundAmount ?? null,
    refundedAt: b.refundedAt || null };
  if (audience === "admin") {
    return { ...base, status, effectiveStatus: effectiveStatus(b) };
  }
  // Student view: no payment-state strings anywhere — a pending
  // booking is "unpaid" (machine field) with needsPayment for actions.
  return { ...base,
    status: paid || status === "cancelled" ? status : "unpaid",
    effectiveStatus: studentEffectiveStatus(b),
    needsPayment: status === "pending_payment" };
}

/* ---------------- Settings (KV `meta:settings`) ---------------- */

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeSettings(raw) {
  const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  if (!raw || typeof raw !== "object") return s;
  if (raw.weekly && typeof raw.weekly === "object") {
    for (let d = 0; d <= 6; d++) {
      if (!(String(d) in raw.weekly)) continue;
      const v = raw.weekly[String(d)];
      if (v === null) s.weekly[d] = null;
      else if (v && TIME_RE.test(v.start || "") && TIME_RE.test(v.end || "") &&
               toMin(v.start) < toMin(v.end)) {
        s.weekly[d] = { start: v.start, end: v.end };
      }
    }
  }
  if (raw.weeklyHours && typeof raw.weeklyHours === "object") {
    for (let d = 0; d <= 6; d++) {
      const v = raw.weeklyHours[String(d)];
      if (!Array.isArray(v)) continue;
      s.weeklyHours[String(d)] = [...new Set(
        v.map(Number).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23)
      )].sort((a, b) => a - b);
    }
  }
  if (raw.pricing && typeof raw.pricing === "object") {
    for (const d of CONFIG.durations) {
      const v = raw.pricing[String(d.minutes)];
      const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
      if (typeof n === "number" && Number.isFinite(n) && n > 0) {
        s.pricing[String(d.minutes)] = Math.round(n * 100) / 100;
      }
    }
  }
  if (raw.google && typeof raw.google === "object") {
    s.google = {
      clientId: String(raw.google.clientId || "").slice(0, 300),
      clientSecret: String(raw.google.clientSecret || "").slice(0, 300),
    };
  }
  if (Array.isArray(raw.blockedDates)) {
    s.blockedDates = [...new Set(raw.blockedDates.filter((x) => DATE_RE.test(x || "")))].sort();
  }
  if (raw.meeting && typeof raw.meeting === "object") {
    s.meeting = { type: "fixed", url: String(raw.meeting.url || "").slice(0, 500) };
  }
  if (raw.resend && typeof raw.resend === "object") {
    s.resend = {
      apiKey: String(raw.resend.apiKey || "").slice(0, 300),
      from: String(raw.resend.from || "").slice(0, 200),
    };
  }
  if (typeof raw.teacherEmail === "string") {
    s.teacherEmail = raw.teacherEmail.slice(0, 200);
  }
  if (typeof raw.replyTo === "string") {
    s.replyTo = raw.replyTo.slice(0, 200);
  }
  if (typeof raw.calendarKey === "string") {
    s.calendarKey = raw.calendarKey.slice(0, 100);
  }
  if (Array.isArray(raw.adminEmails)) {
    const list = raw.adminEmails
      .map((x) => String(x || "").toLowerCase().trim())
      .filter((x) => EMAIL_RE.test(x));
    s.adminEmails = [...new Set(list)].slice(0, 20);
  }
  if (raw.dateOverrides && typeof raw.dateOverrides === "object") {
    for (const [date, v] of Object.entries(raw.dateOverrides)) {
      if (!DATE_RE.test(date)) continue;
      if (v === null) s.dateOverrides[date] = null;
      else if (v && TIME_RE.test(v.start || "") && TIME_RE.test(v.end || "") &&
               toMin(v.start) < toMin(v.end)) {
        s.dateOverrides[date] = { start: v.start, end: v.end };
      }
    }
  }
  if (raw.blockedHours && typeof raw.blockedHours === "object") {
    for (const [date, list] of Object.entries(raw.blockedHours)) {
      if (!DATE_RE.test(date) || !Array.isArray(list)) continue;
      const hours = [...new Set(list.filter((x) => TIME_RE.test(x || "")))].sort();
      if (hours.length) s.blockedHours[date] = hours;
    }
  }
  return s;
}

async function getSettings(env) {
  const raw = await env.BOOKINGS.get("meta:settings");
  if (!raw) return normalizeSettings(null);
  try { return normalizeSettings(JSON.parse(raw)); }
  catch { return normalizeSettings(null); }
}

/** Settings as the admin page may see them: the Resend key is never echoed. */
function publicSettings(s) {
  return {
    weekly: s.weekly,
    weeklyHours: s.weeklyHours,
    pricing: s.pricing,
    google: { clientId: s.google.clientId, clientSecretSet: !!s.google.clientSecret },
    blockedDates: s.blockedDates,
    meeting: s.meeting,
    resend: { from: s.resend.from, apiKeySet: !!s.resend.apiKey },
    teacherEmail: s.teacherEmail,
    replyTo: s.replyTo,
    calendarKey: s.calendarKey,
    dateOverrides: s.dateOverrides,
    blockedHours: s.blockedHours,
    adminEmails: s.adminEmails,
  };
}

/** The current price for a duration: the admin-configured settings
 *  value wins; CONFIG holds the factory default. Amounts are
 *  snapshotted onto bookings/subscriptions at creation time, so a
 *  price change never rewrites an existing record. */
function priceFor(settings, minutes) {
  const v = settings && settings.pricing
    ? settings.pricing[String(minutes)] : undefined;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  const d = CONFIG.durations.find((x) => x.minutes === minutes);
  return d ? d.price : 0;
}

/** Reject a settings.pricing payload that is not clean: every key a
 *  known duration, every value a positive finite number. Returns an
 *  error string or null. */
function validatePricing(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) {
    return "Prices must be an object keyed by duration";
  }
  for (const [k, v] of Object.entries(p)) {
    if (!CONFIG.durations.some((d) => String(d.minutes) === k)) {
      return `Unknown duration in prices: ${k}`;
    }
    const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
      return `Price for ${k} min must be a positive number`;
    }
  }
  return null;
}

/** Is this email on the admin whitelist (settings.adminEmails)?
 *  Case-insensitive and whitespace-tolerant on both sides. The list
 *  itself is never sent to the client — only this boolean outcome. */
function isAdminEmail(settings, email) {
  const e = String(email || "").toLowerCase().trim();
  if (!e) return false;
  return (settings.adminEmails || []).some(
    (x) => String(x || "").toLowerCase().trim() === e);
}

/** Available start-hours (integers 0–23, sorted) for a weekday from
 *  the hour-set template (settings.weeklyHours). When the template has
 *  no entry for the weekday, derive the set from the legacy weekly
 *  range: every hour block [h:00, h+1:00) fully inside [start, end) —
 *  for Mon–Fri 08:00–22:00 that is exactly [8..21]. */
function weeklyHoursFor(settings, weekday) {
  const wh = settings.weeklyHours || {};
  const v = wh[String(weekday)];
  if (Array.isArray(v)) return [...v].sort((a, b) => a - b);
  const range = settings.weekly ? settings.weekly[weekday] : null;
  if (!range) return [];
  const out = [];
  for (let h = 0; h < 24; h++) {
    if (h * 60 >= toMin(range.start) && (h + 1) * 60 <= toMin(range.end)) out.push(h);
  }
  return out;
}

/** Open intervals [startMin, endMin) that apply on a date, merged and
 *  ordered: a per-date override wins (null = closed, a range = one
 *  interval), then the blocked-dates list, then the weekly hour-set
 *  template (consecutive selected hours merge into one interval).
 *  This is the single resolution behind every availability check. */
function openIntervals(settings, dateStr) {
  if (Object.prototype.hasOwnProperty.call(settings.dateOverrides, dateStr)) {
    const o = settings.dateOverrides[dateStr];
    return o ? [[toMin(o.start), toMin(o.end)]] : [];
  }
  if (settings.blockedDates.includes(dateStr)) return [];
  const out = [];
  for (const h of weeklyHoursFor(settings, jstWeekday(dateStr))) {
    const start = h * 60, end = start + 60;
    const last = out[out.length - 1];
    if (last && last[1] === start) last[1] = end;
    else out.push([start, end]);
  }
  return out;
}

/** True when [startMin, startMin+minutes) fits inside one open interval. */
function intervalCovers(intervals, startMin, minutes) {
  return intervals.some(([a, b]) => startMin >= a && startMin + minutes <= b);
}

/** Bounding range {start, end} of the day's open intervals, or null
 *  when closed. Kept for callers that only need the outer bounds;
 *  precise checks go through openIntervals/intervalCovers. */
function effectiveHours(settings, dateStr) {
  const iv = openIntervals(settings, dateStr);
  if (!iv.length) return null;
  return { start: toHHMM(iv[0][0]), end: toHHMM(iv[iv.length - 1][1]) };
}

/** Hourly candidate start times ("HH:MM") for a date, or null when
 *  closed: every hour step inside the open intervals. Per-hour blocks
 *  (settings.blockedHours) are removed. */
function candidateStarts(settings, dateStr) {
  const iv = openIntervals(settings, dateStr);
  if (!iv.length) return null;
  const blocked = new Set(settings.blockedHours[dateStr] || []);
  const out = [];
  for (const [a, b] of iv) {
    for (let t = a; t < b; t += 60) {
      const hm = toHHMM(t);
      if (!blocked.has(hm)) out.push(hm);
    }
  }
  return out;
}

/** Slot list for one date at a lesson length: closed per the full
 *  settings resolution (weeklyHours/weekly + dateOverrides +
 *  blockedDates), each start checked against the lead-time rule, the
 *  interval-coverage rule (the whole lesson must fit inside selected
 *  hours) and existing bookings (`taken` intervals in bookingsOn's
 *  shape). One source of truth shared by /api/availability and
 *  /api/availability/month. */
function computeSlots(settings, dateStr, minutes, taken) {
  const starts = candidateStarts(settings, dateStr);
  if (!starts) return { closed: true, slots: [] };
  const intervals = openIntervals(settings, dateStr);
  const slots = starts.map((time) => {
    const start = toMin(time);
    const tooSoon = slotInstant(dateStr, Number(time.slice(0, 2))) - new Date() <
      CONFIG.policy.bookAheadHours * 3600_000;
    const covered = intervalCovers(intervals, start, minutes);
    return { time, endTime: toHHMM(start + minutes),
      available: !tooSoon && covered && !overlaps(start, minutes, taken) };
  });
  return { closed: false, slots };
}

/** Admin gate for every /api/admin/* route, with two channels:
 *  1. the shared admin key in KV `meta:admin_key` (X-Admin-Key header) —
 *     the original channel, unchanged;
 *  2. a site session whose account email is on the admin whitelist
 *     (settings.adminEmails) — a whitelisted Google sign-in is itself
 *     the credential (Daniel's decision 2026-11-06). Reuses the normal
 *     session validation; the whitelist decision is made only here,
 *     server-side. Anything else is denied. */
async function adminAuthorized(env, request) {
  const raw = await env.BOOKINGS.get("meta:admin_key");
  if (raw) {
    // Tolerate a key stored with surrounding quotes/whitespace (e.g. written
    // through a JSON-bodied API helper).
    const key = raw.trim().replace(/^"+|"+$/g, "");
    if (key && (request.headers.get("X-Admin-Key") || "") === key) return true;
  }
  const me = await sessionUser(env, request);
  if (!me) return false;
  const settings = await getSettings(env);
  return isAdminEmail(settings, me.email);
}

/* ---------------- Student accounts & sessions ----------------
 * KV `user:<email>` = {name, salt, passwordHash, createdAt} — passwords
 * are PBKDF2-SHA256 hashes (100k iterations, random 16-byte salt),
 * never plaintext. KV `session:<token>` = {email, createdAt} with a
 * 30-day KV TTL; the token travels in an HttpOnly cookie. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION_TTL = 30 * 24 * 3600; // seconds
const LOGIN_FAIL_LIMIT = 10;
const LOGIN_FAIL_TTL = 15 * 60; // seconds

function bytesToB64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
async function hashPassword(password, saltBytes) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations: 100000, hash: "SHA-256" },
    key, 256);
  return bytesToB64(new Uint8Array(bits));
}

async function getUser(env, email) {
  const raw = await env.BOOKINGS.get(`user:${email}`);
  return raw ? JSON.parse(raw) : null;
}

function jsonWithHeaders(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json", ...headers },
  });
}
function sessionCookie(token, maxAge) {
  return `yumi_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}
async function createSession(env, email) {
  const token = bytesToB64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  await env.BOOKINGS.put(`session:${token}`,
    JSON.stringify({ email, createdAt: new Date().toISOString() }),
    { expirationTtl: SESSION_TTL });
  return token;
}
function sessionToken(request) {
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(/(?:^|;\s*)yumi_session=([^;]+)/);
  return m ? m[1] : null;
}
/** The logged-in student for this request: {name, email} or null. */
async function sessionUser(env, request) {
  const token = sessionToken(request);
  if (!token) return null;
  const raw = await env.BOOKINGS.get(`session:${token}`);
  if (!raw) return null;
  let sess;
  try { sess = JSON.parse(raw); } catch { return null; }
  const user = await getUser(env, sess.email);
  if (!user) return null;
  return { name: user.name, email: sess.email,
    picture: user.googlePicture || "" };
}

/** The student object the frontend keeps: identity plus whether this
 *  account is on the admin whitelist. `isAdmin` drives the nav Admin
 *  shortcut's visibility; the actual admin authorization for such a
 *  session is re-checked server-side in adminAuthorized. */
async function publicUser(env, user) {
  const settings = await getSettings(env);
  return { name: user.name, email: user.email,
    picture: user.picture || "",
    isAdmin: isAdminEmail(settings, user.email) };
}

/* ---------------- Google sign-in (the only login) ----------------
 * Hand-rolled OAuth 2.0, mirroring Daniel's japanese-learning
 * project: state kept in a short-lived KV record + cookie, code
 * exchange at Google's token endpoint, userinfo fetch, upsert BY
 * EMAIL into the existing user store, then a normal session through
 * the existing mechanism. Password-era accounts stay in KV
 * (dormant): a Google sign-in with the same verified email lands in
 * the same account, so bookings and packages unify. */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const OAUTH_STATE_TTL = 600; // seconds

function googleConfigured(settings) {
  return !!(settings.google && settings.google.clientId &&
    settings.google.clientSecret);
}
function randomHex(bytes) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** Only same-site paths may be OAuth landing targets. */
function safeNextPath(value) {
  if (!value || typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//") ||
      value.includes("://")) return "/";
  return value;
}
function readCookieValue(request, name) {
  const header = request.headers.get("Cookie") || "";
  const m = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}
function redirectTo(location, cookies = []) {
  const headers = new Headers({ Location: location });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}

/* ---------------- Bookings storage ---------------- */

/** Run fn over items with bounded concurrency, preserving order.
 *  KV reads are independent round trips: awaiting them one by one
 *  made the admin aggregates cost one serial round trip per record
 *  (measured in measure-students-perf.mjs: /api/admin/students did
 *  240 serial gets ≈ 1.3s at only 5ms/op). Batching keeps the same
 *  reads, just overlapped. */
async function mapParallel(items, fn, limit = 50) {
  const out = new Array(items.length);
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

async function getBooking(env, id) {
  const raw = await env.BOOKINGS.get(`booking:${id}`);
  return raw ? JSON.parse(raw) : null;
}

async function saveBooking(env, b) {
  await env.BOOKINGS.put(`booking:${b.id}`, JSON.stringify(b));
  await env.BOOKINGS.put(`byemail:${b.email.toLowerCase()}:${b.id}`, b.id);
}

/** Active bookings on a date, as occupied intervals [{id, start, end}] in minutes. */
async function bookingsOn(env, dateStr) {
  // Bookings are few; scan the prefix and filter by date.
  const out = [];
  let cursor;
  do {
    const list = await env.BOOKINGS.list({ prefix: "booking:", cursor, limit: 100 });
    const raws = await mapParallel(list.keys, (key) => env.BOOKINGS.get(key.name));
    for (const raw of raws) {
      if (!raw) continue;
      const b = JSON.parse(raw);
      if (b.date === dateStr && ["pending_payment", "paid"].includes(b.status)) {
        const start = toMin(b.time);
        out.push({ id: b.id, start, end: start + minutesOfBooking(b) });
      }
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  return out;
}

function overlaps(start, minutes, intervals, excludeId) {
  return intervals.some((iv) => iv.id !== excludeId && start < iv.end && iv.start < start + minutes);
}

/** Every stored booking (unsorted). Bookings are few; scan the prefix. */
async function listAllBookings(env) {
  const out = [];
  let cursor;
  do {
    const list = await env.BOOKINGS.list({ prefix: "booking:", cursor, limit: 100 });
    const batch = await mapParallel(list.keys, (key) =>
      getBooking(env, key.name.slice("booking:".length)));
    for (const b of batch) if (b) out.push(b);
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  return out;
}

/** Resolve the teacher's remark for every student in a booking list.
 *  A stored `studentnote:<email>` wins; otherwise the remark defaults to
 *  the notes the student wrote on their EARLIEST booking (Daniel's rule),
 *  flagged isDefault so the admin UI can label it. Admin-only data — this
 *  never reaches publicBooking or any student-facing response. */
async function resolveRemarks(env, allBookings) {
  const earliest = new Map();
  const byCreation = [...allBookings]
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  for (const b of byCreation) {
    const em = b.email.toLowerCase();
    if (!earliest.has(em) && (b.notes || "").trim()) earliest.set(em, b.notes);
  }
  const remarks = new Map();
  const emails = [...new Set(allBookings.map((b) => b.email.toLowerCase()))];
  const raws = await mapParallel(emails, (em) =>
    env.BOOKINGS.get(`studentnote:${em}`));
  emails.forEach((em, i) => {
    const raw = raws[i];
    let stored = null;
    if (raw) { try { stored = JSON.parse(raw); } catch { stored = null; } }
    if (stored) {
      remarks.set(em, { note: stored.note || "", isDefault: false });
    } else if (earliest.has(em)) {
      remarks.set(em, { note: earliest.get(em), isDefault: true });
    } else {
      remarks.set(em, { note: "", isDefault: false });
    }
  });
  return remarks;
}

/** A student's bookings via the `byemail:` index, as public objects split
 *  into upcoming (soonest first) and history (newest first). */
async function bookingsSplitForEmail(env, settings, email) {
  const mine = [];
  let cursor;
  do {
    const list = await env.BOOKINGS.list({
      prefix: `byemail:${email}:`, cursor, limit: 100 });
    const ids = await mapParallel(list.keys, (key) => env.BOOKINGS.get(key.name));
    const batch = await mapParallel(ids, (id) => id ? getBooking(env, id) : null);
    for (const b of batch) if (b) mine.push(b);
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  const pub = mine.map((b) => publicBooking(b, settings));
  return {
    upcoming: pub
      .filter((b) => ["upcoming", "pending_payment"].includes(b.effectiveStatus))
      .sort((a, b) => lessonStartMs(a) - lessonStartMs(b)),
    history: pub
      .filter((b) => ["completed", "cancelled"].includes(b.effectiveStatus))
      .sort((a, b) => lessonStartMs(b) - lessonStartMs(a)),
  };
}

function validateSlot(settings, dateStr, time, minutes) {
  if (!DATE_RE.test(dateStr || "")) return "Invalid date";
  const intervals = openIntervals(settings, dateStr);
  if (!intervals.length) {
    return settings.blockedDates.includes(dateStr) ||
      settings.dateOverrides[dateStr] === null
      ? "Not available on that date"
      : "Closed on that day";
  }
  if ((settings.blockedHours[dateStr] || []).includes(time)) {
    return "That time is not available on that date";
  }
  const starts = candidateStarts(settings, dateStr) || [];
  if (!starts.includes(time)) return "Invalid time";
  if (!intervalCovers(intervals, toMin(time), minutes)) {
    const startMin = toMin(time);
    const containing = intervals.find(([a, b]) => startMin >= a && startMin < b);
    const end = containing ? containing[1] : intervals[intervals.length - 1][1];
    return `That lesson would end after closing time (${toHHMM(end)} JST)`;
  }
  const hour = Number(time.slice(0, 2));
  const aheadMs = slotInstant(dateStr, hour) - new Date();
  if (aheadMs < CONFIG.policy.bookAheadHours * 3600_000) {
    return `Bookings need to be at least ${CONFIG.policy.bookAheadHours} hours ahead`;
  }
  return null;
}

/** Resolve what a create-booking request is buying: a duration, or (old clients) a legacy lesson type. */
function resolvePurchase(body, settings) {
  const dur = CONFIG.durations.find((d) => d.id === body.durationId) ||
    CONFIG.durations.find((d) => d.minutes === Number(body.durationMinutes));
  if (dur) return { durationId: dur.id, minutes: dur.minutes, price: priceFor(settings, dur.minutes), lessons: 1, lessonTypeId: null };
  const legacy = CONFIG.legacyLessonTypes.find((t) => t.id === body.lessonTypeId);
  if (legacy) return { durationId: null, minutes: legacy.minutes, price: legacy.price, lessons: legacy.lessons, lessonTypeId: legacy.id };
  return null;
}

/* ---------------- Learning profile (KV `profile:<email>`) ----------------
 * The student's self-described Japanese level + learning goals, edited
 * on /account (Sakura's Learning profile). Stored apart from the user
 * record — same pattern as `studentnote:<email>` — so the admin
 * students aggregate can attach it without touching accounts. Level
 * is one of PROFILE_LEVELS ("" = not set); goals is free text, capped
 * like the other student-written text fields. */

const PROFILE_LEVELS = [
  "Complete beginner", "JLPT N5", "JLPT N4", "JLPT N3",
  "JLPT N2", "JLPT N1", "Not sure",
];

async function getProfile(env, email) {
  const raw = await env.BOOKINGS.get(`profile:${email}`);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    return {
      level: PROFILE_LEVELS.includes(p.level) ? p.level : "",
      goals: String(p.goals || "").slice(0, 2000),
      updatedAt: p.updatedAt || null,
    };
  } catch { return null; }
}

async function saveProfile(env, email, { level, goals }) {
  const rec = { level, goals, updatedAt: new Date().toISOString() };
  await env.BOOKINGS.put(`profile:${email}`, JSON.stringify(rec));
  return rec;
}

/* ---------------- Email outbox (KV `email:<id>`) ---------------- */

function courseNameOf(b) {
  return CONFIG.courses.find((c) => c.id === b.courseId)?.name || b.courseId;
}

function meetingLine(b, settings) {
  // The meeting link is revealed only once the booking is PAID;
  // before that the student sees a neutral placeholder instead.
  if (b.status !== "paid") {
    return "The meeting link will appear here once payment is complete.";
  }
  const url = b.meetLink || settings.meeting.url;
  return url
    ? `Online meeting link: ${url}`
    : "Your teacher will send the meeting link before the lesson.";
}

function bookingSummaryText(b, settings) {
  const minutes = minutesOfBooking(b);
  return [
    `Booking reference: ${b.id}`,
    `Course: ${courseNameOf(b)}`,
    `Date: ${b.date} (Japan time, JST)`,
    `Time: ${b.time}–${toHHMM(toMin(b.time) + minutes)} JST (${minutes} min)`,
    `Name: ${b.name}`,
    `Total: $${b.amount} ${b.currency || ""}`.trim(),
    meetingLine(b, settings),
  ].join("\n");
}

/** "20261117T010000Z" style UTC timestamp (ICS / calendar links). */
function icsUtc(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** RFC 5545 text escaping for ICS property values. */
function icsEscape(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/;/g, "\\;")
    .replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** RFC 5545 line folding (continuation lines start with a space). */
function icsFold(line) {
  if (line.length <= 73) return line;
  const parts = [line.slice(0, 73)];
  let rest = line.slice(73);
  while (rest.length) {
    parts.push(" " + rest.slice(0, 72));
    rest = rest.slice(72);
  }
  return parts.join("\r\n");
}

/** "Add to Google Calendar" template link for a booking. */
function googleCalendarUrl(b, s) {
  const text = encodeURIComponent(`Japanese lesson with Yumi — ${courseNameOf(b)}`);
  const details = encodeURIComponent(
    `Booking reference: ${b.id}\n${meetingLine(b, s)}`);
  return "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    `&text=${text}&dates=${icsUtc(lessonStartMs(b))}/${icsUtc(lessonEndMs(b))}` +
    `&details=${details}`;
}

const EMAIL_TEMPLATES = {
  created: (b, s) => ({
    subject: `Booking received — Yumi Japanese Lessons (${b.id})`,
    body: `Hi ${b.name},\n\nThank you! We received your booking. ` +
      `Your lesson time is held for you — please complete the payment on the ` +
      `booking page to confirm it.\n\n${bookingSummaryText(b, s)}\n\n` +
      `You can review, reschedule or cancel anytime in My Bookings on the ` +
      `site, using this email address and your booking reference.\n\n— Yumi 🌸`,
  }),
  confirmed: (b, s) => ({
    subject: `Booking confirmed 🎉 — Yumi Japanese Lessons (${b.id})`,
    body: `Hi ${b.name},\n\nYour lesson is confirmed. I look forward to ` +
      `seeing you!\n\n${bookingSummaryText(b, s)}\n\n` +
      `Add it to your Google Calendar: ${googleCalendarUrl(b, s)}\n\n` +
      `Rescheduling is free up to 24 hours before the lesson (max. 2 times) ` +
      `in My Bookings on the site.\n\n— Yumi 🌸`,
  }),
  cancelled: (b, s) => ({
    subject: `Booking cancelled — Yumi Japanese Lessons (${b.id})`,
    body: `Hi ${b.name},\n\nYour booking below has been cancelled.\n` +
      (b.cancelledBy === "teacher"
        ? `This lesson was cancelled by the teacher. We're sorry for the change!\n` : "") +
      (b.refundAmount > 0
        ? `Refund: $${Number(b.refundAmount).toFixed(2)} (mock) — full refund for an unused lesson.\n`
        : `Refund: ${b.refund || "none — lesson counted as used"}.\n`) + "\n" +
      `${bookingSummaryText(b, s)}\n\n` +
      `You are welcome to book a new lesson anytime.\n\n— Yumi 🌸`,
  }),
  rescheduled: (b, s) => ({
    subject: `Booking rescheduled — Yumi Japanese Lessons (${b.id})`,
    body: `Hi ${b.name},\n\nYour lesson has been moved to a new time:\n\n` +
      `${bookingSummaryText(b, s)}\n\nSee you then!\n\n— Yumi 🌸`,
  }),
};

/** Write one email to the outbox; attempt a real Resend send only when a
 *  key + sender are configured. Returns the stored record. */
async function queueEmail(env, settings, { to, subject, body, bookingRef, kind, replyTo }) {
  const id = crypto.randomUUID();
  const rec = {
    id, to, subject, body, kind,
    replyTo: replyTo || null,
    bookingRef: bookingRef || null,
    status: "queued",
    createdAt: new Date().toISOString(),
  };
  await env.BOOKINGS.put(`email:${id}`, JSON.stringify(rec));
  if (settings.resend.apiKey && settings.resend.from && to) {
    // Sender identity: "Yumi Japanese Lessons <yumi-lesson@ki-toko.com>".
    // settings.resend.from holds the bare address; a value that already
    // carries a display name ("Name <addr>") is used as-is.
    const fromHeader = settings.resend.from.includes("<")
      ? settings.resend.from
      : `Yumi Japanese Lessons <${settings.resend.from}>`;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.resend.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromHeader, to: [to], subject, text: body,
          ...(replyTo ? { reply_to: replyTo } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        rec.status = "sent";
        rec.resendId = data.id || null;
        rec.sentAt = new Date().toISOString();
      } else {
        rec.status = "failed";
        rec.error = data.message || `Resend returned HTTP ${res.status}`;
      }
    } catch (e) {
      rec.status = "failed";
      rec.error = String((e && e.message) || e);
    }
    await env.BOOKINGS.put(`email:${id}`, JSON.stringify(rec));
  }
  return rec;
}

/* ---------------- Lesson packages (课时包 · 每周固定时间) ----------------
 * A subscription is a prepaid lesson package: 6, 10 or 20 lessons at
 * 1–3 fixed weekly slots (weekday + start time, JST). Created via
 * POST /api/packages (pending_payment); paying (mock) materializes ALL
 * lessons at once as paid bookings — a date that conflicts or is
 * teacher-closed is skipped and that slot extends one week, keeping
 * the count exact. When the remaining future lessons first drop to 2,
 * one ending reminder fires. Stopping cancels all future lessons
 * (full refund only for lessons ≥12h away — Feature G) with a single
 * summary email. Lessons are ordinary bookings carrying
 * `subscriptionId`, so availability, My Bookings, the admin calendar,
 * the ICS feed and emails all treat them like normal lessons. */

function addDaysStr(ds, n) {
  const [y, m, d] = ds.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** UTC instant (ms) of a JST date + "HH:MM". */
function instantMs(dateStr, time) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - JST * 60000 + toMin(time) * 60000;
}

const DAY_NAMES = ["Sundays", "Mondays", "Tuesdays", "Wednesdays",
  "Thursdays", "Fridays", "Saturdays"];

/** Why one weekly occurrence cannot be placed, or null when it can.
 *  Used for occurrences 2–4 at creation and for horizon extensions:
 *  they only need to be inside the teacher's hours (incl. per-date
 *  overrides and blocked hours) — no lead-time rule. */
function checkOccurrence(settings, dateStr, time, minutes) {
  const intervals = openIntervals(settings, dateStr);
  if (!intervals.length) return "the teacher is not available that day";
  if ((settings.blockedHours[dateStr] || []).includes(time)) {
    return "that start time is blocked that day";
  }
  const starts = candidateStarts(settings, dateStr) || [];
  if (!starts.includes(time)) return "that start time is outside the teacher's hours";
  if (!intervalCovers(intervals, toMin(time), minutes)) {
    return "the lesson would end after closing time";
  }
  return null;
}

async function getSubscription(env, id) {
  const raw = await env.BOOKINGS.get(`subscription:${id}`);
  return raw ? JSON.parse(raw) : null;
}

async function saveSubscription(env, sub) {
  await env.BOOKINGS.put(`subscription:${sub.id}`, JSON.stringify(sub));
  await env.BOOKINGS.put(`subbyemail:${sub.email.toLowerCase()}:${sub.id}`, sub.id);
}

async function subscriptionsForEmail(env, email) {
  const out = [];
  let cursor;
  do {
    const list = await env.BOOKINGS.list({
      prefix: `subbyemail:${email}:`, cursor, limit: 100 });
    const ids = await mapParallel(list.keys, (key) => env.BOOKINGS.get(key.name));
    const batch = await mapParallel(ids, (id) => id ? getSubscription(env, id) : null);
    for (const sub of batch) if (sub) out.push(sub);
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  return out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

async function listAllSubscriptions(env) {
  const out = [];
  let cursor;
  do {
    const list = await env.BOOKINGS.list({ prefix: "subscription:", cursor, limit: 100 });
    const batch = await mapParallel(list.keys, (key) =>
      getSubscription(env, key.name.slice("subscription:".length)));
    for (const sub of batch) if (sub) out.push(sub);
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  return out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

async function lessonsForSubscription(env, subId) {
  return lessonsOfSub(await listAllBookings(env), subId);
}

/** One subscription's lessons out of an already-loaded booking list,
 *  chronological — the same set lessonsForSubscription returns,
 *  without re-scanning KV. List endpoints load every booking ONCE
 *  and derive all per-package aggregates from it (previously each
 *  aggregate re-scanned the whole booking table per subscription). */
function lessonsOfSub(allBookings, subId) {
  return allBookings
    .filter((b) => b.subscriptionId === subId)
    .sort((a, b) => lessonStartMs(a) - lessonStartMs(b));
}

function nextLessonFrom(lessons) {
  const f = lessons.find((b) => b.status === "paid" && lessonStartMs(b) > Date.now());
  return f ? { id: f.id, date: f.date, time: f.time } : null;
}

function remainingFrom(lessons) {
  const now = Date.now();
  return lessons.filter((b) => b.status === "paid" && lessonStartMs(b) > now).length;
}

function refundableFrom(lessons) {
  const now = Date.now();
  const cutoff = CONFIG.policy.refundCutoffHours * 3600_000;
  let count = 0, total = 0, insideWindow = 0;
  for (const b of lessons) {
    if (b.status !== "paid" || lessonStartMs(b) <= now) continue;
    if (lessonStartMs(b) - now >= cutoff) { count++; total += b.amount || 0; }
    else insideWindow++;
  }
  return { count, total, insideWindow };
}

async function nextLessonOf(env, sub) {
  return nextLessonFrom(await lessonsForSubscription(env, sub.id));
}

function publicSubscription(sub, nextLesson = null, remainingLessons = null, refundable = null) {
  const slots = Array.isArray(sub.slots) ? sub.slots : [];
  return {
    id: sub.id, email: sub.email, name: sub.name,
    courseId: sub.courseId, durationId: sub.durationId,
    durationMinutes: sub.durationMinutes,
    slots, totalLessons: sub.totalLessons || 0,
    pricePerLesson: sub.pricePerLesson, totalPrice: sub.totalPrice || 0,
    status: sub.status, createdAt: sub.createdAt, paidAt: sub.paidAt || null,
    remainingLessons,
    refundableLessons: refundable ? refundable.count : null,
    refundableTotal: refundable ? refundable.total : null,
    insideWindowLessons: refundable ? refundable.insideWindow : null,
    lastSkippedDates: sub.lastSkippedDates || [],
    nextLesson,
  };
}

/** Refund preview for a package (Feature G): of the remaining future paid
 *  lessons, which would refund in full if the package were stopped now
 *  (start at least refundCutoffHours away) and which fall inside the
 *  no-refund window. */
async function refundableOf(env, sub) {
  return refundableFrom(await lessonsForSubscription(env, sub.id));
}

async function remainingOf(env, sub) {
  return remainingFrom(await lessonsForSubscription(env, sub.id));
}

/** Ending reminder (Feature F amendment): when an active subscription's
 *  remaining future lessons first drop to 2 (or fewer, but at least 1), email
 *  the student once (+ teacher copy) that the weekly block is about to end.
 *  Guarded by sub.endingReminderSent so it never double-fires per block;
 *  renewal resets the flag. */
async function checkEndingReminder(env, settings, sub, preloadedLessons = null) {
  if (sub.status !== "active" || sub.endingReminderSent) return;
  const lessons = preloadedLessons || await lessonsForSubscription(env, sub.id);
  const now = Date.now();
  const future = lessons.filter((b) => b.status === "paid" && lessonStartMs(b) > now);
  if (future.length === 0 || future.length > 2) return;
  sub.endingReminderSent = true;
  await saveSubscription(env, sub);
  await notifySubscriptionEvent(env, settings, sub, "subscription_ending", {
    dates: future.map((b) => b.date),
  });
}

/** After a booking is cancelled/rescheduled, re-evaluate the ending
 *  reminder of its subscription (if any) — remaining lessons may have
 *  dropped to 2. */
async function checkSubReminderAfterChange(env, settings, booking) {
  if (!booking.subscriptionId) return;
  const sub = await getSubscription(env, booking.subscriptionId);
  if (sub) await checkEndingReminder(env, settings, sub);
}

function newLessonId() {
  return "YM-" + crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
}

async function createSubscriptionLesson(env, sub, date, time) {
  const booking = {
    id: newLessonId(), courseId: sub.courseId, lessonTypeId: null,
    durationId: sub.durationId, durationMinutes: sub.durationMinutes,
    date, time,
    name: sub.name, email: sub.email, notes: "",
    status: "paid",
    amount: sub.pricePerLesson, currency: CONFIG.currency,
    lessonsTotal: 1, reschedules: 0, meetLink: null,
    subscriptionId: sub.id, createdAt: new Date().toISOString(),
  };
  await saveBooking(env, booking);
  return booking;
}

const PACKAGE_SIZES = [6, 10, 20];

/** First date (JST) with the given weekday whose lesson start is at
 *  least bookAheadHours (72h) ahead — where a package slot begins. */
function firstOccurrenceDate(weekday, time) {
  const minMs = Date.now() + CONFIG.policy.bookAheadHours * 3600_000;
  const today = new Date(Date.now() + JST * 60000).toISOString().slice(0, 10);
  for (let i = 0; i < 21; i++) {
    const d = addDaysStr(today, i);
    if (jstWeekday(d) === weekday && instantMs(d, time) >= minMs) return d;
  }
  return addDaysStr(today, 21);
}

/** Materialize ALL of a package's lessons as paid bookings, week by
 *  week across its slots (chronological). A date that conflicts or is
 *  teacher-closed is skipped and that slot extends one more week, so
 *  the lesson count stays exact. Package lessons may sit far in the
 *  future (20 lessons at 1/week ≈ 20 weeks) — no far-ahead rejection. */
async function materializePackage(env, settings, sub) {
  const placed = [];
  const skipped = [];
  const cursors = sub.slots.map((slot) => firstOccurrenceDate(slot.weekday, slot.time));
  let guard = 0;
  while (placed.length < sub.totalLessons && guard++ < 400) {
    let idx = 0;
    for (let i = 1; i < cursors.length; i++) {
      if (cursors[i] < cursors[idx]) idx = i;
    }
    const slot = sub.slots[idx];
    const date = cursors[idx];
    const problem = checkOccurrence(settings, date, slot.time, sub.durationMinutes);
    const taken = problem ? [] : await bookingsOn(env, date);
    const clash = !problem && overlaps(toMin(slot.time), sub.durationMinutes, taken);
    if (problem || clash) skipped.push(date);
    else placed.push(await createSubscriptionLesson(env, sub, date, slot.time));
    cursors[idx] = addDaysStr(date, 7);
  }
  return { placed, skipped };
}

/** Stop a package: every future lesson is cancelled; lessons starting
 *  at least refundCutoffHours (12h) away refund in full, lessons inside
 *  the window are cancelled without a refund (Feature G). NO per-lesson
 *  emails — one summary email lists the dates, the refund total and any
 *  unrefunded inside-window lessons. Past lessons are untouched. */
async function stopSubscription(env, settings, sub) {
  sub.status = "stopped";
  sub.stoppedAt = new Date().toISOString();
  await saveSubscription(env, sub);
  const cancelledDates = [];
  let refundTotal = 0;
  let unrefundedCount = 0;
  const cutoff = CONFIG.policy.refundCutoffHours * 3600_000;
  const now = Date.now();
  for (const lesson of await lessonsForSubscription(env, sub.id)) {
    if (lesson.status !== "paid" || lessonStartMs(lesson) <= now) continue;
    const refundable = lessonStartMs(lesson) - now >= cutoff;
    lesson.status = "cancelled";
    lesson.cancelledAt = new Date().toISOString();
    lesson.cancelledBy = "subscription";
    if (refundable) {
      lesson.refund = "full (mock)";
      lesson.refundAmount = lesson.amount;
      lesson.refundedAt = lesson.cancelledAt;
      refundTotal += lesson.amount || 0;
    } else {
      lesson.refund = "none — inside the 12-hour window, lesson counted as used";
      lesson.refundAmount = 0;
      unrefundedCount++;
    }
    await saveBooking(env, lesson);
    cancelledDates.push(`${lesson.date} ${lesson.time}`);
  }
  await notifySubscriptionEvent(env, settings, sub, "subscription_stopped", {
    dates: cancelledDates, refundTotal, unrefundedCount,
  });
  return { cancelledDates, refundTotal, unrefundedCount };
}

const SUB_TEMPLATES = {
  subscription_started: (sub, s, ctx) => ({
    subject: `Lesson package confirmed 🎉 — Yumi Japanese Lessons (${sub.id})`,
    body: `Hi ${sub.name},\n\nYour lesson package is active: ` +
      `${sub.totalLessons} lessons (${sub.durationMinutes} min each), ` +
      `every week on ${sub.slots.map((sl) => `${DAY_NAMES[sl.weekday]} ${sl.time}`).join(" · ")} JST.\n\n` +
      `Your lessons:\n${ctx.dates.map((d) => `• ${d}`).join("\n")}\n\n` +
      (ctx.skippedDates.length
        ? `These dates were already taken or the teacher is closed, so those lessons were moved one week later (already included above): ${ctx.skippedDates.join(", ")}\n\n`
        : "") +
      `You can reschedule or cancel any single lesson in My Bookings.\n\n— Yumi 🌸`,
  }),
  subscription_ending: (sub, s, ctx) => ({
    subject: `Your lesson package is almost finished — Yumi Japanese Lessons (${sub.id})`,
    body:
      `Hi ${sub.name},\n\n` +
      `你的课时包还剩最后 ${ctx.dates.length} 节（${ctx.dates.join("、")}），用完可以在 My Bookings 续购。\n\n` +
      `Your lesson package has ${ctx.dates.length} lesson(s) left. ` +
      `You can buy a new package anytime from My Bookings.\n\n— Yumi 🌸`,
  }),
  subscription_stopped: (sub, s, ctx) => ({
    subject: `Lesson package stopped — Yumi Japanese Lessons (${sub.id})`,
    body: `Hi ${sub.name},\n\nYour lesson package (${sub.totalLessons} lessons) has been stopped.\n\n` +
      (ctx.dates.length
        ? `These upcoming lessons were cancelled:\n` +
          `${ctx.dates.map((d) => `• ${d}`).join("\n")}\n\n`
        : `You had no upcoming lessons left to cancel.\n\n`) +
      `Refund total: $${Number(ctx.refundTotal || 0).toFixed(2)} (mock).\n` +
      (ctx.unrefundedCount > 0
        ? `其中 ${ctx.unrefundedCount} 节在开课前 12 小时内，不退款。 ` +
          `(${ctx.unrefundedCount} lesson(s) started within 12 hours and were not refunded.)\n`
        : "") +
      `\nLessons you already took are unaffected. To start again, just buy a new package.\n\n— Yumi 🌸`,
  }),
};

/** Outbox notification for a subscription event + teacher copy. */
async function notifySubscriptionEvent(env, settings, sub, kind, extra = {}) {
  const tpl = SUB_TEMPLATES[kind];
  if (!tpl) return;
  const ctx = {
    dates: extra.dates || [],
    skippedDates: extra.skippedDates || [],
    refundTotal: extra.refundTotal || 0,
    unrefundedCount: extra.unrefundedCount || 0,
  };
  const { subject, body } = tpl(sub, settings, ctx);
  await queueEmail(env, settings, {
    to: sub.email, subject, body, bookingRef: sub.id, kind,
    replyTo: settings.replyTo || "",
  });
  if (settings.teacherEmail) {
    await queueEmail(env, settings, {
      to: settings.teacherEmail,
      subject: `[New ${kind}] ${subject}`,
      body: `Subscription event: ${kind}\nStudent: ${sub.name} <${sub.email}>\n\n${body}`,
      bookingRef: sub.id, kind: `teacher_${kind}`,
      replyTo: sub.email,
    });
  }
}

/** Compose + queue the student email for a booking event, plus a teacher
 *  notification copy when settings.teacherEmail is set. */
async function notifyBookingEvent(env, settings, booking, kind) {
  const tpl = EMAIL_TEMPLATES[kind];
  if (!tpl) return;
  const { subject, body } = tpl(booking, settings);
  await queueEmail(env, settings, {
    to: booking.email, subject, body, bookingRef: booking.id, kind,
    replyTo: settings.replyTo || "",
  });
  if (settings.teacherEmail) {
    await queueEmail(env, settings, {
      to: settings.teacherEmail,
      subject: `[New ${kind}] ${subject}`,
      body: `Booking event: ${kind}\nStudent: ${booking.name} <${booking.email}>\n\n${body}`,
      bookingRef: booking.id, kind: `teacher_${kind}`,
      // The teacher hits "reply" and writes straight to the student.
      replyTo: booking.email,
    });
  }
}

/* ---------------- HTTP ---------------- */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const defer = (p) => { if (ctx && ctx.waitUntil) ctx.waitUntil(p); else return p; };

    /* ----- Admin: settings ----- */
    if (path === "/api/admin/settings") {
      if (!(await adminAuthorized(env, request))) {
        return json({ error: "Admin API is disabled or the admin key is wrong" }, 403);
      }
      if (request.method === "GET") {
        return json({ settings: publicSettings(await getSettings(env)) });
      }
      if (request.method === "PUT") {
        let body;
        try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
        const incoming = (body && body.settings) || body || {};
        if (incoming.pricing !== undefined) {
          const perr = validatePricing(incoming.pricing);
          if (perr) return json({ error: perr }, 400);
        }
        const current = await getSettings(env);
        // An empty apiKey in the form means "keep the saved one".
        if (incoming.resend && !incoming.resend.apiKey) {
          incoming.resend = { ...incoming.resend, apiKey: current.resend.apiKey };
        }
        // Same rule for the Google client secret.
        if (incoming.google && !incoming.google.clientSecret) {
          incoming.google = { ...incoming.google, clientSecret: current.google.clientSecret };
        }
        const merged = normalizeSettings({ ...current, ...incoming });
        await env.BOOKINGS.put("meta:settings", JSON.stringify(merged));
        return json({ settings: publicSettings(merged) });
      }
      return json({ error: "Method not allowed" }, 405);
    }

    /* ----- Admin: booking management ----- */
    if (path === "/api/admin/bookings" && request.method === "GET") {
      if (!(await adminAuthorized(env, request))) {
        return json({ error: "Admin API is disabled or the admin key is wrong" }, 403);
      }
      const settings = await getSettings(env);
      const statusF = (url.searchParams.get("status") || "").trim();
      const q = (url.searchParams.get("q") || "").trim().toLowerCase();
      const dateF = (url.searchParams.get("date") || "").trim();
      const fromF = (url.searchParams.get("from") || "").trim();
      const toF = (url.searchParams.get("to") || "").trim();
      const all = await listAllBookings(env);
      const remarks = await resolveRemarks(env, all);
      const filtered = all.filter((b) => {
        // `status` matches the stored status or the effective one, so
        // "upcoming"/"completed" work as well as "paid"/"cancelled".
        if (statusF && b.status !== statusF && effectiveStatus(b) !== statusF) return false;
        if (dateF && b.date !== dateF) return false;
        if (fromF && b.date < fromF) return false;
        if (toF && b.date > toF) return false;
        if (q && !`${b.email} ${b.name} ${b.id}`.toLowerCase().includes(q)) return false;
        return true;
      });
      filtered.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      // Range queries feed the admin calendar (a whole month at once).
      const cap = fromF || toF ? 500 : 200;
      const bookings = filtered.slice(0, cap).map((b) => {
        const r = remarks.get(b.email.toLowerCase()) || { note: "", isDefault: false };
        return {
          ...publicBooking(b, settings, "admin"),
          cancelledBy: b.cancelledBy || null,
          refund: b.refund || null,
          studentRemark: r.note,
          remarkIsDefault: r.isDefault,
        };
      });
      return json({ bookings, total: filtered.length });
    }

    /* ----- Admin: per-student remark (teacher's private note) ----- */
    if (path === "/api/admin/student-note" && request.method === "POST") {
      if (!(await adminAuthorized(env, request))) {
        return json({ error: "Admin API is disabled or the admin key is wrong" }, 403);
      }
      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const email = String(body?.email || "").toLowerCase().trim();
      const note = String(body?.note ?? "").slice(0, 2000);
      if (!EMAIL_RE.test(email)) return json({ error: "A valid email is required" }, 400);
      await env.BOOKINGS.put(`studentnote:${email}`, JSON.stringify({
        note, updatedAt: new Date().toISOString(),
      }));
      return json({ ok: true, email, studentRemark: note, remarkIsDefault: false });
    }

    const am = path.match(/^\/api\/admin\/bookings\/([A-Z0-9-]+)\/cancel$/);
    if (am && request.method === "POST") {
      if (!(await adminAuthorized(env, request))) {
        return json({ error: "Admin API is disabled or the admin key is wrong" }, 403);
      }
      const booking = await getBooking(env, am[1]);
      if (!booking) return json({ error: "Booking not found" }, 404);
      if (booking.status !== "paid" && booking.status !== "pending_payment") {
        return json({ error: `Cannot cancel a booking in status ${booking.status}` }, 409);
      }
      if (booking.status === "paid" && effectiveStatus(booking) === "completed") {
        return json({ error: "That lesson has already taken place" }, 409);
      }
      const settings = await getSettings(env);
      const wasPaid = booking.status === "paid";
      booking.status = "cancelled";
      booking.cancelledAt = new Date().toISOString();
      booking.cancelledBy = "teacher";
      // Teacher-initiated cancels always refund in full — the 12-hour
      // student cutoff does not apply to the teacher's own initiative.
      booking.refund = wasPaid ? "full (mock)" : "none — no payment was taken";
      if (wasPaid) {
        booking.refundAmount = booking.amount;
        booking.refundedAt = booking.cancelledAt;
      }
      await saveBooking(env, booking);
      defer(notifyBookingEvent(env, settings, booking, "cancelled"));
      return json({ booking: publicBooking(booking, settings, "admin"), refunded: wasPaid });
    }

    /* ----- Google sign-in ----- */
    if (path === "/api/auth/google" && request.method === "GET") {
      const settings = await getSettings(env);
      if (!googleConfigured(settings)) {
        return json({ error: "Google sign-in is not configured" }, 501);
      }
      const state = randomHex(24);
      const next = safeNextPath(url.searchParams.get("next"));
      await env.BOOKINGS.put(`oauthstate:${state}`,
        JSON.stringify({ next, createdAt: Date.now() }),
        { expirationTtl: OAUTH_STATE_TTL });
      const authUrl = new URL(GOOGLE_AUTH_URL);
      authUrl.search = new URLSearchParams({
        client_id: settings.google.clientId,
        redirect_uri: `${url.origin}/api/auth/google/callback`,
        response_type: "code",
        scope: "openid email profile",
        state,
        access_type: "online",
        prompt: "select_account",
      }).toString();
      return redirectTo(authUrl.toString(), [
        `yumi_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${OAUTH_STATE_TTL}`,
      ]);
    }

    if (path === "/api/auth/google/callback" && request.method === "GET") {
      const clearState =
        "yumi_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";
      const fail = () => redirectTo("/?login_error=google", [clearState]);
      const settings = await getSettings(env);
      if (!googleConfigured(settings)) return fail();
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (url.searchParams.get("error") || !code || !state) return fail();
      if (readCookieValue(request, "yumi_oauth_state") !== state) return fail();
      const rawState = await env.BOOKINGS.get(`oauthstate:${state}`);
      if (!rawState) return fail();
      await env.BOOKINGS.delete(`oauthstate:${state}`); // one-time
      let next = "/";
      try { next = safeNextPath(JSON.parse(rawState).next); } catch { /* keep "/" */ }
      try {
        const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: settings.google.clientId,
            client_secret: settings.google.clientSecret,
            redirect_uri: `${url.origin}/api/auth/google/callback`,
            grant_type: "authorization_code",
          }),
        });
        if (!tokenRes.ok) return fail();
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) return fail();
        const infoRes = await fetch(GOOGLE_USERINFO_URL, {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        if (!infoRes.ok) return fail();
        const profile = await infoRes.json();
        const email = String(profile.email || "").toLowerCase().trim();
        if (!profile.sub || !EMAIL_RE.test(email) ||
            profile.email_verified !== true) {
          return fail();
        }
        // Upsert BY EMAIL: an existing account with this verified
        // email is signed into as-is (bookings/packages stay
        // attached); only the Google identity is recorded on it.
        let user = await getUser(env, email);
        if (user) {
          user.googleSub = profile.sub;
          user.googlePicture = profile.picture || user.googlePicture || "";
          if (!user.name && profile.name) user.name = profile.name;
        } else {
          user = {
            name: profile.name || email.split("@")[0],
            salt: null, passwordHash: null,
            googleSub: profile.sub,
            googlePicture: profile.picture || "",
            createdAt: new Date().toISOString(),
          };
        }
        await env.BOOKINGS.put(`user:${email}`, JSON.stringify(user));
        const token = await createSession(env, email);
        return redirectTo(next, [sessionCookie(token, SESSION_TTL), clearState]);
      } catch {
        return fail();
      }
    }

    /* ----- Student accounts -----
     * Password auth is retired (Google-only sign-in): both endpoints
     * answer 410 Gone. Existing user records and password hashes stay
     * in KV untouched — a Google sign-in with the same verified email
     * lands in the same account. */
    if (path === "/api/auth/register" && request.method === "POST") {
      return json({ error: "Password registration is disabled — please sign in with Google." }, 410);
    }
    if (path === "/api/auth/login" && request.method === "POST") {
      return json({ error: "Password sign-in is disabled — please sign in with Google." }, 410);
    }
    if (path === "/api/auth/logout" && request.method === "POST") {
      const token = sessionToken(request);
      if (token) await env.BOOKINGS.delete(`session:${token}`);
      return jsonWithHeaders({ ok: true }, 200,
        { "Set-Cookie": sessionCookie("", 0) });
    }

    if (path === "/api/auth/me" && request.method === "GET") {
      const me = await sessionUser(env, request);
      if (!me) return json({ error: "Not logged in" }, 401);
      return json({ user: await publicUser(env, me) });
    }

    /* ----- My bookings (login required) ----- */
    if (path === "/api/my/bookings" && request.method === "GET") {
      const me = await sessionUser(env, request);
      if (!me) return json({ error: "Please log in to see your bookings" }, 401);
      const settings = await getSettings(env);
      // Reading My Bookings evaluates the ending reminder for the student's
      // weekly subscriptions (fires once per block at 2 lessons left).
      for (const sub of await subscriptionsForEmail(env, me.email)) {
        await checkEndingReminder(env, settings, sub);
      }
      return json(await bookingsSplitForEmail(env, settings, me.email));
    }

    /* ----- My subscriptions (login required) ----- */
    if (path === "/api/my/subscriptions" && request.method === "GET") {
      const me = await sessionUser(env, request);
      if (!me) return json({ error: "Please log in to see your subscriptions" }, 401);
      const settings = await getSettings(env);
      const subs = await subscriptionsForEmail(env, me.email);
      const all = await listAllBookings(env);
      const out = [];
      for (const sub of subs) {
        const lessons = lessonsOfSub(all, sub.id);
        await checkEndingReminder(env, settings, sub, lessons);
        out.push(publicSubscription(sub, nextLessonFrom(lessons),
          remainingFrom(lessons), refundableFrom(lessons)));
      }
      return json({ subscriptions: out });
    }

    /* ----- Learning profile (login required) ----- */
    if (path === "/api/account/profile") {
      const me = await sessionUser(env, request);
      if (!me) return json({ error: "Please log in to see your profile" }, 401);
      const em = me.email.toLowerCase();
      if (request.method === "GET") {
        const p = await getProfile(env, em);
        return json({ profile: p ? { level: p.level, goals: p.goals } : null });
      }
      if (request.method === "PUT") {
        let body;
        try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
        const level = String(body?.level ?? "");
        if (level !== "" && !PROFILE_LEVELS.includes(level)) {
          return json({ error: "Unknown level" }, 400);
        }
        const goals = String(body?.goals ?? "").slice(0, 2000);
        const rec = await saveProfile(env, em, { level, goals });
        return json({ profile: { level: rec.level, goals: rec.goals } });
      }
      return json({ error: "Method not allowed" }, 405);
    }

    /* ----- Lesson packages: create (pending) ----- */
    if (path === "/api/packages" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const name = String(body?.name || "").trim().slice(0, 80);
      let email = String(body?.email || "").toLowerCase().trim().slice(0, 120);
      /* Course is optional (Daniel, 2026-11-07): an absent/empty
       * courseId books as "Other"; an explicitly unknown one is
       * still rejected by the !course check below. */
      const course = body?.courseId
        ? CONFIG.courses.find((c) => c.id === body.courseId)
        : CONFIG.courses.find((c) => c.id === "other");
      const dur = CONFIG.durations.find((d) => d.id === body?.durationId);
      const size = Number(body?.packageSize);
      if (!course || !dur) return json({ error: "Unknown course or duration" }, 400);
      if (!PACKAGE_SIZES.includes(size)) {
        return json({ error: "Package size must be 6, 10 or 20 lessons" }, 400);
      }
      if (!name || !EMAIL_RE.test(email)) {
        return json({ error: "Name and a valid email are required" }, 400);
      }
      /* Payment sign-in gate: same rule as POST /api/bookings —
       * with Google sign-in configured, creation requires a session
       * and the package is bound to the verified account email;
       * unconfigured deployments keep the guest fallback. */
      {
        const gateSettings = await getSettings(env);
        const me = await sessionUser(env, request);
        if (googleConfigured(gateSettings)) {
          if (!me) {
            return json({ error: "Please sign in with Google to complete your booking" }, 401);
          }
          email = me.email.toLowerCase();
        }
      }
      const rawSlots = Array.isArray(body?.slots) ? body.slots : [];
      if (rawSlots.length < 1 || rawSlots.length > 3) {
        return json({ error: "Choose 1 to 3 weekly time slots" }, 400);
      }
      const slots = [];
      const seen = new Set();
      for (const sl of rawSlots) {
        const weekday = Number(sl?.weekday);
        const time = String(sl?.time || "");
        if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !TIME_RE.test(time)) {
          return json({ error: "Each slot needs a weekday and a start time" }, 400);
        }
        const k = `${weekday} ${time}`;
        if (seen.has(k)) return json({ error: "Weekly slots must be distinct" }, 400);
        seen.add(k);
        slots.push({ weekday, time });
      }
      // Slots on the same weekday must not overlap each other.
      for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
          if (slots[i].weekday !== slots[j].weekday) continue;
          const a = toMin(slots[i].time), b = toMin(slots[j].time);
          if (a < b + dur.minutes && b < a + dur.minutes) {
            return json({ error: "Two of your weekly slots overlap each other" }, 400);
          }
        }
      }
      const settings = await getSettings(env);
      // Each slot must be schedulable in principle: its first or second
      // weekly occurrence must fall inside the teacher's hours (a single
      // closed week is fine — materialization skips and extends).
      for (const slot of slots) {
        const first = firstOccurrenceDate(slot.weekday, slot.time);
        const ok = !checkOccurrence(settings, first, slot.time, dur.minutes) ||
          !checkOccurrence(settings, addDaysStr(first, 7), slot.time, dur.minutes);
        if (!ok) {
          return json({ error: `${DAY_NAMES[slot.weekday]} at ${slot.time} is outside the teacher's hours` }, 400);
        }
      }
      const sub = {
        id: "SUB-" + crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase(),
        email, name,
        courseId: course.id, durationId: dur.id, durationMinutes: dur.minutes,
        slots, totalLessons: size,
        pricePerLesson: priceFor(settings, dur.minutes),
        totalPrice: priceFor(settings, dur.minutes) * size,
        status: "pending_payment",
        endingReminderSent: false, lastSkippedDates: [],
        createdAt: new Date().toISOString(),
      };
      await saveSubscription(env, sub);
      return json({ subscription: publicSubscription(sub, null, 0, null) }, 201);
    }

    /* ----- Subscriptions: owner read + pay + stop ----- */
    const sm = path.match(/^\/api\/subscriptions\/([A-Z0-9-]+)(\/(?:stop|pay))?$/);
    if (sm) {
      const [, id, action] = sm;
      const sub = await getSubscription(env, id);
      if (!sub) return json({ error: "Subscription not found" }, 404);
      const settings = await getSettings(env);
      const me = await sessionUser(env, request);

      if (!action && request.method === "GET") {
        const email = (url.searchParams.get("email") || "").toLowerCase();
        if (!(me && me.email === sub.email.toLowerCase()) &&
            email !== sub.email.toLowerCase()) {
          return json({ error: "Email does not match this subscription" }, 403);
        }
        await checkEndingReminder(env, settings, sub);
        return json({ subscription: publicSubscription(sub, await nextLessonOf(env, sub),
          await remainingOf(env, sub), await refundableOf(env, sub)) });
      }

      if (action === "/stop" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const owns = (!!me && me.email === sub.email.toLowerCase()) ||
          (body.email || "").toLowerCase() === sub.email.toLowerCase();
        if (!owns) {
          return json({ error: "Email does not match this subscription" }, 403);
        }
        if (sub.status !== "active") {
          return json({ error: `Cannot stop a subscription in status ${sub.status}` }, 409);
        }
        const result = await stopSubscription(env, settings, sub);
        return json({ subscription: publicSubscription(sub), ...result });
      }

      if (action === "/pay" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const owns = (!!me && me.email === sub.email.toLowerCase()) ||
          (body.email || "").toLowerCase() === sub.email.toLowerCase();
        if (!owns) {
          return json({ error: "Email does not match this subscription" }, 403);
        }
        if (sub.status !== "pending_payment") {
          return json({ error: `Cannot pay a subscription in status ${sub.status}` }, 409);
        }
        // MOCK payment: materialize every package lesson as a paid
        // booking; conflicting/closed dates skip and extend a week.
        const { placed, skipped } = await materializePackage(env, settings, sub);
        sub.status = "active";
        sub.paidAt = new Date().toISOString();
        sub.lastSkippedDates = [...new Set(skipped)];
        await saveSubscription(env, sub);
        await notifySubscriptionEvent(env, settings, sub, "subscription_started", {
          dates: placed.map((b) => `${b.date} ${b.time}`),
          skippedDates: sub.lastSkippedDates,
        });
        return json({
          subscription: publicSubscription(sub, await nextLessonOf(env, sub),
            await remainingOf(env, sub), await refundableOf(env, sub)),
          lessons: placed.map((b) => publicBooking(b, settings)),
          skippedDates: sub.lastSkippedDates,
        });
      }

    }

    /* ----- Admin: subscriptions (read-only + stop) ----- */
    if (path === "/api/admin/subscriptions" && request.method === "GET") {
      if (!(await adminAuthorized(env, request))) {
        return json({ error: "Admin API is disabled or the admin key is wrong" }, 403);
      }
      const subs = await listAllSubscriptions(env);
      const settings = await getSettings(env);
      const all = await listAllBookings(env);
      const out = [];
      for (const sub of subs) {
        const lessons = lessonsOfSub(all, sub.id);
        await checkEndingReminder(env, settings, sub, lessons);
        out.push(publicSubscription(sub, nextLessonFrom(lessons),
          remainingFrom(lessons), refundableFrom(lessons)));
      }
      return json({ subscriptions: out });
    }

    const asm = path.match(/^\/api\/admin\/subscriptions\/([A-Z0-9-]+)\/stop$/);
    if (asm && request.method === "POST") {
      if (!(await adminAuthorized(env, request))) {
        return json({ error: "Admin API is disabled or the admin key is wrong" }, 403);
      }
      const sub = await getSubscription(env, asm[1]);
      if (!sub) return json({ error: "Subscription not found" }, 404);
      if (sub.status !== "active") {
        return json({ error: `Cannot stop a subscription in status ${sub.status}` }, 409);
      }
      const settings = await getSettings(env);
      const result = await stopSubscription(env, settings, sub);
      return json({ subscription: publicSubscription(sub), ...result });
    }

    /* ----- Admin: students board (one aggregate, no N+1) ----- */
    if (path === "/api/admin/students" && request.method === "GET") {
      if (!(await adminAuthorized(env, request))) {
        return json({ error: "Admin API is disabled or the admin key is wrong" }, 403);
      }
      const all = await listAllBookings(env);
      const remarks = await resolveRemarks(env, all);
      // Learning profiles (`profile:<email>`), attached to a student
      // only when one was actually saved with content.
      const profiles = new Map();
      {
        let cursor;
        do {
          const list = await env.BOOKINGS.list({ prefix: "profile:", cursor, limit: 100 });
          const raws = await mapParallel(list.keys, (key) => env.BOOKINGS.get(key.name));
          list.keys.forEach((key, i) => {
            const raw = raws[i];
            if (!raw) return;
            try {
              const p = JSON.parse(raw);
              profiles.set(key.name.slice("profile:".length).toLowerCase(), {
                level: PROFILE_LEVELS.includes(p.level) ? p.level : "",
                goals: String(p.goals || "").slice(0, 2000),
              });
            } catch { /* skip malformed record */ }
          });
          cursor = list.list_complete ? undefined : list.cursor;
        } while (cursor);
      }
      const subs = await listAllSubscriptions(env);
      const users = new Map();
      {
        let cursor;
        do {
          const list = await env.BOOKINGS.list({ prefix: "user:", cursor, limit: 100 });
          const raws = await mapParallel(list.keys, (key) => env.BOOKINGS.get(key.name));
          list.keys.forEach((key, i) => {
            const raw = raws[i];
            if (!raw) return;
            try {
              users.set(key.name.slice("user:".length).toLowerCase(), JSON.parse(raw));
            } catch { /* skip malformed record */ }
          });
          cursor = list.list_complete ? undefined : list.cursor;
        } while (cursor);
      }
      const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
      const monthStart = today.slice(0, 8) + "01";
      const dormantCutoff = addDaysStr(today, -30);
      const byEmail = new Map();
      const ensure = (email) => {
        const em = String(email || "").toLowerCase();
        if (!byEmail.has(em)) {
          const u = users.get(em);
          const r = remarks.get(em) || { note: "", isDefault: false };
          byEmail.set(em, {
            email: em,
            name: (u && u.name) || "",
            hasAccount: !!u,
            accountType: u ? (u.googleSub ? "google" : "registered") : "guest",
            picture: (u && (u.googlePicture || u.picture)) || "",
            studentRemark: r.note, remarkIsDefault: r.isDefault,
            totalLessons: 0, completedLessons: 0, totalSpent: 0,
            nextLesson: null, activePackageRemaining: 0, hasActivePackage: false,
            lastLessonDate: null, lastActivityAt: null, firstSeen: null,
            lessons: [], packages: [],
          });
        }
        return byEmail.get(em);
      };
      for (const em of users.keys()) ensure(em);
      const byStart = [...all].sort((a, b) =>
        (a.date + a.time).localeCompare(b.date + b.time));
      for (const b of byStart) {
        const s = ensure(b.email);
        if (!s.name && b.name) s.name = b.name;
        const st = effectiveStatus(b);
        s.lessons.push({
          id: b.id, date: b.date, time: b.time,
          durationMinutes: minutesOfBooking(b),
          courseId: b.courseId || null, lessonTypeId: b.lessonTypeId || null,
          status: st, amount: b.amount || 0,
          subscriptionId: b.subscriptionId || null,
        });
        if (b.status !== "cancelled") {
          s.totalLessons++;
          if (st === "completed") {
            s.completedLessons++;
            if (!s.lastLessonDate || b.date > s.lastLessonDate) s.lastLessonDate = b.date;
          }
          if (st === "upcoming" && !s.nextLesson) {
            s.nextLesson = { date: b.date, time: b.time };
          }
        }
        if (b.status === "paid") {
          s.totalSpent += (b.amount || 0) - (b.refundAmount || 0);
        }
        if (b.createdAt) {
          if (!s.firstSeen || b.createdAt < s.firstSeen) s.firstSeen = b.createdAt;
          if (!s.lastActivityAt || b.createdAt > s.lastActivityAt) s.lastActivityAt = b.createdAt;
        }
      }
      for (const sub of subs) {
        const s = ensure(sub.email);
        // Remaining lessons come from the already-loaded booking
        // list — remainingOf() here used to re-scan all of KV per
        // subscription (the N+1 that made this endpoint crawl).
        const remaining = sub.status === "active"
          ? remainingFrom(lessonsOfSub(all, sub.id)) : 0;
        s.packages.push({
          id: sub.id, courseId: sub.courseId,
          durationMinutes: sub.durationMinutes,
          totalLessons: sub.totalLessons, remainingLessons: remaining,
          slots: sub.slots || [], status: sub.status,
          totalPrice: sub.totalPrice || 0, pricePerLesson: sub.pricePerLesson || 0,
        });
        if (sub.status === "active" && remaining > 0) {
          s.hasActivePackage = true;
          s.activePackageRemaining += remaining;
        }
        if (sub.createdAt) {
          if (!s.firstSeen || sub.createdAt < s.firstSeen) s.firstSeen = sub.createdAt;
          if (!s.lastActivityAt || sub.createdAt > s.lastActivityAt) s.lastActivityAt = sub.createdAt;
        }
      }
      const students = [...byEmail.values()].map((s) => {
        if (!s.name) s.name = s.email.split("@")[0];
        const prof = profiles.get(s.email);
        if (prof && (prof.level || prof.goals)) s.profile = prof;
        s.totalSpent = Math.round(s.totalSpent * 100) / 100;
        s.dormant = !s.nextLesson &&
          (!s.lastLessonDate || s.lastLessonDate < dormantCutoff);
        const up = s.lessons.filter(
          (l) => l.status === "upcoming" || l.status === "pending_payment");
        const rest = s.lessons.filter(
          (l) => !(l.status === "upcoming" || l.status === "pending_payment"));
        s.lessons = [...up, ...rest.reverse()];
        return s;
      });
      students.sort((a, b) => {
        const an = a.nextLesson ? a.nextLesson.date + a.nextLesson.time : "9999";
        const bn = b.nextLesson ? b.nextLesson.date + b.nextLesson.time : "9999";
        return an.localeCompare(bn) || a.name.localeCompare(b.name);
      });
      const summary = {
        total: students.length,
        withUpcoming: students.filter((s) => s.nextLesson).length,
        withActivePackage: students.filter((s) => s.hasActivePackage).length,
        newThisMonth: students.filter((s) =>
          s.firstSeen && s.firstSeen.slice(0, 10) >= monthStart).length,
      };
      return json({ summary, students });
    }

    /* ----- Teacher's Google Calendar feed (ICS subscription) ----- */
    if (path === "/api/calendar.ics" && request.method === "GET") {
      const settings = await getSettings(env);
      const key = url.searchParams.get("key") || "";
      if (!settings.calendarKey || key !== settings.calendarKey) {
        return new Response("Not found", { status: 404 });
      }
      const cutoff = Date.now() - 7 * 24 * 3600_000;
      const events = (await listAllBookings(env))
        .filter((b) => b.status === "paid" && lessonStartMs(b) >= cutoff)
        .sort((a, b) => lessonStartMs(a) - lessonStartMs(b));
      const lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Yumi Japanese Lessons//Bookings//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Yumi Japanese Lessons",
      ];
      const stamp = icsUtc(Date.now());
      for (const b of events) {
        const meet = b.meetLink || settings.meeting.url || "";
        lines.push(
          "BEGIN:VEVENT",
          `UID:${b.id}@yumi.ki-toko.com`,
          `DTSTAMP:${stamp}`,
          `DTSTART:${icsUtc(lessonStartMs(b))}`,
          `DTEND:${icsUtc(lessonEndMs(b))}`,
          `SUMMARY:${icsEscape(`Japanese lesson — ${courseNameOf(b)} · ${b.name}`)}`,
          `DESCRIPTION:${icsEscape(
            `Booking reference: ${b.id}\nStudent: ${b.name} <${b.email}>` +
            (meet ? `\nMeeting: ${meet}` : ""))}`,
          ...(meet ? [`LOCATION:${icsEscape(meet)}`] : []),
          "STATUS:CONFIRMED",
          "END:VEVENT",
        );
      }
      lines.push("END:VCALENDAR");
      const body = lines.map(icsFold).join("\r\n") + "\r\n";
      return new Response(body, {
        headers: { "Content-Type": "text/calendar; charset=utf-8" },
      });
    }

    if (path === "/api/config" && request.method === "GET") {
      const settings = await getSettings(env);
      const openDays = [0, 1, 2, 3, 4, 5, 6].filter(
        (d) => weeklyHoursFor(settings, d).length > 0);
      const durations = CONFIG.durations.map(
        (d) => ({ ...d, price: priceFor(settings, d.minutes) }));
      return json({ courses: CONFIG.courses, durations,
        legacyLessonTypes: CONFIG.legacyLessonTypes,
        currency: CONFIG.currency, policy: CONFIG.policy,
        googleAuth: googleConfigured(settings),
        openDays });
    }

    if (path === "/api/availability" && request.method === "GET") {
      const date = url.searchParams.get("date");
      if (!date || !DATE_RE.test(date)) {
        return json({ error: "date is required (YYYY-MM-DD)" }, 400);
      }
      const minutes = Number(url.searchParams.get("duration")) || 60;
      if (!CONFIG.durations.some((d) => d.minutes === minutes) &&
          !CONFIG.legacyLessonTypes.some((t) => t.minutes === minutes)) {
        return json({ error: "Unknown duration" }, 400);
      }
      const settings = await getSettings(env);
      const blocked = settings.blockedDates.includes(date) ||
        settings.dateOverrides[date] === null;
      const taken = candidateStarts(settings, date) ? await bookingsOn(env, date) : [];
      const { closed, slots } = computeSlots(settings, date, minutes, taken);
      return json({ date, closed, blocked, duration: minutes,
        timezone: "Asia/Tokyo (JST)", slots });
    }

    /* ----- Month availability for the student calendar: per date, is
       the day closed (full settings resolution), and is at least one
       start time bookable at this duration? Lets the picker enable
       one-off openings (e.g. a Saturday opened by dateOverride) that
       the weekly template alone would grey out. ----- */
    if (path === "/api/availability/month" && request.method === "GET") {
      const month = url.searchParams.get("month") || "";
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        return json({ error: "month is required (YYYY-MM)" }, 400);
      }
      const minutes = Number(url.searchParams.get("duration")) || 60;
      if (!CONFIG.durations.some((d) => d.minutes === minutes) &&
          !CONFIG.legacyLessonTypes.some((t) => t.minutes === minutes)) {
        return json({ error: "Unknown duration" }, 400);
      }
      const settings = await getSettings(env);
      // One scan for the whole month, grouped into bookingsOn-shaped
      // intervals per date (same pending_payment/paid filter).
      const takenByDate = new Map();
      for (const b of await listAllBookings(env)) {
        if (!b.date || !b.date.startsWith(month)) continue;
        if (!["pending_payment", "paid"].includes(b.status)) continue;
        const start = toMin(b.time);
        if (!takenByDate.has(b.date)) takenByDate.set(b.date, []);
        takenByDate.get(b.date).push(
          { id: b.id, start, end: start + minutesOfBooking(b) });
      }
      const [yy, mm] = month.split("-").map(Number);
      const dayCount = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
      const days = [];
      for (let d = 1; d <= dayCount; d++) {
        const date = `${month}-${String(d).padStart(2, "0")}`;
        const { closed, slots } = computeSlots(
          settings, date, minutes, takenByDate.get(date) || []);
        days.push({ date, closed,
          hasAvailableSlot: !closed && slots.some((s) => s.available) });
      }
      return json({ month, duration: minutes,
        timezone: "Asia/Tokyo (JST)", days });
    }

    if (path === "/api/bookings" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const { date, time, name, notes } = body || {};
      let email = body?.email;
      /* Course is optional (Daniel, 2026-11-07): an absent/empty
       * courseId books as "Other"; an explicitly unknown one is
       * still rejected by the !course check below. */
      const course = body?.courseId
        ? CONFIG.courses.find((c) => c.id === body.courseId)
        : CONFIG.courses.find((c) => c.id === "other");
      const settings = await getSettings(env);
      /* Payment sign-in gate (Daniel's decision, 2026-11-06): when
       * Google sign-in is configured, a booking can only be created
       * by a signed-in student and is bound to the verified account
       * email — a booking paid under an arbitrary non-Google email
       * could never be claimed into an account. When Google is NOT
       * configured, the legacy guest checkout remains as fallback so
       * checkout never dead-ends. Historical guest bookings are
       * unaffected (they still claim by email on sign-in). */
      const me = await sessionUser(env, request);
      if (googleConfigured(settings)) {
        if (!me) {
          return json({ error: "Please sign in with Google to complete your booking" }, 401);
        }
        email = me.email;
      }
      const purchase = resolvePurchase(body || {}, settings);
      if (!course || !purchase) return json({ error: "Unknown course or duration" }, 400);
      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "")) {
        return json({ error: "Name and a valid email are required" }, 400);
      }
      const err = validateSlot(settings, date, time, purchase.minutes);
      if (err) return json({ error: err }, 400);
      const taken = await bookingsOn(env, date);
      if (overlaps(toMin(time), purchase.minutes, taken)) {
        return json({ error: "That time was just taken" }, 409);
      }

      const id = "YM-" + crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
      const booking = {
        id, courseId: course.id, lessonTypeId: purchase.lessonTypeId,
        durationId: purchase.durationId, durationMinutes: purchase.minutes,
        date, time,
        name: String(name).slice(0, 80), email: String(email).slice(0, 120),
        notes: String(notes || "").slice(0, 1000),
        status: "pending_payment",
        amount: purchase.price, currency: CONFIG.currency,
        lessonsTotal: purchase.lessons, reschedules: 0,
        meetLink: null, createdAt: new Date().toISOString(),
      };
      await saveBooking(env, booking);
      defer(notifyBookingEvent(env, settings, booking, "created"));
      return json({ booking: publicBooking(booking, settings) }, 201);
    }

    /* ----- My Bookings list: one valid email+reference unlocks the
       student's own bookings, split into upcoming vs. history. ----- */
    if (path === "/api/my-bookings" && request.method === "GET") {
      const email = (url.searchParams.get("email") || "").toLowerCase();
      const ref = (url.searchParams.get("ref") || "").trim().toUpperCase();
      const anchor = ref ? await getBooking(env, ref) : null;
      if (!anchor) return json({ error: "Booking not found" }, 404);
      if (!email || email !== anchor.email.toLowerCase()) {
        return json({ error: "Email does not match this booking" }, 403);
      }
      const settings = await getSettings(env);
      return json(await bookingsSplitForEmail(env, settings, email));
    }

    const m = path.match(/^\/api\/bookings\/([A-Z0-9-]+)(\/pay|\/cancel|\/reschedule)?$/);
    if (m) {
      const [, id, action] = m;
      const booking = await getBooking(env, id);
      if (!booking) return json({ error: "Booking not found" }, 404);
      const settings = await getSettings(env);
      // Cancel/reschedule accept the legacy email-match body check OR a
      // session cookie belonging to the booking's owner.
      const me = await sessionUser(env, request);
      const sessionOwns = !!me && me.email === booking.email.toLowerCase();

      if (!action && request.method === "GET") {
        const email = (url.searchParams.get("email") || "").toLowerCase();
        if (email !== booking.email.toLowerCase()) {
          return json({ error: "Email does not match this booking" }, 403);
        }
        return json({ booking: publicBooking(booking, settings) });
      }

      if (action === "/pay" && request.method === "POST") {
        // MOCK payment: a real deployment charges via Stripe here and only
        // marks the booking paid from Stripe's webhook/confirmation.
        if (booking.status !== "pending_payment") {
          return json({ error: `Cannot pay a booking in status ${booking.status}` }, 409);
        }
        booking.status = "paid";
        booking.paidAt = new Date().toISOString();
        // No meeting link is generated: the fixed link from settings (if
        // any) is resolved at read time; otherwise the teacher sends it.
        await saveBooking(env, booking);
        defer(notifyBookingEvent(env, settings, booking, "confirmed"));
        return json({ booking: publicBooking(booking, settings) });
      }

      if (action === "/cancel" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        if (!sessionOwns &&
            (body.email || "").toLowerCase() !== booking.email.toLowerCase()) {
          return json({ error: "Email does not match this booking" }, 403);
        }
        if (booking.status !== "paid" && booking.status !== "pending_payment") {
          return json({ error: `Cannot cancel a booking in status ${booking.status}` }, 409);
        }
        // Feature G: a lesson can be cancelled any time before it starts.
        // Paid lessons refund in FULL when cancelled at least
        // refundCutoffHours (12h) before the start — reschedule history
        // no longer matters; inside the window the lesson counts as used.
        const startMs = lessonStartMs(booking);
        if (booking.status === "paid" && startMs <= Date.now()) {
          return json({ error: "This lesson has already started and can no longer be cancelled or refunded" }, 409);
        }
        const refunded = booking.status === "paid" &&
          startMs - Date.now() >= CONFIG.policy.refundCutoffHours * 3600_000;
        const wasPending = booking.status === "pending_payment";
        booking.status = "cancelled";
        booking.cancelledAt = new Date().toISOString();
        if (wasPending) {
          booking.refund = "none — not charged";
        } else if (refunded) {
          booking.refund = "full (mock)";
          booking.refundAmount = booking.amount;
          booking.refundedAt = booking.cancelledAt;
        } else {
          booking.refund = "none — inside the 12-hour window, lesson counted as used";
          booking.refundAmount = 0;
        }
        await saveBooking(env, booking);
        defer(notifyBookingEvent(env, settings, booking, "cancelled"));
        defer(checkSubReminderAfterChange(env, settings, booking));
        return json({ booking: publicBooking(booking, settings), refunded });
      }

      if (action === "/reschedule" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        if (!sessionOwns &&
            (body.email || "").toLowerCase() !== booking.email.toLowerCase()) {
          return json({ error: "Email does not match this booking" }, 403);
        }
        if (booking.status !== "paid") {
          return json({ error: "Only a paid booking can be rescheduled" }, 409);
        }
        if (booking.reschedules >= CONFIG.policy.maxReschedules) {
          return json({ error: `Reschedule limit reached (${CONFIG.policy.maxReschedules})` }, 409);
        }
        const hour = Number(booking.time.slice(0, 2));
        const hoursLeft = (slotInstant(booking.date, hour) - new Date()) / 3600_000;
        if (hoursLeft < CONFIG.policy.rescheduleBeforeHours) {
          return json({ error: `Reschedule at least ${CONFIG.policy.rescheduleBeforeHours} hours before the lesson` }, 409);
        }
        const minutes = minutesOfBooking(booking);
        const err = validateSlot(settings, body.date, body.time, minutes);
        if (err) return json({ error: err }, 400);
        const taken = await bookingsOn(env, body.date);
        if (overlaps(toMin(body.time), minutes, taken, booking.id)) {
          return json({ error: "That time was just taken" }, 409);
        }
        booking.date = body.date;
        booking.time = body.time;
        booking.reschedules += 1;
        await saveBooking(env, booking);
        defer(notifyBookingEvent(env, settings, booking, "rescheduled"));
        defer(checkSubReminderAfterChange(env, settings, booking));
        return json({ booking: publicBooking(booking, settings) });
      }
    }

    if (path.startsWith("/api/")) return json({ error: "Not found" }, 404);

    // SEO: sitemap.xml + robots.txt are served by the worker so they
    // always match the canonical origin. (There is no static
    // robots.txt asset; without this route Cloudflare answered the
    // path with a content-signals boilerplate carrying no crawl
    // rules at all.)
    if (path === "/sitemap.xml") {
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        "  <url>",
        "    <loc>https://yumi.ki-toko.com/</loc>",
        "    <changefreq>weekly</changefreq>",
        "    <priority>1.0</priority>",
        "  </url>",
        "</urlset>",
        "",
      ].join("\n");
      return new Response(xml, {
        headers: { "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "public, max-age=3600" },
      });
    }
    if (path === "/robots.txt") {
      const txt = [
        "User-agent: *",
        "Allow: /",
        "Disallow: /admin",
        "Disallow: /api/",
        "",
        "Sitemap: https://yumi.ki-toko.com/sitemap.xml",
        "",
      ].join("\n");
      return new Response(txt, {
        headers: { "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=3600" },
      });
    }

    // The admin page lives at /admin (the asset itself stays admin.html).
    if (path === "/admin" || path === "/admin/") {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = "/admin.html";
      assetUrl.search = "";
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }
    // The student account page lives at /account (asset: account.html).
    if (path === "/account" || path === "/account/") {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = "/account.html";
      assetUrl.search = "";
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }
    return env.ASSETS.fetch(request);
  },
};
