"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
// Same treatment as MeetingMap: `leaflet/dist/leaflet.css` is imported at this
// component's module scope, so a static import pulls the stylesheet into the
// route bundle whether or not a picker is ever opened.
const LocationPicker = dynamic(() => import("@/components/LocationPicker"), { ssr: false });
import { getPlaces, createPlace, type Place } from "@/lib/places";
import {
  getMeetingLocation, saveMeetingLocation, clearMeetingLocation,
} from "@/lib/meeting-location";
import { resolvePlaceFrom, SNAP_RADIUS_M } from "@/lib/place-resolve";
import { distanceMeters } from "@/lib/geo";
import { BUTTON_PRIMARY, BUTTON_SECONDARY_CARD } from "@/lib/ui";

interface MeetingLocationEditorProps {
  conversationId: string;
  /** Whatever Omi reported, shown as the thing a correction departs from. */
  omiLat?: number;
  omiLng?: number;
  omiPlaceName?: string;
  onSaved: () => void;
  onCancel: () => void;
}

/**
 * Repairs one meeting's location.
 *
 * Two independent things can be set, and the copy keeps them separate because
 * they answer different questions: the pin answers "where did this happen",
 * the place answers "which of my named places was this". Setting the pin near
 * a saved place links them automatically; assigning a place by hand links them
 * regardless of distance, which is the only escape hatch when the GPS fix is
 * simply wrong.
 */
export default function MeetingLocationEditor({
  conversationId, omiLat, omiLng, omiPlaceName, onSaved, onCancel,
}: MeetingLocationEditorProps) {
  const existing = useMemo(() => getMeetingLocation(conversationId), [conversationId]);
  const places = useMemo(() => getPlaces(), []);

  const [coord, setCoord] = useState<{ lat: number; lng: number } | null>(() => {
    const lat = existing?.lat ?? omiLat;
    const lng = existing?.lng ?? omiLng;
    return lat != null && lng != null ? { lat, lng } : null;
  });
  const [placeId, setPlaceId] = useState<string>(existing?.placeId ?? "");
  const [searchLabel, setSearchLabel] = useState<string | null>(null);
  const [newPlaceName, setNewPlaceName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const hasOverride = existing != null;
  const hasOmi = omiLat != null && omiLng != null;

  // What the pin would snap to on its own, so the user can see the automatic
  // answer before deciding whether to override it.
  const autoPlace: Place | null = useMemo(
    () => (coord ? resolvePlaceFrom(coord, places) : null),
    [coord, places]
  );

  const pinnedPlace = places.find((p) => p.id === placeId) ?? null;
  // Distance is the reason an explicit assignment exists; showing it explains
  // why the automatic link didn't happen.
  const pinnedDistance = pinnedPlace && coord ? Math.round(distanceMeters(coord, pinnedPlace)) : null;

  const save = () => {
    setError(null);
    const name = newPlaceName.trim();
    let assigned = placeId;

    if (name) {
      if (!coord) {
        setError("Drop a pin first — a new place needs a location.");
        return;
      }
      const created = createPlace({ name, lat: coord.lat, lng: coord.lng, notes: "" });
      if (!created) {
        setError("Could not create that place (name empty or storage full).");
        return;
      }
      assigned = created.id;
    }

    if (!coord && !assigned) {
      setError("Set a pin or pick a place.");
      return;
    }

    const saved = saveMeetingLocation(conversationId, {
      lat: coord?.lat ?? null,
      lng: coord?.lng ?? null,
      placeId: assigned || null,
      placeName: assigned ? null : searchLabel ?? null,
    });
    if (!saved) {
      setError("Could not save that location — storage may be full.");
      return;
    }
    onSaved();
  };

  const revert = () => {
    if (!clearMeetingLocation(conversationId)) {
      setError("Could not clear the correction.");
      return;
    }
    onSaved();
  };

  return (
    <div className="enter-rise card p-4 border-cyan-500/30 mt-3">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400 mb-2">
        {hasOverride ? "Edit location" : "Set location"}
      </p>

      <p className="text-slate-400 font-serif italic text-sm mb-3">
        {hasOmi
          ? `Recorded at ${omiPlaceName || `${omiLat!.toFixed(4)}, ${omiLng!.toFixed(4)}`}. Move the pin to correct it.`
          : "This recording arrived without a location. Search an address or tap the map to add one."}
      </p>

      <LocationPicker
        value={coord}
        onChange={(lat, lng) => setCoord({ lat, lng })}
        onResolveName={(label) => setSearchLabel(label)}
        initialCenter={hasOmi ? { lat: omiLat!, lng: omiLng! } : undefined}
      />

      {coord && (
        <p className="font-mono text-xs text-slate-400 mt-2">
          {coord.lat.toFixed(5)}, {coord.lng.toFixed(5)}
          {autoPlace && !placeId ? ` · links to ${autoPlace.name}` : ""}
        </p>
      )}

      <div className="mt-4">
        <label htmlFor="mle-place" className="block text-sm text-slate-400 mb-1">
          Place {placeId ? "" : "(optional)"}
        </label>
        <select
          id="mle-place"
          value={placeId}
          onChange={(e) => { setPlaceId(e.target.value); setNewPlaceName(""); }}
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 min-h-[44px] text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
        >
          <option value="">
            {autoPlace ? `Automatic — ${autoPlace.name}` : "Automatic — nearest place within 200 m"}
          </option>
          {places.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {pinnedDistance != null && pinnedDistance > SNAP_RADIUS_M && (
          <p className="text-xs text-slate-400 mt-1">
            {pinnedPlace!.name} is {pinnedDistance >= 1000
              ? `${(pinnedDistance / 1000).toFixed(1)} km`
              : `${pinnedDistance} m`}{" "}
            from this pin — too far to link on its own, so this assignment keeps them together.
          </p>
        )}
      </div>

      {!placeId && (
        <div className="mt-3">
          <label htmlFor="mle-new-place" className="block text-sm text-slate-400 mb-1">
            Or name this spot as a new place
          </label>
          <input
            id="mle-new-place"
            value={newPlaceName}
            onChange={(e) => setNewPlaceName(e.target.value)}
            placeholder="e.g. Dry Fork Ranch"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 min-h-[44px] text-sm text-slate-200 placeholder-slate-400 focus:border-cyan-500 focus:outline-none"
          />
        </div>
      )}

      {error && <p className="text-sm text-red-400 mt-3" role="alert">{error}</p>}

      <div className="flex flex-wrap gap-2 mt-4">
        <button onClick={save} className={`${BUTTON_PRIMARY} py-2 px-5`}>Save location</button>
        <button onClick={onCancel} className={BUTTON_SECONDARY_CARD}>Cancel</button>
        {hasOverride && (
          <button
            onClick={revert}
            className="text-sm text-slate-400 hover:text-red-400 min-h-[44px] px-2 transition-colors"
          >
            {hasOmi ? "Undo correction" : "Remove location"}
          </button>
        )}
      </div>
    </div>
  );
}
