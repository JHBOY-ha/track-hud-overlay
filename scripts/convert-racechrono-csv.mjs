// Convert a RaceChrono Pro v10 OBD-II + GPS CSV export into the HUD project's
// telemetry CSV format. Gear is derived from rpm / speed using the vehicle's
// gear-ratio table (default: Porsche 987.1 Cayman S 5AT, 265/40ZR18).
//
// RaceChrono interleaves sensor channels at different rates (GPS ~100Hz,
// OBD ~1-10Hz, IMU ~200Hz) — each row only carries values for the channels
// that fired at that timestamp, others are blank. We forward-fill state so
// every emitted sample carries the most recent reading per channel.
//
// Usage:
//   node scripts/convert-racechrono-csv.mjs <input.csv> [out.csv]
//        [--vehicle="Porsche 987.1 Cayman S 5AT"]
//        [--ratios=local/..._gear_ratios_with_final_drive.csv]
//        [--tire=265/40R18]               # override stock tire
//        [--rpm-idle=700] [--min-kmh=5]   # gear estimation thresholds
//        [--position-current=10] [--position-total=12]
//        [--rate=N]                       # force fixed Hz output
//        [--speed-source=gps|obd|calc]    # default: gps
//
// Output columns (compatible with scripts/convert-obd-log.mjs):
//   t, speed_kmh, rpm, rpm_max, gear, throttle, brake, abs, tcs,
//   progress, position_current, position_total, lat, lon, altitude, bearing
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const positional = [];
const opts = {
  vehicle: 'Porsche 987.1 Cayman S 5AT',
  ratios: 'local/bmw_e63_lci_630i_6at_porsche_9871_cayman_s_5at_gear_ratios_with_final_drive.csv',
  tire: null,
  rpmIdle: 700,
  minKmh: 5,
  positionCurrent: 10,
  positionTotal: 12,
  rate: null,
  speedSource: 'gps',
};
for (const a of args) {
  if (a.startsWith('--vehicle=')) opts.vehicle = a.slice(10);
  else if (a.startsWith('--ratios=')) opts.ratios = a.slice(9);
  else if (a.startsWith('--tire=')) opts.tire = a.slice(7);
  else if (a.startsWith('--rpm-idle=')) opts.rpmIdle = Number(a.slice(11));
  else if (a.startsWith('--min-kmh=')) opts.minKmh = Number(a.slice(10));
  else if (a.startsWith('--position-current=')) opts.positionCurrent = Number(a.slice(19));
  else if (a.startsWith('--position-total=')) opts.positionTotal = Number(a.slice(17));
  else if (a.startsWith('--rate=')) opts.rate = Number(a.slice(7));
  else if (a.startsWith('--speed-source=')) opts.speedSource = a.slice(15);
  else positional.push(a);
}
const [inPath, outPathArg] = positional;
if (!inPath) {
  console.error('usage: node scripts/convert-racechrono-csv.mjs <input.csv> [out.csv] [...flags]');
  process.exit(1);
}
const outPath = outPathArg ?? inPath.replace(/\.csv$/i, '') + '.hud.csv';

// --- tire size → rolling circumference (meters) ---
function tireCircumference(spec) {
  const m = /^(\d+)\/(\d+)\s*Z?R\s*(\d+)/i.exec(spec.trim());
  if (!m) throw new Error(`unrecognized tire size: ${spec}`);
  const [, w, ar, rim] = m;
  const sidewallMm = Number(w) * (Number(ar) / 100);
  const diameterMm = Number(rim) * 25.4 + 2 * sidewallMm;
  return Math.PI * (diameterMm / 1000);
}

// --- load gear ratios ---
function loadRatios(file, vehicle) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(',');
  const idx = (n) => header.indexOf(n);
  const iv = idx('vehicle'), ig = idx('gear'), ior = idx('overall_ratio'), it = idx('stock_rear_tire_size');
  const rows = lines.slice(1).map((l) => l.split(','));
  const veh = rows.filter((r) => r[iv] === vehicle);
  if (!veh.length) throw new Error(`vehicle "${vehicle}" not found in ${file}`);
  const tire = veh[0][it];
  const gears = veh
    .filter((r) => /^\d+$/.test(r[ig]))
    .map((r) => ({ gear: Number(r[ig]), overall: Number(r[ior]) }))
    .sort((a, b) => a.gear - b.gear);
  return { gears, tire };
}

// --- parse RaceChrono CSV, return ordered events with channel tags ---
function parseRaceChrono(text, speedSource) {
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => /^timestamp,/.test(l));
  if (headerIdx < 0) throw new Error('not a RaceChrono CSV (no timestamp header)');
  const header = lines[headerIdx].split(',');
  const sourceRow = lines[headerIdx + 2]?.split(',') ?? [];
  const find = (name, sourceTag) => {
    for (let i = 0; i < header.length; i++) {
      if (header[i] !== name) continue;
      if (!sourceTag) return i;
      const src = (sourceRow[i] ?? '').toLowerCase();
      if (src.includes(sourceTag)) return i;
    }
    return -1;
  };
  const cols = {
    elapsed: find('elapsed_time'),
    distance: find('distance_traveled'),
    lat: find('latitude'),
    lon: find('longitude'),
    altitude: find('altitude'),
    bearing: find('bearing'),
    speedGps: find('speed', 'gps'),
    speedObd: find('speed', 'obd'),
    speedCalc: find('speed', 'calc'),
    rpm: find('rpm'),
    throttle: find('accelerator_pos'),
  };
  const speedCol = cols[`speed${speedSource[0].toUpperCase()}${speedSource.slice(1)}`];
  if (speedCol == null || speedCol < 0) throw new Error(`speed source "${speedSource}" not found`);

  const num = (v) => {
    if (v === undefined || v === '' || v == null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const events = [];
  for (let i = headerIdx + 3; i < lines.length; i++) {
    const line = lines[i];
    if (!line || /^\s*$/.test(line)) continue;
    const f = line.split(',');
    const t = num(f[cols.elapsed]);
    if (t === undefined) continue;
    events.push({
      t,
      speed_mps: num(f[speedCol]),
      rpm: num(f[cols.rpm]),
      throttle_pct: num(f[cols.throttle]),
      distance_m: num(f[cols.distance]),
      lat: num(f[cols.lat]),
      lon: num(f[cols.lon]),
      altitude: num(f[cols.altitude]),
      bearing: num(f[cols.bearing]),
    });
  }
  return events;
}

// --- gear estimation: rpm = (v_mps / circumference) * overall * 60 ---
function makeGearEstimator(gears, circumference, { rpmIdle, minKmh }) {
  return (speedKmh, rpm) => {
    if (!Number.isFinite(speedKmh) || !Number.isFinite(rpm)) return '';
    if (speedKmh < minKmh || rpm < rpmIdle) return '';
    const vMps = speedKmh / 3.6;
    let best = null;
    for (const g of gears) {
      const predicted = (vMps / circumference) * g.overall * 60;
      if (predicted <= 0) continue;
      const err = Math.abs(Math.log(rpm / predicted));
      if (!best || err < best.err) best = { gear: g.gear, err };
    }
    return best ? best.gear : '';
  };
}

// --- main ---
const { gears, tire: stockTire } = loadRatios(opts.ratios, opts.vehicle);
const tire = opts.tire ?? stockTire;
const circumference = tireCircumference(tire);
console.error(`vehicle: ${opts.vehicle}`);
console.error(`gears:   ${gears.map((g) => `${g.gear}=${g.overall}`).join(', ')}`);
console.error(`tire:    ${tire}  (circumference ${circumference.toFixed(4)} m)`);
console.error(`speed:   ${opts.speedSource}`);

const text = fs.readFileSync(inPath, 'utf8');
const events = parseRaceChrono(text, opts.speedSource);
console.error(`events:  ${events.length}`);

// First pass: max distance for progress normalization, max rpm for rpm_max.
let distanceMax = 0;
let rpmMaxObserved = 0;
for (const e of events) {
  if (Number.isFinite(e.distance_m) && e.distance_m > distanceMax) distanceMax = e.distance_m;
  if (Number.isFinite(e.rpm) && e.rpm > rpmMaxObserved) rpmMaxObserved = e.rpm;
}
const rpmMax = Math.max(6000, Math.ceil((rpmMaxObserved + 200) / 500) * 500);

// Decide output sample times.
let sampleTimes;
if (opts.rate) {
  sampleTimes = [];
  const tStart = events[0].t;
  const tEnd = events[events.length - 1].t;
  const step = 1 / opts.rate;
  for (let t = tStart; t <= tEnd + 1e-9; t += step) sampleTimes.push(t);
} else {
  // One row per speed update — that's the HUD's required field, and it
  // matches RaceChrono's GPS cadence (~100Hz) without bloating with IMU rows.
  const seen = new Set();
  sampleTimes = [];
  for (const e of events) {
    if (e.speed_mps === undefined) continue;
    if (seen.has(e.t)) continue;
    seen.add(e.t);
    sampleTimes.push(e.t);
  }
}

// Forward-fill across events.
const state = {};
let evtIdx = 0;
const estimateGear = makeGearEstimator(gears, circumference, opts);
const gearHist = new Map();
const fmt = (v, d = 4) => (Number.isFinite(v) ? Number(v).toFixed(d) : '');

const headerCols = [
  't', 'speed_kmh', 'rpm', 'rpm_max', 'gear', 'throttle', 'brake', 'abs', 'tcs',
  'progress', 'position_current', 'position_total', 'lat', 'lon', 'altitude', 'bearing',
];
const out = [headerCols.join(',')];

for (const t of sampleTimes) {
  while (evtIdx < events.length && events[evtIdx].t <= t) {
    const e = events[evtIdx++];
    if (e.speed_mps !== undefined) state.speed_mps = e.speed_mps;
    if (e.rpm !== undefined) state.rpm = e.rpm;
    if (e.throttle_pct !== undefined) state.throttle_pct = e.throttle_pct;
    if (e.distance_m !== undefined) state.distance_m = e.distance_m;
    if (e.lat !== undefined) state.lat = e.lat;
    if (e.lon !== undefined) state.lon = e.lon;
    if (e.altitude !== undefined) state.altitude = e.altitude;
    if (e.bearing !== undefined) state.bearing = e.bearing;
  }
  if (state.speed_mps === undefined) continue;

  const speedKmh = state.speed_mps * 3.6;
  const rpm = state.rpm;
  const throttle = state.throttle_pct !== undefined
    ? Math.max(0, Math.min(1, state.throttle_pct / 100))
    : undefined;
  const gear = estimateGear(speedKmh, rpm);
  if (gear !== '') gearHist.set(gear, (gearHist.get(gear) ?? 0) + 1);
  const progress = distanceMax > 0 && state.distance_m !== undefined
    ? Math.max(0, Math.min(1, state.distance_m / distanceMax))
    : undefined;

  out.push([
    fmt(t, 3),
    speedKmh.toFixed(2),
    Number.isFinite(rpm) ? rpm.toFixed(0) : '',
    rpmMax,
    gear,
    throttle !== undefined ? throttle.toFixed(3) : '',
    '', // brake — not exposed by RaceChrono OBD
    '', // abs
    '', // tcs
    progress !== undefined ? progress.toFixed(4) : '',
    opts.positionCurrent,
    opts.positionTotal,
    fmt(state.lat, 7),
    fmt(state.lon, 7),
    fmt(state.altitude, 2),
    fmt(state.bearing, 2),
  ].join(','));
}

fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, out.join('\n') + '\n');
console.error(`wrote: ${outPath}  (${out.length - 1} rows)`);
console.error(`rpm observed max: ${rpmMaxObserved} → rpm_max: ${rpmMax}`);
if (distanceMax > 0) console.error(`distance max: ${distanceMax.toFixed(1)} m`);
const total = [...gearHist.values()].reduce((a, b) => a + b, 0) || 1;
console.error('gear distribution:');
for (const g of gears) {
  const n = gearHist.get(g.gear) ?? 0;
  console.error(`  G${g.gear}: ${n} (${((n / total) * 100).toFixed(1)}%)`);
}
