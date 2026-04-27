#!/usr/bin/env node
// Convert OBD recorder long-format CSV (SECONDS;PID;VALUE;UNITS) to project telemetry CSV.
// Emits every column the HUD consumes (see src/data/telemetry.ts):
//   t, speed_kmh, rpm, rpm_max, gear, throttle, brake, abs, tcs, progress,
//   position_current, position_total
// Default: emits one row per speed update (native OBD cadence) so sampleAt()
// can lerp smoothly between samples each frame. Pass --rate=N to force a
// fixed output rate (useful for exporting).
// Usage: node scripts/convert-obd-log.mjs <input.csv> [output.csv] [--rate=N]
//        [--position-current=N] [--position-total=N]
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_POSITION_CURRENT = 10;
const DEFAULT_POSITION_TOTAL = 12;

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
  console.error(
    'Usage: node scripts/convert-obd-log.mjs <input.csv> [output.csv] [--rate=10] [--position-current=10] [--position-total=12]',
  );
  process.exit(1);
}
const output =
  positional[1] ?? path.join('public', 'samples', 'telemetry.csv');
const rateHz = flags.rate !== undefined ? Number(flags.rate) : null;

function positiveIntFlag(name, fallback) {
  const raw = flags[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    console.error(`--${name} must be a positive integer.`);
    process.exit(1);
  }
  return value;
}

const positionCurrent = positiveIntFlag('position-current', DEFAULT_POSITION_CURRENT);
const positionTotal = positiveIntFlag('position-total', DEFAULT_POSITION_TOTAL);
if (positionCurrent > positionTotal) {
  console.error('--position-current cannot be greater than --position-total.');
  process.exit(1);
}

// PID → canonical intermediate column. Values are forward-filled.
// Keys cover both Chinese OBD recorder labels and common English variants.
const PID_MAP = {
  车速: 'speed_kmh',
  Speed: 'speed_kmh',
  'Vehicle Speed': 'speed_kmh',
  '速度 (GPS)': 'speed_kmh',
  平均GPS速度: 'speed_kmh',
  平均速度: 'speed_kmh',

  发动机转速: 'rpm',
  '发动机转速 x1000': 'rpm_x1000',
  'Engine RPM': 'rpm',

  节气门位置: 'throttle_pct',
  'Throttle Position': 'throttle_pct',
  绝对油门位置B: 'throttle_pct_b',
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
  Gear: 'gear',
};

// Normalize a PID string before map lookup — trims whitespace and trailing
// dots/periods (some recorders append ".", "．", "。" to the same PID, e.g.
// "绝对踏板位置E." vs "绝对踏板位置E").
function canonicalPid(pid) {
  return String(pid).trim().replace(/[.．。\s]+$/u, '');
}

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

// Determine wall-clock start of the recording. Three cases:
//   1) SECONDS column is Unix epoch (≥ year 2001 ~ 1e9): use it directly,
//      subtract that day's local midnight to land on time-of-day seconds.
//   2) SECONDS column is already time-of-day seconds (the OBD recorder's
//      default): pass through. This is the default for non-epoch data.
//   3) Explicit --relative + --start (or filename pattern): SECONDS is
//      counted from power-on / app start; re-anchor against the given
//      wall-clock start.
const startFlag = typeof flags.start === 'string' ? flags.start : null;
const epochMode = t0 >= 1e9 && !startFlag;
const relativeMode = !!flags.relative;

function parseStartString(s) {
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})[\sT](\d{2})[:\-](\d{2})[:\-](\d{2})/,
  );
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}
function parseStartFromFilename() {
  const m = path
    .basename(input)
    .match(/(\d{4})-(\d{2})-(\d{2})[\s_T](\d{2})[-:](\d{2})[-:](\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

let startDate;
if (startFlag) {
  startDate = parseStartString(startFlag);
  if (!startDate) {
    console.error('Invalid --start; expected "YYYY-MM-DD HH:MM:SS".');
    process.exit(1);
  }
} else if (epochMode) {
  startDate = new Date(t0 * 1000);
} else if (relativeMode) {
  startDate = parseStartFromFilename();
  if (!startDate) {
    console.error(
      `--relative requires a wall-clock start. Either rename the input file like "YYYY-MM-DD HH-MM-SS.csv" or pass --start="YYYY-MM-DD HH:MM:SS".`,
    );
    process.exit(1);
  }
} else {
  // TOD mode: filename is optional (used only for the date label in logs).
  startDate = parseStartFromFilename() ?? new Date();
}

const localMidnight =
  new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate(),
  ).getTime() / 1000;
const startSecOfDay = startDate.getTime() / 1000 - localMidnight;
function toTimeOfDay(absSecs) {
  if (epochMode) return absSecs - localMidnight;
  if (relativeMode) return (absSecs - t0) + startSecOfDay;
  // Default: SECONDS is already time-of-day; pass through.
  return absSecs;
}

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
  if (col === 'rpm_x1000') return Number.isFinite(n) ? n * 1000 : undefined;
  return Number.isFinite(n) ? n : undefined;
}

// First pass: observe max distance so we can normalise progress.
let distanceMax = 0;
for (const e of events) {
  const col = PID_MAP[canonicalPid(e.pid)];
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
    if (PID_MAP[canonicalPid(e.pid)] !== 'speed_kmh') continue;
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
    const col = PID_MAP[canonicalPid(e.pid)];
    if (!col) continue;
    const v = parseVal(col, e.value);
    if (v !== undefined) state[col] = v;
  }
  const speed = state.speed_kmh;
  if (speed === undefined) continue; // wait until we have speed

  const throttleRaw =
    state.throttle_rel_pct ??
    state.pedal_pct ??
    state.pedal_pct_d ??
    state.throttle_pct ??
    state.throttle_pct_b;
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

  const t = toTimeOfDay(absT);
  rows.push({
    t: t.toFixed(3),
    speed_kmh: speed.toFixed(2),
    rpm: rpm === '' ? '' : Math.round(rpm),
    gear,
    throttle: throttle === '' ? '' : throttle.toFixed(2),
    brake,
    abs,
    progress: progress === '' ? '' : progress.toFixed(4),
    position_current: positionCurrent,
    position_total: positionTotal,
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
  'position_current',
  'position_total',
];
const out = [headerCols.join(',')];
for (const r of rows) {
  out.push(
    [
      r.t,
      r.speed_kmh,
      r.rpm,
      rpmMax,
      r.gear,
      r.throttle,
      r.brake,
      r.abs,
      '',
      r.progress,
      r.position_current,
      r.position_total,
    ].join(','),
  );
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, out.join('\n') + '\n', 'utf8');

const cadence = rateHz ? `${rateHz}Hz` : 'speed-event cadence';
const startTod = toTimeOfDay(t0);
const endTod = toTimeOfDay(tEnd);
function fmtTod(s) {
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = (s % 60).toFixed(3);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${ss.padStart(6, '0')}`;
}
console.log(
  `Wrote ${rows.length} rows (${duration.toFixed(1)}s @ ${cadence}) → ${output}`,
);
console.log(
  `  t = seconds since local midnight (${startDate.toLocaleDateString()}); range ${fmtTod(startTod)} → ${fmtTod(endTod)}`,
);
console.log(`  observed rpm max: ${rpmMaxObserved}, rpm_max set to ${rpmMax}`);
console.log(`  grid position: ${positionCurrent}/${positionTotal}`);
if (distanceMax > 0) console.log(`  distance max: ${distanceMax} km (→ progress)`);
