"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import "leaflet/dist/leaflet.css";

interface LatLng {
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

export default function LocationPicker({ value, onChange, initialCenter, className }: LocationPickerProps) {
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
    <div
      ref={containerRef}
      className={`rounded-lg overflow-hidden border border-slate-700 h-64 ${className ?? ""}`}
      role="application"
      aria-label="Tap the map to set the location, or drag the pin to move it"
    />
  );
}
