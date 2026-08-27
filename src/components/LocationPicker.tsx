"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import "leaflet/dist/leaflet.css";
import { SearchIcon, LoaderIcon } from "@/components/icons";

interface LatLng {
  lat: number;
  lng: number;
}

interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
}

interface LocationPickerProps {
  /** Current pin, or null when nothing is placed yet. Controlled by the parent. */
  value: LatLng | null;
  /** Fired when the user taps the map or drags the pin. */
  onChange: (lat: number, lng: number) => void;
  /** Where to center when there is no value yet (e.g. a nearby meeting). */
  initialCenter?: LatLng;
  /** Fired alongside onChange when the pin came from a named search result,
   *  so a caller can prefill its own name field. */
  onResolveName?: (label: string) => void;
  className?: string;
}

// Continental-US view — the fallback when we have nothing to anchor on. The
// user pans from here; it's a starting frame, not a guess at their location.
const FALLBACK_CENTER: [number, number] = [39.5, -98.35];
const FALLBACK_ZOOM = 4;
const ANCHOR_ZOOM = 9; // centered on a nearby meeting, no pin yet
const PIN_ZOOM = 13; // centered on an existing pin

// The pin the user is placing — copper, matching the place markers elsewhere.
function pinHtml(): string {
  return '<div style="width:16px;height:16px;border-radius:4px;background:#b96d33;border:2px solid #14100d"></div>';
}

export default function LocationPicker({ value, onChange, initialCenter, onResolveName, className }: LocationPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);
  // Keep the latest onChange without rebuilding the map when its identity
  // changes. Initialized to a no-op (not the prop) and kept current via an
  // effect, so tap/drag always call the freshest handler.
  const onChangeRef = useRef<(lat: number, lng: number) => void>(() => {});
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Build the map exactly once (mount), like MeetingMap. Tap-to-place and
  // marker-drag both report through the ref, so a new onChange never rebuilds.
  // The initial `value`/`initialCenter` are read from the mount-time closure —
  // later value changes drive the marker via the sync effect below, not a rebuild.
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current) return;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      const map = L.map(containerRef.current, { scrollWheelZoom: false });
      mapRef.current = map;
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);

      const icon = L.divIcon({ className: "", html: pinHtml(), iconSize: [16, 16], iconAnchor: [8, 8] });

      const placeOrMove = (lat: number, lng: number) => {
        if (markerRef.current) {
          markerRef.current.setLatLng([lat, lng]);
        } else {
          const marker = L.marker([lat, lng], { icon, draggable: true }).addTo(map);
          marker.on("dragend", () => {
            const p = marker.getLatLng();
            onChangeRef.current(p.lat, p.lng);
          });
          markerRef.current = marker;
        }
      };

      map.on("click", (e) => {
        placeOrMove(e.latlng.lat, e.latlng.lng);
        onChangeRef.current(e.latlng.lat, e.latlng.lng);
      });

      if (value) {
        placeOrMove(value.lat, value.lng);
        map.setView([value.lat, value.lng], PIN_ZOOM);
      } else if (initialCenter) {
        map.setView([initialCenter.lat, initialCenter.lng], ANCHOR_ZOOM);
      } else {
        map.setView(FALLBACK_CENTER, FALLBACK_ZOOM);
      }

      // The panel animates in (enter-rise), so the container can be mid-transition
      // at build time; recompute tile/size once it has settled.
      setTimeout(() => map.invalidateSize(), 0);
    })();
    return () => {
      cancelled = true;
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Mount-once: reads the initial value/center from closure; later changes are
    // handled by the sync effect. Intentionally no deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync the marker to an externally-driven value change (e.g. picking a past
  // meeting from the shortcut list). Recenter only when the point is off-screen,
  // so a tap the user just made on-screen doesn't jump the view.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!value) {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      return;
    }
    (async () => {
      const L = (await import("leaflet")).default;
      if (!mapRef.current) return;
      if (markerRef.current) {
        markerRef.current.setLatLng([value.lat, value.lng]);
      } else {
        const icon = L.divIcon({ className: "", html: pinHtml(), iconSize: [16, 16], iconAnchor: [8, 8] });
        const marker = L.marker([value.lat, value.lng], { icon, draggable: true }).addTo(map);
        marker.on("dragend", () => {
          const p = marker.getLatLng();
          onChangeRef.current(p.lat, p.lng);
        });
        markerRef.current = marker;
      }
      if (!map.getBounds().contains([value.lat, value.lng])) {
        map.setView([value.lat, value.lng], Math.max(map.getZoom(), PIN_ZOOM));
      }
    })();
  }, [value]);

  return (
    <div>
      <AddressSearch
        onPick={(r) => {
          onChange(r.lat, r.lng);
          onResolveName?.(r.label);
        }}
      />
      <div
        ref={containerRef}
        className={`rounded-lg overflow-hidden border border-slate-700 h-64 ${className ?? ""}`}
        role="application"
        aria-label="Tap the map to set the location, or drag the pin to move it"
      />
    </div>
  );
}

/**
 * Type an address, pick a match, and the pin moves there.
 *
 * The map alone could only be driven by tapping the right patch of tiles,
 * which means knowing where a place is before you can record where it is.
 * This is the way in when you know the name but not the spot.
 */
function AddressSearch({ onPick }: { onPick: (r: GeocodeResult) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against a slow earlier request resolving after a later one and
  // overwriting fresher results.
  const runRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      setSearching(false);
      setMessage(null);
      return;
    }
    setSearching(true);
    setMessage(null);
    const run = ++runRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
        const data: { results?: GeocodeResult[]; error?: string } = await res.json();
        if (run !== runRef.current) return;
        const found = data.results ?? [];
        setResults(found);
        setMessage(data.error ?? (found.length === 0 ? `No match for “${q}”.` : null));
      } catch {
        if (run !== runRef.current) return;
        setResults([]);
        setMessage("Address search is unavailable right now. Tap the map instead.");
      } finally {
        if (run === runRef.current) setSearching(false);
      }
    }, 450);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <div className="mb-2">
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search an address or landmark…"
          aria-label="Search for an address to place the pin"
          className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-9 py-2.5 text-sm text-slate-200 placeholder-slate-400 focus:border-cyan-500 focus:outline-none min-h-[44px]"
        />
        {searching && (
          <LoaderIcon className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 animate-spin" />
        )}
      </div>

      {results.length > 0 && (
        <ul className="mt-1 space-y-1 max-h-40 overflow-auto">
          {results.map((r) => (
            <li key={`${r.lat},${r.lng},${r.label}`}>
              <button
                onClick={() => {
                  onPick(r);
                  setResults([]);
                  setQuery("");
                }}
                className="w-full text-left text-sm text-slate-300 hover:text-white px-3 py-2 min-h-[44px] rounded-lg hover:bg-slate-700 transition-colors"
              >
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {message && <p className="text-xs text-slate-400 mt-1">{message}</p>}
    </div>
  );
}
