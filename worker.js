/**
 * YUMI Japanese Lessons — Worker
 *
 * Serves the static site (ASSETS binding) and the booking API.
 *
 * Booking model (modeled on sakurajapaneselesson.com's flow):
 *   choose course & lesson type -> pick a slot -> your details ->
 *   pay (MOCK checkout) -> confirmed, Google Meet link issued.
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
  lessonTypes: [
    { id: "trial", name: "Trial lesson", minutes: 25, price: 10, lessons: 1 },
    { id: "single", name: "Single lesson", minutes: 60, price: 30, lessons: 1 },
    { id: "pack5", name: "Package · 5 × 60 min", minutes: 60, price: 135, lessons: 5 },
    { id: "pack10", name: "Package · 10 × 60 min", minutes: 60, price: 270, lessons: 10 },
  ],
  // MOCK weekly availability, Japan time. 0 = Sunday.
  openDays: [2, 3, 4, 5, 6], // Tue–Sat
  slotHours: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19], // first lesson starts 10:00, last 19:00 JST
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
  const { id, courseId, lessonTypeId, date, time, name, email, status,
    amount, currency, meetLink, reschedules, lessonsTotal, createdAt } = b;
  return { id, courseId, lessonTypeId, date, time, name, email, status,
    amount, currency, meetLink, reschedules, lessonsTotal, createdAt };
}

async function getBooking(env, id) {
  const raw = await env.BOOKINGS.get(`booking:${id}`);
  return raw ? JSON.parse(raw) : null;
}

async function saveBooking(env, b) {
  await env.BOOKINGS.put(`booking:${b.id}`, JSON.stringify(b));
  await env.BOOKINGS.put(`byemail:${b.email.toLowerCase()}:${b.id}`, b.id);
}

async function bookedSlots(env, dateStr) {
  // Bookings are few; scan the prefix and filter by date.
  const taken = new Set();
  let cursor;
  do {
    const list = await env.BOOKINGS.list({ prefix: "booking:", cursor, limit: 100 });
    for (const key of list.keys) {
      const raw = await env.BOOKINGS.get(key.name);
      if (!raw) continue;
      const b = JSON.parse(raw);
      if (b.date === dateStr && ["pending_payment", "paid"].includes(b.status)) {
        taken.add(b.time);
      }
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  return taken;
}

function validateSlot(dateStr, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || "")) return "Invalid date";
  if (!CONFIG.slotHours.some((h) => `${String(h).padStart(2, "0")}:00` === time)) {
    return "Invalid time";
  }
  if (!CONFIG.openDays.includes(jstWeekday(dateStr))) return "Closed on that day";
  const hour = Number(time.slice(0, 2));
  const aheadMs = slotInstant(dateStr, hour) - new Date();
  if (aheadMs < CONFIG.policy.bookAheadHours * 3600_000) {
    return `Bookings need to be at least ${CONFIG.policy.bookAheadHours} hours ahead`;
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/config" && request.method === "GET") {
      return json({ courses: CONFIG.courses, lessonTypes: CONFIG.lessonTypes,
        currency: CONFIG.currency, policy: CONFIG.policy,
        openDays: CONFIG.openDays });
    }

    if (path === "/api/availability" && request.method === "GET") {
      const date = url.searchParams.get("date");
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return json({ error: "date is required (YYYY-MM-DD)" }, 400);
      }
      const closed = !CONFIG.openDays.includes(jstWeekday(date));
      const taken = closed ? new Set() : await bookedSlots(env, date);
      const slots = CONFIG.slotHours.map((h) => {
        const time = `${String(h).padStart(2, "0")}:00`;
        const tooSoon = slotInstant(date, h) - new Date() <
          CONFIG.policy.bookAheadHours * 3600_000;
        return { time, available: !closed && !tooSoon && !taken.has(time) };
      });
      return json({ date, closed, timezone: "Asia/Tokyo (JST)", slots });
    }

    if (path === "/api/bookings" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const { courseId, lessonTypeId, date, time, name, email, notes } = body || {};
      const course = CONFIG.courses.find((c) => c.id === courseId);
      const type = CONFIG.lessonTypes.find((t) => t.id === lessonTypeId);
      if (!course || !type) return json({ error: "Unknown course or lesson type" }, 400);
      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "")) {
        return json({ error: "Name and a valid email are required" }, 400);
      }
      const err = validateSlot(date, time);
      if (err) return json({ error: err }, 400);
      const taken = await bookedSlots(env, date);
      if (taken.has(time)) return json({ error: "That time was just taken" }, 409);

      const id = "YM-" + crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
      const booking = {
        id, courseId, lessonTypeId, date, time,
        name: String(name).slice(0, 80), email: String(email).slice(0, 120),
        notes: String(notes || "").slice(0, 1000),
        status: "pending_payment",
        amount: type.price, currency: CONFIG.currency,
        lessonsTotal: type.lessons, reschedules: 0,
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
        const err = validateSlot(body.date, body.time);
        if (err) return json({ error: err }, 400);
        const taken = await bookedSlots(env, body.date);
        if (taken.has(body.time) && !(body.date === booking.date && body.time === booking.time)) {
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
