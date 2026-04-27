import { create } from 'zustand';
import type { TelemetryTrack, Track, PlayerProfile } from '../data/schema';
import { isCoordinateSystem, type CoordinateSystem } from '../util/coordinateSystems';
import { normalizeProjectFps } from '../util/timecode';
import type { SpeedUnit } from '../util/units';

export type WidgetId =
  | 'topLeft.progress'
  | 'topRight.position'
  | 'minimap.disc'
  | 'minimap.name'
  | 'speedo.gauge';

export interface WidgetState {
  x: number;
  y: number;
  scale: number;
}

export type Layout = Record<WidgetId, WidgetState>;

const DEFAULT_LAYOUT: Layout = {
  'topLeft.progress': { x: 0, y: 0, scale: 1 },
  'topRight.position': { x: 0, y: 0, scale: 1 },
  'minimap.disc': { x: 0, y: 0, scale: 1 },
  'minimap.name': { x: 0, y: 0, scale: 1 },
  'speedo.gauge': { x: 0, y: 0, scale: 1 },
};

const LAYOUT_KEY = 'hud5.layout.v1';
const PRESETS_KEY = 'hud5.presets.v1';
const SETTINGS_KEY = 'hud5.settings.v1';

export interface HudSettings {
  trackCoordinateSystem: CoordinateSystem;
  snapToRoads: boolean;
  snapMaxDistM: number;
  minimapViewRadiusM: number;
  minimapTiltDeg: number;
  minimapStrokeWidth: number;
}

export const DEFAULT_SETTINGS: HudSettings = {
  trackCoordinateSystem: 'wgs84',
  snapToRoads: true,
  snapMaxDistM: 5,
  minimapViewRadiusM: 50,
  minimapTiltDeg: 70,
  minimapStrokeWidth: 10,
};

function normalizeSettings(parsed: unknown): HudSettings {
  const out: HudSettings = { ...DEFAULT_SETTINGS };
  if (parsed && typeof parsed === 'object') {
    const rec = parsed as Record<string, unknown>;
    if (typeof rec.trackCoordinateSystem === 'string' && isCoordinateSystem(rec.trackCoordinateSystem)) {
      out.trackCoordinateSystem = rec.trackCoordinateSystem;
    }
    if (typeof rec.snapToRoads === 'boolean') out.snapToRoads = rec.snapToRoads;
    if (typeof rec.snapMaxDistM === 'number' && rec.snapMaxDistM >= 0) {
      out.snapMaxDistM = rec.snapMaxDistM;
    }
    if (typeof rec.minimapViewRadiusM === 'number' && rec.minimapViewRadiusM > 0) {
      out.minimapViewRadiusM = rec.minimapViewRadiusM;
    }
    if (typeof rec.minimapTiltDeg === 'number' && rec.minimapTiltDeg >= 0) {
      out.minimapTiltDeg = rec.minimapTiltDeg;
    }
    if (typeof rec.minimapStrokeWidth === 'number' && rec.minimapStrokeWidth > 0) {
      out.minimapStrokeWidth = rec.minimapStrokeWidth;
    }
  }
  return out;
}

function loadSettings(): HudSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(s: HudSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

function normalizeLayout(parsed: unknown): Layout {
  const out: Layout = { ...DEFAULT_LAYOUT };
  if (parsed && typeof parsed === 'object') {
    for (const id of Object.keys(DEFAULT_LAYOUT) as WidgetId[]) {
      const v = (parsed as Record<string, unknown>)[id];
      if (v && typeof v === 'object') {
        const rec = v as Record<string, unknown>;
        out[id] = {
          x: typeof rec.x === 'number' ? rec.x : 0,
          y: typeof rec.y === 'number' ? rec.y : 0,
          scale: typeof rec.scale === 'number' && rec.scale > 0 ? rec.scale : 1,
        };
      }
    }
  }
  return out;
}

function loadLayout(): Layout {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return { ...DEFAULT_LAYOUT };
    return normalizeLayout(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

function saveLayout(l: Layout) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(l));
  } catch {
    /* ignore */
  }
}

export type Presets = Record<string, Layout>;

function loadPresets(): Presets {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Presets = {};
    for (const [name, layout] of Object.entries(parsed as Record<string, unknown>)) {
      out[name] = normalizeLayout(layout);
    }
    return out;
  } catch {
    return {};
  }
}

function savePresetsToStorage(p: Presets) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

interface PlaybackState {
  telemetry: TelemetryTrack | null;
  track: Track | null;
  profile: PlayerProfile;
  /** Absolute playhead time, in seconds since local midnight (matches the
   *  CSV/GPX time-of-day convention). */
  currentTime: number;
  playing: boolean;
  rate: number;
  unit: SpeedUnit;
  exporterMode: boolean;
  editMode: boolean;
  layout: Layout;
  presets: Presets;
  settings: HudSettings;
  stageScale: number;
  videoUrl: string | null;
  videoAspect: number;
  videoDuration: number;
  videoWidth: number;
  videoHeight: number;
  previewAspect: number | null;
  projectFps: number;
  /** Per-source offsets (seconds) added to that source's intrinsic t to
   *  map it onto the shared absolute axis. Lets users fine-tune alignment. */
  telemetryOffset: number;
  trackOffset: number;
  /** Time-of-day at which video frame 0 plays. */
  videoOffset: number;
  /** Embedded SMPTE timecode start from the video file, if parsed. */
  videoEmbeddedTimecode: number | null;
  /** Per-source trim (seconds) — clip data from start or end. */
  telemetryTrimStart: number;
  telemetryTrimEnd: number;
  trackTrimStart: number;
  trackTrimEnd: number;
  videoTrimStart: number;
  videoTrimEnd: number;
  /** Selected playback range on the absolute axis. null = use full axis. */
  playbackStart: number | null;
  playbackEnd: number | null;
  /** Legacy export-duration override (kept for export pipeline). null = use
   *  effective selection length. */
  projectDuration: number | null;

  setPreviewAspect(a: number | null): void;
  setProjectFps(fps: number): void;
  setProjectDuration(d: number | null): void;
  setTelemetry(t: TelemetryTrack | null): void;
  setVideo(
    url: string | null,
    aspect: number,
    duration: number,
    width?: number,
    height?: number,
    embeddedTimecodeStart?: number | null,
  ): void;
  setTrack(t: Track | null, opts?: { resetTimeline?: boolean }): void;
  setProfile(p: Partial<PlayerProfile>): void;
  setUnit(u: SpeedUnit): void;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(t: number): void;
  setRate(r: number): void;
  setExporterMode(on: boolean): void;
  setEditMode(on: boolean): void;
  setStageScale(s: number): void;
  nudgeWidget(id: WidgetId, dx: number, dy: number): void;
  setWidgetOffset(id: WidgetId, x: number, y: number): void;
  setWidgetScale(id: WidgetId, scale: number): void;
  resetLayout(): void;
  savePreset(name: string): void;
  loadPreset(name: string): void;
  deletePreset(name: string): void;
  setSetting<K extends keyof HudSettings>(key: K, value: HudSettings[K]): void;
  resetSettings(): void;
  setTelemetryOffset(s: number): void;
  setTrackOffset(s: number): void;
  setVideoOffset(s: number): void;
  setSelection(start: number | null, end: number | null): void;
  clearVideo(): void;
  setSourceTrim(source: SourceKey, start: number, end: number): void;
}

export type SourceKey = 'track' | 'telemetry' | 'video';

export const usePlayback = create<PlaybackState>((set, get) => ({
  telemetry: null,
  track: null,
  profile: { name: 'ANNA' },
  currentTime: 0,
  playing: false,
  rate: 1,
  unit: 'kmh',
  exporterMode: false,
  editMode: false,
  layout: loadLayout(),
  presets: loadPresets(),
  settings: loadSettings(),
  stageScale: 1,
  videoUrl: null,
  videoAspect: 16 / 9,
  videoDuration: 0,
  videoWidth: 0,
  videoHeight: 0,
  previewAspect: null,
  projectFps: 60,
  telemetryOffset: 0,
  trackOffset: 0,
  videoOffset: 0,
  videoEmbeddedTimecode: null,
  telemetryTrimStart: 0,
  telemetryTrimEnd: 0,
  trackTrimStart: 0,
  trackTrimEnd: 0,
  videoTrimStart: 0,
  videoTrimEnd: 0,
  playbackStart: null,
  playbackEnd: null,
  projectDuration: null,

  setPreviewAspect: a => set({ previewAspect: a }),
  setProjectFps: fps => set({ projectFps: normalizeProjectFps(fps) }),
  setProjectDuration: d => set({ projectDuration: d !== null && d > 0 ? d : null }),
  setTelemetry: t => {
    set({
      telemetry: t,
      telemetryOffset: 0,
      telemetryTrimStart: 0,
      telemetryTrimEnd: 0,
      playing: false,
      playbackStart: null,
      playbackEnd: null,
    });
    snapPlayheadToAxis(set, get, { forceStart: true });
  },
  setVideo: (url, aspect, duration, width = 0, height = 0, embeddedTimecodeStart = null) => {
    const prev = get().videoUrl;
    if (prev) URL.revokeObjectURL(prev);
    // Default video offset: align video frame 0 with the earliest data
    // source so a freshly-imported clip lines up sensibly.
    const s = get();
    const dataStart = earliestDataStart(s.telemetry, s.track, s.telemetryOffset, s.trackOffset);
    set({
      videoUrl: url,
      videoAspect: aspect,
      videoDuration: duration,
      videoWidth: width,
      videoHeight: height,
      videoOffset: embeddedTimecodeStart ?? dataStart ?? 0,
      videoEmbeddedTimecode: embeddedTimecodeStart ?? null,
      videoTrimStart: 0,
      videoTrimEnd: 0,
      playing: false,
      playbackStart: null,
      playbackEnd: null,
    });
    snapPlayheadToAxis(set, get, { forceStart: true });
  },
  setTrack: (t, opts) => {
    const resetTimeline = opts?.resetTimeline ?? true;
    set({
      track: t,
      ...(resetTimeline
        ? {
            trackOffset: 0,
            trackTrimStart: 0,
            trackTrimEnd: 0,
            playbackStart: null,
            playbackEnd: null,
          }
        : null),
    });
    snapPlayheadToAxis(set, get, { forceStart: resetTimeline });
  },
  setProfile: p => set(s => ({ profile: { ...s.profile, ...p } })),
  setUnit: u => set({ unit: u }),
  play: () => {
    const s = get();
    if (!s.telemetry && !s.videoUrl) return;
    // If at the end of the selection, rewind to the start before playing.
    const [start, end] = effectiveRangeFromState(s);
    if (s.currentTime >= end - 1e-6) set({ currentTime: start });
    set({ playing: true });
  },
  pause: () => set({ playing: false }),
  toggle: () => {
    const s = get();
    if (s.playing) set({ playing: false });
    else get().play();
  },
  seek: t => {
    const s = get();
    const [start, end] = effectiveRangeFromState(s);
    set({ currentTime: clampN(t, start, end) });
  },
  setTelemetryOffset: offset => {
    set({ telemetryOffset: offset });
    snapPlayheadToAxis(set, get);
  },
  setTrackOffset: offset => {
    set({ trackOffset: offset });
    snapPlayheadToAxis(set, get);
  },
  setVideoOffset: offset => {
    set({ videoOffset: offset });
    snapPlayheadToAxis(set, get);
  },
  setSelection: (start, end) => {
    if (start !== null && end !== null && end < start) [start, end] = [end, start];
    set({ playbackStart: start, playbackEnd: end });
    const s = get();
    const [a, b] = effectiveRangeFromState(s);
    set({ currentTime: clampN(s.currentTime, a, b) });
  },
  clearVideo: () => {
    const prev = get().videoUrl;
    if (prev) URL.revokeObjectURL(prev);
    set({
      videoUrl: null,
      videoAspect: 16 / 9,
      videoDuration: 0,
      videoWidth: 0,
      videoHeight: 0,
      videoOffset: 0,
      videoEmbeddedTimecode: null,
      videoTrimStart: 0,
      videoTrimEnd: 0,
      playing: false,
      playbackStart: null,
      playbackEnd: null,
    });
    snapPlayheadToAxis(set, get, { forceStart: true });
  },
  setSourceTrim: (source, start, end) => {
    const fields =
      source === 'telemetry'
        ? { telemetryTrimStart: start, telemetryTrimEnd: end }
        : source === 'track'
          ? { trackTrimStart: start, trackTrimEnd: end }
          : { videoTrimStart: start, videoTrimEnd: end };
    set(fields);
    snapPlayheadToAxis(set, get);
  },
  setRate: r => set({ rate: r }),
  setExporterMode: on => set({ exporterMode: on }),
  setEditMode: on => set({ editMode: on }),
  setStageScale: s => set({ stageScale: s }),
  nudgeWidget: (id, dx, dy) => {
    const cur = get().layout[id];
    const next: Layout = { ...get().layout, [id]: { x: cur.x + dx, y: cur.y + dy } };
    saveLayout(next);
    set({ layout: next });
  },
  setWidgetOffset: (id, x, y) => {
    const cur = get().layout[id];
    const next: Layout = { ...get().layout, [id]: { ...cur, x, y } };
    saveLayout(next);
    set({ layout: next });
  },
  setWidgetScale: (id, scale) => {
    const cur = get().layout[id];
    const next: Layout = {
      ...get().layout,
      [id]: { ...cur, scale: scale > 0.01 ? scale : 0.01 },
    };
    saveLayout(next);
    set({ layout: next });
  },
  resetLayout: () => {
    saveLayout({ ...DEFAULT_LAYOUT });
    set({ layout: { ...DEFAULT_LAYOUT } });
  },
  savePreset: name => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const snapshot = JSON.parse(JSON.stringify(get().layout)) as Layout;
    const next: Presets = { ...get().presets, [trimmed]: snapshot };
    savePresetsToStorage(next);
    set({ presets: next });
  },
  loadPreset: name => {
    const preset = get().presets[name];
    if (!preset) return;
    const next = normalizeLayout(preset);
    saveLayout(next);
    set({ layout: next });
  },
  deletePreset: name => {
    const { [name]: _, ...rest } = get().presets;
    savePresetsToStorage(rest);
    set({ presets: rest });
  },
  setSetting: (key, value) => {
    const next = { ...get().settings, [key]: value };
    saveSettings(next);
    set({ settings: next });
  },
  resetSettings: () => {
    const next = { ...DEFAULT_SETTINGS };
    saveSettings(next);
    set({ settings: next });
  },
}));

function clampN(n: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.max(lo, Math.min(hi, n));
}

export type Range = [number, number];

function telemetryFirstLast(t: TelemetryTrack | null): Range | null {
  if (!t || t.samples.length === 0) return null;
  return [t.samples[0].t, t.samples[t.samples.length - 1].t];
}

function trackFirstLast(track: Track | null): Range | null {
  if (!track) return null;
  for (const layer of track.layers) {
    const pts = layer.points;
    if (!pts.length) continue;
    let lo: number | undefined, hi: number | undefined;
    for (const p of pts) {
      if (p.t === undefined) continue;
      if (lo === undefined || p.t < lo) lo = p.t;
      if (hi === undefined || p.t > hi) hi = p.t;
    }
    if (lo !== undefined && hi !== undefined) return [lo, hi];
  }
  return null;
}

function earliestDataStart(
  tel: TelemetryTrack | null,
  trk: Track | null,
  telOffset: number,
  trkOffset: number,
): number | null {
  const t = telemetryFirstLast(tel);
  const r = trackFirstLast(trk);
  const candidates: number[] = [];
  if (t) candidates.push(t[0] + telOffset);
  if (r) candidates.push(r[0] + trkOffset);
  return candidates.length ? Math.min(...candidates) : null;
}

/** Returns absolute-time range of every loaded source after offsets. */
export function sourceRanges(s: PlaybackState): {
  telemetry: Range | null;
  track: Range | null;
  video: Range | null;
} {
  const tel = telemetryFirstLast(s.telemetry);
  const trk = trackFirstLast(s.track);
  return {
    telemetry: tel
      ? [tel[0] + s.telemetryOffset + s.telemetryTrimStart, tel[1] + s.telemetryOffset - s.telemetryTrimEnd]
      : null,
    track: trk
      ? [trk[0] + s.trackOffset + s.trackTrimStart, trk[1] + s.trackOffset - s.trackTrimEnd]
      : null,
    video: s.videoUrl && s.videoDuration > 0
      ? [s.videoOffset + s.videoTrimStart, s.videoOffset + s.videoDuration - s.videoTrimEnd]
      : null,
  };
}

/** Union of all source ranges; falls back to [0, 0] when nothing is loaded. */
export function axisRange(s: PlaybackState): Range {
  const { telemetry, track, video } = sourceRanges(s);
  const ranges = [telemetry, track, video].filter(Boolean) as Range[];
  if (ranges.length === 0) return [0, 0];
  let lo = Infinity;
  let hi = -Infinity;
  for (const [a, b] of ranges) {
    if (a < lo) lo = a;
    if (b > hi) hi = b;
  }
  return [lo, hi];
}

/** Selection if set, otherwise the full axis range. */
export function effectiveRange(s: PlaybackState): Range {
  return effectiveRangeFromState(s);
}
function effectiveRangeFromState(s: PlaybackState): Range {
  const [lo, hi] = axisRange(s);
  const start = s.playbackStart ?? lo;
  const end = s.playbackEnd ?? hi;
  return [Math.min(start, end), Math.max(start, end)];
}

function snapPlayheadToAxis(
  set: (partial: Partial<PlaybackState>) => void,
  get: () => PlaybackState,
  opts: { forceStart?: boolean } = {},
) {
  const s = get();
  const [lo, hi] = effectiveRangeFromState(s);
  if (opts.forceStart) {
    set({ currentTime: lo });
    return;
  }
  if (hi <= lo) {
    set({ currentTime: lo });
    return;
  }
  if (s.currentTime < lo || s.currentTime > hi) {
    set({ currentTime: lo });
  }
}

let raf = 0;
let last = 0;

export function startPlaybackLoop(): () => void {
  const tick = (ts: number) => {
    const s = usePlayback.getState();
    const [start, end] = effectiveRangeFromState(s);
    // When a video is loaded, the <video> element is the time source —
    // App.tsx pushes video.currentTime into the store each rAF tick.
    if (s.playing && end > start && !s.videoUrl) {
      if (last) {
        const dt = ((ts - last) / 1000) * s.rate;
        const next = s.currentTime + dt;
        if (next >= end) {
          usePlayback.setState({ currentTime: end, playing: false });
        } else {
          usePlayback.setState({ currentTime: next });
        }
      }
      last = ts;
    } else {
      last = 0;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
