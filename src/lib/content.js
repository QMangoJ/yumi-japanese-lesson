/* lib/content.js — admin-editable front-page copy overrides.
 *
 * The front pages translate through window.YUMI_I18N (i18n.js),
 * whose keys are the English source strings themselves. An override
 * replaces the built-in text for ONE language and ONE key; anything
 * not overridden falls back to the built-in dictionary, so the site
 * can never render blank because of this store.
 *
 * Storage: a single KV record `content:overrides` shaped
 *   { en: { <sourceKey>: "text" }, zh: { ... }, fr: { ... } }
 * Only non-empty string values are kept — an empty value means
 * "no override" (restore the built-in default), never a blank.
 * Overrides are PLAIN TEXT end to end: the front end only ever
 * assigns them through text-node / textContent paths, so markup
 * inside a value displays literally instead of executing. */
export const CONTENT_KV_KEY = "content:overrides";
export const CONTENT_LANGS = ["en", "zh", "fr"];
export const CONTENT_MAX_VALUE = 2000;   // chars per single value
export const CONTENT_MAX_KEY = 1500;     // chars per source key
export const CONTENT_MAX_ENTRIES = 600;  // total override entries

/** Read + normalise the stored overrides. Any corruption (bad JSON,
 *  wrong shapes, non-string values) degrades to fewer/no overrides —
 *  never to an error on the public path. */
export function normalizeContentOverrides(raw) {
  const out = { en: {}, zh: {}, fr: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const lang of CONTENT_LANGS) {
    const bag = raw[lang];
    if (!bag || typeof bag !== "object" || Array.isArray(bag)) continue;
    for (const [k, v] of Object.entries(bag)) {
      if (typeof v === "string" && v.length > 0) out[lang][k] = v;
    }
  }
  return out;
}

export async function getContentOverrides(env) {
  let raw = null;
  try {
    const text = await env.BOOKINGS.get(CONTENT_KV_KEY);
    raw = text ? JSON.parse(text) : null;
  } catch { raw = null; }
  return normalizeContentOverrides(raw);
}

/** Validate an admin PUT payload. Returns an error string, or the
 *  normalised overrides object to store. Stricter than the read
 *  path: unknown languages, non-string values and oversize inputs
 *  are rejected so bad data never reaches the store. */
export function validateContentOverrides(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Payload must be an object" };
  }
  const incoming = body.overrides;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return { error: "Payload must carry an overrides object" };
  }
  for (const lang of Object.keys(incoming)) {
    if (!CONTENT_LANGS.includes(lang)) {
      return { error: `Unknown language: ${lang}` };
    }
  }
  const out = { en: {}, zh: {}, fr: {} };
  let entries = 0;
  for (const lang of CONTENT_LANGS) {
    const bag = incoming[lang];
    if (bag === undefined) continue;
    if (!bag || typeof bag !== "object" || Array.isArray(bag)) {
      return { error: `overrides.${lang} must be an object` };
    }
    for (const [k, v] of Object.entries(bag)) {
      if (typeof v !== "string") {
        return { error: `Override values must be strings (key: ${k.slice(0, 40)})` };
      }
      if (k.length > CONTENT_MAX_KEY) {
        return { error: `Override key too long (max ${CONTENT_MAX_KEY} characters)` };
      }
      if (v.length > CONTENT_MAX_VALUE) {
        return { error: `Override text too long (max ${CONTENT_MAX_VALUE} characters, key: ${k.slice(0, 40)})` };
      }
      if (v.length === 0) continue; // empty = restore default: drop it
      out[lang][k] = v;
      entries++;
      if (entries > CONTENT_MAX_ENTRIES) {
        return { error: `Too many overrides (max ${CONTENT_MAX_ENTRIES})` };
      }
    }
  }
  return { overrides: out };
}
