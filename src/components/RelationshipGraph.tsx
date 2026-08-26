"use client";

import { useMemo, useState } from "react";
import { computeLayout } from "@/lib/graph-layout";
import {
  getRelationships, RELATIONSHIP_TYPES, RELATIONSHIP_LABEL,
  type RelationshipType,
} from "@/lib/relationships";
import { REL_DASH } from "@/components/EgoWeb";
import type { Person } from "@/lib/people";

interface RelationshipGraphProps {
  people: Person[];
  onOpen: (personId: string) => void;
}

const W = 600;
const H = 460;

export default function RelationshipGraph({ people, onOpen }: RelationshipGraphProps) {
  const [filter, setFilter] = useState<RelationshipType | "all">("all");
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

  // Only people that appear in at least one (filtered) edge, and that still exist.
  const ids = useMemo(() => {
    const alive = new Set(people.map((p) => p.id));
    const s = new Set<string>();
    for (const r of rels) {
      if (alive.has(r.aId) && alive.has(r.bId)) { s.add(r.aId); s.add(r.bId); }
    }
    return [...s];
  }, [rels, people]);

  const edges = useMemo(
    () => rels.filter((r) => ids.includes(r.aId) && ids.includes(r.bId)).map((r) => ({ a: r.aId, b: r.bId, rel: r })),
    [rels, ids]
  );

  const pos = useMemo(
    () => computeLayout(ids, edges.map((e) => ({ a: e.a, b: e.b })), { width: W, height: H, seed: 1 }),
    [ids, edges]
  );

  if (ids.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-slate-300">No relationships to show yet.</p>
        <p className="text-slate-400 text-sm mt-2">Open a person and add a relationship to build the web.</p>
      </div>
    );
  }

  const isDim = (pid: string) => selected != null && pid !== selected &&
    !edges.some((e) => (e.a === selected && e.b === pid) || (e.b === selected && e.a === pid));

  const activate = (pid: string) => {
    if (pid === selected) onOpen(pid);
    else setSelected(pid);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-3" role="radiogroup" aria-label="Filter by relationship type">
        {(["all", ...RELATIONSHIP_TYPES] as const).map((t) => (
          <button key={t} role="radio" aria-checked={filter === t}
            onClick={() => setFilter(t)}
            className={`px-4 py-2 min-h-[44px] rounded-full text-sm transition-colors ${
              filter === t ? "bg-cyan-400 text-slate-950" : "bg-slate-800 text-slate-300 hover:text-white"
            }`}>
            {t === "all" ? "All" : RELATIONSHIP_LABEL[t as RelationshipType]}
          </button>
        ))}
      </div>

      <div className="card p-2 overflow-hidden">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" style={{ touchAction: "pan-y" }}
          role="group" aria-label="Relationship network">
          {edges.map((e) => {
            const pa = pos.get(e.a)!; const pb = pos.get(e.b)!;
            const dim = selected != null && e.a !== selected && e.b !== selected;
            return (
              <line key={e.rel.id} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                stroke="#4d4133" strokeOpacity={dim ? 0.25 : 1} strokeWidth={1.4}
                strokeDasharray={REL_DASH[e.rel.type]} />
            );
          })}
          {ids.map((pid) => {
            const p = pos.get(pid)!;
            const dim = isDim(pid);
            const isSel = pid === selected;
            return (
              <g key={pid} style={{ cursor: "pointer" }} opacity={dim ? 0.35 : 1}
                onClick={() => activate(pid)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    activate(pid);
                  }
                }}
                tabIndex={0}
                role="button" aria-label={isSel ? `Open ${nameOf(pid)}` : `Highlight ${nameOf(pid)}`}>
                <circle cx={p.x} cy={p.y} r={18} fill={isSel ? "#b96d33" : "#262019"} stroke="#4d4133" />
                <text x={p.x} y={p.y + 3} textAnchor="middle" fontSize={9}
                  fill={isSel ? "#14100d" : "#dcd2bf"}>{nameOf(pid).split(" ")[0].slice(0, 8)}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="text-xs text-slate-400 mt-2 text-center">
        Tap a person to highlight their links; tap again to open.
      </p>
    </div>
  );
}
