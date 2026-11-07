/* lib/packages.js — split from worker.js (mechanical, bodies unchanged). */
import { DAY_NAMES, checkOccurrence } from "./availability.js";
import { CONFIG, JST, addDaysStr, instantMs, jstWeekday, lessonStartMs, toMin } from "./core.js";
import { EMAIL_TEMPLATES, queueEmail } from "./notify.js";
import { bookingsOn, getSubscription, insertBookingGuarded, lessonsForSubscription, nextLessonFrom, overlaps, refundableFrom, remainingFrom, saveBooking, saveSubscription } from "./store.js";

export async function nextLessonOf(env, sub) {
  return nextLessonFrom(await lessonsForSubscription(env, sub.id));
}

export function publicSubscription(sub, nextLesson = null, remainingLessons = null, refundable = null) {
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
export async function refundableOf(env, sub) {
  return refundableFrom(await lessonsForSubscription(env, sub.id));
}

export async function remainingOf(env, sub) {
  return remainingFrom(await lessonsForSubscription(env, sub.id));
}

/** Ending reminder (Feature F amendment): when an active subscription's
 *  remaining future lessons first drop to 2 (or fewer, but at least 1), email
 *  the student once (+ teacher copy) that the weekly block is about to end.
 *  Guarded by sub.endingReminderSent so it never double-fires per block;
 *  renewal resets the flag. */
export async function checkEndingReminder(env, settings, sub, preloadedLessons = null) {
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
export async function checkSubReminderAfterChange(env, settings, booking) {
  if (!booking.subscriptionId) return;
  const sub = await getSubscription(env, booking.subscriptionId);
  if (sub) await checkEndingReminder(env, settings, sub);
}

export function newLessonId() {
  return "YM-" + crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
}

export async function createSubscriptionLesson(env, sub, date, time) {
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
  /* Guarded insert: if a racer took this slot after materialize's
   * check, the lesson does not land and materialize counts the date
   * as skipped (it extends a week like any other skip). */
  if (!(await insertBookingGuarded(env, booking))) return null;
  return booking;
}

export const PACKAGE_SIZES = [6, 10, 20];

/** First date (JST) with the given weekday whose lesson start is at
 *  least bookAheadHours (72h) ahead — where a package slot begins. */
export function firstOccurrenceDate(weekday, time) {
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
export async function materializePackage(env, settings, sub) {
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
    else {
      const lesson = await createSubscriptionLesson(env, sub, date, slot.time);
      if (lesson) placed.push(lesson);
      else skipped.push(date);
    }
    cursors[idx] = addDaysStr(date, 7);
  }
  return { placed, skipped };
}

/** Stop a package: every future lesson is cancelled; lessons starting
 *  at least refundCutoffHours (12h) away refund in full, lessons inside
 *  the window are cancelled without a refund (Feature G). NO per-lesson
 *  emails — one summary email lists the dates, the refund total and any
 *  unrefunded inside-window lessons. Past lessons are untouched. */
export async function stopSubscription(env, settings, sub) {
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

export const SUB_TEMPLATES = {
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
export async function notifySubscriptionEvent(env, settings, sub, kind, extra = {}) {
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
export async function notifyBookingEvent(env, settings, booking, kind) {
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

