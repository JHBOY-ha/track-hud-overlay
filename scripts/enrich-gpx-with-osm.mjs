// Enrich a GPX track with nearby OpenStreetMap roads for the HUD minimap.
// Outputs:
//   *_enriched.geojson        Project-ready track + reference road layers
//   *_enriched_points.csv     Per-trackpoint nearest OSM way metadata
//   *_enriched.gpx            Original GPX with osme:NearestWay extensions
//   *_osm_bbox.osm            Cached OSM bbox source data
// Usage:
//   node scripts/enrich-gpx-with-osm.mjs <input.gpx> [out-dir]
//        [--margin-deg=0.001] [--refresh-osm]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
];

const OSM_ENRICH_NS = 'https://openai.com/codex/osm-enrichment/1';
const OSM_TILE_SIZE_DEG = 0.08;
const COORDINATE_SYSTEMS = new Set(['wgs84', 'gcj02', 'bd09']);
const GCJ_A = 6378245.0;
const GCJ_EE = 0.00669342162296594323;
const BD_X_PI = (Math.PI * 3000.0) / 180.0;

function usage() {
  console.error(
    'Usage: node scripts/enrich-gpx-with-osm.mjs <input.gpx> [out-dir] [--margin-deg=0.001] [--coord=wgs84|gcj02|bd09] [--refresh-osm]',
  );
}

function parseArgs(argv) {
  const positional = argv.filter(a => !a.startsWith('--'));
  const flags = Object.fromEntries(
    argv
      .filter(a => a.startsWith('--'))
      .map(a => {
        const [k, v] = a.replace(/^--/, '').split('=');
        return [k, v ?? true];
      }),
  );
  return {
    input: positional[0],
    outDir: positional[1] ?? 'output',
    marginDeg: flags['margin-deg'] === undefined ? 0.001 : Number(flags['margin-deg']),
    coordinateSystem: normalizeCoordinateSystem(flags.coord),
    refreshOsm: flags['refresh-osm'] === true,
  };
}

function decodeXml(value = '') {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function attrsFromTag(tag) {
  const attrs = {};
  for (const match of tag.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

function firstText(body, localName) {
  const re = new RegExp(`<(?:[\\w.-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${localName}>`);
  const match = body.match(re);
  return match ? decodeXml(match[1].trim()) : '';
}

function normalizeCoordinateSystem(value) {
  return COORDINATE_SYSTEMS.has(value) ? value : 'wgs84';
}

function outsideChina(lon, lat) {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y;
  ret += 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320.0 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLon(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y;
  ret += 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return ret;
}

function wgs84ToGcj02(point) {
  if (outsideChina(point.lon, point.lat)) return { ...point };

  let dLat = transformLat(point.lon - 105.0, point.lat - 35.0);
  let dLon = transformLon(point.lon - 105.0, point.lat - 35.0);
  const radLat = (point.lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * Math.PI);
  dLon = (dLon * 180.0) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { lon: point.lon + dLon, lat: point.lat + dLat };
}

function gcj02ToWgs84(point) {
  if (outsideChina(point.lon, point.lat)) return { ...point };

  let guess = { ...point };
  for (let i = 0; i < 2; i++) {
    const shifted = wgs84ToGcj02(guess);
    guess = {
      lon: guess.lon - (shifted.lon - point.lon),
      lat: guess.lat - (shifted.lat - point.lat),
    };
  }
  return guess;
}

function bd09ToGcj02(point) {
  const x = point.lon - 0.0065;
  const y = point.lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * BD_X_PI);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * BD_X_PI);
  return {
    lon: z * Math.cos(theta),
    lat: z * Math.sin(theta),
  };
}

function convertLonLatToWgs84(point, source = 'wgs84') {
  if (source === 'gcj02') return gcj02ToWgs84(point);
  if (source === 'bd09') return gcj02ToWgs84(bd09ToGcj02(point));
  return { ...point };
}

export function parseGpxTrack(gpxText, coordinateSystem = 'wgs84') {
  const source = normalizeCoordinateSystem(coordinateSystem);
  const points = [];
  let idx = 0;
  for (const match of gpxText.matchAll(/<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g)) {
    const attrs = attrsFromTag(match[1]);
    const lat = Number(attrs.lat);
    const lon = Number(attrs.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const wgs84 = convertLonLatToWgs84({ lon, lat }, source);
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
  if (points.length === 0) throw new Error('No <trkpt> points found in GPX.');
  return points;
}

function bboxForPoints(points, marginDeg) {
  const lats = points.map(p => p.lat);
  const lons = points.map(p => p.lon);
  return [
    Math.min(...lons) - marginDeg,
    Math.min(...lats) - marginDeg,
    Math.max(...lons) + marginDeg,
    Math.max(...lats) + marginDeg,
  ];
}

function osmMapUrl(bbox) {
  return (
    'https://api.openstreetmap.org/api/0.6/map?' +
    new URLSearchParams({ bbox: bbox.map(v => v.toFixed(7)).join(',') }).toString()
  );
}

export function splitBbox(bbox, tileSizeDeg = OSM_TILE_SIZE_DEG) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const tiles = [];
  for (let west = minLon; west < maxLon; west += tileSizeDeg) {
    const east = Math.min(west + tileSizeDeg, maxLon);
    for (let south = minLat; south < maxLat; south += tileSizeDeg) {
      const north = Math.min(south + tileSizeDeg, maxLat);
      tiles.push([west, south, east, north]);
    }
  }
  return tiles;
}

async function fetchOsmTile(bbox) {
  const sourceUrl = osmMapUrl(bbox);
  const res = await fetch(sourceUrl, {
    headers: { 'User-Agent': 'hud5-overlay GPX OSM enrichment script' },
  });
  if (!res.ok) throw new Error(`OSM download failed: ${res.status} ${res.statusText}`);
  return res.text();
}

async function loadOsmXml(bbox, cachePath, refreshOsm) {
  const sourceUrl = osmMapUrl(bbox);

  if (fs.existsSync(cachePath) && !refreshOsm) {
    return { xml: fs.readFileSync(cachePath, 'utf8'), sourceUrl, downloaded: false };
  }

  const tiles = splitBbox(bbox);
  const xmlParts = [];
  for (const tile of tiles) {
    try {
      xmlParts.push(await fetchOsmTile(tile));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('400') || tile[2] - tile[0] <= 0.01 || tile[3] - tile[1] <= 0.01) {
        throw error;
      }
      for (const childTile of splitBbox(tile, (tile[2] - tile[0]) / 2)) {
        xmlParts.push(await fetchOsmTile(childTile));
      }
    }
  }

  const xml = [
    '<osm version="0.6" generator="hud5-overlay-tiled-osm-cache">',
    `<!-- source: ${sourceUrl} -->`,
    `<!-- tiles: ${tiles.length} -->`,
    ...xmlParts.map(part =>
      part
        .replace(/<\?xml[^>]*>\s*/g, '')
        .replace(/<\/?osm\b[^>]*>/g, '')
        .trim(),
    ),
    '</osm>',
  ].join('\n');
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, xml, 'utf8');
  return {
    xml,
    sourceUrl: tiles.length === 1 ? sourceUrl : `${sourceUrl} (tiled: ${tiles.length})`,
    downloaded: true,
  };
}

export function parseOsmRoads(osmXml) {
  const nodes = new Map();
  for (const match of osmXml.matchAll(/<node\b([^>]*?)(?:\/>|>[\s\S]*?<\/node>)/g)) {
    const attrs = attrsFromTag(match[1]);
    const lat = Number(attrs.lat);
    const lon = Number(attrs.lon);
    if (attrs.id && Number.isFinite(lat) && Number.isFinite(lon)) {
      nodes.set(attrs.id, { lat, lon });
    }
  }

  const roads = [];
  for (const match of osmXml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) {
    const attrs = attrsFromTag(match[1]);
    const body = match[2];
    const tags = {};
    for (const tagMatch of body.matchAll(/<tag\b([^>]*?)\/>/g)) {
      const tagAttrs = attrsFromTag(tagMatch[1]);
      if (tagAttrs.k) tags[tagAttrs.k] = tagAttrs.v ?? '';
    }
    if (!tags.highway) continue;
    const coords = [];
    for (const ndMatch of body.matchAll(/<nd\b([^>]*?)\/>/g)) {
      const ndAttrs = attrsFromTag(ndMatch[1]);
      const node = nodes.get(ndAttrs.ref);
      if (node) coords.push(node);
    }
    if (coords.length >= 2) roads.push({ id: attrs.id, tags, coords });
  }
  return roads;
}

function project(lat, lon, originLat, originLon) {
  const radiusM = 6371008.8;
  const x = ((lon - originLon) * Math.PI / 180) * radiusM * Math.cos(originLat * Math.PI / 180);
  const y = ((lat - originLat) * Math.PI / 180) * radiusM;
  return [x, y];
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function buildSegments(roads, originLat, originLon) {
  const segments = [];
  for (const road of roads) {
    const projected = road.coords.map(pt => ({
      ...pt,
      xy: project(pt.lat, pt.lon, originLat, originLon),
    }));
    for (let i = 0; i < projected.length - 1; i++) {
      segments.push({ road, index: i, a: projected[i], b: projected[i + 1] });
    }
  }
  return segments;
}

function nearestSegment(point, segments, originLat, originLon) {
  const [px, py] = project(point.lat, point.lon, originLat, originLon);
  let best = null;
  for (const segment of segments) {
    const [ax, ay] = segment.a.xy;
    const [bx, by] = segment.b.xy;
    const distanceM = distanceToSegment(px, py, ax, ay, bx, by);
    if (!best || distanceM < best.distanceM) best = { segment, distanceM };
  }
  return best;
}

export function enrichPoints(points, roads) {
  const originLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const originLon = points.reduce((sum, p) => sum + p.lon, 0) / points.length;
  const segments = buildSegments(roads, originLat, originLon);
  if (segments.length === 0) throw new Error('No OSM road segments found.');

  let lastWayId = null;
  return points.map(point => {
    const match = nearestSegment(point, segments, originLat, originLon);
    const road = match.segment.road;
    const row = {
      point_index: point.idx,
      time: point.time,
      lat: point.lat.toFixed(8),
      lon: point.lon.toFixed(8),
      ele_m: point.ele,
      heart_rate_bpm: point.hr,
      nearest_way_id: road.id,
      nearest_way_distance_m: match.distanceM.toFixed(2),
      nearest_way_segment_index: match.segment.index,
      way_changed: road.id !== lastWayId ? '1' : '0',
    };
    for (const tag of ROAD_TAGS) row[`osm_${tag}`] = road.tags[tag] ?? '';
    lastWayId = road.id;
    return row;
  });
}

function csvValue(value) {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(rows, output) {
  const header = Object.keys(rows[0]);
  const lines = [header.join(',')];
  for (const row of rows) lines.push(header.map(k => csvValue(row[k])).join(','));
  fs.writeFileSync(output, '\ufeff' + lines.join('\n') + '\n', 'utf8');
}

function roadFeature(road) {
  const props = {
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

export function buildGeoJsonFeatureCollection(points, enrichedRows, roads, sourceUrl) {
  const features = [
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
  ];

  return {
    type: 'FeatureCollection',
    properties: {
      source_url: sourceUrl,
      source_license: 'OpenStreetMap contributors, ODbL',
    },
    features,
  };
}

function addOsmNamespace(gpxText) {
  if (gpxText.includes('xmlns:osme=')) return gpxText;
  return gpxText.replace(/<gpx\b([^>]*)>/, `<gpx$1 xmlns:osme="${OSM_ENRICH_NS}">`);
}

function nearestWayExtension(row) {
  const fields = [
    'nearest_way_id',
    'nearest_way_distance_m',
    'osm_name',
    'osm_highway',
    'osm_surface',
    'osm_cycleway',
    'osm_bicycle',
    'osm_oneway',
  ];
  const inner = fields
    .map(key => `            <osme:${key}>${escapeXml(row[key] ?? '')}</osme:${key}>`)
    .join('\n');
  return `          <osme:NearestWay>\n${inner}\n          </osme:NearestWay>`;
}

function writeEnrichedGpx(originalGpx, rows, output) {
  let idx = 0;
  const withNamespace = addOsmNamespace(originalGpx);
  const enriched = withNamespace.replace(/<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g, (full, attrs, body) => {
    const ext = nearestWayExtension(rows[idx] ?? {});
    idx += 1;
    if (/<extensions\b[^>]*>[\s\S]*?<\/extensions>/.test(body)) {
      return `<trkpt${attrs}>${body.replace(/<\/extensions>/, `${ext}\n        </extensions>`)}</trkpt>`;
    }
    return `<trkpt${attrs}>${body}\n        <extensions>\n${ext}\n        </extensions>\n      </trkpt>`;
  });
  fs.writeFileSync(output, enriched, 'utf8');
}

function writeGeoJson(points, rows, roads, sourceUrl, output) {
  const geo = buildGeoJsonFeatureCollection(points, rows, roads, sourceUrl);
  fs.writeFileSync(output, JSON.stringify(geo, null, 2) + '\n', 'utf8');
}

function writeSummary(points, rows, roads, sourceUrl, output) {
  const distances = rows.map(r => Number(r.nearest_way_distance_m));
  const uniqueWays = new Set(rows.map(r => r.nearest_way_id));
  const highwayCounts = new Map();
  for (const row of rows) {
    const key = row.osm_highway || '(unknown)';
    highwayCounts.set(key, (highwayCounts.get(key) ?? 0) + 1);
  }
  const lines = [
    '# GPX OSM enrichment summary',
    '',
    `- Track points: ${points.length}`,
    `- OSM highway ways in bbox: ${roads.length}`,
    `- Matched unique OSM ways along track: ${uniqueWays.size}`,
    `- Match distance mean: ${(distances.reduce((a, b) => a + b, 0) / distances.length).toFixed(2)} m`,
    `- Match distance max: ${Math.max(...distances).toFixed(2)} m`,
    `- OSM source: ${sourceUrl}`,
    '- OSM license: OpenStreetMap contributors, ODbL',
    '',
    '## Matched highway classes',
  ];
  for (const [key, count] of [...highwayCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    lines.push(`- ${key}: ${count} track points`);
  }
  fs.writeFileSync(output, lines.join('\n') + '\n', 'utf8');
}

function outputStem(inputName) {
  const base = path.basename(inputName || 'track.gpx', path.extname(inputName || 'track.gpx'));
  return base.replace(/[^a-zA-Z0-9._-]+/g, '_') || 'track';
}

export async function enrichGpxText(
  originalGpx,
  {
    inputName = 'track.gpx',
    outDir = 'output',
    marginDeg = 0.001,
    refreshOsm = false,
    coordinateSystem = 'wgs84',
  } = {},
) {
  const resolvedOutDir = path.resolve(outDir);
  const stem = outputStem(inputName);
  fs.mkdirSync(resolvedOutDir, { recursive: true });

  const points = parseGpxTrack(originalGpx, coordinateSystem);
  const bbox = bboxForPoints(points, marginDeg);
  const osmCache = path.join(resolvedOutDir, `${stem}_osm_bbox.osm`);
  const { xml: osmXml, sourceUrl, downloaded } = await loadOsmXml(bbox, osmCache, refreshOsm);
  const roads = parseOsmRoads(osmXml);
  if (roads.length === 0) throw new Error('No OSM highway ways found in bbox.');

  const rows = enrichPoints(points, roads);
  const csvPath = path.join(resolvedOutDir, `${stem}_enriched_points.csv`);
  const gpxPath = path.join(resolvedOutDir, `${stem}_enriched.gpx`);
  const geoJsonPath = path.join(resolvedOutDir, `${stem}_enriched.geojson`);
  const summaryPath = path.join(resolvedOutDir, `${stem}_summary.md`);

  writeCsv(rows, csvPath);
  writeEnrichedGpx(originalGpx, rows, gpxPath);
  writeGeoJson(points, rows, roads, sourceUrl, geoJsonPath);
  writeSummary(points, rows, roads, sourceUrl, summaryPath);

  return {
    downloaded,
    points,
    roads,
    geoJson: buildGeoJsonFeatureCollection(points, rows, roads, sourceUrl),
    paths: {
      csv: csvPath,
      gpx: gpxPath,
      geoJson: geoJsonPath,
      summary: summaryPath,
      osm: osmCache,
    },
  };
}

export async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.input || !Number.isFinite(args.marginDeg)) {
    usage();
    process.exitCode = 1;
    return;
  }

  const input = path.resolve(args.input);
  const outDir = path.resolve(args.outDir);
  const originalGpx = fs.readFileSync(input, 'utf8');
  const result = await enrichGpxText(originalGpx, {
    inputName: path.basename(input),
    outDir,
    marginDeg: args.marginDeg,
    coordinateSystem: args.coordinateSystem,
    refreshOsm: args.refreshOsm,
  });

  console.log(`downloaded_osm=${result.downloaded}`);
  console.log(`points=${result.points.length}`);
  console.log(`roads=${result.roads.length}`);
  console.log(`csv=${result.paths.csv}`);
  console.log(`gpx=${result.paths.gpx}`);
  console.log(`geojson=${result.paths.geoJson}`);
  console.log(`summary=${result.paths.summary}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
