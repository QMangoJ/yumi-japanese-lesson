/* routes/admin.js — route blocks split from worker.js (bodies unchanged).
 * Returns a Response, or undefined when no block matches. */
import { EMAIL_RE, adminAuthorized } from "../lib/auth.js";
import { addDaysStr, effectiveStatus, json, mapParallel, minutesOfBooking, publicBooking } from "../lib/core.js";
import { checkEndingReminder, notifyBookingEvent, publicSubscription, remainingOf, stopSubscription } from "../lib/packages.js";
import { PROFILE_LEVELS } from "../lib/profiles.js";
import { getSettings, normalizeSettings, publicSettings, validatePricing } from "../lib/settings.js";
import { CONTENT_KV_KEY, getContentOverrides, validateContentOverrides } from "../lib/content.js";
import { deleteMessage, getBooking, getMessage, getSubscription, lessonsOfSub, listAllBookings, listAllMessages, listAllSubscriptions, nextLessonFrom, refundableFrom, remainingFrom, resolveRemarks, saveBooking, saveMessage } from "../lib/store.js";

export async function handleAdmin(c) {
  const { request, env, ctx, url, path, defer } = c;
    if (path === "/api/admin/settings") {
      if (!(await adminAuthorized(env, request))) {
        return json({ error: "Admin API is disabled or the admin key is wrong" }, 403);
      }
      if (request.method === "GET") {
        return json({ settings: publicSettings(await getSettings(env)) });
      }
      if (request.method === "PUT") {
        let body;
        try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
        const incoming = (body && body.settings) || body || {};
        if (incoming.pricing !== undefined) {
          const perr = validatePricing(incoming.pricing);
          if (perr) return json({ error: perr }, 400);
        }
        const current = await getSettings(env);
        // An empty apiKey in the form means "keep the saved one".
        if (incoming.resend && !incoming.resend.apiKey) {
          incoming.resend = { ...incoming.resend, apiKey: current.resend.apiKey };
        }
        // Same rule for the Google client secret.
        if (incoming.google && !incoming.google.clientSecret) {
          incoming.google = { ...incoming.google, clientSecret: current.google.clientSecret };
        }
        const merged = normalizeSettings({ ...current, ...incoming });
        await env.BOOKINGS.put("meta:settings", JSON.stringify(merged));
        return json({ settings: publicSettings(merged) });
      }
      return json({ error: "Method not allowed" }, 405);
    }

    /* ----- Admin: front-page copy overrides -----
     * Full-state replace, same shape as the settings flow: the
     * Site Content view loads the whole overrides object, edits it
     * per language, and PUTs it back. Validation lives in
     * lib/content.js (unknown language / non-string / oversize are
     * 400s; empty strings drop the key = restore built-in default).
     * The public read side is GET /api/content (routes/public.js). */
    if (path === "/api/admin/content") {
      if (!(await adminAuthorized(env, request))) {
        return json({ error: "Admin API is disabled or the admin key is wrong" }, 403);
      }
      if (request.method === "GET") {
        return json({ overrides: await getContentOverrides(env) });
      }
      if (request.method === "PUT") {
        let body;
        try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
        const checked = validateContentOverrides(body);
        if (checked.error) return json({ error: checked.error }, 400);
        await env.BOOKINGS.put(CONTENT_KV_KEY, JSON.stringify(checked.overrides));
        return json({ overrides: checked.overrides });
      }
      return json({ error: "Method not allowed" }, 405);
    }

    /* ----- Admin: fullscreen background image -----
     * The image bytes live in KV under `admin-bg` (never inside the
     * settings JSON — only meta does). Modes: "default" = Yumi's
     * portrait (the static asset /images/yumi-avatar.jpg, served by
     * the client directly, no route involved), "custom" = the KV
     * blob below, "off" = plain canvas. Same admin auth as every
     * other admin API; the <img> on the admin page rides the session
     * cookie, so before sign-in only the public default can show. */
    if (path === "/api/admin/background") {
      if (!(await adminAuthorized(env, request))) {
        return json({ error: "Admin API is disabled or the admin key is wrong" }, 403);
      }
      if (request.method === "GET") {
        const s = await getSettings(env);
        if (s.adminBg.mode !== "custom" || !s.adminBg.custom) {
          return json({ error: "No custom background" }, 404);
        }
        const buf = await env.BOOKINGS.get("admin-bg", "arrayBuffer");
        if (!buf) return json({ error: "No custom background" }, 404);
        return new Response(buf, {
          headers: {
            "Content-Type": s.adminBg.custom.contentType,
            "Cache-Control": "private, max-age=60",
          },
        });
      }
      if (request.method === "POST") {
        const ct = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
        if (!["image/jpeg", "image/png", "image/webp"].includes(ct)) {
          return json({ error: "Only JPG, PNG or WebP images are allowed" }, 400);
        }
        const buf = await request.arrayBuffer();
        if (!buf.byteLength) return json({ error: "Empty upload" }, 400);
        if (buf.byteLength > 5 * 1024 * 1024) {
          return json({ error: "Image is larger than 5 MB" }, 413);
        }
        const b = new Uint8Array(buf);
        const sigOk = ct === "image/jpeg"
          ? b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
          : ct === "image/png"
            ? b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
            : b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
              b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
        if (!sigOk) return json({ error: "File content does not match its image type" }, 400);
        await env.BOOKINGS.put("admin-bg", buf);
        const current = await getSettings(env);
        const merged = normalizeSettings({
          ...current,
          adminBg: {
            mode: "custom",
            strength: current.adminBg.strength,
            custom: { contentType: ct, size: buf.byteLength, uploadedAt: new Date().toISOString() },
          },
        });
        await env.BOOKINGS.put("meta:settings", JSON.stringify(merged));
        return json({ settings: publicSettings(merged) });
      }
      if (request.method === "DELETE") {
        await env.BOOKINGS.delete("admin-bg");
        const current = await getSettings(env);
        const merged = normalizeSettings({
          ...current,
          adminBg: { mode: "default", strength: current.adminBg.strength, custom: null },
        });
        await env.BOOKINGS.put("meta:settings", JSON.stringify(merged));
        return json({ settings: publicSettings(merged) });
      }
      return json({ error: "Method not allowed" }, 405);
    }
    if (path === "/api/admin/background/prefs") {
      if (!(await adminAuthorized(env, request))) {
        return json({ error: "Admin API is disabled or the admin key is wrong" }, 403);
      }
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const current = await getSettings(env);
      const next = { ...current.adminBg };
      if (body && ["default", "custom", "off"].includes(body.mode)) {
        if (body.mode === "custom" && !current.adminBg.custom) {
          return json({ error: "Upload an image first" }, 400);
        }
        next.mode = body.mode;
      }
      if (body && Number.isFinite(Number(body.strength))) next.strength = Number(body.strength);
      const merged = normalizeSettings({ ...current, adminBg: next });
      await env.BOOKINGS.put("meta:settings", JSON.stringify(merged));
      return json({ settings: publicSettings(merged) });
    }

    /* ----- Admin: booking management ----- */
    if (path === "/api/admin/bookings" && request.method === "GET") {
      if (!(await adminAuthorized(env, request))) {
        return json({ error: "Admin API is disabled or the admin key is wrong" }, 403);
      }
      const settings = await getSettings(env);
      const statusF = (url.searchParams.get("status") || "").trim();
      const q = (url.searchParams.get("q") || "").trim().toLowerCase();
      const dateF = (url.searchParams.get("date") || "").trim();
      const fromF = (url.searchParams.get("from") || "").trim();
      const toF = (url.searchParams.get("to") || "").trim();
      const all = await listAllBookings(env);
      const remarks = await resolveRemarks(env, all);
      const filtered = all.filter((b) => {
        // `status` matches the stored status or the effective one, so
        // "upcoming"/"completed" work as well as "paid"/"cancelled".
        if (statusF && b.status !== statusF && effectiveStatus(b) !== statusF) return false;
        if (dateF && b.date !== dateF) return false;
        if (fromF && b.date < fromF) return false;
        if (toF && b.date > toF) return false;
        if (q && !`${b.email} ${b.name} ${b.id}`.toLowerCase().includes(q)) return false;
        return true;
      });
      filtered.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      // Range queries feed the admin calendar (a whole month at once).
      const cap = fromF || toF ? 500 : 200;
      const bookings = filtered.slice(0, cap).map((b) => {
        const r = remarks.get(b.email.toLowerCase()) || { note: "", isDefault: false };
        return {
          ...publicBooking(b, settings, "admin"),
          cancelledBy: b.cancelledBy || null,
          refund: b.refund || null,
          studentRemark: r.note,
          remarkIsDefault: r.isDefault,
        };
      });
      return json({ bookings, total: filtered.length });
    }

    /* ----- Admin: per-student remark (teacher's private note) ----- */
    if (path === "/api/admin/student-note" && request.method === "POST") {
      if (!(await adminAuthorized(env, request))) {
        return json({ error: "Admin API is disabled or the admin key is wrong" }, 403);
      }
      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const email = String(body?.email || "").toLowerCase().trim();
      const note = String(body?.note ?? "").slice(0, 2000);
      if (!EMAIL_RE.test(email)) return json({ error: "A valid email is required" }, 400);
      await env.BOOKINGS.put(`studentnote:${email}`, JSON.stringify({
        note, updatedAt: new Date().toISOString(),
      }));
      return json({ ok: true, email, studentRemark: note, remarkIsDefault: false });
    }

    const am = path.match(/^\/api\/admin\/bookings\/([A-Z0-9-]+)\/cancel$/);
    if (am && request.method === "POST") {
      if (!(await adminAuthorized(env, request))) {
        return json({ error: "Admin API is disabled or the admin key is wrong" }, 403);
      }
      const booking = await getBooking(env, am[1]);
      if (!booking) return json({ error: "Booking not found" }, 404);
      if (booking.status !== "paid" && booking.status !== "pending_payment") {
        return json({ error: `Cannot cancel a booking in status ${booking.status}` }, 409);
      }
      if (booking.status === "paid" && effectiveStatus(booking) === "completed") {
        return json({ error: "That lesson has already taken place" }, 409);
      }
      const settings = await getSettings(env);
      const wasPaid = booking.status === "paid";
      booking.status = "cancelled";
      booking.cancelledAt = new Date().toISOString();
      booking.cancelledBy = "teacher";
      // Teacher-initiated cancels always refund in full — the 12-hour
      // student cutoff does not apply to the teacher's own initiative.
      booking.refund = wasPaid ? "full (mock)" : "none — no payment was taken";
      if (wasPaid) {
        booking.refundAmount = booking.amount;
        booking.refundedAt = booking.cancelledAt;
      }
      await saveBooking(env, booking);
      defer(notifyBookingEvent(env, settings, booking, "cancelled"));
      return json({ booking: publicBooking(booking, settings, "admin"), refunded: wasPaid });
    }

    /* ----- Google sign-in ----- */
    if (path === "/api/admin/subscriptions" && request.method === "GET") {
      if (!(await adminAuthorized(env, request))) {
        return json({ error: "Admin API is disabled or the admin key is wrong" }, 403);
      }
      const subs = await listAllSubscriptions(env);
      const settings = await getSettings(env);
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

    /* ----- Contact messages (website form archive) ----- */
    if (path === "/api/admin/messages" && request.method === "GET") {
      if (!(await adminAuthorized(env, request))) {
        return json({ error: "Admin API is disabled or the admin key is wrong" }, 403);
      }
      return json({ messages: await listAllMessages(env) });
    }

    const msgm = path.match(/^\/api\/admin\/messages\/([A-Z0-9-]+)\/(read|delete)$/);
    if (msgm && request.method === "POST") {
      if (!(await adminAuthorized(env, request))) {
        return json({ error: "Admin API is disabled or the admin key is wrong" }, 403);
      }
      const msg = await getMessage(env, msgm[1]);
      if (!msg) return json({ error: "Message not found" }, 404);
      if (msgm[2] === "delete") {
        await deleteMessage(env, msg.id);
        return json({ ok: true });
      }
      let body = {};
      try { body = await request.json(); } catch { /* default: mark read */ }
      msg.read = body && body.read === false ? false : true;
      await saveMessage(env, msg);
      return json({ message: msg });
    }

    const asm = path.match(/^\/api\/admin\/subscriptions\/([A-Z0-9-]+)\/stop$/);
    if (asm && request.method === "POST") {
      if (!(await adminAuthorized(env, request))) {
        return json({ error: "Admin API is disabled or the admin key is wrong" }, 403);
      }
      const sub = await getSubscription(env, asm[1]);
      if (!sub) return json({ error: "Subscription not found" }, 404);
      if (sub.status !== "active") {
        return json({ error: `Cannot stop a subscription in status ${sub.status}` }, 409);
      }
      const settings = await getSettings(env);
      const result = await stopSubscription(env, settings, sub);
      return json({ subscription: publicSubscription(sub), ...result });
    }

    /* ----- Admin: students board (one aggregate, no N+1) ----- */
    if (path === "/api/admin/students" && request.method === "GET") {
      if (!(await adminAuthorized(env, request))) {
        return json({ error: "Admin API is disabled or the admin key is wrong" }, 403);
      }
      const all = await listAllBookings(env);
      const remarks = await resolveRemarks(env, all);
      // Learning profiles (`profile:<email>`), attached to a student
      // only when one was actually saved with content.
      const profiles = new Map();
      {
        let cursor;
        do {
          const list = await env.BOOKINGS.list({ prefix: "profile:", cursor, limit: 100 });
          const raws = await mapParallel(list.keys, (key) => env.BOOKINGS.get(key.name));
          list.keys.forEach((key, i) => {
            const raw = raws[i];
            if (!raw) return;
            try {
              const p = JSON.parse(raw);
              profiles.set(key.name.slice("profile:".length).toLowerCase(), {
                level: PROFILE_LEVELS.includes(p.level) ? p.level : "",
                goals: String(p.goals || "").slice(0, 2000),
              });
            } catch { /* skip malformed record */ }
          });
          cursor = list.list_complete ? undefined : list.cursor;
        } while (cursor);
      }
      const subs = await listAllSubscriptions(env);
      const users = new Map();
      {
        let cursor;
        do {
          const list = await env.BOOKINGS.list({ prefix: "user:", cursor, limit: 100 });
          const raws = await mapParallel(list.keys, (key) => env.BOOKINGS.get(key.name));
          list.keys.forEach((key, i) => {
            const raw = raws[i];
            if (!raw) return;
            try {
              users.set(key.name.slice("user:".length).toLowerCase(), JSON.parse(raw));
            } catch { /* skip malformed record */ }
          });
          cursor = list.list_complete ? undefined : list.cursor;
        } while (cursor);
      }
      const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
      const monthStart = today.slice(0, 8) + "01";
      const dormantCutoff = addDaysStr(today, -30);
      const byEmail = new Map();
      const ensure = (email) => {
        const em = String(email || "").toLowerCase();
        if (!byEmail.has(em)) {
          const u = users.get(em);
          const r = remarks.get(em) || { note: "", isDefault: false };
          byEmail.set(em, {
            email: em,
            name: (u && u.name) || "",
            hasAccount: !!u,
            accountType: u ? (u.googleSub ? "google" : "registered") : "guest",
            picture: (u && (u.googlePicture || u.picture)) || "",
            studentRemark: r.note, remarkIsDefault: r.isDefault,
            totalLessons: 0, completedLessons: 0, totalSpent: 0,
            nextLesson: null, activePackageRemaining: 0, hasActivePackage: false,
            lastLessonDate: null, lastActivityAt: null, firstSeen: null,
            lessons: [], packages: [],
          });
        }
        return byEmail.get(em);
      };
      for (const em of users.keys()) ensure(em);
      const byStart = [...all].sort((a, b) =>
        (a.date + a.time).localeCompare(b.date + b.time));
      for (const b of byStart) {
        const s = ensure(b.email);
        if (!s.name && b.name) s.name = b.name;
        const st = effectiveStatus(b);
        s.lessons.push({
          id: b.id, date: b.date, time: b.time,
          durationMinutes: minutesOfBooking(b),
          courseId: b.courseId || null, lessonTypeId: b.lessonTypeId || null,
          status: st, amount: b.amount || 0,
          subscriptionId: b.subscriptionId || null,
        });
        if (b.status !== "cancelled") {
          s.totalLessons++;
          if (st === "completed") {
            s.completedLessons++;
            if (!s.lastLessonDate || b.date > s.lastLessonDate) s.lastLessonDate = b.date;
          }
          if (st === "upcoming" && !s.nextLesson) {
            s.nextLesson = { date: b.date, time: b.time };
          }
        }
        if (b.status === "paid") {
          s.totalSpent += (b.amount || 0) - (b.refundAmount || 0);
        }
        if (b.createdAt) {
          if (!s.firstSeen || b.createdAt < s.firstSeen) s.firstSeen = b.createdAt;
          if (!s.lastActivityAt || b.createdAt > s.lastActivityAt) s.lastActivityAt = b.createdAt;
        }
      }
      for (const sub of subs) {
        const s = ensure(sub.email);
        // Remaining lessons come from the already-loaded booking
        // list — remainingOf() here used to re-scan all of KV per
        // subscription (the N+1 that made this endpoint crawl).
        const remaining = sub.status === "active"
          ? remainingFrom(lessonsOfSub(all, sub.id)) : 0;
        s.packages.push({
          id: sub.id, courseId: sub.courseId,
          durationMinutes: sub.durationMinutes,
          totalLessons: sub.totalLessons, remainingLessons: remaining,
          slots: sub.slots || [], status: sub.status,
          totalPrice: sub.totalPrice || 0, pricePerLesson: sub.pricePerLesson || 0,
        });
        if (sub.status === "active" && remaining > 0) {
          s.hasActivePackage = true;
          s.activePackageRemaining += remaining;
        }
        if (sub.createdAt) {
          if (!s.firstSeen || sub.createdAt < s.firstSeen) s.firstSeen = sub.createdAt;
          if (!s.lastActivityAt || sub.createdAt > s.lastActivityAt) s.lastActivityAt = sub.createdAt;
        }
      }
      const students = [...byEmail.values()].map((s) => {
        if (!s.name) s.name = s.email.split("@")[0];
        const prof = profiles.get(s.email);
        if (prof && (prof.level || prof.goals)) s.profile = prof;
        s.totalSpent = Math.round(s.totalSpent * 100) / 100;
        s.dormant = !s.nextLesson &&
          (!s.lastLessonDate || s.lastLessonDate < dormantCutoff);
        const up = s.lessons.filter(
          (l) => l.status === "upcoming" || l.status === "pending_payment");
        const rest = s.lessons.filter(
          (l) => !(l.status === "upcoming" || l.status === "pending_payment"));
        s.lessons = [...up, ...rest.reverse()];
        return s;
      });
      students.sort((a, b) => {
        const an = a.nextLesson ? a.nextLesson.date + a.nextLesson.time : "9999";
        const bn = b.nextLesson ? b.nextLesson.date + b.nextLesson.time : "9999";
        return an.localeCompare(bn) || a.name.localeCompare(b.name);
      });
      const summary = {
        total: students.length,
        withUpcoming: students.filter((s) => s.nextLesson).length,
        withActivePackage: students.filter((s) => s.hasActivePackage).length,
        newThisMonth: students.filter((s) =>
          s.firstSeen && s.firstSeen.slice(0, 10) >= monthStart).length,
      };
      return json({ summary, students });
    }

    /* ----- Teacher's Google Calendar feed (ICS subscription) ----- */
}
