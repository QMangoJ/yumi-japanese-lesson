/* lib/store.js — split from worker.js (mechanical, bodies unchanged). */
import { CONFIG, effectiveStatus, lessonStartMs, mapParallel, minutesOfBooking, publicBooking, toMin } from "./core.js";

export async function getBooking(env, id) {
  const raw = await env.BOOKINGS.get(`booking:${id}`);
  return raw ? JSON.parse(raw) : null;
}

export async function saveBooking(env, b) {
  await env.BOOKINGS.put(`booking:${b.id}`, JSON.stringify(b));
  await env.BOOKINGS.put(`byemail:${b.email.toLowerCase()}:${b.id}`, b.id);
}

/** Active bookings on a date, as occupied intervals [{id, start, end}] in minutes. */
export async function bookingsOn(env, dateStr) {
  // Bookings are few; scan the prefix and filter by date.
  const out = [];
  let cursor;
  do {
    const list = await env.BOOKINGS.list({ prefix: "booking:", cursor, limit: 100 });
    const raws = await mapParallel(list.keys, (key) => env.BOOKINGS.get(key.name));
    for (const raw of raws) {
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

export function overlaps(start, minutes, intervals, excludeId) {
  return intervals.some((iv) => iv.id !== excludeId && start < iv.end && iv.start < start + minutes);
}

/** Every stored booking (unsorted). Bookings are few; scan the prefix. */
export async function listAllBookings(env) {
  const out = [];
  let cursor;
  do {
    const list = await env.BOOKINGS.list({ prefix: "booking:", cursor, limit: 100 });
    const batch = await mapParallel(list.keys, (key) =>
      getBooking(env, key.name.slice("booking:".length)));
    for (const b of batch) if (b) out.push(b);
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  return out;
}

/** Resolve the teacher's remark for every student in a booking list.
 *  A stored `studentnote:<email>` wins; otherwise the remark defaults to
 *  the notes the student wrote on their EARLIEST booking (Daniel's rule),
 *  flagged isDefault so the admin UI can label it. Admin-only data — this
 *  never reaches publicBooking or any student-facing response. */
export async function resolveRemarks(env, allBookings) {
  const earliest = new Map();
  const byCreation = [...allBookings]
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  for (const b of byCreation) {
    const em = b.email.toLowerCase();
    if (!earliest.has(em) && (b.notes || "").trim()) earliest.set(em, b.notes);
  }
  const remarks = new Map();
  const emails = [...new Set(allBookings.map((b) => b.email.toLowerCase()))];
  const raws = await mapParallel(emails, (em) =>
    env.BOOKINGS.get(`studentnote:${em}`));
  emails.forEach((em, i) => {
    const raw = raws[i];
    let stored = null;
    if (raw) { try { stored = JSON.parse(raw); } catch { stored = null; } }
    if (stored) {
      remarks.set(em, { note: stored.note || "", isDefault: false });
    } else if (earliest.has(em)) {
      remarks.set(em, { note: earliest.get(em), isDefault: true });
    } else {
      remarks.set(em, { note: "", isDefault: false });
    }
  });
  return remarks;
}

/** A student's bookings via the `byemail:` index, as public objects split
 *  into upcoming (soonest first) and history (newest first). */
export async function bookingsSplitForEmail(env, settings, email) {
  const mine = [];
  let cursor;
  do {
    const list = await env.BOOKINGS.list({
      prefix: `byemail:${email}:`, cursor, limit: 100 });
    const ids = await mapParallel(list.keys, (key) => env.BOOKINGS.get(key.name));
    const batch = await mapParallel(ids, (id) => id ? getBooking(env, id) : null);
    for (const b of batch) if (b) mine.push(b);
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  const pub = mine.map((b) => publicBooking(b, settings));
  return {
    upcoming: pub
      .filter((b) => ["upcoming", "pending_payment"].includes(b.effectiveStatus))
      .sort((a, b) => lessonStartMs(a) - lessonStartMs(b)),
    history: pub
      .filter((b) => ["completed", "cancelled"].includes(b.effectiveStatus))
      .sort((a, b) => lessonStartMs(b) - lessonStartMs(a)),
  };
}
export async function getSubscription(env, id) {
  const raw = await env.BOOKINGS.get(`subscription:${id}`);
  return raw ? JSON.parse(raw) : null;
}

export async function saveSubscription(env, sub) {
  await env.BOOKINGS.put(`subscription:${sub.id}`, JSON.stringify(sub));
  await env.BOOKINGS.put(`subbyemail:${sub.email.toLowerCase()}:${sub.id}`, sub.id);
}

export async function subscriptionsForEmail(env, email) {
  const out = [];
  let cursor;
  do {
    const list = await env.BOOKINGS.list({
      prefix: `subbyemail:${email}:`, cursor, limit: 100 });
    const ids = await mapParallel(list.keys, (key) => env.BOOKINGS.get(key.name));
    const batch = await mapParallel(ids, (id) => id ? getSubscription(env, id) : null);
    for (const sub of batch) if (sub) out.push(sub);
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  return out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export async function listAllSubscriptions(env) {
  const out = [];
  let cursor;
  do {
    const list = await env.BOOKINGS.list({ prefix: "subscription:", cursor, limit: 100 });
    const batch = await mapParallel(list.keys, (key) =>
      getSubscription(env, key.name.slice("subscription:".length)));
    for (const sub of batch) if (sub) out.push(sub);
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  return out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export async function lessonsForSubscription(env, subId) {
  return lessonsOfSub(await listAllBookings(env), subId);
}

/** One subscription's lessons out of an already-loaded booking list,
 *  chronological — the same set lessonsForSubscription returns,
 *  without re-scanning KV. List endpoints load every booking ONCE
 *  and derive all per-package aggregates from it (previously each
 *  aggregate re-scanned the whole booking table per subscription). */
export function lessonsOfSub(allBookings, subId) {
  return allBookings
    .filter((b) => b.subscriptionId === subId)
    .sort((a, b) => lessonStartMs(a) - lessonStartMs(b));
}

export function nextLessonFrom(lessons) {
  const f = lessons.find((b) => b.status === "paid" && lessonStartMs(b) > Date.now());
  return f ? { id: f.id, date: f.date, time: f.time } : null;
}

export function remainingFrom(lessons) {
  const now = Date.now();
  return lessons.filter((b) => b.status === "paid" && lessonStartMs(b) > now).length;
}

export function refundableFrom(lessons) {
  const now = Date.now();
  const cutoff = CONFIG.policy.refundCutoffHours * 3600_000;
  let count = 0, total = 0, insideWindow = 0;
  for (const b of lessons) {
    if (b.status !== "paid" || lessonStartMs(b) <= now) continue;
    if (lessonStartMs(b) - now >= cutoff) { count++; total += b.amount || 0; }
    else insideWindow++;
  }
  return { count, total, insideWindow };
}

