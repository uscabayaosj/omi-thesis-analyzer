"use client";

import { type PendingSuggestion, type Person } from "@/lib/people";
import { BUTTON_PRIMARY, optionLabel } from "@/lib/ui";
import { getAnalysisAge } from "@/lib/storage";

export default function VoicePendingCard({
  suggestion: s,
  people,
  showError,
  errorMessage,
  newName,
  onNewNameChange,
  onAcceptExisting,
  onAcceptNew,
  onIgnore,
}: {
  suggestion: PendingSuggestion;
  people: Person[];
  showError: boolean;
  errorMessage?: string | null;
  newName: string;
  onNewNameChange: (v: string) => void;
  onAcceptExisting: (personId: string) => void;
  onAcceptNew: (name: string) => void;
  onIgnore: () => void;
}) {
  return (
    <div className="card p-4">
      <div className="mb-2">
        <div className="text-white font-medium">Unrecognized voice</div>
        <div className="text-slate-400 text-xs">{getAnalysisAge(s.date).label}</div>
      </div>

      {showError && (
        <p className="text-red-400 text-xs mb-2 break-words" role="alert">
          {errorMessage || "Couldn’t save — try again."}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-2 min-w-0">
        <select
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) onAcceptExisting(e.target.value);
          }}
          aria-label="Select person"
          className="flex-1 min-w-0 max-w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 min-h-[44px] text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
        >
          <option value="" disabled>
            Who is this?
          </option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {optionLabel(p.name)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-2 items-center min-w-0">
        <input
          value={newName}
          onChange={(e) => onNewNameChange(e.target.value)}
          placeholder="Or add a new person…"
          className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 min-h-[44px] text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
        />
        <button
          onClick={() => onAcceptNew(newName)}
          disabled={!newName.trim()}
          className={`${BUTTON_PRIMARY} px-3 disabled:opacity-50`}
        >
          Add
        </button>
        <button
          onClick={onIgnore}
          className="text-sm min-h-[44px] px-3 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          Ignore
        </button>
      </div>
    </div>
  );
}
