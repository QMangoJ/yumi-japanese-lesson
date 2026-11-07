/* lib/profiles.js — split from worker.js (mechanical, bodies unchanged). */
export const PROFILE_LEVELS = [
  "Complete beginner", "JLPT N5", "JLPT N4", "JLPT N3",
  "JLPT N2", "JLPT N1", "Not sure",
];

export async function getProfile(env, email) {
  const raw = await env.BOOKINGS.get(`profile:${email}`);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    return {
      level: PROFILE_LEVELS.includes(p.level) ? p.level : "",
      goals: String(p.goals || "").slice(0, 2000),
      updatedAt: p.updatedAt || null,
    };
  } catch { return null; }
}

export async function saveProfile(env, email, { level, goals }) {
  const rec = { level, goals, updatedAt: new Date().toISOString() };
  await env.BOOKINGS.put(`profile:${email}`, JSON.stringify(rec));
  return rec;
}

/* ---------------- Email outbox (KV `email:<id>`) ---------------- */

