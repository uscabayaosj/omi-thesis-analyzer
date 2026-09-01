"use client";

import { useMemo, useState } from "react";
import { computeLayout } from "@/lib/graph-layout";
import { useRovingRadioGroup } from "@/lib/roving";
import {
  getRelationships, RELATIONSHIP_TYPES, RELATIONSHIP_LABEL,
  type RelationshipType,
} from "@/lib/relationships";
import { REL_DASH } from "@/components/EgoWeb";
import { getPlaces } from "@/lib/places";
import { getMeetingLocations } from "@/lib/meeting-location";
import { groupMeetingsByPlace } from "@/lib/place-resolve";

const FILTER_VALUES = ["all", ...RELATIONSHIP_TYPES] as const;
import type { Person } from "@/lib/people";

interface RelationshipGraphProps {
  people: Person[];
  onOpen: (personId: string) => void;
  onOpenPlace: (placeId: string) => void;
}

/* Sized so the graph stays legible on a phone, the same reasoning EgoWeb
   already carries. A `viewBox` scales its contents with the container, so a
   600-unit box inside a ~272px card on a 320px screen renders at 0.45: the
   9px labels became ~4px and the r=28 hit circles ~25px, and no CSS floor can
   reach them because `min-width`/`min-height` do nothing to SVG elements.
   Halving the box roughly doubles the effective scale; the layout is computed
   from W/H so the arrangement is unchanged, only its density. */
const W = 340;
const H = 260;

// Node ids from two different records (Person, Place) can collide by raw id,
// so every id in the layout/position maps is namespaced by kind — these are
// internal keys only, stripped again before navigating.
const personKey = (id: string) => `p:${id}`;
const placeKey = (id: string) => `pl:${id}`;

export default function RelationshipGraph({ people, onOpen, onOpenPlace }: RelationshipGraphProps) {
  const [filter, setFilter] = useState<RelationshipType | "all">("all");
  const rovingFilter = useRovingRadioGroup(FILTER_VALUES, filter, setFilter);
  const [showPlaces, setShowPlaces] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const allRels = useMemo(() => getRelationships(), []);
  const rels = useMemo(
    () => (filter === "all" ? allRels : allRels.filter((r) => r.type === filter)),
    [allRels, filter]
  );

  const nameOf = useMemo(() => {
    const m = new Map(people.map((p) => [p.id, p.name] as const));
    return (id: string) => m.get(id) ?? "Unknown";
  }, [people]);

  // People that appear in at least one (filtered) relationship edge, and that still exist.
  const relPersonIds = useMemo(() => {
    const alive = new Set(people.map((p) => p.id));
    const s = new Set<string>();
    for (const r of rels) {
      if (alive.has(r.aId) && alive.has(r.bId)) { s.add(r.aId); s.add(r.bId); }
    }
    return s;
  }, [rels, people]);

  const relEdges = useMemo(
    () => rels
      .filter((r) => relPersonIds.has(r.aId) && relPersonIds.has(r.bId))
      .map((r) => ({ a: personKey(r.aId), b: personKey(r.bId), kind: "rel" as const, rel: r })),
    [rels, relPersonIds]
  );

  // Each person's meetings resolved to a saved Place (proximity-snapped, same
  // rule the person and place detail pages use) — one edge per distinct
  // person↔place pair, not one per meeting, so a dozen coffee-shop visits
  // don't draw a dozen overlapping lines.
  const places = useMemo(() => getPlaces(), []);
  const overrides = useMemo(() => getMeetingLocations(), []);
  const placeEdges = useMemo(() => {
    if (!showPlaces) return [];
    const out: { personId: string; placeId: string; count: number }[] = [];
    for (const person of people) {
      for (const g of groupMeetingsByPlace(person.meetings, places, overrides)) {
        if (g.place) out.push({ personId: person.id, placeId: g.place.id, count: g.meetings.length });
      }
    }
    return out;
  }, [showPlaces, people, places, overrides]);

  const placeIds = useMemo(
    () => new Set(placeEdges.map((e) => e.placeId)),
    [placeEdges]
  );
  const placePersonIds = useMemo(
    () => new Set(placeEdges.map((e) => e.personId)),
    [placeEdges]
  );

  const personIds = useMemo(
    () => [...new Set([...relPersonIds, ...placePersonIds])],
    [relPersonIds, placePersonIds]
  );

  const placeNameOf = useMemo(() => {
    const m = new Map(places.map((p) => [p.id, p.name] as const));
    return (id: string) => m.get(id) ?? "Unknown place";
  }, [places]);

  const ids = useMemo(
    () => [...personIds.map(personKey), ...[...placeIds].map(placeKey)],
    [personIds, placeIds]
  );

  const edges = useMemo(() => [
    ...relEdges,
    ...placeEdges.map((e) => ({
      a: personKey(e.personId), b: placeKey(e.placeId), kind: "place" as const,
      id: `${e.personId}:${e.placeId}`,
    })),
  ], [relEdges, placeEdges]);

  const pos = useMemo(
    () => computeLayout(ids, edges.map((e) => ({ a: e.a, b: e.b })), { width: W, height: H, seed: 1 }),
    [ids, edges]
  );

  if (ids.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-slate-300">No relationships to show yet.</p>
        <p className="text-slate-400 text-sm mt-2">
          {showPlaces
            ? "Open a person and add a relationship, or a meeting resolved to a saved place, to build the web."
            : "Open a person and add a relationship to build the web."}
        </p>
      </div>
    );
  }

  const isDim = (key: string) => selected != null && key !== selected &&
    !edges.some((e) => (e.a === selected && e.b === key) || (e.b === selected && e.a === key));

  const activatePerson = (pid: string) => {
    const key = personKey(pid);
    if (key === selected) onOpen(pid);
    else setSelected(key);
  };
  const activatePlace = (plid: string) => {
    const key = placeKey(plid);
    if (key === selected) onOpenPlace(plid);
    else setSelected(key);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 mb-3">
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Filter by relationship type">
          {FILTER_VALUES.map((t) => (
            <button key={t} {...rovingFilter(t)}
              onClick={() => setFilter(t)}
              className={`px-4 py-2 min-h-[44px] rounded-full text-sm transition-colors ${
                // Detector cross-pairs mutually-exclusive ternary branches. Real pairs, both AA-clear:
                // slate-950 on cyan-400 = 7.87:1; slate-300 on slate-800 = 8.35:1.
                filter === t ? "bg-cyan-400 text-slate-950" : "bg-slate-800 text-slate-300 hover:text-white" // impeccable-disable-line gray-on-color
              }`}>
              {t === "all" ? "All" : RELATIONSHIP_LABEL[t as RelationshipType]}
            </button>
          ))}
        </div>
        <button
          role="switch"
          aria-checked={showPlaces}
          onClick={() => { setShowPlaces((v) => !v); setSelected(null); }}
          className={`px-4 py-2 min-h-[44px] rounded-full text-sm transition-colors ${
            showPlaces ? "bg-cyan-400 text-slate-950" : "bg-slate-800 text-slate-300 hover:text-white" // impeccable-disable-line gray-on-color
          }`}
        >
          Places
        </button>
      </div>

      {/* Labels are HTML, not SVG <text>.
          Text inside a viewBox scales with the box, so on a phone the node
          names rendered around 4px and no font-size or CSS floor could reach
          them — and they ignored the reader's own text-size setting entirely.
          Positioning them as absolutely-placed HTML over the SVG lets them use
          real CSS pixels that respect user zoom, while the SVG keeps the
          geometry. The overlay is aria-hidden and pointer-events-none: each
          node's accessible name and hit target already live on its <g>. */}
      <div className="card p-2 overflow-hidden">
        <div className="relative w-full max-w-md mx-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-md mx-auto block" style={{ touchAction: "pan-y" }}
          role="group" aria-label={showPlaces ? "Relationship and place network" : "Relationship network"}>
          {edges.map((e) => {
            const pa = pos.get(e.a)!; const pb = pos.get(e.b)!;
            const dim = selected != null && e.a !== selected && e.b !== selected;
            return (
              <line key={e.kind === "rel" ? e.rel.id : e.id} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                stroke="#7a6b58" strokeOpacity={dim ? 0.25 : e.kind === "place" ? 0.6 : 1} strokeWidth={1.4}
                strokeDasharray={e.kind === "rel" ? REL_DASH[e.rel.type] : undefined} />
            );
          })}
          {personIds.map((pid) => {
            const key = personKey(pid);
            const p = pos.get(key)!;
            const dim = isDim(key);
            const isSel = key === selected;
            return (
              <g key={key} style={{ cursor: "pointer" }} opacity={dim ? 0.35 : 1}
                onClick={() => activatePerson(pid)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    activatePerson(pid);
                  }
                }}
                tabIndex={0}
                role="button" aria-label={isSel ? `Open ${nameOf(pid)}` : `Highlight ${nameOf(pid)}`}>
                <circle cx={p.x} cy={p.y} r={20} fill="transparent" />
                <circle cx={p.x} cy={p.y} r={13} fill={isSel ? "#b96d33" : "#262019"} stroke="#7a6b58" />
              </g>
            );
          })}
          {/* Places render as a diamond, not a circle — the shape (not a new
              color; still the same slate/copper pair) is what tells a place
              apart from a person at a glance. */}
          {[...placeIds].map((plid) => {
            const key = placeKey(plid);
            const p = pos.get(key)!;
            const dim = isDim(key);
            const isSel = key === selected;
            const r = 16;
            const points = `${p.x},${p.y - r} ${p.x + r},${p.y} ${p.x},${p.y + r} ${p.x - r},${p.y}`;
            return (
              <g key={key} style={{ cursor: "pointer" }} opacity={dim ? 0.35 : 1}
                onClick={() => activatePlace(plid)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    activatePlace(plid);
                  }
                }}
                tabIndex={0}
                role="button" aria-label={isSel ? `Open ${placeNameOf(plid)}` : `Highlight ${placeNameOf(plid)}`}>
                <circle cx={p.x} cy={p.y} r={19} fill="transparent" />
                <polygon points={points} fill={isSel ? "#b96d33" : "#221c17"} stroke="#7a6b58" />
              </g>
            );
          })}
        </svg>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {personIds.map((pid) => {
            const key = personKey(pid);
            const p = pos.get(key)!;
            const isSel = key === selected;
            return (
              <span
                key={key}
                className={`absolute -translate-x-1/2 -translate-y-1/2 text-[11px] leading-none font-medium whitespace-nowrap ${
                  isSel ? "text-slate-950" : "text-slate-200"
                }`}
                style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%`, opacity: isDim(key) ? 0.35 : 1 }}
              >
                {nameOf(pid).split(" ")[0].slice(0, 8)}
              </span>
            );
          })}
          {[...placeIds].map((plid) => {
            const key = placeKey(plid);
            const p = pos.get(key)!;
            const isSel = key === selected;
            return (
              <span
                key={key}
                className={`absolute -translate-x-1/2 -translate-y-1/2 text-[11px] leading-none font-medium whitespace-nowrap ${
                  isSel ? "text-slate-950" : "text-slate-300"
                }`}
                style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%`, opacity: isDim(key) ? 0.35 : 1 }}
              >
                {placeNameOf(plid).split(" ")[0].slice(0, 8)}
              </span>
            );
          })}
        </div>
        </div>
      </div>
      <p className="text-xs text-slate-400 mt-2 text-center">
        {showPlaces
          ? "Tap a person or a place (◇) to highlight their links; tap again to open."
          : "Tap a person to highlight their links; tap again to open."}
      </p>
    </div>
  );
}
