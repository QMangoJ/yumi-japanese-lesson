/**
 * YUMI Japanese Lessons — Worker
 *
 * Serves the static site (ASSETS binding) and the booking API.
 *
 * Booking model (modeled on sakurajapaneselesson.com's flow):
 *   one booking pane: choose course & lesson duration (30 / 50 / 120 min)
 *   -> pick a date on the month calendar -> pick a start time ->
 *   your details -> pay (MOCK checkout) -> confirmed.
 *   Students manage bookings with email + booking reference:
 *   cancel / reschedule under the policy in CONFIG.policy, and My Bookings
 *   splits their lessons into upcoming vs. history (completed / cancelled).
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
  ],
  // The only choice besides the course: how long the lesson is.
  // MOCK prices follow the old rate of $30 / 60 min, pro-rated.
  durations: [
    { id: "d30", minutes: 30, price: 15 },
    { id: "d50", minutes: 50, price: 25 },
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
    rescheduleBeforeHours: 24,
    maxReschedules: 2,
    cancelRefundBeforeHours: 24,
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
    lessonsTotal, createdAt };
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
    blockedDates: s.blockedDates,
    meeting: s.meeting,
    resend: { from: s.resend.from, apiKeySet: !!s.resend.apiKey },
    teacherEmail: s.teacherEmail,
    replyTo: s.replyTo,
  };
}

/** Hourly candidate start times ("HH:MM") for a date, or null when closed. */
function candidateStarts(settings, dateStr) {
  if (settings.blockedDates.includes(dateStr)) return null;
  const hours = settings.weekly[jstWeekday(dateStr)];
  if (!hours) return null;
  const out = [];
  for (let t = toMin(hours.start); t < toMin(hours.end); t += 60) out.push(toHHMM(t));
  return out;
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

function validateSlot(settings, dateStr, time, minutes) {
  if (!DATE_RE.test(dateStr || "")) return "Invalid date";
  if (settings.blockedDates.includes(dateStr)) return "Not available on that date";
  const hours = settings.weekly[jstWeekday(dateStr)];
  if (!hours) return "Closed on that day";
  const starts = candidateStarts(settings, dateStr) || [];
  if (!starts.includes(time)) return "Invalid time";
  if (toMin(time) + minutes > toMin(hours.end)) {
    return `That lesson would end after closing time (${hours.end} JST)`;
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
      `Rescheduling is free up to 24 hours before the lesson (max. 2 times) ` +
      `in My Bookings on the site.\n\n— Yumi 🌸`,
  }),
  cancelled: (b, s) => ({
    subject: `Booking cancelled — Yumi Japanese Lessons (${b.id})`,
    body: `Hi ${b.name},\n\nYour booking below has been cancelled.\n` +
      `Refund: ${b.refund || "none — lesson counted as used"}.\n\n` +
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

    if (path === "/api/config" && request.method === "GET") {
      const settings = await getSettings(env);
      const openDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => settings.weekly[d]);
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
      const blocked = settings.blockedDates.includes(date);
      const hours = settings.weekly[jstWeekday(date)];
      const starts = candidateStarts(settings, date);
      const closed = !starts;
      const taken = closed ? [] : await bookingsOn(env, date);
      const slots = (starts || []).map((time) => {
        const start = toMin(time);
        const tooSoon = slotInstant(date, Number(time.slice(0, 2))) - new Date() <
          CONFIG.policy.bookAheadHours * 3600_000;
        const endsLate = start + minutes > toMin(hours.end);
        return { time, endTime: toHHMM(start + minutes),
          available: !tooSoon && !endsLate && !overlaps(start, minutes, taken) };
      });
      return json({ date, closed, blocked, duration: minutes,
        timezone: "Asia/Tokyo (JST)", slots });
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
      const upcoming = pub
        .filter((b) => ["upcoming", "pending_payment"].includes(b.effectiveStatus))
        .sort((a, b) => lessonStartMs(a) - lessonStartMs(b));
      const history = pub
        .filter((b) => ["completed", "cancelled"].includes(b.effectiveStatus))
        .sort((a, b) => lessonStartMs(b) - lessonStartMs(a));
      return json({ upcoming, history });
    }

    const m = path.match(/^\/api\/bookings\/([A-Z0-9-]+)(\/pay|\/cancel|\/reschedule)?$/);
    if (m) {
      const [, id, action] = m;
      const booking = await getBooking(env, id);
      if (!booking) return json({ error: "Booking not found" }, 404);
      const settings = await getSettings(env);

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
        if ((body.email || "").toLowerCase() !== booking.email.toLowerCase()) {
          return json({ error: "Email does not match this booking" }, 403);
        }
        if (booking.status !== "paid" && booking.status !== "pending_payment") {
          return json({ error: `Cannot cancel a booking in status ${booking.status}` }, 409);
        }
        const hour = Number(booking.time.slice(0, 2));
        const hoursLeft = (slotInstant(booking.date, hour) - new Date()) / 3600_000;
        const refunded = booking.status === "paid" &&
          booking.reschedules === 0 &&
          hoursLeft >= CONFIG.policy.cancelRefundBeforeHours;
        booking.status = "cancelled";
        booking.cancelledAt = new Date().toISOString();
        booking.refund = refunded ? "full (mock)" : "none — lesson counted as used";
        await saveBooking(env, booking);
        defer(notifyBookingEvent(env, settings, booking, "cancelled"));
        return json({ booking: publicBooking(booking, settings), refunded });
      }

      if (action === "/reschedule" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        if ((body.email || "").toLowerCase() !== booking.email.toLowerCase()) {
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
