import { isCoordinateSystem, type CoordinateSystem } from './coordinateSystems';
import type { SpeedUnit } from './units';

/** Settings recovered from an export command string. Every field is optional —
 *  only flags actually present in the command are filled in. Frame-based range
 *  flags are converted back to seconds on the absolute axis using --fps. */
export interface ParsedExportCommand {
  telemetryUrl?: string;
  trackUrl?: string;
  fps?: number;
  width?: number;
  height?: number;
  unit?: SpeedUnit;
  player?: string;
  coord?: CoordinateSystem;
  telemetryOffset?: number;
  trackOffset?: number;
  videoOffset?: number;
  snapToRoads?: boolean;
  snapMaxDistM?: number;
  minimapViewRadiusM?: number;
  minimapTiltDeg?: number;
  minimapStrokeWidth?: number;
  hudShakeEnabled?: boolean;
  hudShakeIntensity?: number;
  hudCurvatureEnabled?: boolean;
  hudCurvatureIntensity?: number;
  progressStart?: number;
  progressEnd?: number;
  progressStartPct?: number;
  progressEndPct?: number;
  elapsedStart?: number;
  rangeStartSec?: number;
  rangeEndSec?: number;
}

/** Tokenize a shell command line. Handles single/double quotes (including the
 *  `'\''` escape that shellQuote() emits) and backslash escapes, so adjacent
 *  quoted+escaped+bare segments collapse into one token. */
export function tokenizeCommand(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = input.length;
  const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
  while (i < n) {
    while (i < n && isSpace(input[i])) i++;
    if (i >= n) break;
    let cur = '';
    while (i < n && !isSpace(input[i])) {
      const c = input[i];
      if (c === "'") {
        i++;
        while (i < n && input[i] !== "'") cur += input[i++];
        i++; // closing quote
      } else if (c === '"') {
        i++;
        while (i < n && input[i] !== '"') {
          if (input[i] === '\\' && i + 1 < n) {
            i++;
            cur += input[i++];
          } else {
            cur += input[i++];
          }
        }
        i++; // closing quote
      } else if (c === '\\' && i + 1 < n) {
        i++;
        cur += input[i++];
      } else {
        cur += c;
        i++;
      }
    }
    tokens.push(cur);
  }
  return tokens;
}

/** Collect `--flag value` pairs from tokens into a map. */
export function commandFlags(input: string): Map<string, string> {
  const tokens = tokenizeCommand(input);
  const flags = new Map<string, string>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith('--')) {
      const next = tokens[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(t.slice(2), next);
        i++;
      } else {
        flags.set(t.slice(2), '');
      }
    }
  }
  return flags;
}

function num(map: Map<string, string>, key: string): number | undefined {
  const raw = map.get(key);
  if (raw === undefined || raw.trim() === '') return undefined;
  const v = Number(raw);
  return Number.isFinite(v) ? v : undefined;
}

function bool01(map: Map<string, string>, key: string): boolean | undefined {
  const raw = map.get(key);
  if (raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return undefined;
}

/** Parse an export command string into the settings it encodes. Throws if the
 *  text does not look like an export-frames command. */
export function parseExportCommand(input: string): ParsedExportCommand {
  const flags = commandFlags(input);
  if (!input.includes('export-frames') && flags.size === 0) {
    throw new Error('无法识别的导出命令');
  }

  const out: ParsedExportCommand = {};
  const tel = flags.get('telemetry');
  if (tel && tel.trim() !== '') out.telemetryUrl = tel;
  const trk = flags.get('track');
  if (trk && trk.trim() !== '') out.trackUrl = trk;

  out.fps = num(flags, 'fps');
  out.width = num(flags, 'width');
  out.height = num(flags, 'height');

  const u = flags.get('unit');
  if (u === 'kmh' || u === 'mph') out.unit = u;
  const player = flags.get('player');
  if (player !== undefined && player !== '') out.player = player;
  const coord = flags.get('coord');
  if (isCoordinateSystem(coord)) out.coord = coord;

  out.telemetryOffset = num(flags, 'telemetry-offset');
  out.trackOffset = num(flags, 'track-offset');
  out.videoOffset = num(flags, 'video-offset');

  out.snapToRoads = bool01(flags, 'snap-to-roads');
  out.snapMaxDistM = num(flags, 'snap-max-dist');
  out.minimapViewRadiusM = num(flags, 'minimap-radius');
  out.minimapTiltDeg = num(flags, 'minimap-tilt');
  out.minimapStrokeWidth = num(flags, 'minimap-stroke');

  out.hudShakeEnabled = bool01(flags, 'hud-shake');
  out.hudShakeIntensity = num(flags, 'hud-shake-intensity');
  out.hudCurvatureEnabled = bool01(flags, 'hud-curvature');
  out.hudCurvatureIntensity = num(flags, 'hud-curvature-intensity');

  out.progressStart = num(flags, 'progress-start');
  out.progressEnd = num(flags, 'progress-end');
  out.progressStartPct = num(flags, 'progress-start-pct');
  out.progressEndPct = num(flags, 'progress-end-pct');
  out.elapsedStart = num(flags, 'elapsed-start');

  // Range flags are in frames; convert to absolute-axis seconds via fps.
  const rangeStartFrame = num(flags, 'range-start');
  const rangeEndFrame = num(flags, 'range-end');
  if (out.fps && out.fps > 0) {
    if (rangeStartFrame !== undefined) out.rangeStartSec = rangeStartFrame / out.fps;
    if (rangeEndFrame !== undefined) out.rangeEndSec = rangeEndFrame / out.fps;
  }

  return out;
}
