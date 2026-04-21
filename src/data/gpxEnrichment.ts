const ROAD_TAGS = [
  'name',
  'name:zh',
  'name:en',
  'highway',
  'surface',
  'cycleway',
  'bicycle',
  'foot',
  'oneway',
  'bridge',
  'tunnel',
  'layer',
  'maxspeed',
  'ref',
] as const;

type CoordinateSystem = 'wgs84' | 'gcj02' | 'bd09';

const GCJ_A = 6378245.0;
const GCJ_EE = 0.00669342162296594323;
const BD_X_PI = (Math.PI * 3000.0) / 180.0;

interface GpxPoint {
  idx: number;
  lat: number;
  lon: number;
  ele: string;
  time: string;
  hr: string;
}

interface OsmRoad {
  id: string;
  tags: Record<string, string>;
  coords: Array<{ lat: number; lon: number }>;
}

interface EnrichedRow {
  [key: string]: string | number;
  point_index: number;
  time: string;
  lat: string;
  lon: string;
  ele_m: string;
  heart_rate_bpm: string;
  nearest_way_id: string;
  nearest_way_distance_m: string;
  nearest_way_segment_index: number;
  way_changed: string;
}

export interface EnrichmentResult {
  geoJson: any;
  summary: {
    pointCount: number;
    roadCount: number;
    sourceUrl: string;
  };
}

function decodeXml(value = ''): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function attrsFromTag(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

function firstText(body: string, localName: string): string {
  const re = new RegExp(`<(?:[\\w.-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${localName}>`);
  const match = body.match(re);
  return match ? decodeXml(match[1].trim()) : '';
}

function outsideChina(lon: number, lat: number): boolean {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y;
  ret += 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320.0 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLon(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y;
  ret += 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return ret;
}

function wgs84ToGcj02(lon: number, lat: number): { lon: number; lat: number } {
  if (outsideChina(lon, lat)) return { lon, lat };

  let dLat = transformLat(lon - 105.0, lat - 35.0);
  let dLon = transformLon(lon - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * Math.PI);
  dLon = (dLon * 180.0) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { lon: lon + dLon, lat: lat + dLat };
}

function gcj02ToWgs84(lon: number, lat: number): { lon: number; lat: number } {
  if (outsideChina(lon, lat)) return { lon, lat };

  let guess = { lon, lat };
  for (let i = 0; i < 2; i++) {
    const shifted = wgs84ToGcj02(guess.lon, guess.lat);
    guess = {
      lon: guess.lon - (shifted.lon - lon),
      lat: guess.lat - (shifted.lat - lat),
    };
  }
  return guess;
}

function bd09ToGcj02(lon: number, lat: number): { lon: number; lat: number } {
  const x = lon - 0.0065;
  const y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * BD_X_PI);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * BD_X_PI);
  return {
    lon: z * Math.cos(theta),
    lat: z * Math.sin(theta),
  };
}

function convertLonLatToWgs84(
  lon: number,
  lat: number,
  source: CoordinateSystem,
): { lon: number; lat: number } {
  if (source === 'gcj02') return gcj02ToWgs84(lon, lat);
  if (source === 'bd09') {
    const gcj = bd09ToGcj02(lon, lat);
    return gcj02ToWgs84(gcj.lon, gcj.lat);
  }
  return { lon, lat };
}

export function parseGpxTrackPoints(
  gpxText: string,
  coordinateSystem: CoordinateSystem = 'wgs84',
): GpxPoint[] {
  const points: GpxPoint[] = [];
  let idx = 0;
  for (const match of gpxText.matchAll(/<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g)) {
    const attrs = attrsFromTag(match[1]);
    const lat = Number(attrs.lat);
    const lon = Number(attrs.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const wgs84 = convertLonLatToWgs84(lon, lat, coordinateSystem);
    points.push({
      idx,
      lat: wgs84.lat,
      lon: wgs84.lon,
      ele: firstText(match[2], 'ele'),
      time: firstText(match[2], 'time'),
      hr: firstText(match[2], 'hr'),
    });
    idx += 1;
  }
  if (points.length === 0) throw new Error('GPX 中没有可用的 <trkpt> 轨迹点。');
  return points;
}

function bboxForPoints(points: GpxPoint[], marginDeg: number): [number, number, number, number] {
  const lats = points.map(p => p.lat);
  const lons = points.map(p => p.lon);
  return [
    Math.min(...lons) - marginDeg,
    Math.min(...lats) - marginDeg,
    Math.max(...lons) + marginDeg,
    Math.max(...lats) + marginDeg,
  ];
}

export function osmMapUrl(points: GpxPoint[], marginDeg = 0.001): string {
  const bbox = bboxForPoints(points, marginDeg);
  return `https://api.openstreetmap.org/api/0.6/map?${new URLSearchParams({
    bbox: bbox.map(v => v.toFixed(7)).join(','),
  }).toString()}`;
}

export function parseOsmRoads(osmXml: string): OsmRoad[] {
  const nodes = new Map<string, { lat: number; lon: number }>();
  for (const match of osmXml.matchAll(/<node\b([^>]*?)(?:\/>|>[\s\S]*?<\/node>)/g)) {
    const attrs = attrsFromTag(match[1]);
    const lat = Number(attrs.lat);
    const lon = Number(attrs.lon);
    if (attrs.id && Number.isFinite(lat) && Number.isFinite(lon)) {
      nodes.set(attrs.id, { lat, lon });
    }
  }

  const roads: OsmRoad[] = [];
  for (const match of osmXml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) {
    const attrs = attrsFromTag(match[1]);
    const body = match[2];
    const tags: Record<string, string> = {};
    for (const tagMatch of body.matchAll(/<tag\b([^>]*?)\/>/g)) {
      const tagAttrs = attrsFromTag(tagMatch[1]);
      if (tagAttrs.k) tags[tagAttrs.k] = tagAttrs.v ?? '';
    }
    if (!tags.highway) continue;

    const coords: Array<{ lat: number; lon: number }> = [];
    for (const ndMatch of body.matchAll(/<nd\b([^>]*?)\/>/g)) {
      const ndAttrs = attrsFromTag(ndMatch[1]);
      const node = nodes.get(ndAttrs.ref);
      if (node) coords.push(node);
    }
    if (coords.length >= 2) roads.push({ id: attrs.id, tags, coords });
  }
  return roads;
}

function project(lat: number, lon: number, originLat: number, originLon: number): [number, number] {
  const radiusM = 6371008.8;
  const x = ((lon - originLon) * Math.PI / 180) * radiusM * Math.cos(originLat * Math.PI / 180);
  const y = ((lat - originLat) * Math.PI / 180) * radiusM;
  return [x, y];
}

function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function enrichPoints(points: GpxPoint[], roads: OsmRoad[]): EnrichedRow[] {
  const originLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const originLon = points.reduce((sum, p) => sum + p.lon, 0) / points.length;
  const segments = roads.flatMap(road => {
    const projected = road.coords.map(pt => ({
      ...pt,
      xy: project(pt.lat, pt.lon, originLat, originLon),
    }));
    return projected.slice(0, -1).map((a, i) => ({
      road,
      index: i,
      a,
      b: projected[i + 1],
    }));
  });

  if (segments.length === 0) throw new Error('OSM 数据中没有可匹配的道路段。');

  let lastWayId = '';
  return points.map(point => {
    const [px, py] = project(point.lat, point.lon, originLat, originLon);
    let best = { segment: segments[0], distanceM: Number.POSITIVE_INFINITY };
    for (const segment of segments) {
      const [ax, ay] = segment.a.xy;
      const [bx, by] = segment.b.xy;
      const distanceM = distanceToSegment(px, py, ax, ay, bx, by);
      if (distanceM < best.distanceM) best = { segment, distanceM };
    }

    const road = best.segment.road;
    const row: EnrichedRow = {
      point_index: point.idx,
      time: point.time,
      lat: point.lat.toFixed(8),
      lon: point.lon.toFixed(8),
      ele_m: point.ele,
      heart_rate_bpm: point.hr,
      nearest_way_id: road.id,
      nearest_way_distance_m: best.distanceM.toFixed(2),
      nearest_way_segment_index: best.segment.index,
      way_changed: road.id !== lastWayId ? '1' : '0',
    };
    for (const tag of ROAD_TAGS) row[`osm_${tag}`] = road.tags[tag] ?? '';
    lastWayId = road.id;
    return row;
  });
}

function roadFeature(road: OsmRoad) {
  const props: Record<string, string> = {
    kind: 'reference',
    type: 'reference',
    name: road.tags.name ?? road.tags['name:zh'] ?? road.tags.ref ?? `OSM way ${road.id}`,
    osm_way_id: road.id,
  };
  for (const tag of ROAD_TAGS) {
    if (road.tags[tag] !== undefined) props[tag] = road.tags[tag];
  }
  return {
    type: 'Feature',
    properties: props,
    geometry: {
      type: 'LineString',
      coordinates: road.coords.map(pt => [pt.lon, pt.lat]),
    },
  };
}

export function buildProjectGeoJson(points: GpxPoint[], roads: OsmRoad[], sourceUrl: string): any {
  const enrichedRows = enrichPoints(points, roads);
  return {
    type: 'FeatureCollection',
    properties: {
      source_url: sourceUrl,
      source_license: 'OpenStreetMap contributors, ODbL',
    },
    features: [
      {
        type: 'Feature',
        properties: {
          kind: 'driven',
          type: 'driven',
          name: 'GPX track',
          coordinateProperties: {
            times: points.map(p => p.time || null),
          },
        },
        geometry: {
          type: 'LineString',
          coordinates: points.map(p => [p.lon, p.lat, Number(p.ele) || 0]),
        },
      },
      ...roads.map(roadFeature),
      ...points.map((point, i) => ({
        type: 'Feature',
        properties: {
          kind: 'metadata',
          ...enrichedRows[i],
        },
        geometry: {
          type: 'Point',
          coordinates: [point.lon, point.lat],
        },
      })),
    ],
  };
}

export async function enrichGpxWithOsm(gpxText: string): Promise<EnrichmentResult> {
  const points = parseGpxTrackPoints(gpxText);
  const sourceUrl = osmMapUrl(points);
  const res = await fetch(sourceUrl, {
    headers: { Accept: 'application/xml,text/xml,*/*' },
  });
  if (!res.ok) throw new Error(`OSM 下载失败：${res.status} ${res.statusText}`);
  const roads = parseOsmRoads(await res.text());
  if (roads.length === 0) throw new Error('轨迹范围内没有找到 OpenStreetMap 道路数据。');
  return {
    geoJson: buildProjectGeoJson(points, roads, sourceUrl),
    summary: {
      pointCount: points.length,
      roadCount: roads.length,
      sourceUrl,
    },
  };
}
