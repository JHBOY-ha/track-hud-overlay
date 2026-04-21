#!/usr/bin/env node
// Generate a synthetic telemetry CSV + matching GPX for demo purposes.
// The sample intentionally exercises every HUD data surface: speed, RPM,
// gear, inputs, ABS/TCS, progress, race position, timed track pose, altitude,
// planned route, and reference roads.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'public', 'samples');
mkdirSync(OUT_DIR, { recursive: true });

const DURATION = 150;        // seconds
const FPS = 10;              // samples / second
const RPM_MAX = 8200;
const BASE_TIME = Date.UTC(2026, 3, 21, 10, 0, 0);

// Gear shift thresholds (up)
const SHIFT_UP = [55, 95, 135, 170, 210];
const SHIFT_DOWN = [30, 65, 100, 140, 180];
const CITY_ROUTE = [
  { lon: 121.4568, lat: 31.2352, ele: 18 },
  { lon: 121.4636, lat: 31.2352, ele: 20 },
  { lon: 121.4636, lat: 31.2315, ele: 23 },
  { lon: 121.4705, lat: 31.2315, ele: 24 },
  { lon: 121.4705, lat: 31.2388, ele: 29 },
  { lon: 121.4784, lat: 31.2388, ele: 32 },
  { lon: 121.4784, lat: 31.2330, ele: 31 },
  { lon: 121.4866, lat: 31.2330, ele: 34 },
  { lon: 121.4866, lat: 31.2260, ele: 39 },
  { lon: 121.4934, lat: 31.2260, ele: 42 },
  { lon: 121.4934, lat: 31.2308, ele: 45 },
  { lon: 121.5010, lat: 31.2308, ele: 48 },
];
const REFERENCE_ROADS = [
  [
    { lon: 121.4568, lat: 31.2292, ele: 17 },
    { lon: 121.5010, lat: 31.2292, ele: 46 },
  ],
  [
    { lon: 121.4668, lat: 31.2238, ele: 19 },
    { lon: 121.4668, lat: 31.2410, ele: 30 },
  ],
  [
    { lon: 121.4822, lat: 31.2238, ele: 34 },
    { lon: 121.4822, lat: 31.2410, ele: 37 },
  ],
  [
    { lon: 121.4568, lat: 31.2370, ele: 21 },
    { lon: 121.5010, lat: 31.2370, ele: 49 },
  ],
];

function lerp(a, b, f) {
  return a + (b - a) * f;
}

function distanceApprox(a, b) {
  const lat = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const dx = (b.lon - a.lon) * Math.cos(lat);
  const dy = b.lat - a.lat;
  return Math.hypot(dx, dy);
}

function cumulativeLengths(points) {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1] + distanceApprox(points[i - 1], points[i]));
  }
  return lengths;
}

const CITY_ROUTE_LENGTHS = cumulativeLengths(CITY_ROUTE);
const CITY_ROUTE_TOTAL = CITY_ROUTE_LENGTHS[CITY_ROUTE_LENGTHS.length - 1];

function gearFor(t, speed, prev) {
  if (t < 1.2) return 'N';
  let g = prev;
  if (typeof g !== 'number') g = 1;
  while (g < 6 && speed > SHIFT_UP[g - 1]) g++;
  while (g > 1 && speed < SHIFT_DOWN[g - 2]) g--;
  return g;
}

function rpmFor(speed, gear) {
  // Speeds for 7000 rpm at each gear
  if (typeof gear !== 'number') return Math.round(950 + speed * 18);
  const topForGear = [70, 110, 150, 185, 215, 245];
  const frac = Math.min(1, speed / topForGear[gear - 1]);
  return Math.round(1150 + frac * (7600 - 1150));
}

// Speed profile: launch, straights, hard-braking corners, and a final sprint.
function speedAt(t) {
  if (t < 1.2) return 0;
  if (t < 14) return (t - 1.2) * 9.2;
  if (t < 32) return 118 + (t - 14) * 4.5 + 10 * Math.sin(t * 0.55);
  if (t < 45) return 205 - (t - 32) * 8.5 + 6 * Math.sin(t * 1.2);
  if (t < 66) return 92 + (t - 45) * 5.7 + 12 * Math.sin(t * 0.45);
  if (t < 82) return 218 - (t - 66) * 6.7 + 9 * Math.sin(t * 0.9);
  if (t < 105) return 112 + (t - 82) * 4.7 + 15 * Math.sin(t * 0.35);
  if (t < 122) return 220 - (t - 105) * 7.5 + 10 * Math.sin(t * 0.8);
  if (t < 140) return 98 + (t - 122) * 6.8;
  return 215 + 10 * Math.sin(t * 0.7);
}

function positionAt(t) {
  if (t < 20) return 8;
  if (t < 46) return 6;
  if (t < 78) return 4;
  if (t < 118) return 2;
  return 1;
}

function pointOnPolyline(points, lengths, total, u) {
  const target = Math.max(0, Math.min(1, u)) * total;
  let idx = 1;
  while (idx < lengths.length - 1 && lengths[idx] < target) idx++;
  const a = points[idx - 1];
  const b = points[idx];
  const span = lengths[idx] - lengths[idx - 1] || 1;
  const f = (target - lengths[idx - 1]) / span;
  return {
    lon: lerp(a.lon, b.lon, f),
    lat: lerp(a.lat, b.lat, f),
    ele: lerp(a.ele, b.ele, f),
  };
}

function trackPointAt(u) {
  return pointOnPolyline(CITY_ROUTE, CITY_ROUTE_LENGTHS, CITY_ROUTE_TOTAL, u);
}

function referencePointAt(road, u) {
  const lengths = cumulativeLengths(road);
  return pointOnPolyline(road, lengths, lengths[lengths.length - 1], u);
}

// Build CSV
const rows = ['t,speed_kmh,rpm,rpm_max,gear,throttle,brake,abs,tcs,progress,position_current,position_total'];
let prevGear = 'N';
let prevSpeed = 0;
for (let i = 0; i <= DURATION * FPS; i++) {
  const t = i / FPS;
  const speed = Math.max(0, speedAt(t));
  const gear = gearFor(t, speed, prevGear);
  const rpm = rpmFor(speed, gear);
  const accel = speed - prevSpeed;
  const throttle = accel >= -0.2 ? Math.min(1, Math.max(0, 0.25 + accel * 0.22)) : 0;
  const brake = accel < -0.7 ? Math.min(1, -accel * 0.11) : 0;
  const abs = brake > 0.58 || (t > 31 && t < 36) || (t > 105 && t < 111) ? 1 : 0;
  const tcs = (throttle > 0.72 && (gear === 1 || gear === 2)) || (t > 7 && t < 11) ? 1 : 0;
  const progress = t / DURATION;
  rows.push(
    [
      t.toFixed(2),
      speed.toFixed(2),
      rpm,
      RPM_MAX,
      gear,
      throttle.toFixed(2),
      brake.toFixed(2),
      abs,
      tcs,
      progress.toFixed(4),
      positionAt(t),
      12,
    ].join(','),
  );
  prevGear = gear;
  prevSpeed = speed;
}
writeFileSync(resolve(OUT_DIR, 'telemetry.csv'), rows.join('\n') + '\n');

function trkpt(point, t) {
  const ts = new Date(BASE_TIME + t * 1000).toISOString();
  return `      <trkpt lat="${point.lat.toFixed(7)}" lon="${point.lon.toFixed(7)}"><ele>${point.ele.toFixed(1)}</ele><time>${ts}</time></trkpt>`;
}

function rtept(point) {
  return `    <rtept lat="${point.lat.toFixed(7)}" lon="${point.lon.toFixed(7)}"><ele>${point.ele.toFixed(1)}</ele></rtept>`;
}

// Build GPX near Shanghai. It contains:
// - a timed driven track with elevation
// - a route layer shown as the planned course
// - named reference tracks that mimic nearby city-grid roads
const gpxPoints = [];
for (let i = 0; i <= DURATION * FPS; i++) {
  const t = i / FPS;
  const u = t / DURATION;
  gpxPoints.push(trkpt(trackPointAt(u), t));
}

const routePoints = [];
for (let i = 0; i <= 75; i++) {
  routePoints.push(rtept(trackPointAt(i / 75)));
}

const referenceTracks = [];
for (let road = 0; road < REFERENCE_ROADS.length; road++) {
  const pts = [];
  for (let i = 0; i <= 36; i++) {
    const u = i / 36;
    pts.push(trkpt(referencePointAt(REFERENCE_ROADS[road], u), u * DURATION));
  }
  referenceTracks.push(`  <trk><name>Reference Road ${road + 1}</name><trkseg>
${pts.join('\n')}
  </trkseg></trk>`);
}

const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="hud5-sample" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>HUD5 Full Data Sample</name>
    <desc>Synthetic data covering every HUD field: telemetry, timed GPX pose, elevation, planned route, and reference roads.</desc>
  </metadata>
  <rte><name>Planned Demo Course</name>
${routePoints.join('\n')}
  </rte>
  <trk><name>Driven Demo Lap</name><trkseg>
${gpxPoints.join('\n')}
  </trkseg></trk>
${referenceTracks.join('\n')}
</gpx>
`;
writeFileSync(resolve(OUT_DIR, 'track.gpx'), gpx);

console.log(`Wrote ${OUT_DIR}/telemetry.csv (${rows.length - 1} rows) and track.gpx (${gpxPoints.length} points)`);
