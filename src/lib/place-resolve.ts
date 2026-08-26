import { distanceMeters, type LatLng } from "./geo";
import { getPlaces, type Place } from "./places";
import type { Meeting } from "./people";

export const SNAP_RADIUS_M = 200;

/** Nearest place within SNAP_RADIUS_M of `point`, or null. Pure: caller
 *  supplies the place list, so this runs in tests and on the server. */
export function resolvePlaceFrom(point: LatLng, places: Place[]): Place | null {
  let best: Place | null = null;
  let bestDist = SNAP_RADIUS_M;
  for (const place of places) {
    const d = distanceMeters(point, place);
    if (d <= bestDist) {
      best = place;
      bestDist = d;
    }
  }
  return best;
}

/** Storage-backed convenience wrapper. */
export function resolvePlace(point: LatLng): Place | null {
  return resolvePlaceFrom(point, getPlaces());
}

export interface PlaceGroup {
  place: Place | null;
  rawName?: string; // set only when place is null
  meetings: Meeting[];
}

/** Group meetings by resolved place. Located meetings that snap to a place are
 *  grouped under it; everything else is grouped under `place: null`, keyed by
 *  the meeting's raw Omi `placeName` (or "Unknown location"). Pure. */
export function groupMeetingsByPlace(meetings: Meeting[], places: Place[]): PlaceGroup[] {
  const byPlace = new Map<string, PlaceGroup>();
  const byRaw = new Map<string, PlaceGroup>();

  for (const m of meetings) {
    const located = m.lat != null && m.lng != null;
    const place = located ? resolvePlaceFrom({ lat: m.lat!, lng: m.lng! }, places) : null;
    if (place) {
      const g = byPlace.get(place.id) ?? { place, meetings: [] };
      g.meetings.push(m);
      byPlace.set(place.id, g);
    } else {
      const raw = (m.placeName ?? "").trim() || "Unknown location";
      const g = byRaw.get(raw) ?? { place: null, rawName: raw, meetings: [] };
      g.meetings.push(m);
      byRaw.set(raw, g);
    }
  }

  const placeGroups = [...byPlace.values()].sort((a, b) => b.meetings.length - a.meetings.length);
  const rawGroups = [...byRaw.values()].sort((a, b) => b.meetings.length - a.meetings.length);
  return [...placeGroups, ...rawGroups]; // named places first
}
