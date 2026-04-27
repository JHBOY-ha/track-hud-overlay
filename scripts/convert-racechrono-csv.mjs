// Convert a RaceChrono Pro v10 OBD-II + GPS CSV export into the HUD project's
// telemetry CSV format. Gear is derived from rpm / speed using the vehicle's
// gear-ratio table (default: Porsche 987.1 Cayman S 5AT, 265/40ZR18).
//
// Usage:
//   node scripts/convert-racechrono-csv.mjs <input.csv> [out.csv]
//        [--vehicle="Porsche 987.1 Cayman S 5AT"]
//        [--ratios=local/bmw_e63_..._gear_ratios_with_final_drive.csv]
//        [--tire=265/40R18]   # override tire size
//        [--rpm-idle=700] [--min-kmh=5]
//
// Output columns: t, speed_kmh, rpm, throttle, gear, lat, lon, altitude, bearing
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
};
for (const a of args) {
  if (a.startsWith('--vehicle=')) opts.vehicle = a.slice(10);
  else if (a.startsWith('--ratios=')) opts.ratios = a.slice(9);
  else if (a.startsWith('--tire=')) opts.tire = a.slice(7);
  else if (a.startsWith('--rpm-idle=')) opts.rpmIdle = Number(a.slice(11));
  else if (a.startsWith('--min-kmh=')) opts.minKmh = Number(a.slice(10));
  else positional.push(a);
}
const [inPath, outPathArg] = positional;
if (!inPath) {
  console.error('usage: node scripts/convert-racechrono-csv.mjs <input.csv> [out.csv] [--vehicle=...] [--ratios=...] [--tire=...]');
  process.exit(1);
}
const outPath = outPathArg ?? inPath.replace(/\.csv$/i, '') + '.hud.csv';

// --- tire size → rolling circumference (meters) ---
function tireCircumference(spec) {
  // e.g. "265/40R18" or "265/40ZR18"
  const m = /^(\d+)\/(\d+)\s*Z?R\s*(\d+)/i.exec(spec.trim());
  if (!m) throw new Error(`unrecognized tire size: ${spec}`);
  const widthMm = Number(m[1]);
  const aspect = Number(m[2]);
  const rimIn = Number(m[3]);
  const sidewallMm = widthMm * (aspect / 100);
  const diameterMm = rimIn * 25.4 + 2 * sidewallMm;
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

// --- parse RaceChrono CSV (skips preamble, handles duplicate column names) ---
function parseRaceChrono(text) {
  const lines = text.split(/\r?\n/);
  // Find the header row: starts with "timestamp,"
  const headerIdx = lines.findIndex((l) => /^timestamp,/.test(l));
  if (headerIdx < 0) throw new Error('not a RaceChrono CSV (no timestamp header)');
  const header = lines[headerIdx].split(',');
  const sourceRow = lines[headerIdx + 2]?.split(',') ?? [];
  // Resolve duplicate column names by source tag (gps / obd / calc)
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
    lat: find('latitude'),
    lon: find('longitude'),
    altitude: find('altitude'),
    bearing: find('bearing'),
    speedGps: find('speed', 'gps'),
    speedObd: find('speed', 'obd'),
    rpm: find('rpm'),
    throttle: find('accelerator_pos'),
  };
  const dataLines = lines.slice(headerIdx + 3).filter((l) => l && !/^\s*$/.test(l));
  const rows = [];
  for (const line of dataLines) {
    const f = line.split(',');
    const t = Number(f[cols.elapsed]);
    if (!Number.isFinite(t)) continue;
    const speedMps = Number(f[cols.speedGps]);
    rows.push({
      t,
      speed_kmh: Number.isFinite(speedMps) ? speedMps * 3.6 : NaN,
      rpm: cols.rpm >= 0 ? Number(f[cols.rpm]) : NaN,
      throttle: cols.throttle >= 0 ? Number(f[cols.throttle]) : NaN,
      lat: Number(f[cols.lat]),
      lon: Number(f[cols.lon]),
      altitude: Number(f[cols.altitude]),
      bearing: Number(f[cols.bearing]),
    });
  }
  return rows;
}

// --- gear estimation ---
// rpm = (v_mps / circumference) * overall_ratio * 60
function makeGearEstimator(gears, circumference, { rpmIdle, minKmh }) {
  return (speedKmh, rpm) => {
    if (!Number.isFinite(speedKmh) || !Number.isFinite(rpm)) return '';
    if (speedKmh < minKmh || rpm < rpmIdle) return '';
    const vMps = speedKmh / 3.6;
    let best = null;
    for (const g of gears) {
      const predicted = (vMps / circumference) * g.overall * 60;
      if (predicted <= 0) continue;
      // Compare in log space so ratios match symmetrically
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

const text = fs.readFileSync(inPath, 'utf8');
const rows = parseRaceChrono(text);
console.error(`samples: ${rows.length}`);

const estimateGear = makeGearEstimator(gears, circumference, opts);

const outHeader = ['t', 'speed_kmh', 'rpm', 'throttle', 'gear', 'lat', 'lon', 'altitude', 'bearing'];
const out = [outHeader.join(',')];
const fmt = (v, d = 4) => (Number.isFinite(v) ? Number(v).toFixed(d) : '');
const gearHist = new Map();
for (const r of rows) {
  const gear = estimateGear(r.speed_kmh, r.rpm);
  if (gear !== '') gearHist.set(gear, (gearHist.get(gear) ?? 0) + 1);
  out.push([
    fmt(r.t, 3),
    fmt(r.speed_kmh, 3),
    Number.isFinite(r.rpm) ? r.rpm.toFixed(0) : '',
    fmt(r.throttle, 2),
    gear,
    fmt(r.lat, 7),
    fmt(r.lon, 7),
    fmt(r.altitude, 2),
    fmt(r.bearing, 2),
  ].join(','));
}

fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, out.join('\n'));
console.error(`wrote: ${outPath}`);
const total = [...gearHist.values()].reduce((a, b) => a + b, 0) || 1;
console.error('gear distribution:');
for (const g of gears) {
  const n = gearHist.get(g.gear) ?? 0;
  console.error(`  G${g.gear}: ${n} (${((n / total) * 100).toFixed(1)}%)`);
}
