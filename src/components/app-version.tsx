"use client";

import { useCallback, useState } from "react";
import { RefreshIcon } from "@/components/icons";

// Inlined at build time, so this is the deployment the running bundle actually
// came from — not what the server would say if asked. That difference is the
// point: if the footer sha doesn't match the latest deploy, this device is on
// stale code, and Reload is the way out.
const VERSION = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";

/**
 * Quiet footer: which build this device is running, plus a manual reload.
 *
 * Exists because the update prompt only appears when the service worker file
 * itself changes — an app-only deploy installs no new worker, so nothing
 * prompts, and an iOS PWA resumed from memory can sit on old code
 * indefinitely. This gives the user a way to see that and fix it themselves.
 */
export default function AppVersion() {
  const [reloading, setReloading] = useState(false);

  const reload = useCallback(async () => {
    setReloading(true);
    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        // Take a waiting worker along if one exists; its controllerchange
        // handler (sw-register) performs the reload in that case.
        if (reg?.waiting) {
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
          return;
        }
        await reg?.update().catch(() => {});
      }
    } finally {
      // Navigations are network-first in the service worker, so a plain
      // reload fetches the freshest deployed shell regardless of SW version.
      window.location.reload();
    }
  }, []);

  return (
    <footer className="max-w-3xl mx-auto px-4 pb-6 flex items-center justify-center gap-1 text-xs text-slate-400">
      <span aria-label={`Running version ${VERSION}`}>TRACE {VERSION}</span>
      <span aria-hidden="true">·</span>
      <button
        onClick={reload}
        disabled={reloading}
        aria-label="Reload the app to pick up the latest version"
        className="min-h-[44px] px-2 inline-flex items-center gap-1 text-slate-400 hover:text-slate-300 disabled:opacity-50 transition-colors"
      >
        <RefreshIcon className={`w-3 h-3 ${reloading ? "animate-spin" : ""}`} />
        {reloading ? "Reloading…" : "Reload"}
      </button>
    </footer>
  );
}
