# ADHD Aid Nudge — Missed Daily Rollup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send a real Web Push notification once a day, at ~9:00 PM Europe/London, if the user hasn't run today's Daily Rollup yet — delivered even when TRACE isn't open.

**Architecture:** A new Neon table (`push_subscriptions`) stores browser push subscriptions, written/removed via two small API routes the client calls when the user toggles a "remind me" switch on `/rollup`. A Vercel Cron job hits a third route once daily; it checks whether today's rollup exists in the already-synced `omi-adhd-rollups` namespace, and if not, sends a push to every stored subscription via the `web-push` npm package and VAPID keys. The service worker's existing `push` event listener (already written, currently unused) receives and displays it.

**Tech Stack:** Next.js 16 App Router, TypeScript, `@neondatabase/serverless` (existing dependency), `web-push` (new dependency), Vercel Cron (`vercel.json`), the Web Push / Notifications browser APIs.

## Global Constraints

- Single trigger only: missed daily rollup. No aging-commitments nudge, no other triggers (per spec — explicitly deferred).
- Check time: once daily via a fixed UTC cron time (`21:00 UTC`) approximating 9:00 PM Europe/London — this drifts to ~10:00 PM local during British Summer Time. This is an approved, documented approximation, not a defect to fix in this plan.
- The cron-triggered send route must reject any request without a valid `Authorization: Bearer $CRON_SECRET` header matching `process.env.CRON_SECRET`.
- Every store-backed route degrades to `{ configured: false }` with HTTP 200 (never a 500) when `DATABASE_URL`/the Neon store isn't configured — matches the existing pattern in `src/app/api/store/route.ts` and `src/lib/usage.ts`.
- A push send that 404s/410s (expired subscription) deletes that subscription's row; other send failures are logged and skipped, never block sending to remaining subscriptions.
- **No test runner exists in this codebase** (confirmed: no jest/vitest/tsx in `node_modules/.bin`, no `test` script in `package.json`, zero test files under `src/`). Verification in this plan uses `npx tsc --noEmit`, `npm run lint`, `npm run build`, and manual runtime checks (curl against `npm run dev`/`npm start`) — do not introduce a new test framework.
- VAPID keys, `CRON_SECRET`, and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` are set in the Vercel project's environment variables outside this codebase — no task in this plan sets them remotely, only generates/documents the values.

---

## File Structure

- **Create `src/lib/push-store.ts`** — the `push_subscriptions` schema (lazy-created, memoized), and `addSubscription`/`removeSubscription`/`listSubscriptions` — the server-side data layer for subscriptions, parallel to how `src/lib/usage.ts` owns `trace_usage`.
- **Create `src/app/api/push/subscribe/route.ts`** — `POST`, validates and upserts a subscription.
- **Create `src/app/api/push/unsubscribe/route.ts`** — `POST`, deletes a subscription by endpoint.
- **Create `src/app/api/push/check-rollup/route.ts`** — `GET`, the cron target: checks today's rollup, sends pushes via `web-push`.
- **Create `vercel.json`** — the cron schedule (no Vercel config file exists in this repo today).
- **Modify `package.json`** — add `web-push` (runtime) and `@types/web-push` (dev) dependencies.
- **Create `src/lib/push.ts`** — client-side subscribe/unsubscribe helpers, calling the two API routes above.
- **Modify `src/components/icons.tsx`** — add `BellIcon`, used by the toggle UI.
- **Modify `src/app/rollup/page.tsx`** — add the "remind me" toggle.

---

### Task 1: Subscription storage and subscribe/unsubscribe routes

**Files:**
- Create: `src/lib/push-store.ts`
- Create: `src/app/api/push/subscribe/route.ts`
- Create: `src/app/api/push/unsubscribe/route.ts`

**Interfaces:**
- Consumes: `getStore`, `withTimeout`, `type Sql` from `src/lib/kv.ts` (existing exports).
- Produces: `export interface PushSubscriptionRow { endpoint: string; p256dh: string; auth: string }`
- Produces: `export async function addSubscription(sub: PushSubscriptionRow): Promise<void>`
- Produces: `export async function removeSubscription(endpoint: string): Promise<void>`
- Produces: `export async function listSubscriptions(): Promise<PushSubscriptionRow[]>`

- [ ] **Step 1: Write the schema and data-layer functions**

```typescript
// src/lib/push-store.ts

/**
 * Server-side storage for Web Push subscriptions — one row per
 * browser/device that has opted in to the missed-rollup nudge.
 *
 * Same lazy-schema, degrade-gracefully posture as trace_store (kv.ts) and
 * trace_usage (usage.ts): every function no-ops when the store isn't
 * configured rather than throwing, and the schema is created on first use
 * with no separate migration step.
 */

import { getStore, withTimeout, type Sql } from "./kv";

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

let schemaReady: Promise<void> | null = null;

async function ensurePushSchema(sql: Sql): Promise<void> {
  await withTimeout(
    sql`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint    TEXT PRIMARY KEY,
        p256dh      TEXT NOT NULL,
        auth        TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `
  );
}

async function ensurePushSchemaOnce(sql: Sql): Promise<void> {
  if (!schemaReady) {
    schemaReady = ensurePushSchema(sql);
  }
  try {
    await schemaReady;
  } catch (e) {
    schemaReady = null; // allow retry on the next call if this attempt failed
    throw e;
  }
}

/** No-ops if the store isn't configured. */
export async function addSubscription(sub: PushSubscriptionRow): Promise<void> {
  const sql = getStore();
  if (!sql) return;
  await ensurePushSchemaOnce(sql);
  await withTimeout(sql`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth)
    VALUES (${sub.endpoint}, ${sub.p256dh}, ${sub.auth})
    ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
  `);
}

/** No-ops (including "no such row") if the store isn't configured or the row is already gone. */
export async function removeSubscription(endpoint: string): Promise<void> {
  const sql = getStore();
  if (!sql) return;
  await ensurePushSchemaOnce(sql);
  await withTimeout(sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`);
}

/** Returns an empty array if the store isn't configured. */
export async function listSubscriptions(): Promise<PushSubscriptionRow[]> {
  const sql = getStore();
  if (!sql) return [];
  await ensurePushSchemaOnce(sql);
  const rows = (await withTimeout(
    sql`SELECT endpoint, p256dh, auth FROM push_subscriptions`
  )) as PushSubscriptionRow[];
  return rows;
}
```

- [ ] **Step 2: Create the subscribe route**

```typescript
// src/app/api/push/subscribe/route.ts
import { NextRequest, NextResponse } from "next/server";
import { addSubscription } from "@/lib/push-store";
import { isStoreConfigured } from "@/lib/kv";

// POST /api/push/subscribe → store a browser's push subscription.
export async function POST(req: NextRequest) {
  if (!isStoreConfigured()) {
    return NextResponse.json({ configured: false });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "The request could not be read." }, { status: 400 });
  }

  const b = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (
    typeof b.endpoint !== "string" ||
    !b.endpoint ||
    !b.keys ||
    typeof b.keys.p256dh !== "string" ||
    !b.keys.p256dh ||
    typeof b.keys.auth !== "string" ||
    !b.keys.auth
  ) {
    return NextResponse.json(
      { error: "Expected { endpoint, keys: { p256dh, auth } }." },
      { status: 400 }
    );
  }

  try {
    await addSubscription({ endpoint: b.endpoint, p256dh: b.keys.p256dh, auth: b.keys.auth });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("push subscribe failed:", err);
    return NextResponse.json({ error: "Could not save subscription." }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create the unsubscribe route**

```typescript
// src/app/api/push/unsubscribe/route.ts
import { NextRequest, NextResponse } from "next/server";
import { removeSubscription } from "@/lib/push-store";

// POST /api/push/unsubscribe → drop a stored subscription. Always ok:true
// (idempotent) even if no row matched, so the client doesn't need to
// distinguish "already unsubscribed" from "just unsubscribed".
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "The request could not be read." }, { status: 400 });
  }

  const b = body as { endpoint?: unknown };
  if (typeof b.endpoint !== "string" || !b.endpoint) {
    return NextResponse.json({ error: "Expected { endpoint }." }, { status: 400 });
  }

  try {
    await removeSubscription(b.endpoint);
  } catch (err) {
    console.error("push unsubscribe failed:", err);
    // Still report ok:true — client-side unsubscribe already happened;
    // a stuck server-side row just means one stale future push attempt,
    // which self-heals on its next 404/410.
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the linter**

Run: `npm run lint`
Expected: no errors/warnings from the new files.

- [ ] **Step 6: Manual runtime check**

Run: `npm run dev`, then in another terminal:
```bash
curl -s -X POST http://localhost:3000/api/push/subscribe \
  -H "Content-Type: application/json" \
  -d '{"endpoint":"https://example.com/ep1","keys":{"p256dh":"testkey","auth":"testauth"}}'
```
Expected: if `DATABASE_URL` is configured, `{"ok":true}`; if not, `{"configured":false}` — either way, no 500. Then:
```bash
curl -s -X POST http://localhost:3000/api/push/unsubscribe \
  -H "Content-Type: application/json" -d '{"endpoint":"https://example.com/ep1"}'
```
Expected: `{"ok":true}`. If `DATABASE_URL` is configured, optionally confirm the row was actually inserted then removed via a direct query (same pattern as the usage-visibility plan's Task 2 smoke test) — this step is optional if no local `DATABASE_URL` is set; note that in your report instead of failing.

- [ ] **Step 7: Commit**

```bash
git add src/lib/push-store.ts src/app/api/push/subscribe/route.ts src/app/api/push/unsubscribe/route.ts
git commit -m "feat(push): add subscription storage and subscribe/unsubscribe routes"
```

---

### Task 2: VAPID keys, `web-push` dependency, and the cron send route

**Files:**
- Modify: `package.json` (add `web-push`, `@types/web-push`)
- Create: `src/app/api/push/check-rollup/route.ts`
- Create: `vercel.json`

**Interfaces:**
- Consumes: `listSubscriptions`, `removeSubscription`, `type PushSubscriptionRow` from `src/lib/push-store.ts` (Task 1)
- Consumes: `getStore`, `getNamespaceData`, `withTimeout` from `src/lib/kv.ts` (existing exports)
- Consumes: the `web-push` npm package's default export (`webpush.setVapidDetails`, `webpush.sendNotification`)

- [ ] **Step 1: Install the dependency**

Run:
```bash
npm install web-push
npm install -D @types/web-push
```
Expected: `package.json` gains `"web-push": "^<version>"` under `dependencies` and `"@types/web-push": "^<version>"` under `devDependencies`.

- [ ] **Step 2: Generate a VAPID key pair**

Run: `npx web-push generate-vapid-keys`
Expected output (values will differ):
```
=======================================

Public Key:
BN4...(a long base64url string)...

Private Key:
kR7...(a shorter base64url string)...

=======================================
```
**Do not commit these values anywhere in the repo.** Record the printed Public Key and Private Key in your task report so the controller can hand them to the user for setting as Vercel environment variables (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and the public key again as `NEXT_PUBLIC_VAPID_PUBLIC_KEY`) — this plan does not set them remotely.

- [ ] **Step 3: Write the cron send route**

```typescript
// src/app/api/push/check-rollup/route.ts
import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { getStore, getNamespaceData } from "@/lib/kv";
import { listSubscriptions, removeSubscription } from "@/lib/push-store";

/**
 * Cron target (see vercel.json — runs daily at 21:00 UTC, approximating
 * 9:00 PM Europe/London; drifts ~1hr during British Summer Time, an
 * approved approximation per the spec).
 *
 * Auth: Vercel automatically sends `Authorization: Bearer $CRON_SECRET` on
 * requests it makes to a configured cron path. Anything else is rejected —
 * this route sends a push to every stored subscription and must not be
 * publicly triggerable.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getStore();
  if (!sql) {
    return NextResponse.json({ sent: false, reason: "not configured" });
  }

  // "Today" in Europe/London, as YYYY-MM-DD — matches the day-key format
  // StoredRollup is keyed by in the omi-adhd-rollups namespace.
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  let rollups: Record<string, unknown>;
  try {
    const data = await getNamespaceData(sql, "omi-adhd-rollups");
    rollups = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  } catch (err) {
    console.error("check-rollup: failed to read rollups namespace:", err);
    return NextResponse.json({ sent: false, reason: "read failed" }, { status: 500 });
  }

  if (todayKey in rollups) {
    return NextResponse.json({ sent: false, reason: "already run" });
  }

  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;
  if (!vapidPublic || !vapidPrivate || !vapidSubject) {
    console.error("check-rollup: VAPID env vars not configured");
    return NextResponse.json({ sent: false, reason: "vapid not configured" }, { status: 500 });
  }
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const subscriptions = await listSubscriptions();
  const payload = JSON.stringify({
    title: "TRACE",
    body: "You haven't run today's rollup yet.",
    url: "/rollup",
  });

  let deliveredCount = 0;
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      deliveredCount++;
    } catch (err) {
      const statusCode = (err as { statusCode?: number } | null)?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await removeSubscription(sub.endpoint).catch((e) =>
          console.error(`check-rollup: failed to remove dead subscription ${sub.endpoint}:`, e)
        );
      } else {
        console.error(`check-rollup: send failed for ${sub.endpoint}:`, err);
      }
    }
  }

  return NextResponse.json({
    sent: true,
    subscriptionCount: subscriptions.length,
    deliveredCount,
  });
}
```

- [ ] **Step 4: Create the cron config**

```json
{
  "crons": [
    { "path": "/api/push/check-rollup", "schedule": "0 21 * * *" }
  ]
}
```
Write this to `vercel.json` at the project root (`/Users/ulyssescabayao/omi-thesis-analyzer/vercel.json` — confirm no `vercel.json` already exists first; if one does, this is a plan-conflict, stop and report it rather than overwriting).

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors. If `@types/web-push` doesn't fully resolve `webpush.sendNotification`'s error shape, the `(err as { statusCode?: number } | null)` cast in Step 3 already handles that — no additional typing needed.

- [ ] **Step 6: Run the linter**

Run: `npm run lint`
Expected: no errors/warnings from the new file.

- [ ] **Step 7: Manual runtime check**

Run: `npm run dev`, then in another terminal:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/push/check-rollup
```
Expected: `401` (no `Authorization` header, and/or `CRON_SECRET` unset locally — either way, must not be 200 without the header). Then, if you want to test the authorized path locally, you'd need `CRON_SECRET` set in `.env.local` — if it's not set in this environment, that's expected and fine; note in your report that only the unauthorized-rejection path was verified locally, not the full authorized send path (which also needs real VAPID keys and a real subscription to fully exercise).

- [ ] **Step 8: Full build**

Run: `npm run build`
Expected: build succeeds, `/api/push/check-rollup`, `/api/push/subscribe`, `/api/push/unsubscribe` all listed as routes.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/app/api/push/check-rollup/route.ts vercel.json
git commit -m "feat(push): add cron-triggered missed-rollup send route"
```

---

### Task 3: Client subscribe UI on the Rollup page

**Files:**
- Modify: `src/components/icons.tsx` (add `BellIcon`)
- Create: `src/lib/push.ts`
- Modify: `src/app/rollup/page.tsx`

**Interfaces:**
- Consumes: `fetchJson` from `src/lib/fetch-json.ts`
- Produces: `export function isPushSupported(): boolean`
- Produces: `export async function getPushSubscriptionState(): Promise<boolean>` (true if currently subscribed)
- Produces: `export async function subscribeToPush(): Promise<void>` (throws with a readable message on failure — permission denied, unsupported, or the API call failing)
- Produces: `export async function unsubscribeFromPush(): Promise<void>`

- [ ] **Step 1: Add the bell icon**

In `src/components/icons.tsx`, add (following the file's existing stroke-icon pattern — see `TrendingUpIcon` for the exact shape of a two-path icon):

```typescript
export function BellIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
```

- [ ] **Step 2: Write the client push module**

```typescript
// src/lib/push.ts
"use client";

import { fetchJson } from "./fetch-json";

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// PushManager.subscribe needs the VAPID public key as a Uint8Array, but
// browsers hand it out (and expect it back) base64url-encoded.
function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export async function getPushSubscriptionState(): Promise<boolean> {
  if (!isPushSupported()) return false;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return subscription !== null;
}

export async function subscribeToPush(): Promise<void> {
  if (!isPushSupported()) {
    throw new Error("Push notifications aren't supported in this browser.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted.");
  }

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) {
    throw new Error("Push notifications aren't configured yet.");
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  });

  const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("The browser returned an incomplete push subscription.");
  }

  await fetchJson("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }),
  });
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushSupported()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await fetchJson("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
}
```

- [ ] **Step 3: Add the toggle to the Rollup page**

Read `src/app/rollup/page.tsx` first (its current imports and the `<header>` block shown below are from before Tasks 1-2 touched other files, so confirm exact current line numbers before editing).

Add to the imports:
```typescript
import { BellIcon } from "@/components/icons"; // add BellIcon to the existing icons import list, don't duplicate the import line
import { isPushSupported, getPushSubscriptionState, subscribeToPush, unsubscribeFromPush } from "@/lib/push";
```

Add state and an effect near the top of the `RollupPage` (or equivalent) component function, alongside the component's other `useState`/`useEffect` calls:

```typescript
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  useEffect(() => {
    setPushSupported(isPushSupported());
    getPushSubscriptionState().then(setPushEnabled).catch(() => setPushEnabled(false));
  }, []);

  const togglePush = async () => {
    setPushBusy(true);
    setPushError(null);
    try {
      if (pushEnabled) {
        await unsubscribeFromPush();
        setPushEnabled(false);
      } else {
        await subscribeToPush();
        setPushEnabled(true);
      }
    } catch (e) {
      setPushError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPushBusy(false);
    }
  };
```

Add the toggle UI inside the existing `<header className="mb-6">` block, after the closing `</p>` of the description paragraph:

```tsx
        {pushSupported ? (
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={togglePush}
              disabled={pushBusy}
              className="flex items-center gap-1.5 text-sm min-h-[44px] px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-pressed={pushEnabled}
            >
              <BellIcon className="w-4 h-4 flex-shrink-0" />
              {pushEnabled ? "Reminders on" : "Remind me if I forget today's rollup"}
            </button>
            {pushError && <span className="text-xs text-red-400">{pushError}</span>}
          </div>
        ) : (
          <p className="text-xs text-slate-500 mt-3">
            Push reminders aren&apos;t supported in this browser.
          </p>
        )}
```

- [ ] **Step 4: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Full build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Manual browser check**

Run: `npm run dev` (or `npm run build && npm run start` for a closer-to-production check, since service workers behave more predictably against a production build), open `http://localhost:3000/rollup`, confirm the "Remind me if I forget today's rollup" toggle renders (or the "not supported" note, if the environment lacks Notification/PushManager support). Clicking it without `NEXT_PUBLIC_VAPID_PUBLIC_KEY` configured locally is expected to show the "Push notifications aren't configured yet." error text via `pushError` — confirm that happens gracefully (no crash, no unhandled rejection in the console) rather than confirming a real subscription succeeds, since no local VAPID key exists yet.

- [ ] **Step 7: Commit**

```bash
git add src/components/icons.tsx src/lib/push.ts src/app/rollup/page.tsx
git commit -m "feat(push): add reminder toggle to the Rollup page"
```

---

## Spec Coverage Check

- `push_subscriptions` table, lazy schema, memoized → Task 1
- Subscribe/unsubscribe routes, degrade to `configured:false` → Task 1
- VAPID key generation, `web-push` dependency → Task 2
- Cron auth via `CRON_SECRET` bearer check → Task 2
- "Today" computed in Europe/London, checked against `omi-adhd-rollups` → Task 2
- Send via `web-push`, dead-subscription cleanup on 404/410 → Task 2
- `vercel.json` cron schedule (`0 21 * * *`) → Task 2
- Client subscribe/unsubscribe helpers, VAPID key decode → Task 3
- Toggle UI on `/rollup`, unsupported-browser fallback → Task 3
- Service worker changes: none needed — the existing `push` handler in `src/app/sw.js/route.ts` already parses `{ title, body, url }`, confirmed during spec research
- Out of scope (aging-commitments nudge, quiet hours, settings page): not built anywhere in this plan — correct per spec
- Env vars (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `CRON_SECRET`) set in Vercel outside this codebase: Task 2 generates and reports the VAPID pair; the controller is responsible for relaying all five values to the user for them to set in Vercel — no plan task can do this itself
