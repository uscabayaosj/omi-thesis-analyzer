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

/**
 * The effective location of a meeting: a manual correction when one exists,
 * otherwise whatever Omi reported. Pure — the caller supplies the overrides.
 *
 * Precedence is deliberate. An explicit `placeId` is a direct statement by the
 * user and beats every distance calculation; corrected coordinates beat Omi's;
 * Omi's are the floor. That ordering is what makes a wrong or missing GPS fix
 * repairable instead of permanent.
 */
export function effectiveMeetingLocation(
  meeting: Meeting,
  overrides: Record<string, MeetingLocationOverride> = {}
): { lat?: number; lng?: number; placeId?: string; placeName?: string } {
  const o = overrides[meeting.conversationId];
  return {
    lat: o?.lat ?? meeting.lat,
    lng: o?.lng ?? meeting.lng,
    placeId: o?.placeId,
    placeName: o?.placeName ?? meeting.placeName,
  };
}

/** The override shape this module needs, kept structural so `place-resolve`
 *  stays free of the client-only storage module and remains testable. */
export interface MeetingLocationOverride {
  lat?: number;
  lng?: number;
  placeId?: string;
  placeName?: string;
}

/** Group meetings by resolved place. A meeting pinned to a place by hand is
 *  grouped under it outright; otherwise a located meeting that snaps within
 *  SNAP_RADIUS_M is grouped under the nearest place, and everything else is
 *  grouped under `place: null`, keyed by its place name (or "Unknown
 *  location"). Pure. */
export function groupMeetingsByPlace(
  meetings: Meeting[],
  places: Place[],
  overrides: Record<string, MeetingLocationOverride> = {}
): PlaceGroup[] {
  const byPlace = new Map<string, PlaceGroup>();
  const byRaw = new Map<string, PlaceGroup>();

  for (const m of meetings) {
    const eff = effectiveMeetingLocation(m, overrides);
    // An explicit assignment short-circuits proximity entirely — but only to a
    // place that still exists, so a stale id falls back rather than vanishing.
    const pinned = eff.placeId ? places.find((p) => p.id === eff.placeId) ?? null : null;
    const located = eff.lat != null && eff.lng != null;
    const place = pinned ?? (located ? resolvePlaceFrom({ lat: eff.lat!, lng: eff.lng! }, places) : null);
    if (place) {
      const g = byPlace.get(place.id) ?? { place, meetings: [] };
      g.meetings.push(m);
      byPlace.set(place.id, g);
    } else {
      const raw = (eff.placeName ?? "").trim() || "Unknown location";
      const g = byRaw.get(raw) ?? { place: null, rawName: raw, meetings: [] };
      g.meetings.push(m);
      byRaw.set(raw, g);
    }
  }

  const placeGroups = [...byPlace.values()].sort((a, b) => b.meetings.length - a.meetings.length);
  const rawGroups = [...byRaw.values()].sort((a, b) => b.meetings.length - a.meetings.length);
  return [...placeGroups, ...rawGroups]; // named places first
}
