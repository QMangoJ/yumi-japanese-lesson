/* lib/notify.js — split from worker.js (mechanical, bodies unchanged). */
import { CONFIG, JST, json, lessonEndMs, lessonStartMs, minutesOfBooking, toHHMM, toMin } from "./core.js";

export function courseNameOf(b) {
  return CONFIG.courses.find((c) => c.id === b.courseId)?.name || b.courseId;
}

export function meetingLine(b, settings) {
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

export function bookingSummaryText(b, settings) {
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
export function icsUtc(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** RFC 5545 text escaping for ICS property values. */
export function icsEscape(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/;/g, "\\;")
    .replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** RFC 5545 line folding (continuation lines start with a space). */
export function icsFold(line) {
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
export function googleCalendarUrl(b, s) {
  const text = encodeURIComponent(`Japanese lesson with Yumi — ${courseNameOf(b)}`);
  const details = encodeURIComponent(
    `Booking reference: ${b.id}\n${meetingLine(b, s)}`);
  return "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    `&text=${text}&dates=${icsUtc(lessonStartMs(b))}/${icsUtc(lessonEndMs(b))}` +
    `&details=${details}`;
}

export const EMAIL_TEMPLATES = {
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
export async function queueEmail(env, settings, { to, subject, body, bookingRef, kind, replyTo }) {
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

