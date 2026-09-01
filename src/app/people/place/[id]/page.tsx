"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getPlace, updatePlace, deletePlace, type Place } from "@/lib/places";
import { getPeople, type Person } from "@/lib/people";
import { groupMeetingsByPlace } from "@/lib/place-resolve";
import { getMeetingLocations, onPlaceDeleted } from "@/lib/meeting-location";
import MeetingMap, { type MapMarker } from "@/components/MeetingMap";
import dynamic from "next/dynamic";
// Same treatment as MeetingMap: `leaflet/dist/leaflet.css` is imported at this
// component's module scope, so a static import pulls the stylesheet into the
// route bundle whether or not a picker is ever opened.
const LocationPicker = dynamic(() => import("@/components/LocationPicker"), { ssr: false });
import ConfirmDialog from "@/components/ConfirmDialog";
import { pullAndMerge } from "@/lib/sync";
import { BUTTON_PRIMARY, BUTTON_SECONDARY_CARD, LINK_BACK } from "@/lib/ui";

export default function PlaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [place, setPlace] = useState<Place | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [pinDraft, setPinDraft] = useState<{ lat: number; lng: number } | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    pullAndMerge().then(() => {
      if (cancelled) return;
      setPlace(getPlace(id));
      setPeople(getPeople());
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [id]);

  // People met here, with counts, via resolution against this one place —
  // including meetings pinned here by hand, which proximity alone would miss.
  const metHere = useMemo(() => {
    if (!place) return [];
    const overrides = getMeetingLocations();
    const rows: { person: Person; count: number }[] = [];
    for (const p of people) {
      const groups = groupMeetingsByPlace(p.meetings, [place], overrides);
      const g = groups.find((x) => x.place?.id === place.id);
      if (g) rows.push({ person: p, count: g.meetings.length });
    }
    return rows.sort((a, b) => b.count - a.count);
  }, [people, place]);

  if (loading) {
    return <main id="main" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-8"><div className="skeleton h-24 w-full" /></main>;
  }
  if (!place) {
    return (
      <main id="main" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-8 text-center">
        <h1 className="font-bold text-white mb-2">This place no longer exists</h1>
        <Link href="/people" className={BUTTON_SECONDARY_CARD}>All people</Link>
      </main>
    );
  }

  const marker: MapMarker = { lat: place.lat, lng: place.lng, label: place.name };

  const saveEdit = () => {
    setError(null);
    const patch: Parameters<typeof updatePlace>[1] = { name: nameDraft, notes: notesDraft };
    if (pinDraft) { patch.lat = pinDraft.lat; patch.lng = pinDraft.lng; }
    if (!updatePlace(id, patch)) { setError("Could not save."); return; }
    setPlace(getPlace(id));
    setEditing(false);
  };

  return (
    <main id="main" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/people" className={LINK_BACK}>← People</Link>

      {!editing ? (
        <div className="mb-4">
          <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400">
            Location
          </p>
          <div className="flex items-start justify-between gap-3">
            <h1 className="font-bold text-white">{place.name}</h1>
            <button onClick={() => { setNameDraft(place.name); setNotesDraft(place.notes); setPinDraft({ lat: place.lat, lng: place.lng }); setEditing(true); }}
              className="text-sm text-cyan-400 hover:text-cyan-300 min-h-[44px] px-2">Edit</button>
          </div>
        </div>
      ) : (
        <div className="card p-4 mb-4">
          <label htmlFor="place-name" className="block text-sm text-slate-400 mb-1">Name</label>
          <input id="place-name" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none min-h-[44px]" />
          {/* Not a <label>: its control is a map, which cannot be a label
              target. It is a caption; LocationPicker carries its own name. */}
          <p className="block text-sm text-slate-400 mb-1 mt-3">Location — search an address, or drag the pin to move it</p>
          <LocationPicker
            value={pinDraft}
            onChange={(lat, lng) => setPinDraft({ lat, lng })}
          />
          <label htmlFor="place-notes" className="block text-sm text-slate-400 mb-1 mt-3">Notes</label>
          <textarea id="place-notes" value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} rows={4}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none resize-none" />
          {error && <p className="text-sm text-red-400 mt-2" role="alert">{error}</p>}
          <div className="flex gap-2 mt-3">
            <button onClick={saveEdit} className={`${BUTTON_PRIMARY} py-2 px-5`}>Save</button>
            <button onClick={() => setEditing(false)} className={BUTTON_SECONDARY_CARD}>Cancel</button>
          </div>
        </div>
      )}

      {!editing && (
        <div className="card p-2 mb-4">
          <MeetingMap markers={[marker]} className="h-48 w-full rounded-lg overflow-hidden" />
        </div>
      )}

      <section className="card p-5 mb-4">
        <h2 className="text-slate-400 mb-3">Met here</h2>
        {metHere.length === 0 ? (
          <p className="text-slate-400 text-sm">No meetings resolve to this place yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {metHere.map(({ person, count }) => (
              <Link key={person.id} href={`/people/${person.id}`}
                className="inline-flex items-center gap-1.5 bg-slate-800 border border-slate-700 rounded-full px-3 py-1 font-serif text-sm text-slate-200 hover:border-cyan-500/50 transition-colors">
                {person.name}<span className="font-mono text-slate-400">· {count}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {place.notes && !editing && (
        <section className="card p-5 mb-4">
          <h2 className="text-slate-400 mb-2">Notes</h2>
          <p className="text-slate-300 text-sm whitespace-pre-wrap">{place.notes}</p>
        </section>
      )}

      <button onClick={() => setShowDelete(true)} className="text-sm text-red-400 hover:text-red-300 min-h-[44px] px-2">
        Delete this place
      </button>

      {showDelete && (
        <ConfirmDialog
          title={`Delete "${place.name}"?`}
          body="Meetings keep their locations; they just lose this name."
          confirmLabel="Delete"
          onConfirm={() => {
            if (!deletePlace(id)) return;
            // Meetings pinned here by hand would otherwise keep pointing at a
            // place that no longer exists; drop those assignments so they fall
            // back to proximity (or to no place at all).
            onPlaceDeleted(id);
            router.push("/people");
          }}
          onCancel={() => setShowDelete(false)}
        />
      )}
    </main>
  );
}
