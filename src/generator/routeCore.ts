export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface RoadPoint extends GeoPoint {
  nodeId: string;
}

export interface Road {
  id: string;
  name: string;
  highway: string;
  points: RoadPoint[];
}

export interface RouteMark {
  id: number;
  timeMs: number;
  roadId: string;
  segmentIndex: number;
  segmentT: number;
  point: GeoPoint;
}

export interface TimedRoutePoint extends GeoPoint {
  timeMs: number;
  progress: number;
}

export interface RouteResult {
  path: GeoPoint[];
  samples: TimedRoutePoint[];
  lengthM: number;
  disconnectedPair: number | null;
}

interface Edge {
  to: string;
  distance: number;
}

const keyForMark = (mark: RouteMark) => `mark:${mark.id}`;

export function distanceM(a: GeoPoint, b: GeoPoint): number {
  const lat = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const dx = (b.lon - a.lon) * 111320 * Math.cos(lat);
  const dy = (b.lat - a.lat) * 110540;
  return Math.hypot(dx, dy);
}

export function pathLength(points: GeoPoint[]): number {
  return points.slice(1).reduce((sum, point, i) => sum + distanceM(points[i], point), 0);
}

export function projectToRoad(target: GeoPoint, roads: Road[]): Omit<RouteMark, 'id' | 'timeMs'> | null {
  let best: (Omit<RouteMark, 'id' | 'timeMs'> & { distance: number }) | null = null;
  for (const road of roads) {
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1];
      const b = road.points[i];
      const lat = ((a.lat + b.lat + target.lat) / 3) * Math.PI / 180;
      const sx = (b.lon - a.lon) * 111320 * Math.cos(lat);
      const sy = (b.lat - a.lat) * 110540;
      const px = (target.lon - a.lon) * 111320 * Math.cos(lat);
      const py = (target.lat - a.lat) * 110540;
      const len2 = sx * sx + sy * sy;
      const t = Math.max(0, Math.min(1, len2 ? (px * sx + py * sy) / len2 : 0));
      const point = { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
      const distance = distanceM(target, point);
      if (!best || distance < best.distance) {
        best = { roadId: road.id, segmentIndex: i - 1, segmentT: t, point, distance };
      }
    }
  }
  if (!best) return null;
  const { distance: _distance, ...projection } = best;
  return projection;
}

function buildGraph(roads: Road[], marks: RouteMark[]) {
  const graph = new Map<string, Edge[]>();
  const points = new Map<string, GeoPoint>();
  const add = (from: string, to: string, a: GeoPoint, b: GeoPoint) => {
    points.set(from, a);
    points.set(to, b);
    const distance = distanceM(a, b);
    graph.set(from, [...(graph.get(from) ?? []), { to, distance }]);
    graph.set(to, [...(graph.get(to) ?? []), { to: from, distance }]);
  };

  for (const road of roads) {
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1];
      const b = road.points[i];
      const segmentMarks = marks
        .filter(mark => mark.roadId === road.id && mark.segmentIndex === i - 1)
        .sort((x, y) => x.segmentT - y.segmentT);
      const chain = [
        { key: `node:${a.nodeId}`, point: a },
        ...segmentMarks.map(mark => ({ key: keyForMark(mark), point: mark.point })),
        { key: `node:${b.nodeId}`, point: b },
      ];
      for (let j = 1; j < chain.length; j++) add(chain[j - 1].key, chain[j].key, chain[j - 1].point, chain[j].point);
    }
  }
  return { graph, points };
}

function shortestPath(
  graph: Map<string, Edge[]>,
  points: Map<string, GeoPoint>,
  start: string,
  end: string,
): GeoPoint[] {
  if (start === end) return [points.get(start)!];
  const distances = new Map<string, number>([[start, 0]]);
  const previous = new Map<string, string>();
  const queue = new Set(graph.keys());
  while (queue.size) {
    let current = '';
    let best = Infinity;
    for (const candidate of queue) {
      const distance = distances.get(candidate) ?? Infinity;
      if (distance < best) { current = candidate; best = distance; }
    }
    if (!current || current === end) break;
    queue.delete(current);
    for (const edge of graph.get(current) ?? []) {
      const next = best + edge.distance;
      if (next < (distances.get(edge.to) ?? Infinity)) {
        distances.set(edge.to, next);
        previous.set(edge.to, current);
      }
    }
  }
  if (!previous.has(end)) return [];
  const keys = [end];
  while (keys[0] !== start) keys.unshift(previous.get(keys[0])!);
  return keys.map(key => points.get(key)!);
}

function pointAtDistance(points: GeoPoint[], target: number): GeoPoint {
  let passed = 0;
  for (let i = 1; i < points.length; i++) {
    const length = distanceM(points[i - 1], points[i]);
    if (passed + length >= target) {
      const t = length ? (target - passed) / length : 0;
      return {
        lat: points[i - 1].lat + (points[i].lat - points[i - 1].lat) * t,
        lon: points[i - 1].lon + (points[i].lon - points[i - 1].lon) * t,
      };
    }
    passed += length;
  }
  return points[points.length - 1];
}

export function buildTimedRoute(roads: Road[], inputMarks: RouteMark[], sampleHz = 10): RouteResult {
  const marks = [...inputMarks].sort((a, b) => a.timeMs - b.timeMs);
  if (marks.length < 2) return { path: [], samples: [], lengthM: 0, disconnectedPair: null };
  const { graph, points } = buildGraph(roads, marks);
  const segments: Array<{ points: GeoPoint[]; startMs: number; endMs: number; length: number }> = [];
  const path: GeoPoint[] = [];
  for (let i = 1; i < marks.length; i++) {
    const segment = shortestPath(graph, points, keyForMark(marks[i - 1]), keyForMark(marks[i]));
    if (!segment.length) return { path: [], samples: [], lengthM: 0, disconnectedPair: i - 1 };
    const length = pathLength(segment);
    segments.push({ points: segment, startMs: marks[i - 1].timeMs, endMs: marks[i].timeMs, length });
    path.push(...(path.length ? segment.slice(1) : segment));
  }
  const lengthM = segments.reduce((sum, segment) => sum + segment.length, 0);
  const intervalMs = 1000 / sampleHz;
  const samples: TimedRoutePoint[] = [];
  let distanceBefore = 0;
  for (const segment of segments) {
    const duration = segment.endMs - segment.startMs;
    const count = Math.max(1, Math.round(duration / intervalMs));
    for (let i = 0; i <= count; i++) {
      if (samples.length && i === 0) continue;
      const fraction = i / count;
      const point = pointAtDistance(segment.points, segment.length * fraction);
      samples.push({
        ...point,
        timeMs: segment.startMs + duration * fraction,
        progress: lengthM ? (distanceBefore + segment.length * fraction) / lengthM : 0,
      });
    }
    distanceBefore += segment.length;
  }
  if (samples.length) samples[samples.length - 1].progress = 1;
  return { path, samples, lengthM, disconnectedPair: null };
}

export function buildHudGeoJson(
  roads: Road[],
  route: RouteResult,
  center: GeoPoint,
  radiusM: number,
  sampleHz = 10,
) {
  const latDelta = radiusM / 110540;
  const lonDelta = radiusM / (111320 * Math.cos(center.lat * Math.PI / 180));
  return {
    type: 'FeatureCollection',
    properties: {
      center,
      radius_m: radiusM,
      sample_hz: sampleHz,
      source_url: `https://www.openstreetmap.org/api/0.6/map?bbox=${center.lon-lonDelta},${center.lat-latDelta},${center.lon+lonDelta},${center.lat+latDelta}`,
      source_license: 'OpenStreetMap contributors, ODbL',
    },
    features: [
      {
        type: 'Feature',
        properties: {
          kind: 'driven',
          type: 'driven',
          name: 'Generated HUD route',
          coordinateProperties: {
            times: route.samples.map(point => new Date(point.timeMs).toISOString()),
            progresses: route.samples.map(point => point.progress),
          },
        },
        geometry: {
          type: 'LineString',
          coordinates: route.samples.map(point => [point.lon, point.lat, 0]),
        },
      },
      ...roads.map(road => ({
        type: 'Feature',
        properties: {
          kind: 'reference',
          type: 'reference',
          name: road.name,
          osm_way_id: road.id,
          highway: road.highway,
        },
        geometry: {
          type: 'LineString',
          coordinates: road.points.map(point => [point.lon, point.lat]),
        },
      })),
    ],
  };
}
