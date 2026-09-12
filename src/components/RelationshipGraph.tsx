"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRovingRadioGroup } from "@/lib/roving";
import {
  getRelationships, RELATIONSHIP_TYPES, RELATIONSHIP_LABEL,
  type RelationshipType,
} from "@/lib/relationships";
import { REL_DASH } from "@/components/EgoWeb";
import { getPlaces } from "@/lib/places";
import { getMeetingLocations } from "@/lib/meeting-location";
import { groupMeetingsByPlace } from "@/lib/place-resolve";
import type { ForceGraphMethods } from "react-force-graph-2d";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => (
    <div className="w-full flex items-center justify-center" style={{ aspectRatio: "7/5" }}>
      <span className="text-slate-500 text-sm">Loading graph…</span>
    </div>
  ),
});

const FILTER_VALUES = ["all", ...RELATIONSHIP_TYPES] as const;
import type { Person } from "@/lib/people";

interface RelationshipGraphProps {
  people: Person[];
  onOpen: (personId: string) => void;
  onOpenPlace: (placeId: string) => void;
}

const personKey = (id: string) => `p:${id}`;
const placeKey = (id: string) => `pl:${id}`;

const shortName = (name: string) => {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
};

const parseDash = (dash: string): number[] | null => {
  if (dash === "0") return null;
  return dash.split(" ").map(Number);
};

const linkNodeId = (ref: unknown): string =>
  typeof ref === "string" || typeof ref === "number"
    ? String(ref)
    : String((ref as { id?: string })?.id ?? "");

export default function RelationshipGraph({ people, onOpen, onOpenPlace }: RelationshipGraphProps) {
  const [filter, setFilter] = useState<RelationshipType | "all">("all");
  const rovingFilter = useRovingRadioGroup(FILTER_VALUES, filter, setFilter);
  const [showPlaces, setShowPlaces] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  /* ── data layer ── */

  const allRels = useMemo(() => getRelationships(), []);
  const rels = useMemo(
    () => (filter === "all" ? allRels : allRels.filter((r) => r.type === filter)),
    [allRels, filter],
  );

  const nameOf = useMemo(() => {
    const m = new Map(people.map((p) => [p.id, p.name] as const));
    return (id: string) => m.get(id) ?? "Unknown";
  }, [people]);

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
    [rels, relPersonIds],
  );

  const allPlaces = useMemo(() => getPlaces(), []);
  const overrides = useMemo(() => getMeetingLocations(), []);
  const placeEdges = useMemo(() => {
    if (!showPlaces) return [];
    const out: { personId: string; placeId: string; count: number }[] = [];
    for (const person of people) {
      for (const g of groupMeetingsByPlace(person.meetings, allPlaces, overrides)) {
        if (g.place) out.push({ personId: person.id, placeId: g.place.id, count: g.meetings.length });
      }
    }
    return out;
  }, [showPlaces, people, allPlaces, overrides]);

  const placeIds = useMemo(() => new Set(placeEdges.map((e) => e.placeId)), [placeEdges]);
  const placePersonIds = useMemo(() => new Set(placeEdges.map((e) => e.personId)), [placeEdges]);
  const personIds = useMemo(
    () => [...new Set([...relPersonIds, ...placePersonIds])],
    [relPersonIds, placePersonIds],
  );

  const placeNameOf = useMemo(() => {
    const m = new Map(allPlaces.map((p) => [p.id, p.name] as const));
    return (id: string) => m.get(id) ?? "Unknown place";
  }, [allPlaces]);

  const ids = useMemo(
    () => [...personIds.map(personKey), ...[...placeIds].map(placeKey)],
    [personIds, placeIds],
  );

  const edges = useMemo(() => [
    ...relEdges,
    ...placeEdges.map((e) => ({
      a: personKey(e.personId), b: placeKey(e.placeId), kind: "place" as const,
      id: `${e.personId}:${e.placeId}`,
    })),
  ], [relEdges, placeEdges]);

  /* ── degree computation ── */

  const degree = useMemo(() => {
    const d = new Map<string, number>();
    for (const e of edges) {
      d.set(e.a, (d.get(e.a) ?? 0) + 1);
      d.set(e.b, (d.get(e.b) ?? 0) + 1);
    }
    return d;
  }, [edges]);
  const maxDeg = useMemo(() => Math.max(...degree.values(), 1), [degree]);

  /* ── graph data for ForceGraph2D ── */

  const graphData = useMemo(() => ({
    nodes: [
      ...personIds.map((pid) => ({
        id: personKey(pid),
        name: nameOf(pid),
        kind: "person" as const,
        deg: degree.get(personKey(pid)) ?? 1,
      })),
      ...[...placeIds].map((plid) => ({
        id: placeKey(plid),
        name: placeNameOf(plid),
        kind: "place" as const,
        deg: degree.get(placeKey(plid)) ?? 1,
      })),
    ],
    links: [
      ...relEdges.map((e) => ({
        source: e.a,
        target: e.b,
        kind: "rel" as const,
        relType: e.rel.type as RelationshipType,
      })),
      ...placeEdges.map((e) => ({
        source: personKey(e.personId),
        target: placeKey(e.placeId),
        kind: "place" as const,
        relType: undefined as RelationshipType | undefined,
      })),
    ],
  }), [personIds, placeIds, relEdges, placeEdges, nameOf, placeNameOf, degree]);

  /* ── container sizing ── */

  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState(() => {
    if (typeof window !== "undefined") {
      const w = Math.min(window.innerWidth - 32, 700);
      return { w, h: Math.round(w * 5 / 7) };
    }
    return { w: 400, h: 286 };
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const { width } = el.getBoundingClientRect();
      if (width > 0) setDims({ w: width, h: Math.round(width * 5 / 7) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── graph ref ── */

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<ForceGraphMethods<any, any>>(undefined);

  // Configure d3 forces and fit view when data changes.
  useEffect(() => {
    const t = setTimeout(() => {
      const g = graphRef.current;
      if (!g) return;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const charge = g.d3Force("charge") as any;
        if (charge?.strength) charge.strength(-120);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const link = g.d3Force("link") as any;
        if (link?.distance) link.distance(60);
        g.d3ReheatSimulation();
      } catch { /* force-graph may not be ready yet */ }
    }, 80);
    return () => clearTimeout(t);
  }, [graphData]);

  // Initial fit + re-fit on data change.
  useEffect(() => {
    const t = setTimeout(() => graphRef.current?.zoomToFit(400, 50), 800);
    return () => clearTimeout(t);
  }, [graphData]);

  /* ── interaction helpers ── */

  const isDim = useCallback((key: string) =>
    selected != null && key !== selected &&
    !edges.some((e) => (e.a === selected && e.b === key) || (e.b === selected && e.a === key)),
    [selected, edges],
  );

  const handleNodeClick = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (node: any) => {
      const key = node.id as string;
      if (key === selected) {
        if (key.startsWith("p:")) onOpen(key.slice(2));
        else if (key.startsWith("pl:")) onOpenPlace(key.slice(3));
      } else {
        setSelected(key);
      }
    },
    [selected, onOpen, onOpenPlace],
  );

  const displayId = selected ?? hovered;
  const displayName = displayId
    ? (displayId.startsWith("p:") ? nameOf(displayId.slice(2)) : placeNameOf(displayId.slice(3)))
    : null;

  /* ── custom node canvas rendering ── */

  const nodeCanvasObject = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      try { // guard transient NaN positions during force simulation ticks
        const x = node.x as number;
      const y = node.y as number;
      const deg = Number(node.deg) || 1;
      const r = 3 + 5 * (deg / maxDeg);
      if (!isFinite(x) || !isFinite(y) || !isFinite(r)) return;
      const key = node.id as string;
      const isSel = key === selected;
      const isHov = key === hovered && !isSel;
      const dim = isDim(key);

      ctx.save();
      if (dim) ctx.globalAlpha = 0.18;

      // Glow
      if (isSel || isHov) {
        ctx.shadowColor = "#d99a5e";
        ctx.shadowBlur = isSel ? 16 : 8;
      }

      // Gradient fill
      const grad = ctx.createRadialGradient(x - r * 0.2, y - r * 0.3, r * 0.1, x, y, r);
      if (isSel) {
        grad.addColorStop(0, "#e6b988");
        grad.addColorStop(1, "#8a4d1f");
      } else if (node.kind === "place") {
        grad.addColorStop(0, "#33291e");
        grad.addColorStop(1, "#151210");
      } else {
        grad.addColorStop(0, "#3d3228");
        grad.addColorStop(1, "#1a1510");
      }

      ctx.beginPath();
      if (node.kind === "place") {
        const s = r * 1.3;
        ctx.moveTo(x, y - s);
        ctx.lineTo(x + s, y);
        ctx.lineTo(x, y + s);
        ctx.lineTo(x - s, y);
        ctx.closePath();
      } else {
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fillStyle = grad;
      ctx.fill();

      // Stroke
      ctx.shadowBlur = 0;
      ctx.strokeStyle = isSel ? "#d99a5e" : isHov ? "#7a6b58" : "#5a4e3f";
      ctx.lineWidth = (isSel ? 1.5 : 0.7) / globalScale;
      ctx.stroke();

      // Label — visible when the node's screen-size is large enough
      const screenR = r * globalScale;
      if (screenR > 6) {
        const label = shortName(node.name as string);
        const fontSize = Math.max(2.5, Math.min(4, 11 / globalScale));
        ctx.font = `${isSel ? 600 : 400} ${fontSize}px -apple-system, "SF Pro Text", system-ui, sans-serif`;
        ctx.fillStyle = isSel ? "#e6b988" : "#a89a88";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(label, x, y + r + 1.5);
      }

        ctx.restore();
      } catch (_e) { /* skip */ }
    },
    [selected, hovered, maxDeg, isDim],
  );

  // Hit area: slightly larger than the visible node.
  const nodePointerAreaPaint = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (node: any, color: string, ctx: CanvasRenderingContext2D) => {
      const x = node.x as number;
      const y = node.y as number;
      const deg = Number(node.deg) || 1;
      const r = 3 + 5 * (deg / maxDeg);
      if (!isFinite(x) || !isFinite(y) || !isFinite(r)) return;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r + 3, 0, Math.PI * 2);
      ctx.fill();
    },
    [maxDeg],
  );

  /* ── link styling (built-in props) ── */

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linkColor = useCallback((link: any) => {
    const srcId = linkNodeId(link.source);
    const tgtId = linkNodeId(link.target);
    const dim = selected != null && srcId !== selected && tgtId !== selected;
    const lit = selected != null && (srcId === selected || tgtId === selected);
    if (dim) return "rgba(122,107,88,0.08)";
    if (lit) return "rgba(217,154,94,0.85)";
    if (link.kind === "place") return "rgba(122,107,88,0.35)";
    return "rgba(122,107,88,0.55)";
  }, [selected]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linkWidth = useCallback((link: any) => {
    const srcId = linkNodeId(link.source);
    const tgtId = linkNodeId(link.target);
    const lit = selected != null && (srcId === selected || tgtId === selected);
    return lit ? 2 : 1;
  }, [selected]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linkDash = useCallback((link: any) => {
    if (link.kind !== "rel" || !link.relType) return null;
    return parseDash(REL_DASH[link.relType as RelationshipType]);
  }, []);

  /* ── zoom controls ── */

  const zoomIn = () => {
    const cur = graphRef.current?.zoom() ?? 1;
    graphRef.current?.zoom(cur * 1.4, 300);
  };
  const zoomOut = () => {
    const cur = graphRef.current?.zoom() ?? 1;
    graphRef.current?.zoom(cur / 1.4, 300);
  };
  const fitAll = () => graphRef.current?.zoomToFit(400, 50);

  /* ── empty state ── */

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

  return (
    <div>
      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center gap-1 mb-3">
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Filter by relationship type">
          {FILTER_VALUES.map((t) => (
            <button key={t} {...rovingFilter(t)}
              onClick={() => setFilter(t)}
              className={`px-4 py-2 min-h-[44px] rounded-full text-sm transition-colors ${
                filter === t ? "bg-cyan-400 text-slate-950" : "bg-slate-800 text-slate-300 hover:text-white" // impeccable-disable-line gray-on-color
              }`}>
              {t === "all" ? "All" : RELATIONSHIP_LABEL[t as RelationshipType]}
            </button>
          ))}
        </div>
        <button
          role="switch" aria-checked={showPlaces}
          onClick={() => { setShowPlaces((v) => !v); setSelected(null); }}
          className={`px-4 py-2 min-h-[44px] rounded-full text-sm transition-colors ${
            showPlaces ? "bg-cyan-400 text-slate-950" : "bg-slate-800 text-slate-300 hover:text-white" // impeccable-disable-line gray-on-color
          }`}
        >
          Places
        </button>
      </div>

      {/* Graph viewport */}
      <div
        ref={containerRef}
        className="card overflow-hidden relative"
        style={{ aspectRatio: "7/5" }}
        role="group"
        aria-label={showPlaces ? "Relationship and place network" : "Relationship network"}
      >
        {/* Name banner */}
        {displayName && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-slate-900/90 border border-slate-700 px-3 py-1.5 rounded-full text-sm text-slate-200 font-medium pointer-events-none whitespace-nowrap max-w-[80%] overflow-hidden text-ellipsis">
            {displayName}
          </div>
        )}

        <ForceGraph2D
          ref={graphRef as React.MutableRefObject<ForceGraphMethods | undefined>}
          graphData={graphData}
          width={dims.w}
          height={dims.h}
          backgroundColor="#221c17"

          // Nodes
          nodeCanvasObject={nodeCanvasObject}
          nodeCanvasObjectMode={() => "replace"}
          nodePointerAreaPaint={nodePointerAreaPaint}
          nodeLabel=""

          // Links
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkLineDash={linkDash}
          linkCurvature={0}

          // Force engine
          warmupTicks={60}
          cooldownTime={5000}
          d3AlphaDecay={0.03}
          d3VelocityDecay={0.3}

          // Zoom
          minZoom={0.3}
          maxZoom={10}

          // Interaction
          onNodeClick={handleNodeClick}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onNodeHover={(node: any) => setHovered(node?.id != null ? String(node.id) : null)}
          onBackgroundClick={() => setSelected(null)}
          enableNodeDrag
          enableZoomInteraction
          enablePanInteraction

          onEngineStop={() => graphRef.current?.zoomToFit(500, 50)}
        />

        {/* Zoom controls — 44pt touch targets */}
        <div className="absolute bottom-3 right-3 flex flex-col gap-1.5 z-10">
          <button onClick={zoomIn} aria-label="Zoom in"
            className="w-11 h-11 rounded-xl bg-slate-900/80 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800/90 active:bg-slate-700/90 flex items-center justify-center text-lg font-light transition-colors backdrop-blur-sm">
            +
          </button>
          <button onClick={zoomOut} aria-label="Zoom out"
            className="w-11 h-11 rounded-xl bg-slate-900/80 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800/90 active:bg-slate-700/90 flex items-center justify-center text-lg font-light transition-colors backdrop-blur-sm">
            &minus;
          </button>
          <button onClick={fitAll} aria-label="Fit all nodes"
            className="w-11 h-11 rounded-xl bg-slate-900/80 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800/90 active:bg-slate-700/90 flex items-center justify-center transition-colors backdrop-blur-sm">
            <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 1H1v3M10 1h3v3M4 13H1v-3M10 13h3v-3" />
            </svg>
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-400 mt-2 text-center">
        Tap to highlight, again to open. Drag nodes to reposition. Pinch or scroll to zoom.
      </p>
    </div>
  );
}
