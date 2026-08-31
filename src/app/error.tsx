"use client";

import { useEffect } from "react";
import Link from "next/link";
import { WarningIcon, ArrowLeftIcon } from "@/components/icons";
import { BUTTON_PRIMARY, BUTTON_SECONDARY_CARD } from "@/lib/ui";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Route error:", error);
  }, [error]);

  return (
    <main id="main" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-16 text-center">
      <div className="card p-8 border-red-500/30">
        <WarningIcon className="w-10 h-10 mx-auto mb-4 text-red-400" />
        <h1 className="font-bold text-white mb-2">Something went wrong</h1>
        {/* The raw error.message is a developer string — it leaked stack-ish
            detail into a page the user is meant to recover from. The message
            still reaches the console via the effect above; the screen gets a
            sentence that names a next step instead. */}
        <p className="text-slate-400 mb-6 text-sm">
          This page couldn&apos;t load. Your saved analyses are stored on this device and are unaffected.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className={`${BUTTON_PRIMARY} py-2 px-5`}
          >
            Try again
          </button>
          <Link
            href="/"
            className={BUTTON_SECONDARY_CARD}
          >
            <ArrowLeftIcon className="w-4 h-4" />
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
