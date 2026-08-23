"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  deletePerson,
  getPeople,
  getPerson,
  mergePeople,
  updatePerson,
  type Person,
  type PersonFact,
} from "@/lib/people";
import { getAnalysisAge } from "@/lib/storage";
import { pullAndMerge } from "@/lib/sync";
import MeetingMap, { type MapMarker } from "@/components/MeetingMap";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  ArrowLeftIcon,
  CheckIcon,
  UsersIcon,
  WarningIcon,
  XIcon,
} from "@/components/icons";
import { BUTTON_PRIMARY } from "@/lib/ui";

// icons.tsx has no camera icon; a small local glyph avoids adding a dependency
// on an icon that doesn't exist there.
function CameraIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8h3l2-2h6l2 2h3v11H4z" />
      <circle cx="12" cy="13.5" r="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatDate(d: string): string {
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return d;
  return t.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function PersonDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [person, setPerson] = useState<Person | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mergeError, setMergeError] = useState<string | null>(null);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const [editingRole, setEditingRole] = useState(false);
  const [roleDraft, setRoleDraft] = useState("");

  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");

  const [aliasDraft, setAliasDraft] = useState("");

  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const refresh = () => {
    const p = getPerson(id);
    setPerson(p);
    setPeople(getPeople());
    if (!p) setNotFound(true);
  };

  useEffect(() => {
    let cancelled = false;
    pullAndMerge().then(() => {
      if (cancelled) return;
      const p = getPerson(id);
      setPerson(p);
      setPeople(getPeople());
      if (!p) setNotFound(true);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const meetingsWithCoords: MapMarker[] = useMemo(() => {
    if (!person) return [];
    return person.meetings
      .filter((m): m is typeof m & { lat: number; lng: number } => m.lat != null && m.lng != null)
      .map((m) => ({
        lat: m.lat,
        lng: m.lng,
        label: m.placeName ?? formatDate(m.date),
        sublabel: formatDate(m.date),
        href: `/conversation/${m.conversationId}`,
      }));
  }, [person]);

  const sortedMeetings = useMemo(() => {
    if (!person) return [];
    return [...person.meetings].sort((a, b) => b.date.localeCompare(a.date));
  }, [person]);

  const otherPeople = useMemo(() => people.filter((p) => p.id !== id), [people, id]);

  // ── photo pipeline (per brief) ──

  async function onPhotoSelected(file: File) {
    if (!file.type.startsWith("image/")) {
      setPhotoError("That file isn't an image.");
      return;
    }
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("unreadable"));
        img.src = url;
      });
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 256 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
      updatePerson(id, { photo: dataUrl });
      setPhotoError(null);
      refresh();
    } catch {
      setPhotoError("Couldn't read that photo — try a different one.");
    }
  }

  const removePhoto = () => {
    updatePerson(id, { photo: undefined });
    refresh();
  };

  // ── inline edit handlers ──

  const startEditName = () => {
    if (!person) return;
    setNameDraft(person.name);
    setEditingName(true);
  };
  const saveName = () => {
    const name = nameDraft.trim();
    if (name) updatePerson(id, { name });
    setEditingName(false);
    refresh();
  };

  const startEditRole = () => {
    setRoleDraft(person?.role ?? "");
    setEditingRole(true);
  };
  const saveRole = () => {
    updatePerson(id, { role: roleDraft.trim() || undefined });
    setEditingRole(false);
    refresh();
  };

  const startEditNotes = () => {
    setNotesDraft(person?.notes ?? "");
    setEditingNotes(true);
  };
  const saveNotes = () => {
    updatePerson(id, { notes: notesDraft.trim() });
    setEditingNotes(false);
    refresh();
  };

  const addAlias = () => {
    const alias = aliasDraft.trim();
    if (!person || !alias) return;
    if (person.aliases.some((a) => a.toLowerCase() === alias.toLowerCase())) {
      setAliasDraft("");
      return;
    }
    updatePerson(id, { aliases: [...person.aliases, alias] });
    setAliasDraft("");
    refresh();
  };

  const removeAlias = (alias: string) => {
    if (!person) return;
    updatePerson(id, { aliases: person.aliases.filter((a) => a !== alias) });
    refresh();
  };

  const removeFact = (fact: PersonFact) => {
    if (!person) return;
    updatePerson(id, {
      facts: person.facts.filter(
        (f) => !(f.text === fact.text && f.conversationId === fact.conversationId && f.date === fact.date)
      ),
    });
    refresh();
  };

  // ── danger zone ──

  const confirmMerge = () => {
    if (!mergeTargetId) return;
    const result = mergePeople(id, mergeTargetId);
    if (!result) {
      setMergeError("Merge failed. Please make sure both people still exist and try again.");
      return;
    }
    setMergeError(null);
    router.push(`/people/${mergeTargetId}`);
  };

  const confirmDelete = () => {
    deletePerson(id);
    router.push("/people");
  };

  // ── render ──

  if (loading) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="space-y-4" role="status" aria-label="Loading person">
          <div className="skeleton h-8 w-1/2" />
          <div className="skeleton h-24 w-24 rounded-full" />
          <div className="skeleton h-32 w-full" />
        </div>
      </main>
    );
  }

  if (notFound || !person) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-16 text-center">
        <div className="card p-8">
          <UsersIcon className="w-10 h-10 mx-auto mb-4 text-slate-500" />
          <h1 className="font-bold text-white mb-2">This person no longer exists</h1>
          <p className="text-slate-400 mb-6 text-sm">
            They may have been deleted or merged into someone else.
          </p>
          <Link
            href="/people"
            className="bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium py-2 px-5 min-h-[44px] rounded-lg text-sm transition-colors inline-flex items-center gap-1.5"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            All people
          </Link>
        </div>
      </main>
    );
  }

  const targetPerson = people.find((p) => p.id === mergeTargetId);

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <Link
        href="/people"
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors mb-4"
      >
        <ArrowLeftIcon className="w-4 h-4" />
        All people
      </Link>

      {/* Header */}
      <div className="card p-6 mb-6">
        <div className="flex items-start gap-4">
          <div className="relative flex-shrink-0 group">
            {person.photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={person.photo}
                alt=""
                className="w-20 h-20 rounded-full object-cover"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-slate-800 flex items-center justify-center text-slate-300 text-xl font-medium">
                {initials(person.name)}
              </div>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              aria-label="Change photo"
              className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center border-2 border-slate-900 transition-colors"
            >
              <CameraIcon className="w-3.5 h-3.5" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onPhotoSelected(file);
                e.target.value = "";
              }}
            />
          </div>

          <div className="flex-1 min-w-0">
            {editingName ? (
              <div className="flex items-center gap-2 mb-1">
                <input
                  autoFocus
                  type="text"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveName();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                  aria-label="Name"
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 min-h-[40px] text-lg font-bold text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
                />
                <button onClick={saveName} aria-label="Save name" className="p-2 min-h-[40px] min-w-[40px] rounded-lg text-cyan-400 hover:bg-slate-800">
                  <CheckIcon className="w-4 h-4" />
                </button>
                <button onClick={() => setEditingName(false)} aria-label="Cancel" className="p-2 min-h-[40px] min-w-[40px] rounded-lg text-slate-400 hover:bg-slate-800">
                  <XIcon className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={startEditName}
                className="text-2xl font-bold text-white hover:text-cyan-300 transition-colors text-left mb-1 truncate max-w-full"
              >
                {person.name}
              </button>
            )}

            {photoError && (
              <p className="text-red-400 text-xs mb-1" role="alert">
                {photoError}
              </p>
            )}
            {person.photo && !editingName && (
              <button
                onClick={removePhoto}
                className="text-xs text-slate-500 hover:text-red-400 transition-colors"
              >
                Remove photo
              </button>
            )}

            {/* Role */}
            <div className="mt-2">
              {editingRole ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={roleDraft}
                    onChange={(e) => setRoleDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveRole();
                      if (e.key === "Escape") setEditingRole(false);
                    }}
                    placeholder="Role or relationship"
                    aria-label="Role"
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 min-h-[36px] text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                  />
                  <button onClick={saveRole} aria-label="Save role" className="p-1.5 min-h-[36px] min-w-[36px] rounded-lg text-cyan-400 hover:bg-slate-800">
                    <CheckIcon className="w-4 h-4" />
                  </button>
                  <button onClick={() => setEditingRole(false)} aria-label="Cancel" className="p-1.5 min-h-[36px] min-w-[36px] rounded-lg text-slate-400 hover:bg-slate-800">
                    <XIcon className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={startEditRole}
                  className="text-sm text-slate-400 hover:text-white transition-colors"
                >
                  {person.role || "+ Add role"}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Aliases */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {person.aliases.map((a) => (
            <span
              key={a}
              className="inline-flex items-center gap-1 bg-slate-800 text-slate-300 text-xs px-2.5 py-1 rounded-full"
            >
              {a}
              <button
                onClick={() => removeAlias(a)}
                aria-label={`Remove alias ${a}`}
                className="hover:text-red-400 transition-colors"
              >
                <XIcon className="w-3 h-3" />
              </button>
            </span>
          ))}
          <input
            type="text"
            value={aliasDraft}
            onChange={(e) => setAliasDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addAlias();
            }}
            placeholder="+ Add alias"
            aria-label="Add alias"
            className="bg-transparent border border-dashed border-slate-700 rounded-full px-2.5 py-1 min-h-[28px] text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400 w-28"
          />
        </div>

        {/* Notes */}
        <div className="mt-4">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Notes</h2>
          {editingNotes ? (
            <div>
              <textarea
                autoFocus
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setEditingNotes(false);
                }}
                rows={3}
                aria-label="Notes"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400 resize-none"
              />
              <div className="flex gap-2 mt-2">
                <button onClick={saveNotes} className={`${BUTTON_PRIMARY} px-4 text-xs`}>
                  Save
                </button>
                <button
                  onClick={() => setEditingNotes(false)}
                  className="text-sm px-3 py-2 min-h-[36px] rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={startEditNotes}
              className="text-sm text-slate-300 hover:text-white transition-colors text-left whitespace-pre-wrap"
            >
              {person.notes || "+ Add notes"}
            </button>
          )}
        </div>
      </div>

      {/* Facts */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">
          Facts ({person.facts.length})
        </h2>
        {person.facts.length === 0 ? (
          <p className="text-slate-400 text-sm">Nothing learned about {person.name} yet.</p>
        ) : (
          <ul className="space-y-2">
            {person.facts.map((f, i) => (
              <li key={`${f.conversationId}-${i}`} className="card p-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-slate-200">{f.text}</p>
                  <Link
                    href={`/conversation/${f.conversationId}`}
                    className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                  >
                    {formatDate(f.date)} · view conversation →
                  </Link>
                </div>
                <button
                  onClick={() => removeFact(f)}
                  aria-label="Delete fact"
                  className="p-1.5 min-h-[32px] min-w-[32px] rounded-lg text-slate-500 hover:text-red-400 hover:bg-slate-800 transition-colors flex-shrink-0"
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Meetings */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">
          Meetings ({person.meetings.length})
        </h2>
        {sortedMeetings.length === 0 ? (
          <p className="text-slate-400 text-sm">No meetings recorded yet.</p>
        ) : (
          <>
            <ul className="space-y-1.5 mb-4">
              {sortedMeetings.map((m) => (
                <li key={m.conversationId} className="card p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-200 truncate">{m.placeName ?? "Unknown place"}</p>
                    <p className="text-xs text-slate-500">
                      {getAnalysisAge(m.date).label} · {formatDate(m.date)}
                    </p>
                  </div>
                  <Link
                    href={`/conversation/${m.conversationId}`}
                    className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors flex-shrink-0"
                  >
                    View →
                  </Link>
                </li>
              ))}
            </ul>
            <MeetingMap markers={meetingsWithCoords} />
          </>
        )}
      </section>

      {/* Danger zone */}
      <section className="card p-5 border-slate-700">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3 flex items-center gap-2">
          <WarningIcon className="w-4 h-4 text-slate-500" />
          Danger zone
        </h2>
        <div className="flex flex-wrap gap-3">
          <div className="flex flex-col gap-2 flex-1">
            <div className="flex items-center gap-2">
              <select
                value={mergeTargetId}
                onChange={(e) => {
                  setMergeTargetId(e.target.value);
                  setMergeError(null);
                }}
                aria-label="Merge target"
                disabled={otherPeople.length === 0}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 min-h-[44px] text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-400 disabled:opacity-50"
              >
                <option value="">Select person…</option>
                {otherPeople.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setShowMergeDialog(true)}
                disabled={!mergeTargetId}
                className="text-sm min-h-[44px] px-3 py-2 rounded-lg bg-amber-900/30 text-amber-300 hover:bg-amber-900/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Merge into…
              </button>
            </div>
            {mergeError && (
              <p className="text-red-400 text-xs" role="alert">
                {mergeError}
              </p>
            )}
          </div>
          <button
            onClick={() => setShowDeleteDialog(true)}
            className="text-sm min-h-[44px] px-3 py-2 rounded-lg bg-red-950/40 text-red-400 hover:bg-red-950/60 transition-colors"
          >
            Delete person
          </button>
        </div>
      </section>

      {showMergeDialog && targetPerson && (
        <ConfirmDialog
          title="Merge people?"
          tone="caution"
          body={
            <>
              Move everything from <strong className="text-slate-200">{person.name}</strong> into{" "}
              <strong className="text-slate-200">{targetPerson.name}</strong>? {person.name} will be deleted;
              their facts, meetings, and aliases will live on inside {targetPerson.name}.
            </>
          }
          confirmLabel="Merge"
          onConfirm={confirmMerge}
          onCancel={() => setShowMergeDialog(false)}
        />
      )}

      {showDeleteDialog && (
        <ConfirmDialog
          title="Delete this person?"
          tone="danger"
          body={
            <>
              This permanently deletes <strong className="text-slate-200">{person.name}</strong> and all
              their facts and meetings. This can&rsquo;t be undone.
            </>
          }
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onCancel={() => setShowDeleteDialog(false)}
        />
      )}
    </main>
  );
}
