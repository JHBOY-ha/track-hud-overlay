export interface Pt2D {
  x: number;
  y: number;
}

export interface Segment2D {
  ax: number;
  ay: number;
  dx: number;
  dy: number;
  len2: number;
  /** Index of the source polyline (one ID per OSM way / reference layer).
   *  Used by snap to keep matching consistent within a way at junctions. */
  wayId: number;
}

export function buildSegments(polylines: Pt2D[][]): Segment2D[] {
  // Union polylines that meet end-to-end and run roughly collinear into a
  // single wayId. OSM commonly splits one physical road into multiple ways
  // at junctions; unioning them lets the sticky-way snap stay locked
  // across these breaks while still distinguishing real branches (which
  // diverge by more than 30 degrees).
  const N = polylines.length;
  const parent = Array.from({ length: N }, (_, i) => i);
  const find = (i: number): number =>
    parent[i] === i ? i : (parent[i] = find(parent[i]));
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  // For each polyline endpoint, record the unit vector pointing INTO the
  // polyline body (away from the joint). Two polylines join smoothly if
  // their inward vectors at the joint are near-opposite.
  type EndInfo = {
    sx: number; sy: number; sdx: number; sdy: number; // start endpoint
    ex: number; ey: number; edx: number; edy: number; // end endpoint
  };
  const ends: (EndInfo | null)[] = polylines.map(line => {
    if (line.length < 2) return null;
    const s0 = line[0], s1 = line[1];
    const e1 = line[line.length - 2], e0 = line[line.length - 1];
    const sLen = Math.hypot(s1.x - s0.x, s1.y - s0.y) || 1;
    const eLen = Math.hypot(e1.x - e0.x, e1.y - e0.y) || 1;
    return {
      sx: s0.x, sy: s0.y, sdx: (s1.x - s0.x) / sLen, sdy: (s1.y - s0.y) / sLen,
      ex: e0.x, ey: e0.y, edx: (e1.x - e0.x) / eLen, edy: (e1.y - e0.y) / eLen,
    };
  });

  const JOINT_EPS = 1.5;       // metres
  const COLLINEAR_DOT = -0.85; // inward dot inward; ~31 degree tolerance

  for (let i = 0; i < N; i++) {
    const a = ends[i];
    if (!a) continue;
    for (let j = i + 1; j < N; j++) {
      const b = ends[j];
      if (!b) continue;
      const tries: [number, number, number, number, number, number, number, number][] = [
        [a.sx, a.sy, a.sdx, a.sdy, b.sx, b.sy, b.sdx, b.sdy], // a.start <-> b.start
        [a.sx, a.sy, a.sdx, a.sdy, b.ex, b.ey, b.edx, b.edy], // a.start <-> b.end
        [a.ex, a.ey, a.edx, a.edy, b.sx, b.sy, b.sdx, b.sdy], // a.end   <-> b.start
        [a.ex, a.ey, a.edx, a.edy, b.ex, b.ey, b.edx, b.edy], // a.end   <-> b.end
      ];
      for (const [ax, ay, adx, ady, bx, by, bdx, bdy] of tries) {
        if (Math.hypot(ax - bx, ay - by) > JOINT_EPS) continue;
        if (adx * bdx + ady * bdy <= COLLINEAR_DOT) {
          union(i, j);
          break;
        }
      }
    }
  }

  const out: Segment2D[] = [];
  polylines.forEach((line, i) => {
    const wayId = find(i);
    for (let k = 1; k < line.length; k++) {
      const a = line[k - 1];
      const b = line[k];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      out.push({ ax: a.x, ay: a.y, dx, dy, len2: dx * dx + dy * dy, wayId });
    }
  });
  return out;
}

interface Projection {
  sx: number;
  sy: number;
  d2: number;
}

function projectOnto(s: Segment2D, px: number, py: number): Projection {
  let t =
    s.len2 > 0 ? ((px - s.ax) * s.dx + (py - s.ay) * s.dy) / s.len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const sx = s.ax + t * s.dx;
  const sy = s.ay + t * s.dy;
  const ddx = px - sx;
  const ddy = py - sy;
  return { sx, sy, d2: ddx * ddx + ddy * ddy };
}

/** A candidate match for one GPS point: its projection onto one OSM way. */
interface Candidate {
  wayId: number; // -1 == off-road (point kept at its raw position)
  x: number;
  y: number;
  d2: number; // squared distance from the raw point to this projection
}

/**
 * Uniform spatial grid over the segment set, so candidate lookup for a point
 * is O(segments in nearby cells) instead of O(all segments). Each segment is
 * rasterised into every cell its body passes through (plus its endpoints), so
 * a query of the point's cell and its 8 neighbours is guaranteed to surface
 * any segment whose nearest point lies within one cell (= maxDistM).
 */
class SegmentGrid {
  private readonly cell: number;
  private readonly buckets = new Map<string, Segment2D[]>();
  private static key(cx: number, cy: number): string {
    return cx + ',' + cy;
  }

  constructor(segments: Segment2D[], cellSize: number) {
    this.cell = cellSize;
    for (const s of segments) this.insert(s);
  }

  private add(cx: number, cy: number, s: Segment2D): void {
    const k = SegmentGrid.key(cx, cy);
    let arr = this.buckets.get(k);
    if (!arr) this.buckets.set(k, (arr = []));
    arr.push(s);
  }

  private insert(s: Segment2D): void {
    const c = this.cell;
    const ax = s.ax, ay = s.ay, bx = s.ax + s.dx, by = s.ay + s.dy;
    const len = Math.sqrt(s.len2);
    const steps = Math.max(1, Math.ceil((len / c) * 2)); // half-cell stride
    let pcx = NaN, pcy = NaN;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = Math.floor((ax + (bx - ax) * t) / c);
      const cy = Math.floor((ay + (by - ay) * t) / c);
      if (cx !== pcx || cy !== pcy) {
        this.add(cx, cy, s);
        pcx = cx;
        pcy = cy;
      }
    }
  }

  /** All segments registered in the 3x3 block of cells around (px, py). */
  near(px: number, py: number, out: Set<Segment2D>): void {
    const c = this.cell;
    const cx = Math.floor(px / c);
    const cy = Math.floor(py / c);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const arr = this.buckets.get(SegmentGrid.key(cx + dx, cy + dy));
        if (arr) for (const s of arr) out.add(s);
      }
    }
  }
}

/**
 * Snap a GPS polyline onto the OSM road network with an HMM map-matcher
 * (Newson & Krumm, 2009 — the model OSRM/Valhalla-style matchers use),
 * solved globally with the Viterbi algorithm.
 *
 * Why this beats a greedy nearest-segment + hysteresis approach: at a fork
 * the side branch is briefly the *nearest* road, so a per-point matcher
 * flickers onto it and back, shattering the line. Viterbi instead picks the
 * single most-likely road *sequence* over the whole track, weighing two costs:
 *
 *   - Emission cost  d² / (2σ²): how far the point sits from a candidate way.
 *   - Transition cost: a fixed SWITCH_PENALTY for changing ways while both
 *     are still in range, plus |gpsStep − routeStep| / β for movement that
 *     is geometrically inconsistent (e.g. the lateral jump between two
 *     parallel roads). A brief detour onto a fork must pay the switch penalty
 *     twice (in and out), which a couple of points of lower emission can never
 *     recoup — so the path stays on the road actually being driven. A *real*
 *     turn is unaffected: the old way leaves snap range, dropping out as a
 *     candidate, so the switch happens for free.
 *
 * Points with no way within maxDistM keep their original position (an
 * off-road state that resets the chain so re-acquisition afterwards is free).
 */
export function snapPointsToSegments(
  points: Pt2D[],
  segments: Segment2D[],
  maxDistM: number,
): Pt2D[] {
  if (!segments.length || !points.length || maxDistM <= 0) {
    return points.map(p => ({ x: p.x, y: p.y }));
  }
  const maxD2 = maxDistM * maxDistM;

  // --- model parameters -----------------------------------------------------
  // σ: GPS scatter assumed around the true road, in metres. Scaled off the
  //    snap radius so a wider radius tolerates noisier fixes.
  const sigma = Math.max(maxDistM / 2.5, 2);
  const TWO_SIGMA2 = 2 * sigma * sigma;
  // β: tolerance (metres) for inconsistency between the GPS step and the
  //    matched on-road step. Smaller => geometry mismatches are penalised
  //    harder, which discourages lateral hops between parallel roads.
  const BETA = 1;
  // Fixed cost of changing ways while the previous way is still reachable.
  // Large enough that no realistic emission saving inside an overlap zone is
  // worth a transient switch; forced switches (old way out of range) are free.
  const SWITCH_PENALTY = 30;
  // Per-point candidate cap keeps the Viterbi inner loop O(P·C²) bounded even
  // in dense road meshes; the nearest few ways are all that matter.
  const MAX_CANDIDATES = 6;

  const grid = new SegmentGrid(segments, maxDistM);
  const scratch = new Set<Segment2D>();

  // Build per-point candidate ways: the nearest projection on each way within
  // maxDistM (deduped to one entry per wayId). Empty => off-road point.
  const candidatesAt = (p: Pt2D): Candidate[] => {
    scratch.clear();
    grid.near(p.x, p.y, scratch);
    const bestByWay = new Map<number, Candidate>();
    for (const s of scratch) {
      const pr = projectOnto(s, p.x, p.y);
      if (pr.d2 > maxD2) continue;
      const prev = bestByWay.get(s.wayId);
      if (!prev || pr.d2 < prev.d2) {
        bestByWay.set(s.wayId, { wayId: s.wayId, x: pr.sx, y: pr.sy, d2: pr.d2 });
      }
    }
    let cands = [...bestByWay.values()];
    if (cands.length > MAX_CANDIDATES) {
      cands.sort((a, b) => a.d2 - b.d2);
      cands = cands.slice(0, MAX_CANDIDATES);
    }
    return cands;
  };

  const OFF_ROAD = (p: Pt2D): Candidate => ({ wayId: -1, x: p.x, y: p.y, d2: 0 });

  const states: Candidate[][] = points.map(p => {
    const cands = candidatesAt(p);
    return cands.length ? cands : [OFF_ROAD(p)];
  });

  // --- Viterbi forward pass -------------------------------------------------
  const emission = (c: Candidate): number =>
    c.wayId < 0 ? 0 : c.d2 / TWO_SIGMA2;

  const transition = (
    from: Candidate,
    to: Candidate,
    gpsStep: number,
  ): number => {
    // Off-road on either end breaks the on-road chain: no penalty, so the
    // path can drop off and re-acquire any road freely across a gap.
    if (from.wayId < 0 || to.wayId < 0) return 0;
    const routeStep = Math.hypot(to.x - from.x, to.y - from.y);
    let cost = Math.abs(gpsStep - routeStep) / BETA;
    if (from.wayId !== to.wayId) cost += SWITCH_PENALTY;
    return cost;
  };

  const n = points.length;
  // cost[j] = best total cost of a path ending in state j of the current point
  let prevCost = states[0].map(emission);
  const back: number[][] = new Array(n);
  back[0] = states[0].map(() => -1);

  for (let i = 1; i < n; i++) {
    const cur = states[i];
    const prev = states[i - 1];
    const gpsStep = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    const curCost = new Array(cur.length).fill(Infinity);
    const curBack = new Array(cur.length).fill(0);
    for (let k = 0; k < cur.length; k++) {
      const emit = emission(cur[k]);
      let best = Infinity;
      let bestJ = 0;
      for (let j = 0; j < prev.length; j++) {
        const c = prevCost[j] + transition(prev[j], cur[k], gpsStep);
        if (c < best) {
          best = c;
          bestJ = j;
        }
      }
      curCost[k] = best + emit;
      curBack[k] = bestJ;
    }
    prevCost = curCost;
    back[i] = curBack;
  }

  // --- backtrack ------------------------------------------------------------
  let k = 0;
  for (let j = 1; j < prevCost.length; j++) {
    if (prevCost[j] < prevCost[k]) k = j;
  }
  const out: Pt2D[] = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    const c = states[i][k];
    out[i] = { x: c.x, y: c.y };
    k = back[i][k];
  }
  return out;
}
