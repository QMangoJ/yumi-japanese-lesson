/* lib/core.js — split from worker.js (mechanical, bodies unchanged). */

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

export const CONFIG = {
  currency: "USD",
  // MOCK prices (USD). One place to change them later.
  courses: [
    { id: "conversation", name: "Conversational Japanese", minutes: 60 },
    { id: "beginners", name: "Japanese for Complete Beginners", minutes: 60 },
    { id: "jlpt", name: "JLPT Preparation", minutes: 60 },
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
export const JST = 9 * 60; // minutes offset

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Parse "YYYY-MM-DD" + hour in JST into a Date (UTC instant). */
export function slotInstant(dateStr, hour) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour, 0) - JST * 60000);
}

export function jstWeekday(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "HH:MM" -> minutes since midnight. */
export function toMin(time) {
  const [h, m] = String(time).split(":").map(Number);
  return h * 60 + (m || 0);
}
export function toHHMM(min) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** How long a stored booking occupies, whichever model created it. */
export function minutesOfBooking(b) {
  if (b.durationMinutes) return b.durationMinutes;
  const legacy = CONFIG.legacyLessonTypes.find((t) => t.id === b.lessonTypeId);
  return legacy ? legacy.minutes : 60;
}

/** UTC instant a lesson starts / ends (booking times are JST wall times). */
export function lessonStartMs(b) {
  const [y, m, d] = b.date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - JST * 60000 + toMin(b.time) * 60000;
}
export function lessonEndMs(b) {
  return lessonStartMs(b) + minutesOfBooking(b) * 60000;
}

/** Lifecycle view of a booking: what the student should see it as. */
export function effectiveStatus(b, now = Date.now()) {
  if (b.status === "cancelled") return "cancelled";
  if (b.status === "paid") return lessonEndMs(b) <= now ? "completed" : "upcoming";
  return b.status; // pending_payment stays pending_payment
}

/** Student-facing display status: students never see a payment
 *  state — a pending-payment booking simply reads as "upcoming";
 *  "cancelled" is the only special state ever shown. */
export function studentEffectiveStatus(b) {
  if (b.status === "cancelled") return "cancelled";
  if (b.status === "pending_payment") return "upcoming";
  return effectiveStatus(b);
}

export function publicBooking(b, settings, audience = "student") {
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

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function bytesToB64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
export function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export function jsonWithHeaders(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json", ...headers },
  });
}
export function randomHex(bytes) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** Only same-site paths may be OAuth landing targets. */
export async function mapParallel(items, fn, limit = 50) {
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

export function addDaysStr(ds, n) {
  const [y, m, d] = ds.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** UTC instant (ms) of a JST date + "HH:MM". */
export function instantMs(dateStr, time) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - JST * 60000 + toMin(time) * 60000;
}

