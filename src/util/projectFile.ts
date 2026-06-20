import type { TelemetryTrack } from '../data/schema';
import type { HudSettings } from '../playback/store';
import type { SpeedUnit } from './units';

export const HUD5_PROJECT_VERSION = 1;

/** Raw, re-parseable track source embedded in a project file. Mirrors the
 *  `TrackSource` shape used in App.tsx so a project restore can re-run the
 *  existing projection/snap pipeline rather than baking in projected points. */
export interface ProjectTrackSource {
  kind: 'gpx' | 'geojson';
  text: string;
  normalizedWgs84?: boolean;
}

/** A self-contained HUD5 project archive: embeds the actual telemetry/track
 *  data plus every setting that the export command encodes, so a project can be
 *  restored without the original source files. */
export interface Hud5Project {
  app: 'hud5';
  version: number;
  // Embedded data
  telemetry: TelemetryTrack | null;
  trackSource: ProjectTrackSource | null;
  // Settings snapshot (same set the export command carries)
  profileName: string;
  unit: SpeedUnit;
  projectFps: number;
  previewAspect: number | null;
  telemetryOffset: number;
  trackOffset: number;
  videoOffset: number;
  telemetryTrimStart: number;
  telemetryTrimEnd: number;
  trackTrimStart: number;
  trackTrimEnd: number;
  videoTrimStart: number;
  videoTrimEnd: number;
  playbackStart: number | null;
  playbackEnd: number | null;
  progressStart: number | null;
  progressEnd: number | null;
  progressStartPct: number;
  progressEndPct: number;
  elapsedStart: number;
  settings: HudSettings;
}

/** The subset of playback-store state captured into a project file. */
export interface ProjectStateSnapshot {
  telemetry: TelemetryTrack | null;
  profile: { name: string };
  unit: SpeedUnit;
  projectFps: number;
  previewAspect: number | null;
  telemetryOffset: number;
  trackOffset: number;
  videoOffset: number;
  telemetryTrimStart: number;
  telemetryTrimEnd: number;
  trackTrimStart: number;
  trackTrimEnd: number;
  videoTrimStart: number;
  videoTrimEnd: number;
  playbackStart: number | null;
  playbackEnd: number | null;
  progressStart: number | null;
  progressEnd: number | null;
  progressStartPct: number;
  progressEndPct: number;
  elapsedStart: number;
  settings: HudSettings;
}

export function buildProject(
  state: ProjectStateSnapshot,
  trackSource: ProjectTrackSource | null,
): Hud5Project {
  return {
    app: 'hud5',
    version: HUD5_PROJECT_VERSION,
    telemetry: state.telemetry,
    trackSource: trackSource
      ? {
          kind: trackSource.kind,
          text: trackSource.text,
          ...(trackSource.normalizedWgs84 ? { normalizedWgs84: true } : {}),
        }
      : null,
    profileName: state.profile.name,
    unit: state.unit,
    projectFps: state.projectFps,
    previewAspect: state.previewAspect,
    telemetryOffset: state.telemetryOffset,
    trackOffset: state.trackOffset,
    videoOffset: state.videoOffset,
    telemetryTrimStart: state.telemetryTrimStart,
    telemetryTrimEnd: state.telemetryTrimEnd,
    trackTrimStart: state.trackTrimStart,
    trackTrimEnd: state.trackTrimEnd,
    videoTrimStart: state.videoTrimStart,
    videoTrimEnd: state.videoTrimEnd,
    playbackStart: state.playbackStart,
    playbackEnd: state.playbackEnd,
    progressStart: state.progressStart,
    progressEnd: state.progressEnd,
    progressStartPct: state.progressStartPct,
    progressEndPct: state.progressEndPct,
    elapsedStart: state.elapsedStart,
    settings: state.settings,
  };
}

/** Trigger a browser download of the project as a `.hud5proj.json` file. */
export function downloadProject(project: Hud5Project, filename: string): void {
  const blob = new Blob([JSON.stringify(project, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Suggest a project filename from the player name and a date string. */
export function projectFilename(playerName: string, date: Date): string {
  const safe = (playerName || 'project').replace(/[^\w.-]+/g, '_');
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${safe}-${y}${m}${d}.hud5proj.json`;
}

/** True if a filename should be treated as a HUD5 project archive. */
export function isProjectFilename(name: string): boolean {
  return /\.hud5proj(\.json)?$/i.test(name);
}

/** Parse and validate a project file's text. Throws on malformed JSON, wrong
 *  app marker, or an unsupported version. */
export function parseProjectText(text: string): Hud5Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('文件不是有效的 JSON');
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error('工程文件格式无效');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.app !== 'hud5') {
    throw new Error('不是 HUD5 工程文件');
  }
  if (typeof obj.version !== 'number' || obj.version > HUD5_PROJECT_VERSION) {
    throw new Error(
      `工程文件版本不受支持（v${String(obj.version)}），请升级应用`,
    );
  }
  return obj as unknown as Hud5Project;
}
