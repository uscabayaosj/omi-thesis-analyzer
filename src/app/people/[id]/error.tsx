"use client";

import { useEffect } from "react";
import Link from "next/link";
import { UsersIcon, ArrowLeftIcon } from "@/components/icons";
import { BUTTON_PRIMARY, BUTTON_SECONDARY_CARD } from "@/lib/ui";

export default function PersonError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Person detail page error:", error);
  }, [error]);

  return (
    <main className="max-w-3xl mx-auto px-4 py-16 text-center">
      <div className="card p-8 border-red-500/30">
        <UsersIcon className="w-10 h-10 mx-auto mb-4 text-red-400" />
        <h1 className="font-bold text-white mb-2">This person&rsquo;s page failed to load</h1>
        <p className="text-slate-400 mb-6 text-sm">
          {error.message || "Something went wrong loading this person. Try again."}
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className={`${BUTTON_PRIMARY} py-2 px-5`}
          >
            Try again
          </button>
          <Link
            href="/people"
            className={BUTTON_SECONDARY_CARD}
          >
            <ArrowLeftIcon className="w-4 h-4" />
            All people
          </Link>
        </div>
      </div>
    </main>
  );
}
