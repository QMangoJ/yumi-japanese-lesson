/* routes/auth.js — route blocks split from worker.js (bodies unchanged).
 * Returns a Response, or undefined when no block matches. */
import { EMAIL_RE, GOOGLE_AUTH_URL, GOOGLE_TOKEN_URL, GOOGLE_USERINFO_URL, OAUTH_STATE_TTL, SESSION_TTL, createSession, getUser, googleConfigured, publicUser, readCookieValue, redirectTo, safeNextPath, sessionCookie, sessionToken, sessionUser } from "../lib/auth.js";
import { json, jsonWithHeaders, randomHex } from "../lib/core.js";
import { checkEndingReminder, publicSubscription } from "../lib/packages.js";
import { PROFILE_LEVELS, getProfile, saveProfile } from "../lib/profiles.js";
import { getSettings } from "../lib/settings.js";
import { bookingsSplitForEmail, lessonsOfSub, listAllBookings, nextLessonFrom, refundableFrom, remainingFrom, subscriptionsForEmail } from "../lib/store.js";

export async function handleAuth(c) {
  const { request, env, ctx, url, path, defer } = c;
    if (path === "/api/auth/google" && request.method === "GET") {
      const settings = await getSettings(env);
      if (!googleConfigured(settings)) {
        return json({ error: "Google sign-in is not configured" }, 501);
      }
      const state = randomHex(24);
      const next = safeNextPath(url.searchParams.get("next"));
      await env.BOOKINGS.put(`oauthstate:${state}`,
        JSON.stringify({ next, createdAt: Date.now() }),
        { expirationTtl: OAUTH_STATE_TTL });
      const authUrl = new URL(GOOGLE_AUTH_URL);
      authUrl.search = new URLSearchParams({
        client_id: settings.google.clientId,
        redirect_uri: `${url.origin}/api/auth/google/callback`,
        response_type: "code",
        scope: "openid email profile",
        state,
        access_type: "online",
        prompt: "select_account",
      }).toString();
      return redirectTo(authUrl.toString(), [
        `yumi_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${OAUTH_STATE_TTL}`,
      ]);
    }

    if (path === "/api/auth/google/callback" && request.method === "GET") {
      const clearState =
        "yumi_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";
      const fail = () => redirectTo("/?login_error=google", [clearState]);
      const settings = await getSettings(env);
      if (!googleConfigured(settings)) return fail();
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (url.searchParams.get("error") || !code || !state) return fail();
      if (readCookieValue(request, "yumi_oauth_state") !== state) return fail();
      const rawState = await env.BOOKINGS.get(`oauthstate:${state}`);
      if (!rawState) return fail();
      await env.BOOKINGS.delete(`oauthstate:${state}`); // one-time
      let next = "/";
      try { next = safeNextPath(JSON.parse(rawState).next); } catch { /* keep "/" */ }
      try {
        const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: settings.google.clientId,
            client_secret: settings.google.clientSecret,
            redirect_uri: `${url.origin}/api/auth/google/callback`,
            grant_type: "authorization_code",
          }),
        });
        if (!tokenRes.ok) return fail();
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) return fail();
        const infoRes = await fetch(GOOGLE_USERINFO_URL, {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        if (!infoRes.ok) return fail();
        const profile = await infoRes.json();
        const email = String(profile.email || "").toLowerCase().trim();
        if (!profile.sub || !EMAIL_RE.test(email) ||
            profile.email_verified !== true) {
          return fail();
        }
        // Upsert BY EMAIL: an existing account with this verified
        // email is signed into as-is (bookings/packages stay
        // attached); only the Google identity is recorded on it.
        let user = await getUser(env, email);
        if (user) {
          user.googleSub = profile.sub;
          user.googlePicture = profile.picture || user.googlePicture || "";
          if (!user.name && profile.name) user.name = profile.name;
        } else {
          user = {
            name: profile.name || email.split("@")[0],
            salt: null, passwordHash: null,
            googleSub: profile.sub,
            googlePicture: profile.picture || "",
            createdAt: new Date().toISOString(),
          };
        }
        await env.BOOKINGS.put(`user:${email}`, JSON.stringify(user));
        const token = await createSession(env, email);
        return redirectTo(next, [sessionCookie(token, SESSION_TTL), clearState]);
      } catch {
        return fail();
      }
    }

    /* ----- Student accounts -----
     * Password auth is retired (Google-only sign-in): both endpoints
     * answer 410 Gone. Existing user records and password hashes stay
     * in KV untouched — a Google sign-in with the same verified email
     * lands in the same account. */
    if (path === "/api/auth/register" && request.method === "POST") {
      return json({ error: "Password registration is disabled — please sign in with Google." }, 410);
    }
    if (path === "/api/auth/login" && request.method === "POST") {
      return json({ error: "Password sign-in is disabled — please sign in with Google." }, 410);
    }
    if (path === "/api/auth/logout" && request.method === "POST") {
      const token = sessionToken(request);
      if (token) await env.BOOKINGS.delete(`session:${token}`);
      return jsonWithHeaders({ ok: true }, 200,
        { "Set-Cookie": sessionCookie("", 0) });
    }

    if (path === "/api/auth/me" && request.method === "GET") {
      const me = await sessionUser(env, request);
      if (!me) return json({ error: "Not logged in" }, 401);
      return json({ user: await publicUser(env, me) });
    }

    /* ----- My bookings (login required) ----- */
    if (path === "/api/my/bookings" && request.method === "GET") {
      const me = await sessionUser(env, request);
      if (!me) return json({ error: "Please log in to see your bookings" }, 401);
      const settings = await getSettings(env);
      // Reading My Bookings evaluates the ending reminder for the student's
      // weekly subscriptions (fires once per block at 2 lessons left).
      for (const sub of await subscriptionsForEmail(env, me.email)) {
        await checkEndingReminder(env, settings, sub);
      }
      return json(await bookingsSplitForEmail(env, settings, me.email));
    }

    /* ----- My subscriptions (login required) ----- */
    if (path === "/api/my/subscriptions" && request.method === "GET") {
      const me = await sessionUser(env, request);
      if (!me) return json({ error: "Please log in to see your subscriptions" }, 401);
      const settings = await getSettings(env);
      const subs = await subscriptionsForEmail(env, me.email);
      const all = await listAllBookings(env);
      const out = [];
      for (const sub of subs) {
        const lessons = lessonsOfSub(all, sub.id);
        await checkEndingReminder(env, settings, sub, lessons);
        out.push(publicSubscription(sub, nextLessonFrom(lessons),
          remainingFrom(lessons), refundableFrom(lessons)));
      }
      return json({ subscriptions: out });
    }

    /* ----- Learning profile (login required) ----- */
    if (path === "/api/account/profile") {
      const me = await sessionUser(env, request);
      if (!me) return json({ error: "Please log in to see your profile" }, 401);
      const em = me.email.toLowerCase();
      if (request.method === "GET") {
        const p = await getProfile(env, em);
        return json({ profile: p ? { level: p.level, goals: p.goals } : null });
      }
      if (request.method === "PUT") {
        let body;
        try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
        const level = String(body?.level ?? "");
        if (level !== "" && !PROFILE_LEVELS.includes(level)) {
          return json({ error: "Unknown level" }, 400);
        }
        const goals = String(body?.goals ?? "").slice(0, 2000);
        const rec = await saveProfile(env, em, { level, goals });
        return json({ profile: { level: rec.level, goals: rec.goals } });
      }
      return json({ error: "Method not allowed" }, 405);
    }

    /* ----- Lesson packages: create (pending) ----- */
}
