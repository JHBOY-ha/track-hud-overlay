import { create } from 'zustand';
import type { TelemetryTrack, Track, PlayerProfile } from '../data/schema';
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
  snapToRoads: boolean;
  snapMaxDistM: number;
  minimapViewRadiusM: number;
  minimapTiltDeg: number;
  minimapStrokeWidth: number;
}

export const DEFAULT_SETTINGS: HudSettings = {
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
  ): void;
  setTrack(t: Track | null): void;
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
}

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
  projectDuration: null,

  setPreviewAspect: a => set({ previewAspect: a }),
  setProjectFps: fps => set({ projectFps: fps > 0 ? fps : 60 }),
  setProjectDuration: d => set({ projectDuration: d !== null && d > 0 ? d : null }),
  setTelemetry: t => set({ telemetry: t, currentTime: 0, playing: false }),
  setVideo: (url, aspect, duration, width = 0, height = 0) => {
    const prev = get().videoUrl;
    if (prev) URL.revokeObjectURL(prev);
    set({
      videoUrl: url,
      videoAspect: aspect,
      videoDuration: duration,
      videoWidth: width,
      videoHeight: height,
      currentTime: 0,
      playing: false,
    });
  },
  setTrack: t => set({ track: t }),
  setProfile: p => set(s => ({ profile: { ...s.profile, ...p } })),
  setUnit: u => set({ unit: u }),
  play: () => {
    const s = get();
    if (!s.telemetry && !s.videoUrl) return;
    set({ playing: true });
  },
  pause: () => set({ playing: false }),
  toggle: () => set(s => ({ playing: !s.playing })),
  seek: t => set({ currentTime: Math.max(0, t) }),
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

let raf = 0;
let last = 0;

export function startPlaybackLoop(): () => void {
  const tick = (ts: number) => {
    const s = usePlayback.getState();
    const duration = Math.max(s.telemetry?.duration ?? 0, s.videoDuration ?? 0);
    // When a video is loaded, the <video> element is the time source —
    // App.tsx pushes video.currentTime into the store each rAF tick.
    if (s.playing && duration > 0 && !s.videoUrl) {
      if (last) {
        const dt = ((ts - last) / 1000) * s.rate;
        const next = s.currentTime + dt;
        if (next >= duration) {
          usePlayback.setState({ currentTime: duration, playing: false });
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
