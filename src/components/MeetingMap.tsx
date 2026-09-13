"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import { TILE_URL, TILE_ATTRIBUTION } from "@/lib/map-tiles";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/* Leaflet builds its markers and popups from raw HTML strings, so these can't
   be Tailwind classes and can't read CSS custom properties. Naming them here
   keeps the map on the same palette as the rest of the app. Meeting and place
   pins stay distinguishable by shape and by two steps of survey blue, not by
   two different hues. */
const PIN = {
  meeting: "#5b9bd5",
  place: "#4a8dc8",
  stroke: "#0b110e",
  link: "#5b9bd5",
  muted: "#8a9f8e",
} as const;

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
  people?: { name: string; href: string }[];
}

interface MeetingMapProps {
  markers: MapMarker[];
  places?: PlaceMarker[];
  onNameLocation?: (lat: number, lng: number, rawName?: string) => void;
  className?: string;
  /** Height utilities for the map box. A separate prop rather than something a
   *  caller folds into `className`, because two height classes on one element
   *  don't resolve by the order they're written — Tailwind emits them in its own
   *  order and the larger one silently wins. One height, decided here. */
  heightClass?: string;
}

export default function MeetingMap({ markers, places, onNameLocation, className, heightClass = "h-64" }: MeetingMapProps) {
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
      L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:14px;height:14px;border-radius:9999px;background:${PIN.meeting};border:2px solid ${PIN.stroke}"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      const bounds = L.latLngBounds([]);
      for (const m of markers) {
        const marker = L.marker([m.lat, m.lng], { icon }).addTo(map);
        const title = m.href
          ? `<a href="${m.href}" style="color:${PIN.link}">${esc(m.label)}</a>`
          : `<strong>${esc(m.label)}</strong>`;
        const nameBtn = onNameLocation
          ? `<br/><button data-name-loc="1" data-lat="${m.lat}" data-lng="${m.lng}" data-raw="${esc(m.placeName ?? "")}" style="margin-top:6px;color:${PIN.link};background:none;border:none;cursor:pointer;font-size:12px">Name this place</button>`
          : "";
        marker.bindPopup(`${title}${m.sublabel ? `<br/><span>${esc(m.sublabel)}</span>` : ""}${nameBtn}`);
        bounds.extend([m.lat, m.lng]);
      }

      // Named places: survey-blue pin + label, popup links to the place page.
      const placeIcon = L.divIcon({
        className: "",
        html: `<div style="width:14px;height:14px;border-radius:6px;background:${PIN.place};border:2px solid ${PIN.stroke}"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      for (const pl of places ?? []) {
        const m = L.marker([pl.lat, pl.lng], { icon: placeIcon }).addTo(map);
        // People met here are listed as links (the meeting pins for these people
        // are absorbed into this marker); the summary count is the fallback.
        const peopleHtml = pl.people && pl.people.length > 0
          ? `<br><span style="font-size:12px">${pl.people
              .map((pn) => `<a href="${esc(pn.href)}" style="color:${PIN.muted}">${esc(pn.name)}</a>`)
              .join(", ")}</span>`
          : pl.peopleLabel
          ? `<br><span style="color:${PIN.muted};font-size:12px">${esc(pl.peopleLabel)}</span>`
          : "";
        m.bindPopup(
          `<a href="/people/place/${esc(pl.id)}" style="color:${PIN.link};font-weight:600">${esc(pl.name)}</a>${peopleHtml}`
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
      className={`rounded-xl overflow-hidden border border-slate-800 ${heightClass} ${className ?? ""}`}
      role="region"
      aria-label="Map of meeting locations"
    />
  );
}
