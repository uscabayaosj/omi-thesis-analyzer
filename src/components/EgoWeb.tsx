"use client";

import { otherId, roleFor, RELATIONSHIP_LABEL, type Relationship, type RelationshipType } from "@/lib/relationships";
import type { Person } from "@/lib/people";

export const REL_DASH: Record<RelationshipType, string> = {
  kin: "0", work: "4 3", neighbor: "8 4", introduced: "1 4", other: "2 6",
};

interface EgoWebProps {
  self: Person;
  rels: Relationship[];
  people: Person[];
  onNavigate: (personId: string) => void;
}

const W = 360;
const H = 240;
const CX = W / 2;
const CY = H / 2;

export default function EgoWeb({ self, rels, people, onNavigate }: EgoWebProps) {
  if (rels.length === 0) return null;
  const nameOf = (pid: string) => people.find((p) => p.id === pid)?.name ?? "Unknown";

  // One ring up to 8 neighbors; a second, larger ring beyond that.
  const nodes = rels.map((r, i) => {
    const oid = otherId(r, self.id);
    const ring = i < 8 ? 0 : 1;
    const inRing = ring === 0 ? Math.min(rels.length, 8) : rels.length - 8;
    const idx = ring === 0 ? i : i - 8;
    const radius = ring === 0 ? 92 : 116;
    const angle = (idx / inRing) * Math.PI * 2 - Math.PI / 2;
    return {
      rel: r, oid,
      x: CX + radius * Math.cos(angle),
      y: CY + radius * Math.sin(angle),
    };
  });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full max-w-md mx-auto block"
      role="group"
      aria-label={`Relationship web for ${self.name}, ${rels.length} ${rels.length === 1 ? "person" : "people"}`}
    >
      <defs>
        <radialGradient id="ego-node" cx="38%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#1e3428" />
          <stop offset="100%" stopColor="#101a14" />
        </radialGradient>
        <radialGradient id="ego-center" cx="38%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#a3cdf0" />
          <stop offset="100%" stopColor="#3a78b4" />
        </radialGradient>
        <filter id="ego-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="4" result="blur" />
          <feFlood floodColor="#5b9bd5" floodOpacity="0.4" result="color" />
          <feComposite in="color" in2="blur" operator="in" result="glow" />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {nodes.map((n) => (
        <line key={`e-${n.rel.id}`} x1={CX} y1={CY} x2={n.x} y2={n.y}
          stroke="#5a7261" strokeWidth={1.5} strokeLinecap="round"
          strokeDasharray={REL_DASH[n.rel.type]} />
      ))}
      {nodes.map((n) => {
        const { otherRole } = roleFor(n.rel, self.id);
        const label = otherRole || RELATIONSHIP_LABEL[n.rel.type];
        return (
          <text key={`l-${n.rel.id}`} x={(CX + n.x) / 2} y={(CY + n.y) / 2 - 3}
            textAnchor="middle" fill="#8a9f8e" fontSize={9}>{label}</text>
        );
      })}
      {nodes.map((n) => {
        const { otherRole } = roleFor(n.rel, self.id);
        const label = otherRole || RELATIONSHIP_LABEL[n.rel.type];
        return (
          <g
            key={`n-${n.rel.id}`}
            onClick={() => onNavigate(n.oid)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onNavigate(n.oid);
              }
            }}
            tabIndex={0}
            role="button"
            aria-label={`Open ${nameOf(n.oid)} — ${label}`}
            style={{ cursor: "pointer" }}
          >
            <circle cx={n.x} cy={n.y} r={30} fill="transparent" />
            <circle cx={n.x} cy={n.y} r={20}
              fill="url(#ego-node)" stroke="#2d3f34" strokeWidth={1.2} />
            <text x={n.x} y={n.y + 3} textAnchor="middle" fill="#d0dbd0" fontSize={10}>
              {nameOf(n.oid).split(" ")[0]}
            </text>
          </g>
        );
      })}
      <circle cx={CX} cy={CY} r={26}
        fill="url(#ego-center)" filter="url(#ego-glow)" />
      <text x={CX} y={CY + 4} textAnchor="middle" fill="#0b110e" fontSize={11} fontWeight={700}>
        {self.name.split(" ")[0]}
      </text>
    </svg>
  );
}
