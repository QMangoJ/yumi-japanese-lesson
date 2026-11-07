/* lib/auth.js — split from worker.js (mechanical, bodies unchanged). */
import { bytesToB64 } from "./core.js";
import { getSettings, isAdminEmail } from "./settings.js";

/** Admin gate for every /api/admin/* route, with two channels:
 *  1. the shared admin key in KV `meta:admin_key` (X-Admin-Key header) —
 *     the original channel, unchanged;
 *  2. a site session whose account email is on the admin whitelist
 *     (settings.adminEmails) — a whitelisted Google sign-in is itself
 *     the credential (Daniel's decision 2026-11-06). Reuses the normal
 *     session validation; the whitelist decision is made only here,
 *     server-side. Anything else is denied. */
export async function adminAuthorized(env, request) {
  const raw = await env.BOOKINGS.get("meta:admin_key");
  if (raw) {
    // Tolerate a key stored with surrounding quotes/whitespace (e.g. written
    // through a JSON-bodied API helper).
    const key = raw.trim().replace(/^"+|"+$/g, "");
    if (key && (request.headers.get("X-Admin-Key") || "") === key) return true;
  }
  const me = await sessionUser(env, request);
  if (!me) return false;
  const settings = await getSettings(env);
  return isAdminEmail(settings, me.email);
}

/* ---------------- Student accounts & sessions ----------------
 * KV `user:<email>` = {name, salt, passwordHash, createdAt} — passwords
 * are PBKDF2-SHA256 hashes (100k iterations, random 16-byte salt),
 * never plaintext. KV `session:<token>` = {email, createdAt} with a
 * 30-day KV TTL; the token travels in an HttpOnly cookie. */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const SESSION_TTL = 30 * 24 * 3600; // seconds
export const LOGIN_FAIL_LIMIT = 10;
export const LOGIN_FAIL_TTL = 15 * 60; // seconds

export async function hashPassword(password, saltBytes) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations: 100000, hash: "SHA-256" },
    key, 256);
  return bytesToB64(new Uint8Array(bits));
}

export async function getUser(env, email) {
  const raw = await env.BOOKINGS.get(`user:${email}`);
  return raw ? JSON.parse(raw) : null;
}

export function sessionCookie(token, maxAge) {
  return `yumi_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}
export async function createSession(env, email) {
  const token = bytesToB64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  await env.BOOKINGS.put(`session:${token}`,
    JSON.stringify({ email, createdAt: new Date().toISOString() }),
    { expirationTtl: SESSION_TTL });
  return token;
}
export function sessionToken(request) {
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(/(?:^|;\s*)yumi_session=([^;]+)/);
  return m ? m[1] : null;
}
/** The logged-in student for this request: {name, email} or null. */
export async function sessionUser(env, request) {
  const token = sessionToken(request);
  if (!token) return null;
  const raw = await env.BOOKINGS.get(`session:${token}`);
  if (!raw) return null;
  let sess;
  try { sess = JSON.parse(raw); } catch { return null; }
  const user = await getUser(env, sess.email);
  if (!user) return null;
  return { name: user.name, email: sess.email,
    picture: user.googlePicture || "" };
}

/** The student object the frontend keeps: identity plus whether this
 *  account is on the admin whitelist. `isAdmin` drives the nav Admin
 *  shortcut's visibility; the actual admin authorization for such a
 *  session is re-checked server-side in adminAuthorized. */
export async function publicUser(env, user) {
  const settings = await getSettings(env);
  return { name: user.name, email: user.email,
    picture: user.picture || "",
    isAdmin: isAdminEmail(settings, user.email) };
}

/* ---------------- Google sign-in (the only login) ----------------
 * Hand-rolled OAuth 2.0, mirroring Daniel's japanese-learning
 * project: state kept in a short-lived KV record + cookie, code
 * exchange at Google's token endpoint, userinfo fetch, upsert BY
 * EMAIL into the existing user store, then a normal session through
 * the existing mechanism. Password-era accounts stay in KV
 * (dormant): a Google sign-in with the same verified email lands in
 * the same account, so bookings and packages unify. */

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
export const OAUTH_STATE_TTL = 600; // seconds

export function googleConfigured(settings) {
  return !!(settings.google && settings.google.clientId &&
    settings.google.clientSecret);
}
export function safeNextPath(value) {
  if (!value || typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//") ||
      value.includes("://")) return "/";
  return value;
}
export function readCookieValue(request, name) {
  const header = request.headers.get("Cookie") || "";
  const m = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}
export function redirectTo(location, cookies = []) {
  const headers = new Headers({ Location: location });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}

/* ---------------- Bookings storage ---------------- */

/** Run fn over items with bounded concurrency, preserving order.
 *  KV reads are independent round trips: awaiting them one by one
 *  made the admin aggregates cost one serial round trip per record
 *  (measured in measure-students-perf.mjs: /api/admin/students did
 *  240 serial gets ≈ 1.3s at only 5ms/op). Batching keeps the same
 *  reads, just overlapped. */
