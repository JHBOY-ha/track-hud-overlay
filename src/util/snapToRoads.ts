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
}

export function buildSegments(polylines: Pt2D[][]): Segment2D[] {
  const out: Segment2D[] = [];
  for (const line of polylines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      out.push({ ax: a.x, ay: a.y, dx, dy, len2: dx * dx + dy * dy });
    }
  }
  return out;
}

// Snap each point onto the nearest reference segment when within maxDistM.
// Points beyond the threshold keep their original position so wrong-road
// snaps on parallel or nearby roads are avoided.
export function snapPointsToSegments(
  points: Pt2D[],
  segments: Segment2D[],
  maxDistM: number,
): Pt2D[] {
  if (!segments.length || !points.length || maxDistM <= 0) {
    return points.map(p => ({ x: p.x, y: p.y }));
  }
  const maxD2 = maxDistM * maxDistM;
  return points.map(p => {
    let bestD2 = Infinity;
    let bx = p.x;
    let by = p.y;
    for (const s of segments) {
      let t =
        s.len2 > 0
          ? ((p.x - s.ax) * s.dx + (p.y - s.ay) * s.dy) / s.len2
          : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const sx = s.ax + t * s.dx;
      const sy = s.ay + t * s.dy;
      const ddx = p.x - sx;
      const ddy = p.y - sy;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < bestD2) {
        bestD2 = d2;
        bx = sx;
        by = sy;
      }
    }
    return bestD2 <= maxD2 ? { x: bx, y: by } : { x: p.x, y: p.y };
  });
}
