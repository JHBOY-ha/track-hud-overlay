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

// Snap each point onto the nearest reference segment when within maxDistM.
//
// Two heuristics keep junctions stable:
//   1. Sticky way: once a point has snapped to OSM way W, subsequent
//      points stay on W unless the best off-way candidate is meaningfully
//      closer (by ratio AND absolute margin). Prevents flicker into short
//      side branches that pass within snap distance.
//   2. Smoothing pass: short wrong-way islands surrounded by the same
//      neighbour way are reassigned back if that neighbour way is reachable
//      within maxDistM for the whole island.
//
// Points beyond maxDistM keep their original position.
export function snapPointsToSegments(
  points: Pt2D[],
  segments: Segment2D[],
  maxDistM: number,
): Pt2D[] {
  if (!segments.length || !points.length || maxDistM <= 0) {
    return points.map(p => ({ x: p.x, y: p.y }));
  }
  const maxD2 = maxDistM * maxDistM;
  // Switching ways requires the new candidate to win on BOTH a ratio
  // (<=40% of own d2) AND an absolute margin (>=0.5 m2 better) for K
  // consecutive samples. K provides temporal hysteresis: 1-2 sample
  // blips at junctions never commit a switch.
  const STICKY_RATIO = 0.4;
  const STICKY_MARGIN2 = 0.5;
  const SWITCH_HOLD = 4;
  const SHORT_ISLAND_MAX_POINTS = 200;
  const SHORT_ISLAND_MAX_DIST_M = 10;

  // Group segments by wayId so we can quickly do "best on this way".
  const byWay = new Map<number, Segment2D[]>();
  for (const s of segments) {
    let arr = byWay.get(s.wayId);
    if (!arr) byWay.set(s.wayId, (arr = []));
    arr.push(s);
  }

  const bestOnWay = (wayId: number, p: Pt2D): Projection | null => {
    const waySegs = byWay.get(wayId);
    if (!waySegs) return null;
    let best: Projection | null = null;
    for (const s of waySegs) {
      const pr = projectOnto(s, p.x, p.y);
      if (!best || pr.d2 < best.d2) best = pr;
    }
    return best;
  };

  type Snap = {
    x: number;
    y: number;
    wayId: number; // -1 == unsnapped
    d2: number;
  };

  const first: Snap[] = points.map(p => {
    let bestD2 = Infinity;
    let bestSx = p.x;
    let bestSy = p.y;
    let bestWay = -1;
    for (const s of segments) {
      const pr = projectOnto(s, p.x, p.y);
      if (pr.d2 < bestD2) {
        bestD2 = pr.d2;
        bestSx = pr.sx;
        bestSy = pr.sy;
        bestWay = s.wayId;
      }
    }
    if (bestD2 > maxD2) return { x: p.x, y: p.y, wayId: -1, d2: bestD2 };
    return { x: bestSx, y: bestSy, wayId: bestWay, d2: bestD2 };
  });

  // Sticky-way pass with temporal hysteresis.
  let curWay = -1;
  let pendingWay = -1;
  let pendingCount = 0;
  const sticky: Snap[] = points.map((p, i) => {
    const ownBest = curWay >= 0 ? bestOnWay(curWay, p) : null;
    const fb = first[i];
    if (fb.wayId < 0) {
      // Out of reach for any way.
      curWay = -1;
      pendingWay = -1;
      pendingCount = 0;
      return fb;
    }
    if (curWay < 0) {
      curWay = fb.wayId;
      pendingWay = -1;
      pendingCount = 0;
      return fb;
    }
    if (fb.wayId === curWay) {
      pendingWay = -1;
      pendingCount = 0;
      return fb;
    }
    // We've drifted off our current way; best global is on a different
    // way. Decide whether to switch.
    const ownReachable = ownBest !== null && ownBest.d2 <= maxD2;
    const winsRatio = ownBest ? fb.d2 < STICKY_RATIO * ownBest.d2 : true;
    const winsMargin = ownBest ? ownBest.d2 - fb.d2 >= STICKY_MARGIN2 : true;
    const candidateBeatsOwn = !ownReachable || (winsRatio && winsMargin);

    if (!ownReachable) {
      // We've fallen off the current way entirely. Switch immediately.
      curWay = fb.wayId;
      pendingWay = -1;
      pendingCount = 0;
      return fb;
    }
    if (candidateBeatsOwn) {
      if (pendingWay === fb.wayId) pendingCount++;
      else { pendingWay = fb.wayId; pendingCount = 1; }
      if (pendingCount >= SWITCH_HOLD) {
        curWay = fb.wayId;
        pendingWay = -1;
        pendingCount = 0;
        return fb;
      }
    } else {
      pendingWay = -1;
      pendingCount = 0;
    }
    // Hold on the current way until hysteresis is satisfied.
    return { x: ownBest!.sx, y: ownBest!.sy, wayId: curWay, d2: ownBest!.d2 };
  });

  // Smoothing pass: a short island on way B surrounded by way A is flipped
  // back to A when A remains reachable throughout the island. This catches
  // fork-side GPS drift that lasts longer than SWITCH_HOLD but only covers
  // a few metres.
  const ways = sticky.map(s => s.wayId);
  for (let start = 0; start < sticky.length;) {
    let end = start + 1;
    while (end < sticky.length && ways[end] === ways[start]) end++;

    const islandWay = ways[start];
    const surroundingWay =
      start > 0 && end < sticky.length && ways[start - 1] === ways[end]
        ? ways[start - 1]
        : -1;

    if (islandWay >= 0 && surroundingWay >= 0 && islandWay !== surroundingWay) {
      const pointCount = end - start;
      let islandDist = 0;
      for (let i = start + 1; i < end; i++) {
        islandDist += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      }
      if (pointCount <= SHORT_ISLAND_MAX_POINTS && islandDist <= SHORT_ISLAND_MAX_DIST_M) {
        const replacements: Snap[] = [];
        for (let i = start; i < end; i++) {
          const best = bestOnWay(surroundingWay, points[i]);
          if (!best || best.d2 > maxD2) {
            replacements.length = 0;
            break;
          }
          replacements.push({ x: best.sx, y: best.sy, wayId: surroundingWay, d2: best.d2 });
        }
        if (replacements.length === pointCount) {
          for (let i = start; i < end; i++) {
            sticky[i] = replacements[i - start];
            ways[i] = surroundingWay;
          }
        }
      }
    }

    start = end;
  }

  return sticky.map(s => ({ x: s.x, y: s.y }));
}
