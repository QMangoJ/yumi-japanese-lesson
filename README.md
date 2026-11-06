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
- `worker.js` — Cloudflare Worker. Serves the static files through the
  ASSETS binding and implements the booking API:
  - `GET  /api/config` — courses, lesson durations (30 / 50 / 120 min),
    prices, policy (single source of truth, all marked MOCK in `CONFIG`)
  - `GET  /api/availability?date=YYYY-MM-DD&duration=50` — start times whose
    whole lesson fits the day and doesn't overlap another booking (JST)
  - `POST /api/bookings` — create a booking (status `pending_payment`)
  - `POST /api/bookings/:id/pay` — MOCK payment, marks the booking `paid`
    and issues a (mock) Google Meet link. Replace with Stripe before
    taking real money.
  - `GET  /api/bookings/:id?email=` — look up a booking (My Bookings)
  - `POST /api/bookings/:id/cancel` — policy: full refund only when never
    rescheduled and cancelled 24h+ ahead
  - `POST /api/bookings/:id/reschedule` — 24h+ before, max 2 times, new
    slot 72h+ ahead
- Bookings are stored in the `yumi-bookings` KV namespace (binding
  `BOOKINGS`).

## Things still mocked (decide before real launch)

Prices and weekly hours in `worker.js` `CONFIG`, the payment step
(Stripe), the Google Meet link, and confirmation emails (not sent yet).

## Local preview

    python3 -m http.server 8080   # static pages only; booking API needs the Worker
