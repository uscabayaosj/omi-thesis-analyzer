"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export interface MapMarker {
  lat: number;
  lng: number;
  label: string;
  sublabel?: string;
  href?: string;
}

export default function MeetingMap({ markers, className }: { markers: MapMarker[]; className?: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    if (!containerRef.current || markers.length === 0) return;
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
      const icon = L.divIcon({
        className: "",
        html: '<div style="width:14px;height:14px;border-radius:9999px;background:#22d3ee;border:2px solid #0f172a;box-shadow:0 0 0 2px #22d3ee66"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      const bounds = L.latLngBounds([]);
      for (const m of markers) {
        const marker = L.marker([m.lat, m.lng], { icon }).addTo(map);
        const title = m.href
          ? `<a href="${m.href}" style="color:#22d3ee">${esc(m.label)}</a>`
          : `<strong>${esc(m.label)}</strong>`;
        marker.bindPopup(`${title}${m.sublabel ? `<br/><span>${esc(m.sublabel)}</span>` : ""}`);
        bounds.extend([m.lat, m.lng]);
      }
      map.fitBounds(bounds.pad(0.3), { maxZoom: 14 });
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [markers]);

  if (markers.length === 0) return null;
  return (
    <div
      ref={containerRef}
      className={`rounded-xl overflow-hidden border border-slate-800 h-64 ${className ?? ""}`}
      role="region"
      aria-label="Map of meeting locations"
    />
  );
}
