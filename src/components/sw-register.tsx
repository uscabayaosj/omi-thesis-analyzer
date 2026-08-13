"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshIcon, XIcon } from "@/components/icons";

// How often to poll for a new deployment while the app sits open. An hour is
// well under the time between this app's deploys and costs one cheap
// conditional request; the load/visible/online triggers below catch the rest.
const UPDATE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Registers the service worker and surfaces updates as an explicit choice.
 *
 * The app never reloads on its own. A new worker installs, then waits; the
 * user decides when to take it. That matters here because the two things this
 * app holds unsaved — a half-written custom-analysis prompt and unpushed
 * commitment toggles — live in component state, and a surprise reload would
 * take them with it.
 */
export default function ServiceWorkerRegistration() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  // Guards against a reload loop: controllerchange can fire more than once.
  const reloading = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    let cancelled = false;

    // A worker sitting in `waiting` is only an *update* if this page is
    // already controlled. On a first-ever install there is no controller, and
    // treating that as an update would prompt people to reload an app they
    // just opened.
    const offerIfUpdate = (sw: ServiceWorker | null) => {
      if (cancelled || !sw || !navigator.serviceWorker.controller) return;
      setWaiting(sw);
      // Re-surface after a "Later": the user asked to be reminded on the next
      // check, not silenced until they happen to reload.
      setDismissed(false);
    };

    navigator.serviceWorker
      // updateViaCache "none": update checks must always hit the network for
      // the script — the whole update flow rests on byte-comparing the
      // deployed worker, and an HTTP-cached copy would hide new deployments.
      .register("/sw.js", { updateViaCache: "none" })
      .then((reg) => {
        if (cancelled) return;
        registration.current = reg;
        offerIfUpdate(reg.waiting);

        // A worker that starts installing while the page is open: watch it
        // through to `installed`, which is when it becomes takeable.
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed") offerIfUpdate(reg.waiting);
          });
        });
      })
      .catch((err) => {
        // A failed registration costs offline support and update prompts, not
        // the app — never surface it to the user.
        console.warn("Service worker registration failed:", err);
      });

    const checkForUpdate = () => {
      // Skip while offline: update() would just fail, and the online listener
      // below already re-checks the moment connectivity returns.
      if (!navigator.onLine) return;
      registration.current
        ?.update()
        .then(() => {
          // "Later" hides the prompt until the next check — so each check
          // re-offers a worker that is still waiting, not only a new one.
          offerIfUpdate(registration.current?.waiting ?? null);
        })
        .catch(() => {});
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") checkForUpdate();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", checkForUpdate);
    const interval = setInterval(checkForUpdate, UPDATE_INTERVAL_MS);

    // The new worker taking control is the signal that the swap is done and
    // it is safe to reload — not the click itself.
    const onControllerChange = () => {
      if (reloading.current) return;
      reloading.current = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", checkForUpdate);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      clearInterval(interval);
    };
  }, []);

  const reloadNow = useCallback(() => {
    if (!waiting) return;
    // Hand over and wait for `controllerchange`; reloading immediately would
    // race the swap and could reload straight back into the old version.
    waiting.postMessage({ type: "SKIP_WAITING" });
  }, [waiting]);

  if (!waiting || dismissed) return null;

  return (
    <div
      // polite, not assertive: an available update is worth mentioning, never
      // worth interrupting a screen reader mid-sentence.
      role="status"
      aria-live="polite"
      className="enter-rise fixed inset-x-0 bottom-0 z-50 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pointer-events-none"
    >
      <div className="card pointer-events-auto mx-auto max-w-3xl border-cyan-500/40 p-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">A new version of TRACE is ready.</p>
          <p className="mt-0.5 text-sm text-slate-400">
            Reloading may discard anything you have typed but not yet run.
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            onClick={() => setDismissed(true)}
            className="min-h-[44px] rounded-lg px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-700 hover:text-white inline-flex items-center gap-1.5"
          >
            <XIcon className="w-3.5 h-3.5" />
            Later
          </button>
          <button
            onClick={reloadNow}
            className="min-h-[44px] rounded-lg border border-cyan-500/50 bg-cyan-950/40 px-4 py-2 text-sm font-medium text-cyan-200 transition-colors hover:border-cyan-500/70 hover:bg-cyan-950/60 hover:text-cyan-100 active:border-cyan-400 active:bg-cyan-400 active:text-slate-950 inline-flex items-center gap-1.5 whitespace-nowrap" // impeccable-disable-line gray-on-color
          >
            <RefreshIcon className="w-3.5 h-3.5" />
            Reload now
          </button>
        </div>
      </div>
    </div>
  );
}
