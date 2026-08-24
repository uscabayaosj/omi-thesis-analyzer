# ADHD Aid Nudge — Missed Daily Rollup — Design Spec (2026-08-24)

## Purpose

Daily Rollup is meant to run once a day to close out the day and plan
tomorrow, but nothing today reminds the user if they forget. This adds a
real push notification, delivered even when the app is closed, that fires
once a day if today's rollup hasn't been run yet by evening.

## Approved decisions

- **Delivery: real Web Push**, not an in-app-only reminder — the point is to
  reach the user even when TRACE isn't open. The service worker
  (`src/app/sw.js/route.ts`) already has a `push` event listener stub
  written for exactly this; this feature is what finally sends something to
  it.
- **Single trigger for this feature: missed daily rollup.** The
  aging-commitments nudge considered alongside this is explicitly deferred —
  it needs a structured "first seen" date on commitments that doesn't exist
  yet (today aging is LLM-generated prose inside the rollup text, not
  structured data).
- **Check time: 9:00 PM Europe/London, once daily.** Implemented as a fixed
  UTC cron time (21:00 UTC), not an hourly DST-aware check — during British
  Summer Time this drifts to firing around 10:00 PM local. This is a
  documented approximation, not a defect, matching the posture already used
  for the cache-pricing caveat in the usage-visibility feature: correct most
  of the year, off by up to an hour for part of it, not worth the added
  cron-frequency complexity for a single-user tool.
- **Subscription storage:** a new Neon table, `push_subscriptions` — not the
  JSONB-namespace pattern (this is server-side infrastructure state, not
  client data being mirrored).
- **Subscribe UI:** a toggle on the `/rollup` page, not a separate settings
  page (none exists yet, and this is the one page a rollup-related nudge is
  obviously relevant to).
- **Cron auth:** the check endpoint verifies `Authorization: Bearer
  $CRON_SECRET`, matching Vercel's automatic cron-request header, and
  rejects everything else — this endpoint sends a push to every stored
  subscription and must not be publicly triggerable.
- **Dead subscriptions self-heal:** a 404/410 from the push service on send
  deletes that subscription's row. No manual cleanup UI.
- **Out of scope:** aging-commitments nudge, multiple nudge times, quiet
  hours / do-not-disturb windows, any notification beyond this one trigger,
  a settings/preferences page.

## Data model

New table, created lazily on first use (mirrors `ensureSchema` in `kv.ts`
and `ensureUsageSchema` in `usage.ts` — no separate migration step):

```sql
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint    TEXT PRIMARY KEY,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`endpoint` is the push service's unique URL for that browser/device
subscription (from the browser's `PushSubscription`), so it's a natural
primary key — resubscribing the same device just upserts the same row.

## Client: subscribe / unsubscribe

New module `src/lib/push.ts`:

- `isPushSupported(): boolean` — `"serviceWorker" in navigator && "PushManager" in window`.
- `subscribeToPush(): Promise<void>` — requests `Notification.requestPermission()`;
  if granted, gets the active service worker registration, calls
  `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: <VAPID public key, urlBase64-decoded> })`,
  then `POST /api/push/subscribe` with `{ endpoint, keys: { p256dh, auth } }`
  extracted from the subscription object (`subscription.toJSON()`).
- `unsubscribeFromPush(): Promise<void>` — gets the current subscription (if
  any), calls `subscription.unsubscribe()` client-side, then
  `POST /api/push/unsubscribe` with `{ endpoint }` so the server drops the
  row too.
- The VAPID public key is not a secret — it's read from
  `process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY` (a `NEXT_PUBLIC_` var, baked
  into the client bundle at build time, same as any other public config).

UI in `src/app/rollup/page.tsx`: a toggle near the top of the page —
"Remind me if I forget today's rollup" — reflecting current subscription
state (checked via `registration.pushManager.getSubscription()` on mount)
and calling `subscribeToPush()`/`unsubscribeFromPush()` on change. If
`isPushSupported()` is false (e.g. desktop Safari, or the app isn't
installed as a PWA on iOS), the toggle is replaced with a short explanatory
note instead of a broken control.

## Server: subscribe / unsubscribe routes

- `POST /api/push/subscribe` (`src/app/api/push/subscribe/route.ts`):
  validates `{ endpoint: string, keys: { p256dh: string, auth: string } }`,
  upserts into `push_subscriptions`. Returns `{ configured: false }` (200,
  not an error) if the Neon store isn't set up — same degrade-gracefully
  posture as every other store-backed route in this app.
- `POST /api/push/unsubscribe` (`src/app/api/push/unsubscribe/route.ts`):
  validates `{ endpoint: string }`, deletes the matching row if present.
  Always returns `{ ok: true }` even if no row matched (idempotent).

## Server: the cron check + send

`GET /api/push/check-rollup` (`src/app/api/push/check-rollup/route.ts`):

1. Reject with 401 unless `req.headers.get("authorization") === \`Bearer ${process.env.CRON_SECRET}\`` and `CRON_SECRET` is set.
2. Compute "today" as a `YYYY-MM-DD` string in `Europe/London` (via
   `Intl.DateTimeFormat` with `timeZone: "Europe/London"`), matching the key
   format the `omi-adhd-rollups` namespace already stores rollups under.
3. Read the `omi-adhd-rollups` namespace from the Neon store (same
   `getNamespaceData` used elsewhere via `kv.ts`). If today's key is
   present, do nothing and return `{ sent: false, reason: "already run" }`.
4. If the store isn't configured at all, return `{ sent: false, reason: "not configured" }` (200) — there is nothing to check or send to.
5. Otherwise, read all rows from `push_subscriptions`. For each, send a push
   via the `web-push` npm package
   (`webpush.sendNotification(subscription, JSON.stringify({ title: "TRACE", body: "You haven't run today's rollup yet.", url: "/rollup" }))`),
   configured with `webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY)`.
   On a 404/410 response, delete that subscription's row. Other send
   failures are logged and skipped (don't block sending to the remaining
   subscriptions).
6. Returns `{ sent: true, subscriptionCount, deliveredCount }` for
   observability in the cron's own logs.

The existing `push` handler in the service worker (`src/app/sw.js/route.ts`)
already parses this exact `{ title, body, url }` shape via
`event.data.json()` — no service worker changes needed, it was written
ahead of time for this.

## Cron configuration

New file `vercel.json` at the project root (none exists today):

```json
{
  "crons": [
    { "path": "/api/push/check-rollup", "schedule": "0 21 * * *" }
  ]
}
```

`0 21 * * *` is 21:00 UTC daily — 9:00 PM London time in GMT (winter),
10:00 PM London time during BST (summer), per the approved DST
approximation above.

## Environment variables (set outside this codebase)

- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` — a key pair generated once via
  the `web-push` package's key-generation helper; the public key is also
  duplicated as `NEXT_PUBLIC_VAPID_PUBLIC_KEY` for the client bundle.
- `VAPID_SUBJECT` — a `mailto:` contact address required by the Web Push
  protocol.
- `CRON_SECRET` — a random secret; Vercel automatically sends it as
  `Authorization: Bearer $CRON_SECRET` on requests it makes to a configured
  cron path, and this project's cron route checks it.

These are generated/provided once during implementation and set in the
Vercel project's environment variables outside of this codebase — this spec
does not include a way to set them from the app itself.
