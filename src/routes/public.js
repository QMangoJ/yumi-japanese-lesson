/* routes/public.js — route blocks split from worker.js (bodies unchanged).
 * Returns a Response, or undefined when no block matches. */
import { googleConfigured } from "../lib/auth.js";
import { candidateStarts, computeSlots, weeklyHoursFor } from "../lib/availability.js";
import { CONFIG, DATE_RE, JST, json, lessonEndMs, lessonStartMs, minutesOfBooking, toMin } from "../lib/core.js";
import { courseNameOf, icsEscape, icsFold, icsUtc } from "../lib/notify.js";
import { getSettings, priceFor } from "../lib/settings.js";
import { bookingsOn, listAllBookings } from "../lib/store.js";

export async function handlePublic(c) {
  const { request, env, ctx, url, path, defer } = c;
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

}
