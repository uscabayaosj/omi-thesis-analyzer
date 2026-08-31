import Link from "next/link";
import { CompassIcon, ArrowLeftIcon } from "@/components/icons";
import { BUTTON_PRIMARY } from "@/lib/ui";

export default function NotFound() {
  return (
    <main id="main" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-16 text-center">
      <div className="card p-8">
        <CompassIcon className="w-10 h-10 mx-auto mb-4 text-slate-400" />
        <h1 className="font-bold text-white mb-2">Page not found</h1>
        <p className="text-slate-400 mb-6 text-sm">
          The page you&apos;re looking for doesn&apos;t exist or the conversation may have been removed.
        </p>
        <Link
          href="/"
          className={`${BUTTON_PRIMARY} py-2 px-5 inline-flex items-center gap-1.5`}
        >
          <ArrowLeftIcon className="w-4 h-4" />
          Back to conversations
        </Link>
      </div>
    </main>
  );
}
