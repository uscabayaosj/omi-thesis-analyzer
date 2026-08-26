// Pure, dependency-free force-directed layout. Deterministic given a seed so
// the graph doesn't reshuffle on every render. Imports nothing from the app.

export interface LayoutNode { id: string; x: number; y: number }
export interface LayoutEdge { a: string; b: string }

// Small seeded PRNG (mulberry32) — avoids Math.random so layouts are stable.
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function computeLayout(
  ids: string[],
  edges: LayoutEdge[],
  opts: { width?: number; height?: number; iterations?: number; seed?: number } = {}
): Map<string, { x: number; y: number }> {
  const width = opts.width ?? 600;
  const height = opts.height ?? 400;
  const iterations = opts.iterations ?? 150;
  const rand = mulberry32(opts.seed ?? 1);
  const cx = width / 2;
  const cy = height / 2;

  // Seed on a circle so no two nodes are coincident (avoids NaN forces).
  const pos = new Map<string, { x: number; y: number }>();
  const R = Math.min(width, height) / 3;
  ids.forEach((id, i) => {
    const a = (i / Math.max(1, ids.length)) * Math.PI * 2;
    pos.set(id, {
      x: cx + R * Math.cos(a) + (rand() - 0.5) * 2,
      y: cy + R * Math.sin(a) + (rand() - 0.5) * 2,
    });
  });

  if (ids.length <= 1) return pos;

  const REPULSION = 4000;
  const SPRING = 0.02;
  const SPRING_LEN = 90;
  const CENTER_PULL = 0.008;

  for (let iter = 0; iter < iterations; iter++) {
    const disp = new Map<string, { dx: number; dy: number }>();
    ids.forEach((id) => disp.set(id, { dx: 0, dy: 0 }));

    // Pairwise repulsion.
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const pi = pos.get(ids[i])!;
        const pj = pos.get(ids[j])!;
        let dx = pi.x - pj.x;
        let dy = pi.y - pj.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = rand(); dy = rand(); d2 = dx * dx + dy * dy; }
        const force = REPULSION / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * force;
        const fy = (dy / d) * force;
        disp.get(ids[i])!.dx += fx; disp.get(ids[i])!.dy += fy;
        disp.get(ids[j])!.dx -= fx; disp.get(ids[j])!.dy -= fy;
      }
    }

    // Spring edges.
    for (const e of edges) {
      const pa = pos.get(e.a); const pb = pos.get(e.b);
      if (!pa || !pb) continue;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const force = SPRING * (d - SPRING_LEN);
      const fx = (dx / d) * force;
      const fy = (dy / d) * force;
      disp.get(e.a)!.dx += fx; disp.get(e.a)!.dy += fy;
      disp.get(e.b)!.dx -= fx; disp.get(e.b)!.dy -= fy;
    }

    // Weak centering + integrate with cooling.
    const cooling = 1 - iter / iterations;
    for (const id of ids) {
      const p = pos.get(id)!;
      const dp = disp.get(id)!;
      dp.dx += (cx - p.x) * CENTER_PULL;
      dp.dy += (cy - p.y) * CENTER_PULL;
      const step = 4 * cooling;
      const mag = Math.hypot(dp.dx, dp.dy) || 1;
      p.x += (dp.dx / mag) * Math.min(mag, step * 6);
      p.y += (dp.dy / mag) * Math.min(mag, step * 6);
    }
  }
  return pos;
}
