"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  appendToPerson,
  createPerson,
  getExtractedConversationIds,
  getPeople,
  getPending,
  ignoreName,
  removePending,
  type Meeting,
  type PendingSuggestion,
  type Person,
  type PersonFact,
} from "@/lib/people";
import { runExtraction } from "@/lib/people-pipeline";
import { getAnalyzedIds, getAnalysisAge } from "@/lib/storage";
import { getAdhdAnalyzedIds } from "@/lib/adhd-storage";
import { pullAndMerge } from "@/lib/sync";
import { getPlaces, createPlace, type Place } from "@/lib/places";
import LocationPicker from "@/components/LocationPicker";
import { groupMeetingsByPlace, resolvePlaceFrom } from "@/lib/place-resolve";
import { getMeetingLocations } from "@/lib/meeting-location";
import MeetingMap, { type MapMarker } from "@/components/MeetingMap";
import RelationshipGraph from "@/components/RelationshipGraph";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  CompassIcon,
  MapPinIcon,
  RefreshIcon,
  SearchIcon,
  SquareIcon,
  UsersIcon,
  XIcon,
} from "@/components/icons";
import { BUTTON_PRIMARY, BUTTON_GHOST, BUTTON_SECONDARY_CARD } from "@/lib/ui";

// Meeting has no personId field of its own; this local shape threads one
// through for per-place people-counting only (see placeStats below).
type MeetingWithPerson = Meeting & { personId: string };

// ── helpers (pure) ──

function factsFrom(s: PendingSuggestion): PersonFact[] {
  return s.details.map((text) => ({ text, conversationId: s.conversationId, date: s.date }));
}

function meetingFrom(s: PendingSuggestion): Meeting {
  return {
    conversationId: s.conversationId,
    date: s.date,
    placeName: s.placeName,
    lat: s.lat,
    lng: s.lng,
  };
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

function lastMeeting(p: Person): Meeting | undefined {
  if (p.meetings.length === 0) return undefined;
  return [...p.meetings].sort((a, b) => b.date.localeCompare(a.date))[0];
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** First letter for grouping/indexing; anything without one lands in "#". */
function indexLetter(name: string): string {
  const c = name.trim()[0]?.toUpperCase();
  return c && /[A-Z]/.test(c) ? c : "#";
}

/** People sorted and bucketed by their index letter, in display order
 *  (A–Z, then "#" last for anyone without a leading letter). */
function groupByLetter(people: Person[]): { letter: string; people: Person[] }[] {
  const buckets = new Map<string, Person[]>();
  for (const p of people) {
    const letter = indexLetter(p.name);
    const bucket = buckets.get(letter);
    if (bucket) bucket.push(p);
    else buckets.set(letter, [p]);
  }
  const order = [...ALPHABET, "#"];
  return order.filter((l) => buckets.has(l)).map((letter) => ({ letter, people: buckets.get(letter)! }));
}

type ViewMode = "grid" | "web" | "map" | "places";

export default function PeoplePage() {
  const router = useRouter();
  const [people, setPeople] = useState<Person[]>([]);
  const [pending, setPending] = useState<PendingSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewMode>("grid");
  const [places, setPlaces] = useState<Place[]>([]);
  const [addingPlace, setAddingPlace] = useState(false);
  const [prefill, setPrefill] = useState<{ lat: number; lng: number; raw?: string } | null>(null);
  const [addingPerson, setAddingPerson] = useState(false);
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [reassigning, setReassigning] = useState<string | null>(null); // pending suggestion id
  const [acceptErrorId, setAcceptErrorId] = useState<string | null>(null); // pending suggestion id
  // Collapsed by default so the directory, search, and view toggle aren't
  // buried under the full review queue on first paint — the count banner keeps
  // it one tap away without owning the whole first screen.
  const [reviewOpen, setReviewOpen] = useState(false);

  // Backfill state
  const [backfillTotal, setBackfillTotal] = useState<number | null>(null);
  const [backfillDone, setBackfillDone] = useState(0);
  const [backfillFailures, setBackfillFailures] = useState<number | null>(null);
  const cancelBackfillRef = useRef(false);

  const refresh = () => {
    setPeople(getPeople());
    setPending(getPending());
    setPlaces(getPlaces());
  };

  useEffect(() => {
    let cancelled = false;
    pullAndMerge().then(() => {
      if (!cancelled) {
        refresh();
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredPeople = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return people;
    return people.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.aliases.some((a) => a.toLowerCase().includes(q)) ||
        (p.role ?? "").toLowerCase().includes(q)
    );
  }, [people, search]);

  const groups = useMemo(() => groupByLetter(filteredPeople), [filteredPeople]);

  // Jump the letter rail to a section. Instant for reduced-motion, since the
  // scroll itself — not just entrance transitions — is the motion in play.
  const jumpToLetter = (letter: string) => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document
      .getElementById(`people-letter-${letter}`)
      ?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  const mapMarkers: MapMarker[] = useMemo(() => {
    const markers: MapMarker[] = [];
    for (const p of filteredPeople) {
      const m = lastMeeting(p);
      if (m?.lat != null && m?.lng != null) {
        // Absorb into the place marker: a meeting that resolves to a named
        // place is represented by that place's copper pin (whose popup lists
        // who was met there), so drop the duplicate person pin at the same spot.
        if (resolvePlaceFrom({ lat: m.lat, lng: m.lng }, places)) continue;
        markers.push({
          lat: m.lat,
          lng: m.lng,
          label: p.name,
          sublabel: [m.placeName, getAnalysisAge(m.date).label].filter(Boolean).join(" · "),
          href: `/people/${p.id}`,
          placeName: m.placeName,
        });
      }
    }
    return markers;
  }, [filteredPeople, places]);

  const locatedMeetings = useMemo(() => {
    const out: { lat: number; lng: number; rawName?: string; personId: string; personName: string; date: string }[] = [];
    for (const p of people) {
      for (const m of p.meetings) {
        if (m.lat != null && m.lng != null) {
          out.push({ lat: m.lat, lng: m.lng, rawName: m.placeName, personId: p.id, personName: p.name, date: m.date });
        }
      }
    }
    return out;
  }, [people]);

  const placeStats = useMemo(() => {
    // meetings & distinct-people counts per place, via resolution
    const meetings: MeetingWithPerson[] = people.flatMap((p) =>
      p.meetings.map((m) => ({ ...m, personId: p.id }))
    );
    const groups = groupMeetingsByPlace(meetings, places, getMeetingLocations());
    const stat = new Map<string, { meetings: number; people: number; personIds: string[] }>();
    for (const g of groups) {
      if (!g.place) continue;
      const personIds = [...new Set((g.meetings as MeetingWithPerson[]).map((m) => m.personId))];
      stat.set(g.place.id, { meetings: g.meetings.length, people: personIds.length, personIds });
    }
    return stat;
  }, [people, places]);

  const nameById = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);

  const placeMarkers = useMemo(
    () => places.map((pl) => {
      const s = placeStats.get(pl.id);
      return {
        id: pl.id, lat: pl.lat, lng: pl.lng, name: pl.name,
        peopleLabel: s ? `${s.people} ${s.people === 1 ? "person" : "people"} · ${s.meetings} meeting${s.meetings === 1 ? "" : "s"}` : undefined,
        // The people met here, so the absorbed pin's popup still names them.
        people: s ? s.personIds.map((pid) => ({ name: nameById.get(pid) ?? "Unknown", href: `/people/${pid}` })) : [],
      };
    }),
    [places, placeStats, nameById]
  );

  // ── review queue actions ──

  const resolve = (s: PendingSuggestion, action: () => void) => {
    action();
    removePending(s.id);
    refresh();
  };

  // Accept actions write to a person; if the write fails (target deleted in
  // another tab, storage write dropped), keep the suggestion queued and show
  // an inline error instead of silently losing the facts/meeting.
  const resolveAccept = (s: PendingSuggestion, action: () => Person | null) => {
    const result = action();
    if (!result) {
      setAcceptErrorId(s.id);
      refresh();
      return;
    }
    setAcceptErrorId((cur) => (cur === s.id ? null : cur));
    removePending(s.id);
    refresh();
  };

  const acceptAsNew = (s: PendingSuggestion) => {
    resolveAccept(s, () => {
      const p = createPerson({ name: s.extractedName });
      // A null here means the write didn't land (quota) or the name was empty.
      // Returning it keeps the suggestion queued rather than losing it.
      if (!p) return null;
      return appendToPerson(p.id, factsFrom(s), meetingFrom(s));
    });
  };

  const acceptInto = (s: PendingSuggestion, personId: string) => {
    resolveAccept(s, () => appendToPerson(personId, factsFrom(s), meetingFrom(s), s.extractedName));
  };

  const doIgnore = (s: PendingSuggestion) => {
    resolve(s, () => ignoreName(s.extractedName));
  };

  // ── add person ──

  const creatingRef = useRef(false);

  const submitNewPerson = () => {
    // A double-tap on Create would otherwise make two people: the navigation
    // that closes this form is async, so the second tap lands before it.
    if (creatingRef.current) return;
    const name = newName.trim();
    if (!name) {
      setAddError("Enter a name first.");
      return;
    }
    creatingRef.current = true;
    const p = createPerson({ name });
    if (!p) {
      creatingRef.current = false;
      setAddError("Couldn’t save — storage may be full.");
      return;
    }
    setAddError(null);
    setAddingPerson(false);
    setNewName("");
    router.push(`/people/${p.id}`);
  };

  // ── backfill ──

  const runBackfill = async () => {
    const analyzed = new Set([...getAnalyzedIds(), ...getAdhdAnalyzedIds()]);
    const extracted = getExtractedConversationIds();
    const candidates = [...analyzed].filter((id) => !extracted.has(id));
    if (candidates.length === 0) return;
    cancelBackfillRef.current = false;
    setBackfillTotal(candidates.length);
    setBackfillDone(0);
    setBackfillFailures(null);
    let failures = 0;
    for (let i = 0; i < candidates.length; i++) {
      if (cancelBackfillRef.current) break;
      const result = await runExtraction(candidates[i]);
      if ("error" in result) failures++;
      setBackfillDone(i + 1);
    }
    setBackfillTotal(null);
    setBackfillDone(0);
    setBackfillFailures(failures > 0 ? failures : null);
    refresh();
  };

  const cancelBackfill = () => {
    cancelBackfillRef.current = true;
  };

  const backfillActive = backfillTotal !== null;

  // The letter rail is a fixed overlay pinned to the viewport's right edge, so
  // it doesn't reserve layout space on its own. When it's showing, widen the
  // container's right padding so right-aligned card content (place, "21h ago")
  // never runs under it. On wide screens the container is centered with gutters
  // and the rail sits well clear, but the extra padding there is harmless.
  const railVisible = view === "grid" && !loading && groups.length > 1;

  return (
    <main className={`max-w-3xl mx-auto py-8 pl-4 ${railVisible ? "pr-9" : "pr-4"}`}>
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors mb-4"
      >
        <ArrowLeftIcon className="w-4 h-4" />
        All conversations
      </Link>

      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-500">
        Directory
      </p>
      <h1 className="mb-2 flex items-center gap-2.5 text-3xl font-bold text-white">
        <UsersIcon className="w-8 h-8 flex-shrink-0" />
        People
      </h1>
      <p className="text-slate-400 font-serif italic text-[0.95rem] mb-6">
        Everyone mentioned in your conversations — who they are, where you met, and what you learned.
      </p>

      {/* Review queue — collapsed to a count banner by default so the search,
          view toggle, and directory stay reachable without scrolling past every
          pending suggestion. Tap to expand; tap the header to collapse again. */}
      {pending.length > 0 && (
        reviewOpen ? (
          <section className="mb-8">
            <button
              onClick={() => setReviewOpen(false)}
              aria-expanded={true}
              className="w-full flex items-center justify-between gap-2 mb-3 min-h-[44px] text-slate-300 hover:text-white transition-colors"
            >
              <span className="text-sm font-semibold uppercase tracking-wide">Review ({pending.length})</span>
              <ChevronRightIcon className="w-4 h-4 -rotate-90 flex-shrink-0" />
            </button>
            <div className="space-y-3">
              {pending.map((s) => (
                <PendingCard
                  key={s.id}
                  suggestion={s}
                  people={people}
                  showError={acceptErrorId === s.id}
                  reassignOpen={reassigning === s.id}
                  onOpenReassign={() => setReassigning(s.id)}
                  onCloseReassign={() => setReassigning(null)}
                  onAcceptMatched={(id) => acceptInto(s, id)}
                  onAcceptCandidate={(id) => acceptInto(s, id)}
                  onAcceptExisting={(id) => acceptInto(s, id)}
                  onAcceptNew={() => acceptAsNew(s)}
                  onIgnore={() => doIgnore(s)}
                />
              ))}
            </div>
          </section>
        ) : (
          <button
            onClick={() => setReviewOpen(true)}
            aria-expanded={false}
            className="card w-full p-4 mb-6 flex items-center justify-between gap-2 min-h-[44px] hover:border-cyan-400/40 transition-colors"
          >
            <span className="text-sm text-slate-200">
              <span className="font-semibold">{pending.length}</span>{" "}
              {pending.length === 1 ? "suggestion" : "suggestions"} to review
            </span>
            <ChevronRightIcon className="w-4 h-4 text-cyan-400 flex-shrink-0" />
          </button>
        )
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <div className="relative flex-1 min-w-[160px]">
          <SearchIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people…"
            aria-label="Search people"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2 min-h-[44px] text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400"
          />
        </div>

        {/* Four views is one too many to spell out on a 320px phone: at that
            width the labelled control ran 319px wide inside a 288px column,
            clipping "Places" off-screen and pushing the whole page into
            horizontal scroll. Below `sm` the labels drop and the icons carry
            the control — each button keeps its name for screen readers and a
            44px square for thumbs, so nothing is hidden, only compacted. */}
        <div className="flex items-center bg-slate-800 rounded-lg p-1 flex-shrink-0" role="group" aria-label="View mode">
          {([
            { key: "grid", label: "Grid", Icon: SquareIcon },
            { key: "web", label: "Web", Icon: UsersIcon },
            { key: "map", label: "Map", Icon: CompassIcon },
            { key: "places", label: "Places", Icon: MapPinIcon },
          ] as const).map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setView(key)}
              aria-pressed={view === key}
              aria-label={label}
              className={`flex items-center justify-center gap-1.5 text-sm min-h-[36px] min-w-[44px] sm:min-w-0 px-2.5 sm:px-3 py-1.5 rounded-md transition-colors ${
                view === key ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        <button
          onClick={() => setAddingPerson(true)}
          className={`${BUTTON_GHOST} flex-shrink-0`}
        >
          + Add person
        </button>

        {!backfillActive ? (
          <button
            onClick={runBackfill}
            className={`${BUTTON_GHOST} flex-shrink-0`}
          >
            <RefreshIcon className="w-4 h-4" />
            Scan past conversations
          </button>
        ) : (
          <div
            className="flex items-center gap-2 text-sm text-slate-400 flex-shrink-0"
            role="status"
            aria-live="polite"
          >
            <RefreshIcon className="w-4 h-4 animate-spin" />
            Scanning {backfillDone} of {backfillTotal}…
            <button
              onClick={cancelBackfill}
              className="text-slate-400 hover:text-white underline"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {backfillFailures !== null && (
        <p className="text-amber-400 text-xs -mt-4 mb-6" role="status">
          Scanned past conversations — {backfillFailures} couldn&rsquo;t be reached. Check your API keys and try
          again.
        </p>
      )}

      {addingPerson && (
        <div className="card p-4 mb-6">
          <div className="flex items-center gap-2">
            <input
              autoFocus
              type="text"
              value={newName}
              maxLength={120}
              onChange={(e) => {
                setNewName(e.target.value);
                if (addError) setAddError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNewPerson();
                if (e.key === "Escape") {
                  setAddingPerson(false);
                  setAddError(null);
                }
              }}
              placeholder="Full name"
              aria-label="New person's name"
              aria-invalid={addError ? true : undefined}
              className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 min-h-[44px] text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400"
            />
            <button onClick={submitNewPerson} className={`${BUTTON_PRIMARY} px-4 flex-shrink-0`}>
              Create
            </button>
            <button
              onClick={() => {
                setAddingPerson(false);
                setNewName("");
                setAddError(null);
              }}
              aria-label="Cancel"
              className="p-2 min-h-[44px] min-w-[44px] flex-shrink-0 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <XIcon className="w-4 h-4" />
            </button>
          </div>
          {addError && (
            <p className="text-red-400 text-xs mt-2" role="alert">
              {addError}
            </p>
          )}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <p className="text-slate-400 text-sm">Loading…</p>
      ) : filteredPeople.length === 0 ? (
        <p className="text-slate-400 text-sm">
          {people.length === 0
            ? "No one in your directory yet. Analyze a conversation to get suggestions, or add someone manually."
            : "No one matches your search."}
        </p>
      ) : view === "grid" ? (
        <div>
          {groups.map(({ letter, people: bucket }, gi) => (
            <section key={letter} id={`people-letter-${letter}`} className={gi > 0 ? "mt-6" : undefined}>
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-2">
                {letter}
              </h2>
              <div className="space-y-2">
                {bucket.map((p) => {
                  const m = lastMeeting(p);
                  return (
                    <Link
                      key={p.id}
                      href={`/people/${p.id}`}
                      className="card p-3.5 flex items-center gap-3 hover:border-cyan-400/40 transition-colors"
                    >
                      {p.photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.photo}
                          alt=""
                          className="w-11 h-11 rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-11 h-11 rounded-full bg-slate-800 flex items-center justify-center text-slate-300 text-sm font-medium flex-shrink-0">
                          {initials(p.name)}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-serif font-medium text-white truncate">{p.name}</div>
                        {p.role && <div className="text-slate-400 font-serif italic text-sm truncate">{p.role}</div>}
                      </div>
                      {/* Meta only when there's a meeting: place (when known)
                          + when. No repeated "No meetings yet" filler down the
                          column, and no misleading label on people who have a
                          meeting but no captured location. */}
                      {m && (
                        <div className="text-slate-400 font-mono text-xs text-right flex-shrink-0 max-w-[40%]">
                          {m.placeName && <div className="truncate">{m.placeName}</div>}
                          <div>{getAnalysisAge(m.date).label}</div>
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : view === "web" ? (
        // Whole-network view: uses the full directory, not the search-filtered
        // list, so typing in the people search never silently prunes nodes and
        // their edges from the "whole network." Search narrows Grid/Map.
        <RelationshipGraph
          people={people}
          onOpen={(pid) => router.push(`/people/${pid}`)}
          onOpenPlace={(plid) => router.push(`/people/place/${plid}`)}
        />
      ) : view === "map" ? (
        mapMarkers.length === 0 && placeMarkers.length === 0 ? (
          <p className="text-slate-400 text-sm">
            Nobody in this view has a meeting location on record yet.
          </p>
        ) : (
          <MeetingMap
            markers={mapMarkers}
            places={placeMarkers}
            onNameLocation={(lat, lng, raw) => { setPrefill({ lat, lng, raw }); setAddingPlace(true); setView("places"); }}
            className="h-[60vh] w-full rounded-xl overflow-hidden"
          />
        )
      ) : (
        <div>
          <div className="flex justify-end mb-3">
            <button onClick={() => setAddingPlace(true)} className={BUTTON_SECONDARY_CARD}>Add place</button>
          </div>

          {addingPlace && (
            <AddPlacePanel
              locatedMeetings={locatedMeetings}
              initial={prefill ?? undefined}
              onCancel={() => { setAddingPlace(false); setPrefill(null); }}
              onCreated={() => { setAddingPlace(false); setPrefill(null); setPlaces(getPlaces()); }}
            />
          )}

          {places.length === 0 && !addingPlace && (
            <div className="card p-8 text-center">
              <p className="text-slate-300">No places yet.</p>
              <p className="text-slate-400 text-sm mt-2">Name a location you&rsquo;ve met people at to start.</p>
            </div>
          )}

          <div className="space-y-3">
            {places.map((pl) => {
              const s = placeStats.get(pl.id);
              return (
                <Link
                  key={pl.id}
                  href={`/people/place/${pl.id}`}
                  className={`card p-5 block transition-colors border-l-2 ${
                    s ? "border-l-emerald-500/40 hover:border-emerald-500/50" : "border-l-transparent hover:border-cyan-500/50"
                  }`}
                >
                  <h2 className="font-serif text-lg text-white">{pl.name}</h2>
                  <p className="text-slate-400 font-mono text-xs mt-1">
                    {s ? `${s.meetings} meeting${s.meetings === 1 ? "" : "s"} · ${s.people} ${s.people === 1 ? "person" : "people"}` : "No meetings yet"}
                  </p>
                  {pl.notes && <p className="text-slate-400 font-serif italic text-sm mt-1.5 line-clamp-1">{pl.notes}</p>}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {railVisible && (
        <LetterRail present={new Set(groups.map((g) => g.letter))} onJump={jumpToLetter} />
      )}
    </main>
  );
}

// ── letter index rail ──
//
// A card-catalog tab index, fixed rather than laid out as a content column —
// it carries no content of its own, only a jump affordance, so it doesn't
// compete with the Single Column Rule the way a real sidebar would. Individual
// letters run well under the 44px touch-target floor: 26 targets can't each
// clear that inside any phone's viewport height, the same constraint every
// real alphabet-index control (iOS Contacts included) accepts. A miss still
// lands within a line or two of the right section, so the control stays usable
// despite the small targets.
//
// It tracks the *column*, not the viewport. Pinned to the viewport edge it
// was adjacent to the list on a phone but stranded 310px away from it at
// 1440px — a tab index floating in empty margin, pointing at nothing. From
// `md` up it aligns to the right edge of the centred 768px column instead,
// landing inside the `pr-9` gutter the list already reserves for it. The
// breakpoint is md, not lg, because at exactly 768px the calc evaluates to
// zero — identical to `right-0` — so the two regimes meet with no seam.
function LetterRail({ present, onJump }: { present: Set<string>; onJump: (letter: string) => void }) {
  return (
    <nav
      aria-label="Jump to letter"
      className="fixed right-0 md:right-[calc(50%-384px)] top-1/2 -translate-y-1/2 z-10 flex flex-col items-center rounded-l-lg bg-slate-950/85 py-2 pl-1 pr-[max(0.25rem,env(safe-area-inset-right))]"
    >
      {ALPHABET.map((letter) => {
        const has = present.has(letter);
        return has ? (
          <button
            key={letter}
            onClick={() => onJump(letter)}
            className="text-[10px] leading-[14px] font-semibold text-slate-300 hover:text-cyan-300 active:text-cyan-300 transition-colors px-1"
          >
            {letter}
          </button>
        ) : (
          <span
            key={letter}
            aria-hidden="true"
            className="text-[10px] leading-[14px] font-semibold text-slate-700 px-1"
          >
            {letter}
          </span>
        );
      })}
    </nav>
  );
}

// ── review queue card ──

function PendingCard({
  suggestion: s,
  people,
  showError,
  reassignOpen,
  onOpenReassign,
  onCloseReassign,
  onAcceptMatched,
  onAcceptCandidate,
  onAcceptExisting,
  onAcceptNew,
  onIgnore,
}: {
  suggestion: PendingSuggestion;
  people: Person[];
  showError: boolean;
  reassignOpen: boolean;
  onOpenReassign: () => void;
  onCloseReassign: () => void;
  onAcceptMatched: (personId: string) => void;
  onAcceptCandidate: (personId: string) => void;
  onAcceptExisting: (personId: string) => void;
  onAcceptNew: () => void;
  onIgnore: () => void;
}) {
  const matched = s.matchedPersonId ? people.find((p) => p.id === s.matchedPersonId) : undefined;
  const candidates = s.candidateIds
    ? s.candidateIds.map((id) => people.find((p) => p.id === id)).filter((p): p is Person => !!p)
    : [];
  const disambiguator = (p: Person) => {
    const m = lastMeeting(p);
    return m ? `${m.placeName ?? "somewhere"} · ${getAnalysisAge(m.date).label}` : "no meetings yet";
  };

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          {/* Every string here is raw model output: a name can arrive as a
              sentence and a place as a paragraph, so both wrap rather than
              stretching the card. */}
          <div className="text-white font-medium break-words">{s.extractedName}</div>
          <div className="text-slate-500 text-xs break-words">
            {[s.placeName, getAnalysisAge(s.date).label].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>
      {s.details.length > 0 && (
        <ul className="text-sm text-slate-300 list-disc list-outside pl-5 mb-3 space-y-0.5">
          {s.details.map((d, i) => (
            <li key={i} className="break-words">
              {d}
            </li>
          ))}
        </ul>
      )}

      {showError && (
        <p className="text-red-400 text-xs mb-2" role="alert">
          Couldn&rsquo;t save — try again.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {matched ? (
          <>
            <button
              onClick={() => onAcceptMatched(matched.id)}
              title={`Add to ${matched.name}`}
              className={`${BUTTON_PRIMARY} px-3 max-w-full inline-flex items-center gap-1 overflow-hidden`}
            >
              <span className="flex-shrink-0">Add to</span>
              <span className="truncate">{matched.name}</span>
            </button>
            <button
              onClick={onOpenReassign}
              className={BUTTON_GHOST}
            >
              Someone else…
            </button>
          </>
        ) : candidates.length > 0 ? (
          <>
            {candidates.map((c) => (
              <button
                key={c.id}
                onClick={() => onAcceptCandidate(c.id)}
                title={`Same as ${c.name} — ${disambiguator(c)}`}
                className="text-sm min-h-[44px] px-3 py-2 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors max-w-full inline-flex items-center gap-1 overflow-hidden text-left"
              >
                <span className="flex-shrink-0">Same as</span>
                <span className="truncate">
                  {c.name} ({disambiguator(c)})
                </span>
              </button>
            ))}
            <button
              onClick={onAcceptNew}
              className={BUTTON_GHOST}
            >
              New person
            </button>
          </>
        ) : (
          <>
            <button onClick={onAcceptNew} className={`${BUTTON_PRIMARY} px-3`}>
              New person
            </button>
            <button
              onClick={onOpenReassign}
              className={BUTTON_GHOST}
            >
              Add to existing…
            </button>
          </>
        )}
        <button
          onClick={onIgnore}
          className="text-sm min-h-[44px] px-3 py-2 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
        >
          Ignore
        </button>
      </div>

      {reassignOpen && (
        <div className="mt-3 flex items-center gap-2 min-w-0">
          {/* min-w-0 + clipped labels: a select otherwise sizes to its widest
              option and pushes the page into horizontal scroll on a phone. */}
          <select
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) onAcceptExisting(e.target.value);
            }}
            aria-label="Select person"
            className="flex-1 min-w-0 max-w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 min-h-[44px] text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
          >
            <option value="" disabled>
              Select a person…
            </option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {optionLabel(p.name)}
              </option>
            ))}
          </select>
          <button
            onClick={onCloseReassign}
            aria-label="Cancel"
            className="p-2 min-h-[44px] min-w-[44px] rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── add place panel ──

function AddPlacePanel({
  locatedMeetings, initial, onCancel, onCreated,
}: {
  locatedMeetings: { lat: number; lng: number; rawName?: string; personName: string; date: string }[];
  initial?: { lat: number; lng: number; raw?: string };
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState(initial?.raw ?? "");
  const [notes, setNotes] = useState("");
  const [coord, setCoord] = useState<{ lat: number; lng: number } | null>(
    initial ? { lat: initial.lat, lng: initial.lng } : null
  );
  const [error, setError] = useState<string | null>(null);

  // Distinct coordinates (rounded) so the shortcut list isn't one row per meeting.
  const options = useMemo(() => {
    const seen = new Map<string, { lat: number; lng: number; label: string }>();
    for (const m of locatedMeetings) {
      const key = `${m.lat.toFixed(4)},${m.lng.toFixed(4)}`;
      if (!seen.has(key)) seen.set(key, { lat: m.lat, lng: m.lng, label: m.rawName || `${m.lat.toFixed(3)}, ${m.lng.toFixed(3)}` });
    }
    return [...seen.values()].slice(0, 30);
  }, [locatedMeetings]);

  // Frame the map on a nearby meeting when the user hasn't pinned anything yet.
  const anchor = options[0];

  const save = () => {
    setError(null);
    if (!coord || !Number.isFinite(coord.lat) || !Number.isFinite(coord.lng)) {
      setError("Tap the map to set a location.");
      return;
    }
    if (!createPlace({ name, lat: coord.lat, lng: coord.lng, notes })) { setError("Could not create the place (name empty or storage full)."); return; }
    onCreated();
  };

  return (
    <div className="enter-rise card p-4 mb-3">
      <label className="block text-sm text-slate-400 mb-1">Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dry Fork Ranch"
        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-400 focus:border-cyan-500 focus:outline-none min-h-[44px]" />

      {options.length > 0 && (
        <>
          <p className="text-sm text-slate-400 mt-3 mb-1">Start from a past meeting</p>
          <div className="space-y-1 max-h-32 overflow-auto">
            {options.map((o) => (
              <button key={`${o.lat},${o.lng}`} onClick={() => setCoord({ lat: o.lat, lng: o.lng })}
                className={`w-full text-left text-sm px-3 py-2 min-h-[44px] rounded-lg transition-colors ${
                  // Detector cross-pairs mutually-exclusive ternary branches. Real pairs:
                  // cyan-200 on the cyan-950/40 wash = 12.20:1; slate-300 is unselected (no fill),
                  // wrongly cross-paired by the detector with the selected branch's bg-cyan-950.
                  coord?.lat === o.lat && coord?.lng === o.lng ? "bg-cyan-950/40 border border-cyan-500/50 text-cyan-200" : "text-slate-300 hover:bg-slate-700" // impeccable-disable-line gray-on-color
                }`}>
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}

      <p className="text-sm text-slate-400 mt-3 mb-1">
        {coord ? "Search, tap the map, or drag the pin to adjust" : "Search an address, or tap the map to drop a pin"}
      </p>
      <LocationPicker
        value={coord}
        onChange={(lat, lng) => setCoord({ lat, lng })}
        // A searched result already carries a name; offer it rather than
        // making the user retype what they just typed. Only when the name
        // field is still empty, so it never overwrites their own wording.
        onResolveName={(label) => setName((n) => n.trim() ? n : label.split(",")[0].trim())}
        initialCenter={anchor ? { lat: anchor.lat, lng: anchor.lng } : undefined}
      />

      <label className="block text-sm text-slate-400 mb-1 mt-3">Notes (optional)</label>
      <input value={notes} onChange={(e) => setNotes(e.target.value)}
        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-400 focus:border-cyan-500 focus:outline-none min-h-[44px]" />

      {error && <p className="text-sm text-red-400 mt-2" role="alert">{error}</p>}
      <div className="flex gap-2 mt-4">
        <button onClick={save} className={`${BUTTON_PRIMARY} py-2 px-5`}>Create place</button>
        <button onClick={onCancel} className={BUTTON_SECONDARY_CARD}>Cancel</button>
      </div>
    </div>
  );
}
