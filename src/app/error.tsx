"use client";

import { useEffect } from "react";

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
    <main className="max-w-3xl mx-auto px-4 py-16 text-center">
      <div className="card p-8 border-red-500/30">
        <p className="text-4xl mb-4">⚠️</p>
        <h1 className="text-xl font-bold text-white mb-2">Something went wrong</h1>
        <p className="text-slate-400 mb-6 text-sm">
          {error.message || "An unexpected error occurred while loading this page."}
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2 px-5 min-h-[44px] rounded-lg text-sm transition-colors"
          >
            Try again
          </button>
          <a
            href="/"
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium py-2 px-5 min-h-[44px] rounded-lg text-sm transition-colors inline-flex items-center"
          >
            ← Back to home
          </a>
        </div>
      </div>
    </main>
  );
}
