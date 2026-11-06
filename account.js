/* YUMI Japanese Lessons — /account page
 *
 * Page-specific logic only: the sign-in gate, the greeting, the three
 * stat cards and the Learning profile. The booking cards, package
 * cards and the booking modal are rendered and wired by app.js into
 * #my-result / #my-subs / #my-history — the exact same code the
 * homepage My Bookings section uses. Helpers ($, api, escHtml,
 * setMsg) are shared from app.js, which loads first.
 */
"use strict";

/* Keep in sync with PROFILE_LEVELS in worker.js. */
const PROFILE_LEVELS = [
  "Complete beginner", "JLPT N5", "JLPT N4", "JLPT N3",
  "JLPT N2", "JLPT N1", "Not sure",
];

const GOOGLE_ICON = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34.3 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34.3 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>`;

document.addEventListener("DOMContentLoaded", async () => {
  let config = null;
  try { config = await api("/api/config"); } catch { /* gate falls back below */ }

  let user = null;
  try { user = (await api("/api/auth/me")).user; } catch { user = null; }
  const loading = $("#acct-loading");
  if (loading) loading.remove();

  /* Header nav account item mirrors the homepage: the static
   * label is "Login"; signed-in users get "Account" pointing
   * straight at /account, signed-out visitors are sent through
   * Google sign-in and land back here (same flow as the gate). */
  const navAcct = document.querySelector('.site-header nav a[href="/#my"]');
  if (navAcct) {
    if (user) {
      navAcct.textContent = "Account";
      navAcct.href = "/account";
    } else if (config?.googleAuth) {
      navAcct.addEventListener("click", (e) => {
        e.preventDefault();
        location.href = "/api/auth/google?next=" +
          encodeURIComponent("/account");
      });
    }
  }

  /* ---------- Signed out: Google sign-in gate ---------- */
  if (!user) {
    $("#acct-signedout").classList.remove("hidden");
    const box = $("#acct-auth");
    if (!config?.googleAuth) {
      box.innerHTML = `
      <div class="lookup-box">
        <p class="note">Sign-in will be available soon. You can still book
        lessons as a guest — just book with the email you will sign in
        with later, and your bookings will show up here automatically.</p>
      </div>`;
      return;
    }
    box.innerHTML = `
    <div class="lookup-box auth-google">
      <a class="google-btn" href="/api/auth/google?next=${encodeURIComponent("/account")}">
        ${GOOGLE_ICON}
        <span>Continue with Google</span></a>
      <p class="note">New here? Sign in with Google to create your account.
      Booked as a guest before? Sign in with the same email and your
      bookings appear here automatically.</p>
      ${new URLSearchParams(location.search).has("login_error")
        ? `<p class="msg msg-err">Google sign-in didn't complete — please try again.</p>` : ""}
    </div>`;
    return;
  }

  /* ---------- Signed in ---------- */
  $("#acct-app").classList.remove("hidden");

  const firstName = String(user.name || "").trim().split(/\s+/)[0] ||
    String(user.email || "").split("@")[0];
  $("#acct-greeting").textContent = `Hello, ${firstName}.`;
  $("#acct-avatar").innerHTML = user.picture
    ? `<img class="acct-avatar-img" src="${escHtml(user.picture)}" alt="" referrerpolicy="no-referrer" />`
    : `<span class="acct-avatar-initial" aria-hidden="true">${escHtml(firstName.charAt(0).toUpperCase())}</span>`;
  $("#acct-stat-email").textContent = user.email;

  $("#acct-logout").onclick = async () => {
    await api("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => {});
    location.reload();
  };

  /* Stat cards + package empty state share the two account fetches
   * (the cards themselves are rendered by app.js off the same APIs). */
  try {
    const [bk, subs] = await Promise.all([
      api("/api/my/bookings"),
      api("/api/my/subscriptions"),
    ]);
    $("#acct-stat-upcoming").textContent = (bk.upcoming || []).length;
    const list = subs.subscriptions || [];
    $("#acct-stat-pkg").textContent = list
      .filter((s) => s.status === "active")
      .reduce((n, s) => n + (s.remainingLessons || 0), 0);
    if (!list.some((s) => s.status !== "pending_payment")) {
      $("#acct-subs-empty").classList.remove("hidden");
    }
  } catch { /* the stat cards keep their placeholders; app.js reports card errors */ }

  /* ---------- Learning profile ---------- */
  let level = "";
  const chipsBox = $("#profile-levels");
  function renderLevelChips() {
    chipsBox.innerHTML = "";
    for (const lv of PROFILE_LEVELS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "dur-chip" + (lv === level ? " selected" : "");
      b.textContent = lv;
      b.setAttribute("aria-pressed", lv === level ? "true" : "false");
      b.onclick = () => {
        level = lv === level ? "" : lv; // click again to clear
        renderLevelChips();
      };
      chipsBox.appendChild(b);
    }
  }
  renderLevelChips();
  try {
    const { profile } = await api("/api/account/profile");
    if (profile) {
      level = profile.level || "";
      $("#profile-goals").value = profile.goals || "";
      renderLevelChips();
    }
  } catch { /* profile stays blank; saving still works */ }

  $("#profile-save").onclick = async () => {
    const btn = $("#profile-save");
    btn.disabled = true;
    setMsg("#profile-msg", "Saving…", true);
    try {
      await api("/api/account/profile", {
        method: "PUT",
        body: JSON.stringify({
          level,
          goals: $("#profile-goals").value.trim(),
        }),
      });
      setMsg("#profile-msg",
        "Saved ✓ Yumi will see your level and goals when planning your lessons.", true);
    } catch (e) {
      setMsg("#profile-msg", e.message, false);
    } finally {
      btn.disabled = false;
    }
  };
});
