"use client";

import { useEffect } from "react";
import Link from "next/link";
import { CompassIcon, ArrowLeftIcon } from "@/components/icons";
import { BUTTON_PRIMARY } from "@/lib/ui";

export default function GroupAnalysisError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Group analysis error:", error);
  }, [error]);

  return (
    <main className="max-w-3xl mx-auto px-4 py-16 text-center">
      <div className="card p-8 border-red-500/30">
        <CompassIcon className="w-10 h-10 mx-auto mb-4 text-red-400" />
        <h1 className="text-xl font-bold text-white mb-2">Group analysis failed</h1>
        <p className="text-slate-400 mb-6 text-sm">
          {error.message || "The group analysis could not be loaded. Try selecting conversations again."}
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
            className="bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium py-2 px-5 min-h-[44px] rounded-lg text-sm transition-colors inline-flex items-center gap-1.5"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            All conversations
          </Link>
        </div>
      </div>
    </main>
  );
}
