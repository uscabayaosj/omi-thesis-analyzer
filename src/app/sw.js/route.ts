import { NextResponse } from "next/server";

// The service worker, served from a route instead of /public so every
// deployment changes its bytes. The browser only installs a new worker (and
// the app only shows its update prompt) when this file's content changes —
// as a static file it only changed when someone edited it, so app-only
// deploys shipped silently with no prompt ever appearing. Stamping the cache
// name with the deploy's commit sha makes each deployment a detectable update
// and scopes the cache to it.
const VERSION = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "dev";

const SW_SOURCE = `const CACHE_NAME = "trace-__VERSION__";
const STATIC_ASSETS = ["/", "/manifest.json", "/icon.svg", "/icon-192.png", "/icon-512.png"];

// Install — cache static shell.
//
// Deliberately does NOT call skipWaiting(): a new worker stays in \`waiting\`
// until the user asks for it. Activating on install would swap the app's code
// out from under someone mid-task — the reason updates here are opt-in.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

// The page asks for activation when the user clicks "Reload now". This is the
// only path that promotes a waiting worker.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

// Push — stub for a future Web Push backend. No subscription is created or
// sent to a server yet, so this never fires today; it exists so that wiring
// up real push later only means adding a subscribe endpoint, not touching the
// worker. Payload shape (once there is a sender): { count?: number, title?,
// body?, url? }.
self.addEventListener("push", (event) => {
  const data = (() => {
    try {
      return event.data ? event.data.json() : {};
    } catch {
      return {};
    }
  })();

  if (typeof data.count === "number" && "setAppBadge" in self.navigator) {
    event.waitUntil(self.navigator.setAppBadge(data.count).catch(() => {}));
  }

  if (data.title) {
    event.waitUntil(
      self.registration.showNotification(data.title, {
        body: data.body,
        icon: "/icon-192.png",
        data: { url: data.url || "/" },
      })
    );
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  event.waitUntil(self.clients.openWindow(url || "/"));
});

// Activate — clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch — network-first for API, cache-first for static
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET
  if (request.method !== "GET") return;

  // API calls — network first, no cache (these need fresh data)
  if (url.pathname.startsWith("/api/") || url.hostname !== location.hostname) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: "Offline — check your connection" }), {
          headers: { "Content-Type": "application/json" },
          status: 503,
        })
      )
    );
    return;
  }

  // Page navigations — network first so the app shell never goes stale,
  // falling back to the cached shell only when offline
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then(
            (cached) =>
              cached ||
              caches.match("/").then(
                (shell) =>
                  shell ||
                  new Response("You are offline and this page is not cached.", {
                    status: 503,
                    headers: { "Content-Type": "text/plain" },
                  })
              )
          )
        )
    );
    return;
  }

  // Static assets — cache first
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached || Response.error());
      return cached || fetched;
    })
  );
});
`;

export async function GET() {
  return new NextResponse(SW_SOURCE.replace("__VERSION__", VERSION), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // Browsers cap SW script caching at 24h; no-cache tightens that so an
      // update check always sees the current deployment.
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
