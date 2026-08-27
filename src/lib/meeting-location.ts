"use client";

import { schedulePush } from "./sync";

const MEETING_LOC_NS = "omi-meeting-locations";

/**
 * A manual location correction for one conversation.
 *
 * Omi's own geolocation is read-only and frequently absent — most recordings
 * arrive with no fix at all, and a fix that does arrive can sit far enough
 * from the real spot that proximity resolution misses the right place. Neither
 * case was repairable before: a meeting's coordinates were whatever Omi said,
 * forever.
 *
 * This namespace is the repair layer. It never mutates the conversation or the
 * copied `Meeting` record — it sits beside them, keyed by conversation id, and
 * every read path consults it first. Deleting an override restores whatever
 * Omi originally reported, so a correction is always reversible.
 *
 * Two independent corrections, either or both:
 * - `lat`/`lng` — where it actually happened. Feeds proximity resolution and
 *   every map.
 * - `placeId` — this meeting belongs to *this* saved place, full stop. Wins
 *   over proximity, so a place 1.6km from a bad GPS fix can still be linked.
 */
export interface MeetingLocation {
  conversationId: string;
  lat?: number;
  lng?: number;
  /** Explicit place assignment; overrides proximity snapping when set. */
  placeId?: string;
  /** Free-text label used when no saved place is assigned. */
  placeName?: string;
  timestamp: string;
}

interface Tombstone { deleted: true; timestamp: string }
function isTombstone(v: unknown): v is Tombstone {
  return !!v && typeof v === "object" && (v as Tombstone).deleted === true;
}

const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
function pruneTombstones(map: Record<string, unknown>): Record<string, unknown> {
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  for (const [k, v] of Object.entries(map)) {
    if (isTombstone(v) && new Date(v.timestamp).getTime() < cutoff) delete map[k];
  }
  return map;
}

function isRecord(v: unknown): v is MeetingLocation {
  return (
    !!v && typeof v === "object" && !isTombstone(v) &&
    typeof (v as MeetingLocation).conversationId === "string"
  );
}

function readMap(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(MEETING_LOC_NS);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, unknown>): boolean {
  try {
    localStorage.setItem(MEETING_LOC_NS, JSON.stringify(map));
    schedulePush(MEETING_LOC_NS);
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === "QuotaExceededError") {
      console.error(`${MEETING_LOC_NS}: localStorage quota exceeded; write dropped`);
    } else {
      console.error(`${MEETING_LOC_NS} write failed`, e);
    }
    return false;
  }
}

export function getMeetingLocations(): Record<string, MeetingLocation> {
  const out: Record<string, MeetingLocation> = {};
  for (const [k, v] of Object.entries(readMap())) {
    if (isRecord(v)) out[k] = v;
  }
  return out;
}

export function getMeetingLocation(conversationId: string): MeetingLocation | null {
  const rec = readMap()[conversationId];
  return isRecord(rec) ? rec : null;
}

/**
 * Upsert a correction. Passing `null` for a field clears just that field;
 * omitting it leaves the stored value alone. When nothing is left worth
 * storing, the record is removed rather than kept as an empty shell.
 */
export function saveMeetingLocation(
  conversationId: string,
  patch: {
    lat?: number | null;
    lng?: number | null;
    placeId?: string | null;
    placeName?: string | null;
  }
): MeetingLocation | null {
  if (!conversationId) return null;
  const map = pruneTombstones(readMap());
  const existing = map[conversationId];
  const base: MeetingLocation = isRecord(existing)
    ? existing
    : { conversationId, timestamp: new Date().toISOString() };

  const pick = <T>(next: T | null | undefined, prev: T | undefined): T | undefined =>
    next === null ? undefined : next === undefined ? prev : next;

  const next: MeetingLocation = {
    conversationId,
    lat: pick(patch.lat, base.lat),
    lng: pick(patch.lng, base.lng),
    placeId: pick(patch.placeId, base.placeId),
    placeName: pick(patch.placeName, base.placeName),
    timestamp: new Date().toISOString(),
  };

  // Coordinates are a pair or nothing — half a fix would resolve to NaN
  // distances downstream.
  if (next.lat == null || next.lng == null || !Number.isFinite(next.lat) || !Number.isFinite(next.lng)) {
    next.lat = undefined;
    next.lng = undefined;
  }

  const empty = next.lat == null && next.placeId == null && !next.placeName;
  if (empty) {
    return clearMeetingLocation(conversationId) ? null : null;
  }

  map[conversationId] = next;
  return writeMap(map) ? next : null;
}

/** Drop a correction entirely, restoring whatever Omi originally reported. */
export function clearMeetingLocation(conversationId: string): boolean {
  const map = pruneTombstones(readMap());
  if (!(conversationId in map)) return true;
  map[conversationId] = { deleted: true, timestamp: new Date().toISOString() } satisfies Tombstone;
  return writeMap(map);
}

/** Drop the explicit place assignment on every meeting pinned to a place, so
 *  deleting that place doesn't leave overrides pointing at nothing. */
export function onPlaceDeleted(placeId: string): void {
  const map = pruneTombstones(readMap());
  let changed = false;
  const now = new Date().toISOString();
  for (const [id, v] of Object.entries(map)) {
    if (!isRecord(v) || v.placeId !== placeId) continue;
    const stripped: MeetingLocation = { ...v, placeId: undefined, timestamp: now };
    if (stripped.lat == null && !stripped.placeName) {
      map[id] = { deleted: true, timestamp: now } satisfies Tombstone;
    } else {
      map[id] = stripped;
    }
    changed = true;
  }
  if (changed) writeMap(map);
}
