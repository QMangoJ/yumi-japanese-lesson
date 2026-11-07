/* lib/availability.js — split from worker.js (mechanical, bodies unchanged). */
import { CONFIG, DATE_RE, JST, jstWeekday, slotInstant, toHHMM, toMin } from "./core.js";
import { bookingsOn, overlaps } from "./store.js";

export function weeklyHoursFor(settings, weekday) {
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
export function openIntervals(settings, dateStr) {
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
export function intervalCovers(intervals, startMin, minutes) {
  return intervals.some(([a, b]) => startMin >= a && startMin + minutes <= b);
}

/** Bounding range {start, end} of the day's open intervals, or null
 *  when closed. Kept for callers that only need the outer bounds;
 *  precise checks go through openIntervals/intervalCovers. */
export function effectiveHours(settings, dateStr) {
  const iv = openIntervals(settings, dateStr);
  if (!iv.length) return null;
  return { start: toHHMM(iv[0][0]), end: toHHMM(iv[iv.length - 1][1]) };
}

/** Hourly candidate start times ("HH:MM") for a date, or null when
 *  closed: every hour step inside the open intervals. Per-hour blocks
 *  (settings.blockedHours) are removed. */
export function candidateStarts(settings, dateStr) {
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
export function computeSlots(settings, dateStr, minutes, taken) {
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

export function validateSlot(settings, dateStr, time, minutes) {
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
export const DAY_NAMES = ["Sundays", "Mondays", "Tuesdays", "Wednesdays",
  "Thursdays", "Fridays", "Saturdays"];

/** Why one weekly occurrence cannot be placed, or null when it can.
 *  Used for occurrences 2–4 at creation and for horizon extensions:
 *  they only need to be inside the teacher's hours (incl. per-date
 *  overrides and blocked hours) — no lead-time rule. */
export function checkOccurrence(settings, dateStr, time, minutes) {
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

