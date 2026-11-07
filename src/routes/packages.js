/* routes/packages.js — route blocks split from worker.js (bodies unchanged).
 * Returns a Response, or undefined when no block matches. */
import { EMAIL_RE, googleConfigured, sessionUser } from "../lib/auth.js";
import { DAY_NAMES, checkOccurrence } from "../lib/availability.js";
import { CONFIG, TIME_RE, addDaysStr, json, publicBooking, toMin } from "../lib/core.js";
import { PACKAGE_SIZES, checkEndingReminder, firstOccurrenceDate, materializePackage, nextLessonOf, notifySubscriptionEvent, publicSubscription, refundableOf, remainingOf, stopSubscription } from "../lib/packages.js";
import { getSettings, priceFor } from "../lib/settings.js";
import { getSubscription, saveSubscription } from "../lib/store.js";

export async function handlePackages(c) {
  const { request, env, ctx, url, path, defer } = c;
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
}
