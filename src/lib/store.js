/* lib/store.js — the data layer for bookings + subscriptions.
 *
 * Dual backend (task 10, Daniel 2026-11-07):
 *  - When the D1 binding `DB` is present, bookings/subscriptions live
 *    in D1 (database `yumi-bookings-db`): the full record is kept as
 *    JSON in `doc` — the exact bytes the KV value held — with the
 *    queryable fields extracted into columns (date/email/status +
 *    start/end minutes) and indexed. Everything else (settings,
 *    sessions, profiles, student notes, the email outbox) stays in KV.
 *  - Without `DB` (local harnesses), the original KV implementation
 *    runs unchanged, including the byemail:/subbyemail: indexes.
 *
 * Conflict safety: insertBookingGuarded() performs the overlap check
 * and the insert as ONE SQL statement (INSERT … WHERE NOT EXISTS), so
 * two racing creates cannot both land on the same slot — the KV era
 * check-then-write had that race. KV mode keeps the old behaviour
 * (the route's JS check has already run). */
import { CONFIG, effectiveStatus, lessonStartMs, mapParallel, minutesOfBooking, publicBooking, toMin } from "./core.js";

export const D1_SCHEMA = `
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  status TEXT NOT NULL,
  subscription_id TEXT,
  start_min INTEGER,
  end_min INTEGER,
  lesson_start_ms INTEGER,
  amount INTEGER,
  paid_at TEXT,
  created_at TEXT,
  doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings(email);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  status TEXT NOT NULL,
  paid_at TEXT,
  created_at TEXT,
  doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subs_email ON subscriptions(email);
CREATE INDEX IF NOT EXISTS idx_subs_status ON subscriptions(status);
`;

const useD1 = (env) => !!env.DB;

function bookingCols(b) {
  const start = toMin(b.time);
  return {
    id: b.id,
    email: String(b.email || "").toLowerCase(),
    date: b.date, time: b.time, status: b.status,
    subscription_id: b.subscriptionId || null,
    start_min: start, end_min: start + minutesOfBooking(b),
    lesson_start_ms: lessonStartMs(b),
    amount: b.amount ?? null,
    paid_at: b.paidAt || null,
    created_at: b.createdAt || null,
    doc: JSON.stringify(b),
  };
}
const BOOKING_COLS = ["id", "email", "date", "time", "status",
  "subscription_id", "start_min", "end_min", "lesson_start_ms",
  "amount", "paid_at", "created_at", "doc"];
const bookingVals = (b) => { const c = bookingCols(b); return BOOKING_COLS.map((k) => c[k]); };

function subCols(s) {
  return {
    id: s.id, email: String(s.email || "").toLowerCase(),
    status: s.status, paid_at: s.paidAt || null,
    created_at: s.createdAt || null, doc: JSON.stringify(s),
  };
}
const SUB_COLS = ["id", "email", "status", "paid_at", "created_at", "doc"];
const subVals = (s) => { const c = subCols(s); return SUB_COLS.map((k) => c[k]); };

const parseDocs = (rows) => rows.map((r) => JSON.parse(r.doc));

/* ---------------- bookings ---------------- */

export async function getBooking(env, id) {
  if (useD1(env)) {
    const row = await env.DB.prepare(
      "SELECT doc FROM bookings WHERE id = ?").bind(id).first();
    return row ? JSON.parse(row.doc) : null;
  }
  const raw = await env.BOOKINGS.get(`booking:${id}`);
  return raw ? JSON.parse(raw) : null;
}

export async function saveBooking(env, b) {
  if (useD1(env)) {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO bookings (${BOOKING_COLS.join(", ")})
       VALUES (${BOOKING_COLS.map(() => "?").join(", ")})`
    ).bind(...bookingVals(b)).run();
    return;
  }
  await env.BOOKINGS.put(`booking:${b.id}`, JSON.stringify(b));
  await env.BOOKINGS.put(`byemail:${b.email.toLowerCase()}:${b.id}`, b.id);
}

/** Insert a NEW booking only if its slot is still free — atomically.
 *  Returns true when the row landed, false when an overlapping
 *  active (pending_payment/paid) booking already occupies the slot.
 *  Mirrors bookingsOn()+overlaps() exactly: same date, same status
 *  set, minute-range intersection, self excluded. */
export async function insertBookingGuarded(env, b) {
  if (!useD1(env)) { await saveBooking(env, b); return true; }
  const c = bookingCols(b);
  const res = await env.DB.prepare(
    `INSERT INTO bookings (${BOOKING_COLS.join(", ")})
     SELECT ${BOOKING_COLS.map(() => "?").join(", ")}
     WHERE NOT EXISTS (
       SELECT 1 FROM bookings
       WHERE date = ? AND status IN ('pending_payment', 'paid')
         AND start_min < ? AND ? < end_min AND id <> ?)`
  ).bind(...bookingVals(b), c.date, c.end_min, c.start_min, c.id).run();
  return (res.meta?.changes || 0) > 0;
}

/** Active bookings on a date, as occupied intervals [{id, start, end}] in minutes. */
export async function bookingsOn(env, dateStr) {
  if (useD1(env)) {
    const { results } = await env.DB.prepare(
      "SELECT doc FROM bookings WHERE date = ?").bind(dateStr).all();
    const out = [];
    for (const b of parseDocs(results)) {
      if (["pending_payment", "paid"].includes(b.status)) {
        const start = toMin(b.time);
        out.push({ id: b.id, start, end: start + minutesOfBooking(b) });
      }
    }
    return out;
  }
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

/** Every stored booking (unsorted). */
export async function listAllBookings(env) {
  if (useD1(env)) {
    const { results } = await env.DB.prepare("SELECT doc FROM bookings").all();
    return parseDocs(results);
  }
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

/** A student's bookings, as public objects split into upcoming
 *  (soonest first) and history (newest first). */
export async function bookingsSplitForEmail(env, settings, email) {
  let mine;
  if (useD1(env)) {
    const { results } = await env.DB.prepare(
      "SELECT doc FROM bookings WHERE email = ?").bind(email.toLowerCase()).all();
    mine = parseDocs(results);
  } else {
    mine = [];
    let cursor;
    do {
      const list = await env.BOOKINGS.list({
        prefix: `byemail:${email}:`, cursor, limit: 100 });
      const ids = await mapParallel(list.keys, (key) => env.BOOKINGS.get(key.name));
      const batch = await mapParallel(ids, (id) => id ? getBooking(env, id) : null);
      for (const b of batch) if (b) mine.push(b);
      cursor = list.list_complete ? undefined : list.cursor;
    } while (cursor);
  }
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

/* ---------------- subscriptions ---------------- */

export async function getSubscription(env, id) {
  if (useD1(env)) {
    const row = await env.DB.prepare(
      "SELECT doc FROM subscriptions WHERE id = ?").bind(id).first();
    return row ? JSON.parse(row.doc) : null;
  }
  const raw = await env.BOOKINGS.get(`subscription:${id}`);
  return raw ? JSON.parse(raw) : null;
}

export async function saveSubscription(env, sub) {
  if (useD1(env)) {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO subscriptions (${SUB_COLS.join(", ")})
       VALUES (${SUB_COLS.map(() => "?").join(", ")})`
    ).bind(...subVals(sub)).run();
    return;
  }
  await env.BOOKINGS.put(`subscription:${sub.id}`, JSON.stringify(sub));
  await env.BOOKINGS.put(`subbyemail:${sub.email.toLowerCase()}:${sub.id}`, sub.id);
}

export async function subscriptionsForEmail(env, email) {
  if (useD1(env)) {
    const { results } = await env.DB.prepare(
      "SELECT doc FROM subscriptions WHERE email = ?").bind(email.toLowerCase()).all();
    return parseDocs(results)
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }
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
  if (useD1(env)) {
    const { results } = await env.DB.prepare("SELECT doc FROM subscriptions").all();
    return parseDocs(results)
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }
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
 *  without re-scanning the store. List endpoints load every booking ONCE
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
