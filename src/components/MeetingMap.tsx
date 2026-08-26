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
  placeName?: string;
}

export interface PlaceMarker {
  id: string;
  lat: number;
  lng: number;
  name: string;
  peopleLabel?: string;
}

interface MeetingMapProps {
  markers: MapMarker[];
  places?: PlaceMarker[];
  onNameLocation?: (lat: number, lng: number, rawName?: string) => void;
  className?: string;
}

export default function MeetingMap({ markers, places, onNameLocation, className }: MeetingMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    if (!containerRef.current || (markers.length === 0 && (places?.length ?? 0) === 0)) return;
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
        const nameBtn = onNameLocation
          ? `<br/><button data-name-loc="1" data-lat="${m.lat}" data-lng="${m.lng}" data-raw="${esc(m.placeName ?? "")}" style="margin-top:6px;color:#d99a5e;background:none;border:none;cursor:pointer;font-size:12px">Name this place</button>`
          : "";
        marker.bindPopup(`${title}${m.sublabel ? `<br/><span>${esc(m.sublabel)}</span>` : ""}${nameBtn}`);
        bounds.extend([m.lat, m.lng]);
      }

      // Named places: copper pin + label, popup links to the place page.
      const placeIcon = L.divIcon({
        className: "",
        html: `<div style="width:14px;height:14px;border-radius:4px;background:#b96d33;border:2px solid #14100d"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      for (const pl of places ?? []) {
        const m = L.marker([pl.lat, pl.lng], { icon: placeIcon }).addTo(map);
        m.bindPopup(
          `<a href="/people/place/${esc(pl.id)}" style="color:#d99a5e;font-weight:600">${esc(pl.name)}</a>` +
          (pl.peopleLabel ? `<br><span style="color:#a89a88;font-size:12px">${esc(pl.peopleLabel)}</span>` : "")
        );
        bounds.extend([pl.lat, pl.lng]);
      }

      if (onNameLocation) {
        map.on("popupopen", (e) => {
          const el = (e.popup.getElement() as HTMLElement | undefined)?.querySelector<HTMLButtonElement>("[data-name-loc]");
          if (el) {
            el.onclick = () => onNameLocation(parseFloat(el.dataset.lat!), parseFloat(el.dataset.lng!), el.dataset.raw || undefined);
          }
        });
      }

      map.fitBounds(bounds.pad(0.3), { maxZoom: 14 });
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [markers, places, onNameLocation]);

  if (markers.length === 0 && (places?.length ?? 0) === 0) return null;
  return (
    <div
      ref={containerRef}
      className={`rounded-xl overflow-hidden border border-slate-800 h-64 ${className ?? ""}`}
      role="region"
      aria-label="Map of meeting locations"
    />
  );
}
