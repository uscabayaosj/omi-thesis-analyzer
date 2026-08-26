"use client";

import { schedulePush } from "./sync";
import type { LatLng } from "./geo";

const PLACES_NS = "omi-places";

export interface Place {
  id: string;
  name: string;
  lat: number;
  lng: number;
  notes: string;
  createdAt: string;
  timestamp: string;
}

const MAX_NAME = 120;
const MAX_NOTES = 5_000;

function clip(value: string | undefined, max: number): string {
  const v = (value ?? "").trim();
  return v.length <= max ? v : `${v.slice(0, max - 1).trimEnd()}…`;
}

interface Tombstone {
  deleted: true;
  timestamp: string;
}
function isTombstone(v: unknown): v is Tombstone {
  return !!v && typeof v === "object" && (v as Tombstone).deleted === true;
}
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
function pruneTombstones<T>(map: Record<string, T>): Record<string, T> {
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  for (const [k, v] of Object.entries(map)) {
    if (isTombstone(v) && new Date((v as Tombstone).timestamp).getTime() < cutoff) delete map[k];
  }
  return map;
}

function isPlaceRecord(v: unknown): v is Place {
  return (
    !!v && typeof v === "object" && !isTombstone(v) &&
    typeof (v as Place).name === "string" &&
    typeof (v as Place).lat === "number" &&
    typeof (v as Place).lng === "number"
  );
}

function readMap(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(PLACES_NS);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, unknown>): boolean {
  try {
    localStorage.setItem(PLACES_NS, JSON.stringify(map));
    schedulePush(PLACES_NS);
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === "QuotaExceededError") {
      console.error(`${PLACES_NS}: localStorage quota exceeded; write dropped`);
    } else {
      console.error(`${PLACES_NS} write failed`, e);
    }
    return false;
  }
}

export function getPlaces(): Place[] {
  return Object.values(readMap())
    .filter(isPlaceRecord)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getPlace(id: string): Place | null {
  const rec = readMap()[id];
  return isPlaceRecord(rec) ? rec : null;
}

function put(place: Place): boolean {
  const map = pruneTombstones(readMap());
  map[place.id] = place;
  return writeMap(map);
}

export function createPlace(init: { name: string; lat: number; lng: number; notes?: string }): Place | null {
  const name = clip(init.name, MAX_NAME);
  if (!name || !Number.isFinite(init.lat) || !Number.isFinite(init.lng)) return null;
  const now = new Date().toISOString();
  const place: Place = {
    id: crypto.randomUUID(),
    name,
    lat: init.lat,
    lng: init.lng,
    notes: clip(init.notes, MAX_NOTES),
    createdAt: now,
    timestamp: now,
  };
  return put(place) ? place : null;
}

export function updatePlace(
  id: string,
  patch: Partial<Omit<Place, "id" | "createdAt" | "timestamp">>
): Place | null {
  const existing = getPlace(id);
  if (!existing) return null;
  const next: Place = {
    ...existing,
    ...patch,
    name: clip(patch.name ?? existing.name, MAX_NAME),
    notes: clip(patch.notes ?? existing.notes, MAX_NOTES),
    id,
    createdAt: existing.createdAt,
    timestamp: new Date().toISOString(),
  };
  if (!next.name || !Number.isFinite(next.lat) || !Number.isFinite(next.lng)) return null;
  return put(next) ? next : null;
}

export function deletePlace(id: string): boolean {
  const map = pruneTombstones(readMap());
  if (!(id in map)) return true;
  map[id] = { deleted: true, timestamp: new Date().toISOString() } satisfies Tombstone;
  return writeMap(map);
}

// Re-export for downstream consumers that treat a Place as a LatLng.
export type { LatLng };
