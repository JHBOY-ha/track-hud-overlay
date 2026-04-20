#!/usr/bin/env node
// Convert OBD recorder long-format CSV (SECONDS;PID;VALUE;UNITS) to project telemetry CSV.
// Emits every column the HUD consumes (see src/data/telemetry.ts):
//   t, speed_kmh, rpm, rpm_max, gear, throttle, brake, abs, tcs, progress
// Default: emits one row per speed update (native OBD cadence) so sampleAt()
// can lerp smoothly between samples each frame. Pass --rate=N to force a
// fixed output rate (useful for exporting).
// Usage: node scripts/convert-obd-log.mjs <input.csv> [output.csv] [--rate=N]
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const positional = args.filter(a => !a.startsWith('--'));
const flags = Object.fromEntries(
  args.filter(a => a.startsWith('--')).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const input = positional[0];
if (!input) {
  console.error('Usage: node scripts/convert-obd-log.mjs <input.csv> [output.csv] [--rate=10]');
  process.exit(1);
}
const output =
  positional[1] ?? path.join('public', 'samples', 'telemetry.csv');
const rateHz = flags.rate !== undefined ? Number(flags.rate) : null;

// PID → canonical intermediate column. Values are forward-filled.
// Keys cover both Chinese OBD recorder labels and common English variants.
const PID_MAP = {
  车速: 'speed_kmh',
  Speed: 'speed_kmh',
  'Vehicle Speed': 'speed_kmh',

  发动机转速: 'rpm',
  'Engine RPM': 'rpm',

  节气门位置: 'throttle_pct',
  'Throttle Position': 'throttle_pct',
  相对节气门位置: 'throttle_rel_pct',
  'Relative throttle position': 'throttle_rel_pct',
  绝对踏板位置E: 'pedal_pct',
  'Accelerator pedal position E': 'pedal_pct',
  绝对踏板位置D: 'pedal_pct_d',

  'ABS Brake pedal pressed': 'abs_active',
  制动踏板开关: 'brake_switch',
  '刹车开关': 'brake_switch',

  '行驶距离（总计）': 'distance_km',
  行驶距离: 'distance_km',
  'Distance traveled': 'distance_km',

  档位: 'gear',
  当前档位: 'gear',
  'Current gear': 'gear',
};

const raw = fs.readFileSync(input, 'utf8');
const lines = raw.split(/\r?\n/).filter(Boolean);
const header = lines.shift();
if (!/SECONDS/i.test(header ?? '')) {
  console.error('Unexpected header:', header);
  process.exit(1);
}

function unquote(s) {
  return s.replace(/^"(.*)"$/, '$1');
}

const events = [];
for (const line of lines) {
  const parts = line.split(';').map(unquote);
  const secs = Number(parts[0]);
  const pid = parts[1];
  const value = parts[2];
  if (!Number.isFinite(secs) || !pid) continue;
  events.push({ t: secs, pid, value });
}
events.sort((a, b) => a.t - b.t);
if (events.length === 0) {
  console.error('No events parsed.');
  process.exit(1);
}
const t0 = events[0].t;
const tEnd = events[events.length - 1].t;
const duration = tEnd - t0;

function parseBool(raw) {
  const s = String(raw).trim().toLowerCase();
  if (s === 'yes' || s === 'true' || s === '1' || s === '是' || s === 'on') return 1;
  if (s === 'no' || s === 'false' || s === '0' || s === '否' || s === 'off') return 0;
  return undefined;
}

function parseGear(raw) {
  const s = String(raw).trim().toUpperCase();
  if (s === 'N' || s === 'R') return s;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function parseVal(col, raw) {
  if (col === 'abs_active' || col === 'brake_switch') return parseBool(raw);
  if (col === 'gear') return parseGear(raw);
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

// First pass: observe max distance so we can normalise progress.
let distanceMax = 0;
for (const e of events) {
  const col = PID_MAP[e.pid];
  if (col !== 'distance_km') continue;
  const n = Number(e.value);
  if (Number.isFinite(n) && n > distanceMax) distanceMax = n;
}

// Decide sample timestamps. Without --rate we emit one row per speed update
// (the HUD's required field); with --rate we tick at fixed Hz.
const sampleTimes = [];
if (rateHz) {
  const step = 1 / rateHz;
  for (let t = 0; t <= duration + 1e-9; t += step) sampleTimes.push(t0 + t);
} else {
  const seen = new Set();
  for (const e of events) {
    if (PID_MAP[e.pid] !== 'speed_kmh') continue;
    if (seen.has(e.t)) continue;
    seen.add(e.t);
    sampleTimes.push(e.t);
  }
}

// Forward-fill state
const state = {};
let evtIdx = 0;
const rows = [];
let rpmMaxObserved = 0;

for (const absT of sampleTimes) {
  while (evtIdx < events.length && events[evtIdx].t <= absT) {
    const e = events[evtIdx++];
    const col = PID_MAP[e.pid];
    if (!col) continue;
    const v = parseVal(col, e.value);
    if (v !== undefined) state[col] = v;
  }
  const speed = state.speed_kmh;
  if (speed === undefined) continue; // wait until we have speed

  const throttleRaw =
    state.throttle_rel_pct ?? state.pedal_pct ?? state.pedal_pct_d ?? state.throttle_pct;
  const throttle =
    throttleRaw !== undefined
      ? Math.max(0, Math.min(1, throttleRaw / 100))
      : '';

  // Brake pedal pressure isn't exposed by standard OBD. Fall back to the
  // brake switch if present — it gives a 0/1 pulse, still useful for the HUD.
  const brake = state.brake_switch ?? '';
  const abs = state.abs_active ?? '';
  const rpm = state.rpm ?? '';
  const gear = state.gear ?? '';
  const progress =
    distanceMax > 0 && state.distance_km !== undefined
      ? Math.max(0, Math.min(1, state.distance_km / distanceMax))
      : '';

  if (typeof rpm === 'number' && rpm > rpmMaxObserved) rpmMaxObserved = rpm;

  const t = absT - t0;
  rows.push({
    t: t.toFixed(3),
    speed_kmh: speed.toFixed(2),
    rpm: rpm === '' ? '' : Math.round(rpm),
    gear,
    throttle: throttle === '' ? '' : throttle.toFixed(2),
    brake,
    abs,
    progress: progress === '' ? '' : progress.toFixed(4),
  });
}

// Pick a sensible rpm_max: round up observed max to next 500, clamp ≥ 6000.
const rpmMax = Math.max(6000, Math.ceil((rpmMaxObserved + 200) / 500) * 500);

const headerCols = [
  't',
  'speed_kmh',
  'rpm',
  'rpm_max',
  'gear',
  'throttle',
  'brake',
  'abs',
  'tcs',
  'progress',
];
const out = [headerCols.join(',')];
for (const r of rows) {
  out.push(
    [r.t, r.speed_kmh, r.rpm, rpmMax, r.gear, r.throttle, r.brake, r.abs, '', r.progress].join(','),
  );
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, out.join('\n') + '\n', 'utf8');

const cadence = rateHz ? `${rateHz}Hz` : 'speed-event cadence';
console.log(
  `Wrote ${rows.length} rows (${duration.toFixed(1)}s @ ${cadence}) → ${output}`,
);
console.log(`  observed rpm max: ${rpmMaxObserved}, rpm_max set to ${rpmMax}`);
if (distanceMax > 0) console.log(`  distance max: ${distanceMax} km (→ progress)`);
