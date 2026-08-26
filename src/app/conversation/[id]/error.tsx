"use client";

import { useEffect } from "react";
import Link from "next/link";
import { MessageIcon, ArrowLeftIcon } from "@/components/icons";
import { BUTTON_PRIMARY, BUTTON_SECONDARY_CARD } from "@/lib/ui";

export default function ConversationError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Conversation error:", error);
  }, [error]);

  return (
    <main className="max-w-3xl mx-auto px-4 py-16 text-center">
      <div className="card p-8 border-red-500/30">
        <MessageIcon className="w-10 h-10 mx-auto mb-4 text-red-400" />
        <h1 className="font-bold text-white mb-2">Failed to load conversation</h1>
        <p className="text-slate-400 mb-6 text-sm">
          {error.message || "The conversation could not be loaded. It may have been deleted or the API is unavailable."}
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
            All conversations
          </Link>
        </div>
      </div>
    </main>
  );
}
