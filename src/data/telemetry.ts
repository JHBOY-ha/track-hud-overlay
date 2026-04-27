import Papa from 'papaparse';
import type { GearValue, TelemetrySample, TelemetryTrack } from './schema';
import { lerp } from '../util/units';

const DEFAULT_RPM_MAX = 8000;

function parseGear(raw: unknown): GearValue | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const s = String(raw).trim().toUpperCase();
  if (s === 'N' || s === 'R') return s;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function num(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function bool(raw: unknown): boolean | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const s = String(raw).trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes') return true;
  if (s === '0' || s === 'false' || s === 'no') return false;
  return undefined;
}

export function parseTelemetryCsv(text: string): TelemetryTrack {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim().toLowerCase(),
  });

  const samples: TelemetrySample[] = [];
  let rpmMax = DEFAULT_RPM_MAX;

  for (const row of parsed.data) {
    const t = num(row.t);
    const speed = num(row.speed_kmh) ?? num(row.speed);
    if (t === undefined || speed === undefined) continue;
    const s: TelemetrySample = {
      t,
      speedKmh: speed,
      rpm: num(row.rpm),
      rpmMax: num(row.rpm_max),
      gear: parseGear(row.gear),
      throttle: num(row.throttle),
      brake: num(row.brake),
      abs: bool(row.abs),
      tcs: bool(row.tcs),
      progress: num(row.progress),
      positionCurrent: num(row.position_current),
      positionTotal: num(row.position_total),
    };
    if (s.rpmMax) rpmMax = s.rpmMax;
    samples.push(s);
  }

  samples.sort((a, b) => a.t - b.t);
  const duration = samples.length ? samples[samples.length - 1].t : 0;
  return { samples, duration, rpmMax };
}

export function parseTelemetryJson(text: string): TelemetryTrack {
  const raw = JSON.parse(text);
  const arr: any[] = Array.isArray(raw) ? raw : raw.samples ?? [];
  const samples: TelemetrySample[] = arr
    .map(r => ({
      t: Number(r.t),
      speedKmh: Number(r.speedKmh ?? r.speed_kmh ?? r.speed),
      rpm: r.rpm != null ? Number(r.rpm) : undefined,
      rpmMax: r.rpmMax ?? r.rpm_max,
      gear: parseGear(r.gear),
      throttle: r.throttle != null ? Number(r.throttle) : undefined,
      brake: r.brake != null ? Number(r.brake) : undefined,
      abs: typeof r.abs === 'boolean' ? r.abs : bool(r.abs),
      tcs: typeof r.tcs === 'boolean' ? r.tcs : bool(r.tcs),
      progress: r.progress != null ? Number(r.progress) : undefined,
      positionCurrent: r.positionCurrent ?? r.position_current,
      positionTotal: r.positionTotal ?? r.position_total,
    }))
    .filter(s => Number.isFinite(s.t) && Number.isFinite(s.speedKmh));

  samples.sort((a, b) => a.t - b.t);
  const duration = samples.length ? samples[samples.length - 1].t : 0;
  const rpmMax = samples.find(s => s.rpmMax)?.rpmMax ?? DEFAULT_RPM_MAX;
  return { samples, duration, rpmMax };
}

function findIndex(samples: TelemetrySample[], t: number): number {
  if (samples.length === 0) return -1;
  if (t <= samples[0].t) return 0;
  if (t >= samples[samples.length - 1].t) return samples.length - 1;
  let lo = 0, hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

function lerpOpt(a: number | undefined, b: number | undefined, f: number): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  if (a === undefined) return b;
  if (b === undefined) return a;
  return lerp(a, b, f);
}

export function sampleAt(
  track: TelemetryTrack,
  t: number,
  trimStart = 0,
  trimEnd = 0,
): TelemetrySample | null {
  const { samples } = track;
  if (samples.length === 0) return null;
  const firstT = samples[0].t + trimStart;
  const lastT = samples[samples.length - 1].t - trimEnd;
  if (t < firstT || t > lastT) return null;
  const i = findIndex(samples, t);
  const a = samples[i];
  const b = samples[Math.min(i + 1, samples.length - 1)];
  if (a === b || b.t === a.t) return a;
  const f = (t - a.t) / (b.t - a.t);
  return {
    t,
    speedKmh: lerp(a.speedKmh, b.speedKmh, f),
    rpm: lerpOpt(a.rpm, b.rpm, f),
    rpmMax: a.rpmMax ?? b.rpmMax,
    gear: a.gear,
    throttle: lerpOpt(a.throttle, b.throttle, f),
    brake: lerpOpt(a.brake, b.brake, f),
    abs: a.abs,
    tcs: a.tcs,
    progress: lerpOpt(a.progress, b.progress, f),
    positionCurrent: a.positionCurrent,
    positionTotal: a.positionTotal ?? b.positionTotal,
  };
}
