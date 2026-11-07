/* lib/settings.js — split from worker.js (mechanical, bodies unchanged). */
import { EMAIL_RE } from "./auth.js";
import { weeklyHoursFor } from "./availability.js";
import { CONFIG, DATE_RE, TIME_RE, toMin } from "./core.js";
import { PROFILE_LEVELS } from "./profiles.js";

export const DEFAULT_SETTINGS = {
  weekly: {
    0: null,
    1: { start: "08:00", end: "22:00" },
    2: { start: "08:00", end: "22:00" },
    3: { start: "08:00", end: "22:00" },
    4: { start: "08:00", end: "22:00" },
    5: { start: "08:00", end: "22:00" },
    6: null,
  },
  // Hour-set weekly template (Task: block-grid editor): weekday ->
  // sorted array of available start-hours (integers 0–23). {} means
  // "not set": the engine then derives the set from the legacy weekly
  // ranges above (see weeklyHoursFor), so pre-existing settings keep
  // behaving identically. Once the admin saves from the grid editor,
  // all seven weekdays are present and this is the source of truth.
  weeklyHours: {},
  // Admin-configurable per-lesson prices (USD), keyed by duration
  // minutes as strings. Defaults reproduce the CONFIG rates; bookings
  // and subscriptions snapshot the price at creation, so edits here
  // only affect new purchases.
  pricing: { "30": 15, "50": 25, "80": 40, "120": 60 },
  // Google sign-in (the site's only login): OAuth client credentials,
  // admin-editable like the Resend key. Both empty = sign-in disabled
  // and the frontend hides every sign-in entry point.
  google: { clientId: "", clientSecret: "" },
  blockedDates: [],
  meeting: { type: "fixed", url: "" },
  // Daniel's decision: sending is via Resend, sender
  // "Yumi Japanese Lessons <yumi-lesson@ki-toko.com>" (his own domain
  // ki-toko.com, already on Cloudflare; verify it in Resend). The API
  // key stays empty until he provides it — until then the outbox only queues.
  resend: { apiKey: "", from: "yumi-lesson@ki-toko.com" },
  teacherEmail: "",
  // Where student replies to outgoing mail should land (the From address
  // itself cannot receive — Resend is send-only). Set by Daniel to his
  // own inbox for now.
  replyTo: "",
  // Secret key for the teacher's ICS calendar feed (/api/calendar.ics).
  // Empty disables the feed (404). Anyone with the URL can see booking
  // names, so it is never exposed outside the admin page.
  calendarKey: "",
  // Site accounts whose email is on this list see an "Admin" entry in
  // the top nav (a shortcut link to /admin), and a session for one of
  // these accounts authorizes /admin and its APIs on its own (Daniel's
  // decision 2026-11-06: whitelisted Google sign-ins enter the admin
  // without the key — both Yumi's project account and Daniel's own
  // Gmail). The X-Admin-Key gate stays as the fallback channel.
  adminEmails: ["yumi.japan2026@gmail.com", "danieljj2026@gmail.com"],
  // Per-date availability overrides, on top of the weekly template:
  // dateOverrides["YYYY-MM-DD"] = null closes that specific day, and
  // {start, end} gives it special hours (even on a normally-closed
  // weekday). blockedHours["YYYY-MM-DD"] = ["10:00", ...] removes
  // individual start times on a day that is otherwise open.
  dateOverrides: {},
  blockedHours: {},
};

export function normalizeSettings(raw) {
  const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  if (!raw || typeof raw !== "object") return s;
  if (raw.weekly && typeof raw.weekly === "object") {
    for (let d = 0; d <= 6; d++) {
      if (!(String(d) in raw.weekly)) continue;
      const v = raw.weekly[String(d)];
      if (v === null) s.weekly[d] = null;
      else if (v && TIME_RE.test(v.start || "") && TIME_RE.test(v.end || "") &&
               toMin(v.start) < toMin(v.end)) {
        s.weekly[d] = { start: v.start, end: v.end };
      }
    }
  }
  if (raw.weeklyHours && typeof raw.weeklyHours === "object") {
    for (let d = 0; d <= 6; d++) {
      const v = raw.weeklyHours[String(d)];
      if (!Array.isArray(v)) continue;
      s.weeklyHours[String(d)] = [...new Set(
        v.map(Number).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23)
      )].sort((a, b) => a - b);
    }
  }
  if (raw.pricing && typeof raw.pricing === "object") {
    for (const d of CONFIG.durations) {
      const v = raw.pricing[String(d.minutes)];
      const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
      if (typeof n === "number" && Number.isFinite(n) && n > 0) {
        s.pricing[String(d.minutes)] = Math.round(n * 100) / 100;
      }
    }
  }
  if (raw.google && typeof raw.google === "object") {
    s.google = {
      clientId: String(raw.google.clientId || "").slice(0, 300),
      clientSecret: String(raw.google.clientSecret || "").slice(0, 300),
    };
  }
  if (Array.isArray(raw.blockedDates)) {
    s.blockedDates = [...new Set(raw.blockedDates.filter((x) => DATE_RE.test(x || "")))].sort();
  }
  if (raw.meeting && typeof raw.meeting === "object") {
    s.meeting = { type: "fixed", url: String(raw.meeting.url || "").slice(0, 500) };
  }
  if (raw.resend && typeof raw.resend === "object") {
    s.resend = {
      apiKey: String(raw.resend.apiKey || "").slice(0, 300),
      from: String(raw.resend.from || "").slice(0, 200),
    };
  }
  if (typeof raw.teacherEmail === "string") {
    s.teacherEmail = raw.teacherEmail.slice(0, 200);
  }
  if (typeof raw.replyTo === "string") {
    s.replyTo = raw.replyTo.slice(0, 200);
  }
  if (typeof raw.calendarKey === "string") {
    s.calendarKey = raw.calendarKey.slice(0, 100);
  }
  if (Array.isArray(raw.adminEmails)) {
    const list = raw.adminEmails
      .map((x) => String(x || "").toLowerCase().trim())
      .filter((x) => EMAIL_RE.test(x));
    s.adminEmails = [...new Set(list)].slice(0, 20);
  }
  if (raw.dateOverrides && typeof raw.dateOverrides === "object") {
    for (const [date, v] of Object.entries(raw.dateOverrides)) {
      if (!DATE_RE.test(date)) continue;
      if (v === null) s.dateOverrides[date] = null;
      else if (v && TIME_RE.test(v.start || "") && TIME_RE.test(v.end || "") &&
               toMin(v.start) < toMin(v.end)) {
        s.dateOverrides[date] = { start: v.start, end: v.end };
      }
    }
  }
  if (raw.blockedHours && typeof raw.blockedHours === "object") {
    for (const [date, list] of Object.entries(raw.blockedHours)) {
      if (!DATE_RE.test(date) || !Array.isArray(list)) continue;
      const hours = [...new Set(list.filter((x) => TIME_RE.test(x || "")))].sort();
      if (hours.length) s.blockedHours[date] = hours;
    }
  }
  return s;
}

export async function getSettings(env) {
  const raw = await env.BOOKINGS.get("meta:settings");
  if (!raw) return normalizeSettings(null);
  try { return normalizeSettings(JSON.parse(raw)); }
  catch { return normalizeSettings(null); }
}

/** Settings as the admin page may see them: the Resend key is never echoed. */
export function publicSettings(s) {
  return {
    weekly: s.weekly,
    weeklyHours: s.weeklyHours,
    pricing: s.pricing,
    google: { clientId: s.google.clientId, clientSecretSet: !!s.google.clientSecret },
    blockedDates: s.blockedDates,
    meeting: s.meeting,
    resend: { from: s.resend.from, apiKeySet: !!s.resend.apiKey },
    teacherEmail: s.teacherEmail,
    replyTo: s.replyTo,
    calendarKey: s.calendarKey,
    dateOverrides: s.dateOverrides,
    blockedHours: s.blockedHours,
    adminEmails: s.adminEmails,
  };
}

/** The current price for a duration: the admin-configured settings
 *  value wins; CONFIG holds the factory default. Amounts are
 *  snapshotted onto bookings/subscriptions at creation time, so a
 *  price change never rewrites an existing record. */
export function priceFor(settings, minutes) {
  const v = settings && settings.pricing
    ? settings.pricing[String(minutes)] : undefined;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  const d = CONFIG.durations.find((x) => x.minutes === minutes);
  return d ? d.price : 0;
}

/** Reject a settings.pricing payload that is not clean: every key a
 *  known duration, every value a positive finite number. Returns an
 *  error string or null. */
export function validatePricing(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) {
    return "Prices must be an object keyed by duration";
  }
  for (const [k, v] of Object.entries(p)) {
    if (!CONFIG.durations.some((d) => String(d.minutes) === k)) {
      return `Unknown duration in prices: ${k}`;
    }
    const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
      return `Price for ${k} min must be a positive number`;
    }
  }
  return null;
}

/** Is this email on the admin whitelist (settings.adminEmails)?
 *  Case-insensitive and whitespace-tolerant on both sides. The list
 *  itself is never sent to the client — only this boolean outcome. */
export function isAdminEmail(settings, email) {
  const e = String(email || "").toLowerCase().trim();
  if (!e) return false;
  return (settings.adminEmails || []).some(
    (x) => String(x || "").toLowerCase().trim() === e);
}

/** Available start-hours (integers 0–23, sorted) for a weekday from
 *  the hour-set template (settings.weeklyHours). When the template has
 *  no entry for the weekday, derive the set from the legacy weekly
 *  range: every hour block [h:00, h+1:00) fully inside [start, end) —
 *  for Mon–Fri 08:00–22:00 that is exactly [8..21]. */
export function resolvePurchase(body, settings) {
  const dur = CONFIG.durations.find((d) => d.id === body.durationId) ||
    CONFIG.durations.find((d) => d.minutes === Number(body.durationMinutes));
  if (dur) return { durationId: dur.id, minutes: dur.minutes, price: priceFor(settings, dur.minutes), lessons: 1, lessonTypeId: null };
  const legacy = CONFIG.legacyLessonTypes.find((t) => t.id === body.lessonTypeId);
  if (legacy) return { durationId: null, minutes: legacy.minutes, price: legacy.price, lessons: legacy.lessons, lessonTypeId: legacy.id };
  return null;
}

/* ---------------- Learning profile (KV `profile:<email>`) ----------------
 * The student's self-described Japanese level + learning goals, edited
 * on /account (Sakura's Learning profile). Stored apart from the user
 * record — same pattern as `studentnote:<email>` — so the admin
 * students aggregate can attach it without touching accounts. Level
 * is one of PROFILE_LEVELS ("" = not set); goals is free text, capped
 * like the other student-written text fields. */

