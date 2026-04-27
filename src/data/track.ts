import { gpx } from '@tmcw/togeojson';
import type { Track, TrackLayer, TrackLayerKind, TrackPoint } from './schema';
import { denoiseGpsPoints } from './gpsDenoise';
import { projectLonLatLayers, type LonLat } from '../util/projection';
import { buildSegments, snapPointsToSegments } from '../util/snapToRoads';
import { clamp } from '../util/units';
import {
  convertLonLatLayersToWgs84,
  type CoordinateSystem,
} from '../util/coordinateSystems';

export interface TrackParseOptions {
  snap?: { enabled: boolean; maxDistM: number };
  coordinateSystem?: CoordinateSystem;
}

interface RawPoint extends LonLat {
  t?: number;
  ele?: number;
}

interface RawLayer {
  kind: TrackLayerKind;
  name?: string;
  points: RawPoint[];
}

function classifyKind(props: any, gpxType: string | undefined): TrackLayerKind {
  if (gpxType === 'rte') return 'planned';
  const explicit = String(props?.kind ?? props?.type ?? '').toLowerCase();
  if (explicit === 'driven' || explicit === 'planned' || explicit === 'reference') {
    return explicit;
  }
  const name = String(props?.name ?? '').toLowerCase();
  if (/(^|\b)(ref|reference|bg|background|ghost)\b/.test(name)) return 'reference';
  if (/(^|\b)(planned|route|plan)\b/.test(name)) return 'planned';
  return 'driven';
}

function rawLayersFromGeoJson(geo: any, denoiseGps = false): RawLayer[] {
  // First pass: collect raw layers with epoch-ms timestamps so we can anchor
  // all of them to a single local midnight (and stay monotonic across
  // midnight rollovers).
  const epochLayers: { kind: TrackLayerKind; name?: string; points: (RawPoint & { tMs?: number })[] }[] = [];

  for (const feature of geo.features ?? []) {
    const g = feature.geometry;
    if (!g) continue;
    const props = feature.properties ?? {};
    const gpxType: string | undefined = props._gpxType;
    const times: string[] | undefined = props.coordinateProperties?.times;
    const kind = classifyKind(props, gpxType);
    const name = props.name as string | undefined;
    const shouldDenoise = denoiseGps || gpxType === 'trk' || gpxType === 'rte';

    const push = (coords: number[][], base = 0): (RawPoint & { tMs?: number })[] =>
      coords.map((c, i) => {
        const ts = times?.[base + i];
        const ms = ts ? Date.parse(ts) : NaN;
        const elev = c.length > 2 ? Number(c[2]) : NaN;
        return {
          lon: c[0],
          lat: c[1],
          tMs: Number.isFinite(ms) ? ms : undefined,
          ele: Number.isFinite(elev) ? elev : undefined,
        };
      });

    if (g.type === 'LineString') {
      const points = push(g.coordinates);
      epochLayers.push({ kind, name, points: shouldDenoise ? denoiseGpsPoints(points) : points });
    } else if (g.type === 'MultiLineString') {
      let offset = 0;
      for (const seg of g.coordinates) {
        const points = push(seg, offset);
        epochLayers.push({ kind, name, points: shouldDenoise ? denoiseGpsPoints(points) : points });
        offset += seg.length;
      }
    }
  }

  // Pick anchor = local midnight of the earliest timestamp across all layers.
  let firstMs: number | undefined;
  for (const l of epochLayers) {
    for (const p of l.points) {
      if (p.tMs !== undefined && (firstMs === undefined || p.tMs < firstMs)) {
        firstMs = p.tMs;
      }
    }
  }
  let anchorMs = 0;
  if (firstMs !== undefined) {
    const d = new Date(firstMs);
    anchorMs = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  return epochLayers
    .map(l => ({
      kind: l.kind,
      name: l.name,
      points: l.points.map(p => ({
        lon: p.lon,
        lat: p.lat,
        ele: p.ele,
        t: p.tMs !== undefined ? (p.tMs - anchorMs) / 1000 : undefined,
      })) as RawPoint[],
    }))
    .filter(l => l.points.length > 0);
}

function buildLayer(
  raw: RawLayer,
  projected: { x: number; y: number }[],
): TrackLayer {
  let totalLength = 0;
  const points: TrackPoint[] = projected.map((p, i) => {
    if (i > 0) {
      const dx = p.x - projected[i - 1].x;
      const dy = p.y - projected[i - 1].y;
      totalLength += Math.hypot(dx, dy);
    }
    return {
      x: p.x,
      y: p.y,
      distance: totalLength,
      t: raw.points[i].t,
      ele: raw.points[i].ele,
    };
  });

  return { kind: raw.kind, name: raw.name, points, totalLength };
}


function pickPrimary(layers: TrackLayer[]): TrackLayer {
  return (
    layers.find(l => l.kind === 'driven') ??
    layers.find(l => l.kind === 'planned') ??
    layers[0]
  );
}

function toTrack(rawLayers: RawLayer[], opts: TrackParseOptions = {}): Track {
  if (rawLayers.length === 0) {
    return { layers: [], points: [], totalLength: 0 };
  }
  const wgs84Groups = convertLonLatLayersToWgs84(
    rawLayers.map(l => l.points),
    opts.coordinateSystem ?? 'wgs84',
  );
  const normalizedRawLayers = rawLayers.map((raw, i) => ({
    ...raw,
    points: wgs84Groups[i],
  }));
  const projectedGroups = projectLonLatLayers(wgs84Groups);

  let processed = projectedGroups;
  const snap = opts.snap;
  if (snap?.enabled && snap.maxDistM > 0) {
    const refIndices: number[] = [];
    for (let i = 0; i < normalizedRawLayers.length; i++) {
      if (normalizedRawLayers[i].kind === 'reference') refIndices.push(i);
    }
    if (refIndices.length > 0) {
      const segments = buildSegments(refIndices.map(i => projectedGroups[i]));
      processed = projectedGroups.map((g, i) =>
        normalizedRawLayers[i].kind === 'driven'
          ? snapPointsToSegments(g, segments, snap.maxDistM)
          : g,
      );
    }
  }

  const layers = normalizedRawLayers.map((raw, i) => buildLayer(raw, processed[i]));
  const primary = pickPrimary(layers);
  return { layers, points: primary.points, totalLength: primary.totalLength };
}

export function parseGpx(text: string, opts?: TrackParseOptions): Track {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const geo = gpx(doc);
  return toTrack(rawLayersFromGeoJson(geo, true), opts);
}

export function parseGeoJson(text: string, opts?: TrackParseOptions): Track {
  const geo = JSON.parse(text);
  return toTrack(rawLayersFromGeoJson(geo), opts);
}

export interface TrackPose {
  x: number;
  y: number;
  headingRad: number;
  ele?: number;
}

export function poseAt(track: Track, opts: { time?: number; progress?: number }): TrackPose | null {
  const { points } = track;
  if (points.length === 0) return null;

  const hasTime = points[0].t !== undefined;
  let idx = 0;
  let f = 0;

  if (hasTime && opts.time !== undefined) {
    const t = opts.time;
    if (t <= points[0].t!) {
      idx = 0; f = 0;
    } else if (t >= points[points.length - 1].t!) {
      idx = points.length - 2; f = 1;
    } else {
      let lo = 0, hi = points.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if ((points[mid].t ?? 0) <= t) lo = mid;
        else hi = mid;
      }
      idx = lo;
      const a = points[idx], b = points[idx + 1];
      f = (t - a.t!) / ((b.t! - a.t!) || 1);
    }
  } else {
    const p = clamp(opts.progress ?? 0, 0, 1);
    const targetDist = p * track.totalLength;
    if (points.length < 2) {
      return { x: points[0].x, y: points[0].y, headingRad: 0, ele: points[0].ele };
    }
    let lo = 0, hi = points.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (points[mid].distance <= targetDist) lo = mid;
      else hi = mid;
    }
    idx = lo;
    const a = points[idx], b = points[idx + 1];
    f = (targetDist - a.distance) / ((b.distance - a.distance) || 1);
  }

  const a = points[idx];
  const b = points[Math.min(idx + 1, points.length - 1)];
  const x = a.x + (b.x - a.x) * f;
  const y = a.y + (b.y - a.y) * f;
  const heading = Math.atan2(b.x - a.x, -(b.y - a.y)); // 0 = north, clockwise
  const ele =
    a.ele !== undefined && b.ele !== undefined
      ? a.ele + (b.ele - a.ele) * f
      : (a.ele ?? b.ele);
  return { x, y, headingRad: heading, ele };
}
