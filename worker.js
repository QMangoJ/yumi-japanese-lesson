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
 * notification email) and are edited through the admin page (admin.html,
 * guarded by the key in KV `meta:admin_key`). When no settings are stored,
 * DEFAULT_SETTINGS below reproduce the original hardcoded schedule.
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
    { id: "beginners", name: "Japanese for Complete Beginners (GENKI)", minutes: 60 },
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
  // the top nav (a shortcut link to /admin). It grants nothing by
  // itself: /admin and its APIs stay behind the X-Admin-Key gate.
  adminEmails: ["yumi.japan2026@gmail.com"],
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

function publicBooking(b, settings) {
  if (!b) return null;
  const { id, courseId, lessonTypeId, durationId, durationMinutes, date, time,
    name, email, status, amount, currency, reschedules,
    lessonsTotal, createdAt } = b;
  // The meeting link is resolved at read time so the teacher can change it
  // in settings and existing bookings pick up the new link. Bookings paid
  // before this change keep the link stored on them, if any.
  const meetLink = b.meetLink || (settings && settings.meeting.url) || null;
  return { id, courseId, lessonTypeId, durationId, durationMinutes, date, time,
    name, email, status, effectiveStatus: effectiveStatus(b),
    amount, currency, meetLink, reschedules,
    lessonsTotal, createdAt, subscriptionId: b.subscriptionId || null,
    refund: b.refund || null,
    refundAmount: b.refundAmount ?? null,
    refundedAt: b.refundedAt || null };
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

async function adminAuthorized(env, request) {
  const raw = await env.BOOKINGS.get("meta:admin_key");
  if (!raw) return false;
  // Tolerate a key stored with surrounding quotes/whitespace (e.g. written
  // through a JSON-bodied API helper).
  const key = raw.trim().replace(/^"+|"+$/g, "");
  if (!key) return false;
  return (request.headers.get("X-Admin-Key") || "") === key;
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
  return { name: user.name, email: sess.email };
}

/** The student object the frontend keeps: identity plus whether this
 *  account is on the admin whitelist. `isAdmin` only drives the nav
 *  Admin shortcut's visibility — it unlocks nothing server-side. */
async function publicUser(env, user) {
  const settings = await getSettings(env);
  return { name: user.name, email: user.email,
    isAdmin: isAdminEmail(settings, user.email) };
}

/* ---------------- Bookings storage ---------------- */

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
    for (const key of list.keys) {
      const raw = await env.BOOKINGS.get(key.name);
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
    for (const key of list.keys) {
      const b = await getBooking(env, key.name.slice("booking:".length));
      if (b) out.push(b);
    }
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
  for (const em of new Set(allBookings.map((b) => b.email.toLowerCase()))) {
    const raw = await env.BOOKINGS.get(`studentnote:${em}`);
    let stored = null;
    if (raw) { try { stored = JSON.parse(raw); } catch { stored = null; } }
    if (stored) {
      remarks.set(em, { note: stored.note || "", isDefault: false });
    } else if (earliest.has(em)) {
      remarks.set(em, { note: earliest.get(em), isDefault: true });
    } else {
      remarks.set(em, { note: "", isDefault: false });
    }
  }
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
    for (const key of list.keys) {
      const id = await env.BOOKINGS.get(key.name);
      const b = id ? await getBooking(env, id) : null;
      if (b) mine.push(b);
    }
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
function resolvePurchase(body) {
  const dur = CONFIG.durations.find((d) => d.id === body.durationId) ||
    CONFIG.durations.find((d) => d.minutes === Number(body.durationMinutes));
  if (dur) return { durationId: dur.id, minutes: dur.minutes, price: dur.price, lessons: 1, lessonTypeId: null };
  const legacy = CONFIG.legacyLessonTypes.find((t) => t.id === body.lessonTypeId);
  if (legacy) return { durationId: null, minutes: legacy.minutes, price: legacy.price, lessons: legacy.lessons, lessonTypeId: legacy.id };
  return null;
}

/* ---------------- Email outbox (KV `email:<id>`) ---------------- */

function courseNameOf(b) {
  return CONFIG.courses.find((c) => c.id === b.courseId)?.name || b.courseId;
}

function meetingLine(b, settings) {
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
    for (const key of list.keys) {
      const id = await env.BOOKINGS.get(key.name);
      const sub = id ? await getSubscription(env, id) : null;
      if (sub) out.push(sub);
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  return out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

async function listAllSubscriptions(env) {
  const out = [];
  let cursor;
  do {
    const list = await env.BOOKINGS.list({ prefix: "subscription:", cursor, limit: 100 });
    for (const key of list.keys) {
      const sub = await getSubscription(env, key.name.slice("subscription:".length));
      if (sub) out.push(sub);
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  return out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

async function lessonsForSubscription(env, subId) {
  return (await listAllBookings(env))
    .filter((b) => b.subscriptionId === subId)
    .sort((a, b) => lessonStartMs(a) - lessonStartMs(b));
}

async function nextLessonOf(env, sub) {
  const lessons = await lessonsForSubscription(env, sub.id);
  const f = lessons.find((b) => b.status === "paid" && lessonStartMs(b) > Date.now());
  return f ? { id: f.id, date: f.date, time: f.time } : null;
}

function publicSubscription(sub, nextLesson = null, remainingLessons = null, refundable = null) {
  const slots = Array.isArray(sub.slots) ? sub.slots : [];
  return {
    id: sub.id, email: sub.email, name: sub.name,
    courseId: sub.courseId, durationId: sub.durationId,
    durationMinutes: sub.durationMinutes,
    slots, totalLessons: sub.totalLessons || 0,
    pricePerLesson: sub.pricePerLesson, totalPrice: sub.totalPrice || 0,
    status: sub.status, createdAt: sub.createdAt,
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
  const lessons = await lessonsForSubscription(env, sub.id);
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

async function remainingOf(env, sub) {
  const lessons = await lessonsForSubscription(env, sub.id);
  const now = Date.now();
  return lessons.filter((b) => b.status === "paid" && lessonStartMs(b) > now).length;
}

/** Ending reminder (Feature F amendment): when an active subscription's
 *  remaining future lessons first drop to 2 (or fewer, but at least 1), email
 *  the student once (+ teacher copy) that the weekly block is about to end.
 *  Guarded by sub.endingReminderSent so it never double-fires per block;
 *  renewal resets the flag. */
async function checkEndingReminder(env, settings, sub) {
  if (sub.status !== "active" || sub.endingReminderSent) return;
  const lessons = await lessonsForSubscription(env, sub.id);
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
        const current = await getSettings(env);
        // An empty apiKey in the form means "keep the saved one".
        if (incoming.resend && !incoming.resend.apiKey) {
          incoming.resend = { ...incoming.resend, apiKey: current.resend.apiKey };
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
          ...publicBooking(b, settings),
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
      return json({ booking: publicBooking(booking, settings), refunded: wasPaid });
    }

    /* ----- Student accounts ----- */
    if (path === "/api/auth/register" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const name = String(body?.name || "").trim().slice(0, 80);
      const email = String(body?.email || "").toLowerCase().trim();
      const password = String(body?.password || "");
      if (!name) return json({ error: "Name is required" }, 400);
      if (!EMAIL_RE.test(email)) return json({ error: "A valid email is required" }, 400);
      if (password.length < 8) {
        return json({ error: "Password must be at least 8 characters" }, 400);
      }
      if (await getUser(env, email)) {
        return json({ error: "An account with this email already exists — please log in instead" }, 409);
      }
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const user = {
        name, salt: bytesToB64(salt),
        passwordHash: await hashPassword(password, salt),
        createdAt: new Date().toISOString(),
      };
      await env.BOOKINGS.put(`user:${email}`, JSON.stringify(user));
      const token = await createSession(env, email);
      return jsonWithHeaders({ user: await publicUser(env, { name, email }) }, 201,
        { "Set-Cookie": sessionCookie(token, SESSION_TTL) });
    }

    if (path === "/api/auth/login" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const email = String(body?.email || "").toLowerCase().trim();
      const password = String(body?.password || "");
      const failKey = `loginfail:${email}`;
      const fails = Number(await env.BOOKINGS.get(failKey)) || 0;
      if (fails >= LOGIN_FAIL_LIMIT) {
        return json({ error: "Too many failed login attempts. Please try again in 15 minutes." }, 429);
      }
      const user = EMAIL_RE.test(email) ? await getUser(env, email) : null;
      const ok = !!user &&
        (await hashPassword(password, b64ToBytes(user.salt))) === user.passwordHash;
      if (!ok) {
        await env.BOOKINGS.put(failKey, String(fails + 1),
          { expirationTtl: LOGIN_FAIL_TTL });
        return json({ error: "Email or password is incorrect" }, 401);
      }
      await env.BOOKINGS.delete(failKey);
      const token = await createSession(env, email);
      return jsonWithHeaders(
        { user: await publicUser(env, { name: user.name, email }) }, 200,
        { "Set-Cookie": sessionCookie(token, SESSION_TTL) });
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
      const out = [];
      for (const sub of subs) {
        await checkEndingReminder(env, settings, sub);
        out.push(publicSubscription(sub, await nextLessonOf(env, sub),
          await remainingOf(env, sub), await refundableOf(env, sub)));
      }
      return json({ subscriptions: out });
    }

    /* ----- Lesson packages: create (pending) ----- */
    if (path === "/api/packages" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const name = String(body?.name || "").trim().slice(0, 80);
      const email = String(body?.email || "").toLowerCase().trim().slice(0, 120);
      const course = CONFIG.courses.find((c) => c.id === body?.courseId);
      const dur = CONFIG.durations.find((d) => d.id === body?.durationId);
      const size = Number(body?.packageSize);
      if (!course || !dur) return json({ error: "Unknown course or duration" }, 400);
      if (!PACKAGE_SIZES.includes(size)) {
        return json({ error: "Package size must be 6, 10 or 20 lessons" }, 400);
      }
      if (!name || !EMAIL_RE.test(email)) {
        return json({ error: "Name and a valid email are required" }, 400);
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
        pricePerLesson: dur.price, totalPrice: dur.price * size,
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
      const out = [];
      for (const sub of subs) {
        await checkEndingReminder(env, settings, sub);
        out.push(publicSubscription(sub, await nextLessonOf(env, sub),
          await remainingOf(env, sub), await refundableOf(env, sub)));
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
      return json({ courses: CONFIG.courses, durations: CONFIG.durations,
        legacyLessonTypes: CONFIG.legacyLessonTypes,
        currency: CONFIG.currency, policy: CONFIG.policy,
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
      const { courseId, date, time, name, email, notes } = body || {};
      const course = CONFIG.courses.find((c) => c.id === courseId);
      const purchase = resolvePurchase(body || {});
      if (!course || !purchase) return json({ error: "Unknown course or duration" }, 400);
      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "")) {
        return json({ error: "Name and a valid email are required" }, 400);
      }
      const settings = await getSettings(env);
      const err = validateSlot(settings, date, time, purchase.minutes);
      if (err) return json({ error: err }, 400);
      const taken = await bookingsOn(env, date);
      if (overlaps(toMin(time), purchase.minutes, taken)) {
        return json({ error: "That time was just taken" }, 409);
      }

      const id = "YM-" + crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
      const booking = {
        id, courseId, lessonTypeId: purchase.lessonTypeId,
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

    // The admin page lives at /admin (the asset itself stays admin.html).
    if (path === "/admin" || path === "/admin/") {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = "/admin.html";
      assetUrl.search = "";
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }
    return env.ASSETS.fetch(request);
  },
};
