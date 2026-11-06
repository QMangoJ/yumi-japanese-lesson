# YUMI Japanese Lessons

A one-page introduction + booking site for Yumi N., a certified Japanese
tutor, modeled on the structure and booking flow of
sakurajapaneselesson.com: hero, 3 reasons, about, lesson menu, price,
on-site booking (Sakura-style single pane: month calendar + start-time
dropdown + duration + live total), student voices, FAQ, and booking
management.

Live at https://yumi.ki-toko.com (Cloudflare Workers, custom domain).

## How it works

- `index.html`, `styles.css`, `app.js`, `images/` — the static site.
- `admin.html` — settings page (weekly hours, blocked dates, meeting
  link, email config), guarded by the admin key described below.
- `worker.js` — Cloudflare Worker. Serves the static files through the
  ASSETS binding and implements the booking API:
  - `GET  /api/config` — courses, lesson durations (30 / 50 / 120 min),
    prices, policy, and the open weekdays from the current settings
  - `GET  /api/availability?date=YYYY-MM-DD&duration=50` — start times whose
    whole lesson fits the day's settings hours and doesn't overlap another
    booking (JST); blocked dates report `closed` + `blocked`
  - `POST /api/bookings` — create a booking (status `pending_payment`)
  - `POST /api/bookings/:id/pay` — MOCK payment, marks the booking `paid`.
    Replace with Stripe before taking real money.
  - `GET  /api/bookings/:id?email=` — look up one booking (My Bookings)
  - `GET  /api/my-bookings?email=&ref=` — all of the student's bookings
    (the reference unlocks the list), split into `upcoming` and `history`
    by effective status: upcoming / pending_payment vs. completed /
    cancelled (a paid booking whose lesson has ended reads `completed`)
  - `POST /api/bookings/:id/cancel` — policy: full refund only when never
    rescheduled and cancelled 24h+ ahead
  - `POST /api/bookings/:id/reschedule` — 24h+ before, max 2 times, new
    slot 72h+ ahead
  - `GET|PUT /api/admin/settings` — runtime settings, requires the
    `X-Admin-Key` header to match the KV key `meta:admin_key`
    (403 while that key is unset)
- Bookings are stored in the `yumi-bookings` KV namespace (binding
  `BOOKINGS`), together with:
  - `meta:settings` — weekly hours per weekday, blocked dates, the fixed
    online-meeting link, Resend `{apiKey, from}` and the teacher
    notification email. Absent = the defaults in `worker.js`
    (Mon–Fri 08:00–22:00 JST). Edited via `admin.html` (served at `/admin`).
  - `email:<id>` — the email outbox. Every booking event (created,
    confirmed, cancelled, rescheduled) writes a record with status
    `queued`; when a Resend API key + sender are configured, a real send
    is attempted and the record is marked `sent` / `failed` (with the
    error). Nothing is ever marked sent without Resend accepting it.

## Things still mocked (decide before real launch)

Prices in `worker.js` `CONFIG` and the payment step (Stripe). Weekly
hours, the meeting link and email sending are real but need Yumi's actual
values in `admin.html` (her hours, her Zoom/Meet link, a Resend API key
with a verified sender domain).

## Local preview

    python3 -m http.server 8080   # static pages only; booking API needs the Worker
