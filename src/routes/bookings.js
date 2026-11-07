/* routes/bookings.js — route blocks split from worker.js (bodies unchanged).
 * Returns a Response, or undefined when no block matches. */
import { googleConfigured, sessionUser } from "../lib/auth.js";
import { validateSlot } from "../lib/availability.js";
import { CONFIG, json, lessonStartMs, minutesOfBooking, publicBooking, slotInstant, toMin } from "../lib/core.js";
import { checkSubReminderAfterChange, notifyBookingEvent } from "../lib/packages.js";
import { getSettings, resolvePurchase } from "../lib/settings.js";
import { bookingsOn, bookingsSplitForEmail, getBooking, overlaps, saveBooking } from "../lib/store.js";

export async function handleBookings(c) {
  const { request, env, ctx, url, path, defer } = c;
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

}
