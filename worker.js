/**
 * YUMI Japanese Lessons — Worker
 *
 * Serves the static site (ASSETS binding) and the booking API.
 *
 * Booking model (modeled on sakurajapaneselesson.com's flow):
 *   one booking pane: choose course & lesson duration (30 / 50 / 120 min)
 *   -> pick a date on the month calendar -> pick a start time ->
 *   your details -> pay (MOCK checkout) -> confirmed, Meet link issued.
 *   Students manage bookings with email + booking reference:
 *   cancel / reschedule under the policy in CONFIG.policy.
 *
 * Everything Daniel/Yumi still need to decide lives in CONFIG below and is
 * marked MOCK: prices, weekly hours, the payment step and the Meet link.
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
  // MOCK weekly availability, Japan time. 0 = Sunday.
  openDays: [2, 3, 4, 5, 6], // Tue–Sat
  slotHours: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19], // first lesson starts 10:00 JST
  closeHour: 20, // a lesson must end by 20:00 JST (so 120 min starts by 18:00)
  policy: {
    bookAheadHours: 72,       // new bookings/reschedules at least 72h ahead
    rescheduleBeforeHours: 24,
    maxReschedules: 2,
    cancelRefundBeforeHours: 24,
  },
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

function publicBooking(b) {
  if (!b) return null;
  const { id, courseId, lessonTypeId, durationId, durationMinutes, date, time,
    name, email, status, amount, currency, meetLink, reschedules,
    lessonsTotal, createdAt } = b;
  return { id, courseId, lessonTypeId, durationId, durationMinutes, date, time,
    name, email, status, amount, currency, meetLink, reschedules,
    lessonsTotal, createdAt };
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

function validateSlot(dateStr, time, minutes) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || "")) return "Invalid date";
  if (!CONFIG.slotHours.some((h) => `${String(h).padStart(2, "0")}:00` === time)) {
    return "Invalid time";
  }
  if (!CONFIG.openDays.includes(jstWeekday(dateStr))) return "Closed on that day";
  if (toMin(time) + minutes > CONFIG.closeHour * 60) {
    return "That lesson would end after closing time (20:00 JST)";
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/config" && request.method === "GET") {
      return json({ courses: CONFIG.courses, durations: CONFIG.durations,
        legacyLessonTypes: CONFIG.legacyLessonTypes,
        currency: CONFIG.currency, policy: CONFIG.policy,
        openDays: CONFIG.openDays });
    }

    if (path === "/api/availability" && request.method === "GET") {
      const date = url.searchParams.get("date");
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return json({ error: "date is required (YYYY-MM-DD)" }, 400);
      }
      const minutes = Number(url.searchParams.get("duration")) || 60;
      if (!CONFIG.durations.some((d) => d.minutes === minutes) &&
          !CONFIG.legacyLessonTypes.some((t) => t.minutes === minutes)) {
        return json({ error: "Unknown duration" }, 400);
      }
      const closed = !CONFIG.openDays.includes(jstWeekday(date));
      const taken = closed ? [] : await bookingsOn(env, date);
      const slots = CONFIG.slotHours.map((h) => {
        const time = `${String(h).padStart(2, "0")}:00`;
        const start = toMin(time);
        const tooSoon = slotInstant(date, h) - new Date() <
          CONFIG.policy.bookAheadHours * 3600_000;
        const endsLate = start + minutes > CONFIG.closeHour * 60;
        return { time, endTime: toHHMM(start + minutes),
          available: !closed && !tooSoon && !endsLate && !overlaps(start, minutes, taken) };
      });
      return json({ date, closed, duration: minutes, timezone: "Asia/Tokyo (JST)", slots });
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
      const err = validateSlot(date, time, purchase.minutes);
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
      return json({ booking: publicBooking(booking) }, 201);
    }

    const m = path.match(/^\/api\/bookings\/([A-Z0-9-]+)(\/pay|\/cancel|\/reschedule)?$/);
    if (m) {
      const [, id, action] = m;
      const booking = await getBooking(env, id);
      if (!booking) return json({ error: "Booking not found" }, 404);

      if (!action && request.method === "GET") {
        const email = (url.searchParams.get("email") || "").toLowerCase();
        if (email !== booking.email.toLowerCase()) {
          return json({ error: "Email does not match this booking" }, 403);
        }
        return json({ booking: publicBooking(booking) });
      }

      if (action === "/pay" && request.method === "POST") {
        // MOCK payment: a real deployment charges via Stripe here and only
        // marks the booking paid from Stripe's webhook/confirmation.
        if (booking.status !== "pending_payment") {
          return json({ error: `Cannot pay a booking in status ${booking.status}` }, 409);
        }
        booking.status = "paid";
        booking.paidAt = new Date().toISOString();
        // MOCK Meet link: real flow creates/attaches a Google Meet link.
        booking.meetLink = "https://meet.google.com/mock-" + id.toLowerCase();
        await saveBooking(env, booking);
        return json({ booking: publicBooking(booking) });
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
        return json({ booking: publicBooking(booking), refunded });
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
        const err = validateSlot(body.date, body.time, minutes);
        if (err) return json({ error: err }, 400);
        const taken = await bookingsOn(env, body.date);
        if (overlaps(toMin(body.time), minutes, taken, booking.id)) {
          return json({ error: "That time was just taken" }, 409);
        }
        booking.date = body.date;
        booking.time = body.time;
        booking.reschedules += 1;
        await saveBooking(env, booking);
        return json({ booking: publicBooking(booking) });
      }
    }

    if (path.startsWith("/api/")) return json({ error: "Not found" }, 404);
    return env.ASSETS.fetch(request);
  },
};
