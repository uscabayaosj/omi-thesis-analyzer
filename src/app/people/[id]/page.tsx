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
import dynamic from "next/dynamic";
import { type MapMarker } from "@/components/MeetingMap";

// Leaflet's JS was already deferred, but `import "leaflet/dist/leaflet.css"`
// at module scope pulled its stylesheet into this route's render-blocking CSS
// even though the map usually draws nothing here. Loading the component
// lazily moves both into a chunk that only arrives when a map actually renders.
const MeetingMap = dynamic(() => import("@/components/MeetingMap"), { ssr: false });
import ConfirmDialog from "@/components/ConfirmDialog";
import RelationshipEditor from "@/components/RelationshipEditor";
import EgoWeb from "@/components/EgoWeb";
import {
  getRelationshipsFor, deleteRelationship, otherId, roleFor,
  RELATIONSHIP_TYPES, RELATIONSHIP_LABEL, type Relationship,
} from "@/lib/relationships";
import { getPlaces } from "@/lib/places";
import { groupMeetingsByPlace, effectiveMeetingLocation } from "@/lib/place-resolve";
import { getMeetingLocations } from "@/lib/meeting-location";
import MeetingLocationEditor from "@/components/MeetingLocationEditor";
import {
  ArrowLeftIcon,
  CheckIcon,
  TrashIcon,
  UndoIcon,
  UsersIcon,
  WarningIcon,
  XIcon,
} from "@/components/icons";
import { BUTTON_PRIMARY, BUTTON_SECONDARY_CARD } from "@/lib/ui";

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

/** Native option text can't wrap or ellipsize, so clip it before it renders. */
function optionLabel(name: string): string {
  return name.length > 48 ? `${name.slice(0, 47)}…` : name;
}

function formatDate(d: string): string {
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return d;
  return t.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function PersonDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [person, setPerson] = useState<Person | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mergeError, setMergeError] = useState<string | null>(null);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const [editingRole, setEditingRole] = useState(false);
  const [roleDraft, setRoleDraft] = useState("");

  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");

  const [aliasDraft, setAliasDraft] = useState("");

  /* Deleting a fact removes a piece of fieldwork evidence with a provenance
     link back to the conversation it came from. It used to commit instantly,
     from a 32px-wide × sitting beside a 26px provenance link, with no dialog
     and no way back — while re-running an analysis (recoverable, merely
     expensive) got a full modal. Rather than add a dialog to a frequent
     action, the delete is made reversible: the row is removed immediately and
     an undo offer stands for 10 seconds. */
  const [undoOffer, setUndoOffer] = useState<{ label: string; restore: Person } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const offerUndo = (label: string, snapshot: Person) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoOffer({ label, restore: snapshot });
    undoTimerRef.current = setTimeout(() => setUndoOffer(null), 10_000);
  };

  useEffect(() => () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }, []);

  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const [editingMeetingId, setEditingMeetingId] = useState<string | null>(null);
  // Bumped after a location correction so every derived view (place groups,
  // map pins, row labels) re-reads it from storage.
  const [locationVersion, setLocationVersion] = useState(0);

  const [rels, setRels] = useState<Relationship[]>([]);
  const [addingRel, setAddingRel] = useState(false);
  const [editingRel, setEditingRel] = useState<Relationship | null>(null);

  const refresh = () => {
    const p = getPerson(id);
    setPerson(p);
    setPeople(getPeople());
    setRels(getRelationshipsFor(id));
    if (!p) setNotFound(true);
  };

  const refreshRels = () => {
    setPeople(getPeople());
    setRels(getRelationshipsFor(id));
  };

  useEffect(() => {
    let cancelled = false;
    pullAndMerge().then(() => {
      if (cancelled) return;
      const p = getPerson(id);
      setPerson(p);
      setPeople(getPeople());
      setRels(getRelationshipsFor(id));
      if (!p) setNotFound(true);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Map pins use the corrected location when one exists, so a repaired
  // meeting moves on the map instead of staying at Omi's original fix.
  const meetingsWithCoords: MapMarker[] = useMemo(() => {
    if (!person) return [];
    const overrides = getMeetingLocations();
    return person.meetings
      .map((m) => ({ m, eff: effectiveMeetingLocation(m, overrides) }))
      .filter((x): x is { m: typeof x.m; eff: typeof x.eff & { lat: number; lng: number } } =>
        x.eff.lat != null && x.eff.lng != null)
      .map(({ m, eff }) => ({
        lat: eff.lat,
        lng: eff.lng,
        label: eff.placeName ?? formatDate(m.date),
        sublabel: formatDate(m.date),
        href: `/conversation/${m.conversationId}`,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person, locationVersion]);

  const sortedMeetings = useMemo(() => {
    if (!person) return [];
    return [...person.meetings].sort((a, b) => b.date.localeCompare(a.date));
  }, [person]);

  const placeGroups = useMemo(
    () => (person ? groupMeetingsByPlace(person.meetings, getPlaces(), getMeetingLocations()) : []),
    // locationVersion re-reads corrections from storage after one is saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [person, locationVersion]
  );

  const meetingOverrides = useMemo(
    () => getMeetingLocations(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locationVersion]
  );
  const places = useMemo(
    () => getPlaces(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locationVersion]
  );

  const otherPeople = useMemo(() => people.filter((p) => p.id !== id), [people, id]);

  const visibleRels = useMemo(() => {
    if (people.length === 0) return rels;
    return rels.filter((r) => people.some((p) => p.id === otherId(r, id)));
  }, [rels, people, id]);

  // ── photo pipeline (per brief) ──

  async function onPhotoSelected(file: File) {
    if (!file.type.startsWith("image/")) {
      setPhotoError("That file isn't an image.");
      return;
    }
    setPhotoBusy(true);
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      try {
        await new Promise<void>((res, rej) => {
          img.onload = () => res();
          img.onerror = () => rej(new Error("unreadable"));
          img.src = url;
        });
      } finally {
        // Revoke on the failure path too — a rejected decode would otherwise
        // leak the blob for the life of the document.
        URL.revokeObjectURL(url);
      }
      const scale = Math.min(1, 256 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
      // Photos are the one field big enough to hit the storage ceiling, and
      // the whole namespace re-serializes on every write — so a rejected write
      // here is the difference between "saved" and silently losing it.
      if (!updatePerson(id, { photo: dataUrl })) {
        setPhotoError("Couldn’t save that photo — storage is full. Remove a photo and try again.");
        return;
      }
      setPhotoError(null);
      refresh();
    } catch {
      setPhotoError("Couldn't read that photo — try a different one.");
    } finally {
      setPhotoBusy(false);
    }
  }

  const removePhoto = () => {
    if (!updatePerson(id, { photo: undefined })) {
      setPhotoError("Couldn’t remove that photo — the change didn’t save.");
      return;
    }
    setPhotoError(null);
    refresh();
  };

  // ── inline edit handlers ──

  const startEditName = () => {
    if (!person) return;
    setNameDraft(person.name);
    setEditingName(true);
  };
  /** Every inline edit runs through here so a rejected write (storage full,
   *  person deleted in another tab) surfaces instead of looking like it saved. */
  const commit = (patch: Parameters<typeof updatePerson>[1]): boolean => {
    if (!updatePerson(id, patch)) {
      setSaveError("That change didn’t save — storage may be full.");
      refresh();
      return false;
    }
    setSaveError(null);
    refresh();
    return true;
  };

  const saveName = () => {
    const name = nameDraft.trim();
    if (name) commit({ name });
    setEditingName(false);
  };

  const startEditRole = () => {
    setRoleDraft(person?.role ?? "");
    setEditingRole(true);
  };
  const saveRole = () => {
    commit({ role: roleDraft.trim() || undefined });
    setEditingRole(false);
  };

  const startEditNotes = () => {
    setNotesDraft(person?.notes ?? "");
    setEditingNotes(true);
  };
  const saveNotes = () => {
    commit({ notes: notesDraft.trim() });
    setEditingNotes(false);
  };

  const addAlias = () => {
    const alias = aliasDraft.trim();
    if (!person || !alias) return;
    if (person.aliases.some((a) => a.toLowerCase() === alias.toLowerCase())) {
      setAliasDraft("");
      return;
    }
    commit({ aliases: [...person.aliases, alias] });
    setAliasDraft("");
  };

  const removeAlias = (alias: string) => {
    if (!person) return;
    offerUndo(`Removed alias “${alias}”.`, person);
    commit({ aliases: person.aliases.filter((a) => a !== alias) });
  };

  const removeFact = (fact: PersonFact) => {
    if (!person) return;
    offerUndo("Fact deleted.", person);
    commit({
      facts: person.facts.filter(
        (f) => !(f.text === fact.text && f.conversationId === fact.conversationId && f.date === fact.date)
      ),
    });
  };

  // ── danger zone ──

  const confirmMerge = () => {
    if (!mergeTargetId) return;
    const result = mergePeople(id, mergeTargetId);
    if (!result) {
      setShowMergeDialog(false);
      setMergeError("Merge failed. Please make sure both people still exist and try again.");
      return;
    }
    setShowMergeDialog(false);
    setMergeError(null);
    router.push(`/people/${mergeTargetId}`);
  };

  const confirmDelete = () => {
    setShowDeleteDialog(false);
    if (!deletePerson(id)) {
      setSaveError("Couldn’t delete — the change didn’t save. Try again.");
      return;
    }
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
            className={BUTTON_SECONDARY_CARD}
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
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400">
        Profile
      </p>
      <div className="card p-6 mb-6">
        <div className="flex items-start gap-4">
          <div className="relative flex-shrink-0 group">
            {person.photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={person.photo}
                alt=""
                decoding="async"
                className="w-20 h-20 rounded-full object-cover"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-slate-800 flex items-center justify-center text-slate-300 text-xl font-medium">
                {initials(person.name)}
              </div>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={photoBusy}
              aria-label={photoBusy ? "Processing photo" : "Change photo"}
              aria-busy={photoBusy || undefined}
              className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-slate-700 hover:bg-slate-600 disabled:opacity-60 disabled:hover:bg-slate-700 text-slate-200 flex items-center justify-center border-2 border-slate-900 transition-colors"
            >
              <CameraIcon className={`w-3.5 h-3.5 ${photoBusy ? "animate-pulse" : ""}`} />
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
                  maxLength={120}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveName();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                  aria-label="Name"
                  className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 min-h-[40px] text-lg font-bold text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
                />
                <button onClick={saveName} aria-label="Save name" className="p-2 min-h-[40px] min-w-[40px] rounded-lg text-cyan-400 hover:bg-slate-800">
                  <CheckIcon className="w-4 h-4" />
                </button>
                <button onClick={() => setEditingName(false)} aria-label="Cancel" className="p-2 min-h-[40px] min-w-[40px] rounded-lg text-slate-400 hover:bg-slate-800">
                  <XIcon className="w-4 h-4" />
                </button>
              </div>
            ) : (
              /* The person's name is this page's title, so it has to BE the
                 h1 — previously the only h1 on the route lived in the
                 "no longer exists" branch, leaving the loaded page with no
                 level-1 heading and a heading outline that started at h2.
                 The button stays (the name is edit-in-place); it just sits
                 inside the heading now, and says so. */
              <h1 className="mb-1">
                <button
                  onClick={startEditName}
                  aria-label={`Edit name: ${person.name}`}
                  className="font-serif text-2xl font-bold text-white hover:text-cyan-300 transition-colors text-left truncate max-w-full"
                >
                  {person.name}
                </button>
              </h1>
            )}

            {photoError && (
              <p className="text-red-400 text-xs mb-1" role="alert">
                {photoError}
              </p>
            )}
            {saveError && (
              <p className="text-red-400 text-xs mb-1" role="alert">
                {saveError}
              </p>
            )}
            {person.photo && !editingName && (
              <button
                onClick={removePhoto}
                className="text-xs text-slate-400 hover:text-red-400 transition-colors"
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
                    maxLength={160}
                    onChange={(e) => setRoleDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveRole();
                      if (e.key === "Escape") setEditingRole(false);
                    }}
                    placeholder="Role or relationship"
                    aria-label="Role"
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 min-h-[36px] text-sm text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-400"
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
              className="inline-flex items-center gap-1 max-w-full bg-slate-800 text-slate-300 text-xs px-2.5 py-1 rounded-full"
            >
              <span className="truncate" title={a}>
                {a}
              </span>
              <button
                onClick={() => removeAlias(a)}
                aria-label={`Remove alias ${a}`}
                className="hover:text-red-400 transition-colors flex-shrink-0"
              >
                <XIcon className="w-3 h-3" />
              </button>
            </span>
          ))}
          <input
            type="text"
            value={aliasDraft}
            maxLength={120}
            onChange={(e) => setAliasDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addAlias();
            }}
            placeholder="+ Add alias"
            aria-label="Add alias"
            className="bg-transparent border border-dashed border-slate-700 rounded-full px-2.5 py-1 min-h-[28px] text-xs text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-400 w-28"
          />
        </div>

        {/* Notes */}
        <div className="mt-4">
          <h2 className="text-slate-400 mb-1.5">Notes</h2>
          {editingNotes ? (
            <div>
              <textarea
                autoFocus
                value={notesDraft}
                maxLength={5000}
                onChange={(e) => setNotesDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setEditingNotes(false);
                }}
                rows={3}
                aria-label="Notes"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-400 resize-none"
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
              className="text-sm text-slate-300 hover:text-white transition-colors text-left whitespace-pre-wrap break-words max-w-full"
            >
              {person.notes || "+ Add notes"}
            </button>
          )}
        </div>
      </div>

      {undoOffer && (
        <div
          role="status"
          className="enter-rise card p-3 mb-4 flex flex-wrap items-center justify-between gap-3 border-cyan-500/30"
        >
          <p className="text-sm text-slate-200">{undoOffer.label}</p>
          <button
            onClick={() => {
              commit({ aliases: undoOffer.restore.aliases, facts: undoOffer.restore.facts });
              setUndoOffer(null);
            }}
            className="bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm px-3 py-2 min-h-[44px] rounded-lg transition-colors inline-flex items-center gap-1.5"
          >
            <UndoIcon className="w-4 h-4" />
            Undo
          </button>
        </div>
      )}

      {/* Facts */}
      <section className="mb-6">
        <h2 className="text-slate-300 mb-3">
          Facts ({person.facts.length})
        </h2>
        {person.facts.length === 0 ? (
          <p className="text-slate-400 text-sm">Nothing learned about {person.name} yet.</p>
        ) : (
          <ul className="space-y-2">
            {person.facts.map((f, i) => (
              <li key={`${f.conversationId}-${i}`} className="card p-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-slate-200 break-words">{f.text}</p>
                  <Link
                    href={`/conversation/${f.conversationId}`}
                    className="font-mono text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                  >
                    {formatDate(f.date)} · view conversation →
                  </Link>
                </div>
                {/* 44×44 and a trash glyph: at 32px wide, beside a 26px-tall
                    provenance link, an × read as "dismiss" and sat within one
                    thumb-width of navigation. */}
                <button
                  onClick={() => removeFact(f)}
                  aria-label={`Delete fact: ${f.text}`}
                  className="p-1.5 min-h-[44px] min-w-[44px] ml-1 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors flex-shrink-0 flex items-center justify-center"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Relationships */}
      <section className="card p-5 mt-4 mb-6">
        <h2 className="text-slate-400 mb-3">Relationships</h2>

        {visibleRels.length === 0 && !addingRel && (
          <p className="text-slate-400 text-sm">No relationships yet.</p>
        )}

        {visibleRels.length > 0 && person && (
          <div className="mb-4">
            <EgoWeb self={person} rels={visibleRels} people={people} onNavigate={(pid) => router.push(`/people/${pid}`)} />
          </div>
        )}

        {RELATIONSHIP_TYPES.map((t) => {
          const ofType = visibleRels.filter((r) => r.type === t);
          if (ofType.length === 0) return null;
          return (
            <div key={t} className="mb-3 last:mb-0">
              <p className="text-xs text-slate-400 mb-1.5">{RELATIONSHIP_LABEL[t]}</p>
              <div className="flex flex-wrap gap-2">
                {ofType.map((r) => {
                  const oid = otherId(r, id);
                  const other = people.find((p) => p.id === oid);
                  const { otherRole } = roleFor(r, id);
                  // otherRole is the OTHER person's role in this relationship
                  // (e.g. "daughter" on Andrew's page means Barbara is his
                  // daughter) — spelling out whose role it is, instead of a
                  // bare "· daughter", keeps that direction unambiguous.
                  return (
                    <span key={r.id} className="inline-flex items-center gap-1.5 bg-slate-800 border border-slate-700 rounded-full pl-3 pr-1.5 py-1 font-serif text-sm text-slate-200">
                      <button
                        onClick={() => router.push(`/people/${oid}`)}
                        className="hover:text-white transition-colors"
                      >
                        {other?.name ?? "Unknown"}
                        {otherRole ? (
                          <span className="text-slate-400"> — {person.name}&rsquo;s {otherRole}</span>
                        ) : r.note ? (
                          <span className="text-slate-400"> · {r.note}</span>
                        ) : null}
                      </button>
                      <button
                        onClick={() => { setEditingRel(r); setAddingRel(false); }}
                        aria-label={`Edit relationship with ${other?.name ?? "person"}`}
                        className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-full text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                      >
                        ⋯
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}

        {editingRel && (
          <RelationshipEditor
            selfId={id}
            selfName={person.name}
            people={people}
            editing={editingRel}
            onSaved={() => { setEditingRel(null); refreshRels(); }}
            onCancel={() => setEditingRel(null)}
          />
        )}

        {addingRel && !editingRel && (
          <RelationshipEditor
            selfId={id}
            selfName={person.name}
            people={people}
            onSaved={() => { setAddingRel(false); refreshRels(); }}
            onCancel={() => setAddingRel(false)}
          />
        )}

        {!addingRel && !editingRel && (
          <button
            onClick={() => setAddingRel(true)}
            className={`${BUTTON_SECONDARY_CARD} mt-3`}
          >
            Add relationship
          </button>
        )}

        {editingRel && (
          <button
            onClick={() => { if (deleteRelationship(editingRel.id)) { setEditingRel(null); refreshRels(); } }}
            className="text-sm text-red-400 hover:text-red-300 mt-2 min-h-[44px] px-2"
          >
            Remove this relationship
          </button>
        )}
      </section>

      {/* Where we've met — same meetings as the list below, grouped by place
          instead of by date; the two sections read as duplicates without a
          line saying so. */}
      {placeGroups.length > 0 && (
        <section className="card p-5 mt-4 mb-6">
          <h2 className="text-slate-400 mb-1">Where we&apos;ve met</h2>
          <p className="text-xs text-slate-400 font-serif italic mb-3">The meetings below, grouped by place</p>
          <ul className="space-y-2">
            {placeGroups.map((g, i) => (
              <li key={g.place?.id ?? `raw-${i}`} className="flex items-center justify-between text-sm">
                {g.place ? (
                  <Link href={`/people/place/${g.place.id}`} className="font-serif text-slate-200 hover:text-white transition-colors">
                    {g.place.name}
                  </Link>
                ) : (
                  <span className="font-serif text-slate-300">{g.rawName}</span>
                )}
                <span className="font-mono text-slate-400">{g.meetings.length}×</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Meeting history — every meeting one row at a time, newest first;
          "Where we've met" above is the same list grouped by place instead. */}
      <section className="mb-6">
        <h2 className="text-slate-300 mb-1">
          Meeting history ({person.meetings.length})
        </h2>
        {sortedMeetings.length === 0 ? (
          <p className="text-slate-400 text-sm">No meetings recorded yet.</p>
        ) : (
          <>
            <p className="text-xs text-slate-400 font-serif italic mb-3">Every meeting, most recent first</p>
            <ul className="space-y-1.5 mb-4">
              {sortedMeetings.map((m) => {
                const eff = effectiveMeetingLocation(m, meetingOverrides);
                const pinnedPlace = eff.placeId ? places.find((p) => p.id === eff.placeId) : null;
                const label = pinnedPlace?.name ?? eff.placeName ?? "Unknown place";
                const isEditing = editingMeetingId === m.conversationId;
                return (
                  <li key={m.conversationId} className="card p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-serif text-sm text-slate-200 truncate">{label}</p>
                        <p className="font-mono text-xs text-slate-400">
                          {getAnalysisAge(m.date).label} · {formatDate(m.date)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => setEditingMeetingId(isEditing ? null : m.conversationId)}
                          aria-expanded={isEditing}
                          className="text-xs text-slate-400 hover:text-white min-h-[44px] px-2 transition-colors"
                        >
                          {eff.lat != null || eff.placeId ? "Edit place" : "Set place"}
                        </button>
                        <Link
                          href={`/conversation/${m.conversationId}`}
                          className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                        >
                          View →
                        </Link>
                      </div>
                    </div>
                    {isEditing && (
                      <MeetingLocationEditor
                        conversationId={m.conversationId}
                        omiLat={m.lat}
                        omiLng={m.lng}
                        omiPlaceName={m.placeName}
                        onSaved={() => {
                          setEditingMeetingId(null);
                          setLocationVersion((v) => v + 1);
                        }}
                        onCancel={() => setEditingMeetingId(null)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
            <MeetingMap markers={meetingsWithCoords} />
          </>
        )}
      </section>

      {/* Merge or remove */}
      <section className="card p-5 border-slate-700">
        <h2 className="text-slate-300 mb-3 flex items-center gap-2">
          <WarningIcon className="w-4 h-4 text-slate-500" />
          Merge or remove
        </h2>
        <div className="flex flex-wrap gap-3">
          <div className="flex flex-col gap-2 flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              {/* A select sizes itself to its widest option, so one long name
                  would otherwise push the whole page into horizontal scroll on
                  a phone. min-w-0 lets it shrink; the label is clipped to keep
                  the collapsed control readable. */}
              <select
                value={mergeTargetId}
                onChange={(e) => {
                  setMergeTargetId(e.target.value);
                  setMergeError(null);
                }}
                aria-label="Merge target"
                disabled={otherPeople.length === 0}
                className="flex-1 min-w-0 max-w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 min-h-[44px] text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-400 disabled:opacity-50"
              >
                <option value="">Select person…</option>
                {otherPeople.map((p) => (
                  <option key={p.id} value={p.id}>
                    {optionLabel(p.name)}
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
