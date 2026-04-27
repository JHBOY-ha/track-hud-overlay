import { useEffect, useMemo, useRef, useState } from 'react';
import { Hud } from './hud/Hud';
import { effectiveRange, startPlaybackLoop, usePlayback } from './playback/store';
import { Timeline } from './ui/Timeline';
import { parseTelemetryCsv, parseTelemetryJson } from './data/telemetry';
import { parseGpx, parseGeoJson } from './data/track';
import { DEFAULT_SETTINGS, type HudSettings } from './playback/store';
import type { SpeedUnit } from './util/units';
import { exportUrlForDroppedFileName } from './util/exportUrls';
import {
  isCoordinateSystem,
  type CoordinateSystem,
} from './util/coordinateSystems';
import { PROJECT_FPS_OPTIONS } from './util/timecode';
import { parseMp4TimecodeFromBlob } from './util/videoTimecode';

function secondsToFrame(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

async function loadTelemetryFromUrl(url: string) {
  const res = await fetch(url);
  const text = await res.text();
  return url.endsWith('.json') ? parseTelemetryJson(text) : parseTelemetryCsv(text);
}

type TrackKind = 'gpx' | 'geojson';

const COORDINATE_SYSTEM_LABELS: Record<CoordinateSystem, string> = {
  wgs84: 'WGS-84',
  gcj02: 'GCJ-02',
  bd09: 'BD-09',
};

interface TrackSource {
  kind: TrackKind;
  text: string;
  normalizedWgs84?: boolean;
}

function parseTrackText(
  source: TrackSource,
  snap: { enabled: boolean; maxDistM: number },
  coordinateSystem: CoordinateSystem,
) {
  const opts = {
    snap,
    coordinateSystem: source.normalizedWgs84 ? 'wgs84' : coordinateSystem,
  };
  return source.kind === 'geojson'
    ? parseGeoJson(source.text, opts)
    : parseGpx(source.text, opts);
}

async function loadTrackFromUrl(url: string) {
  const res = await fetch(url);
  const text = await res.text();
  const kind: TrackKind = url.match(/\.geojson$/i) ? 'geojson' : 'gpx';
  return {
    source: { kind, text } as TrackSource,
    gpxSource: kind === 'gpx' ? { name: url.split('/').pop() ?? 'track.gpx', text } : null,
  };
}

export function App() {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gpxSource, setGpxSource] = useState<{ name: string; text: string } | null>(null);
  const [trackSource, setTrackSource] = useState<TrackSource | null>(null);
  const [enrichingTrack, setEnrichingTrack] = useState(false);
  const [telemetryUrl, setTelemetryUrl] = useState<string | null>(null);
  const [trackUrl, setTrackUrl] = useState<string | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const parsedTrackSourceRef = useRef<TrackSource | null>(null);

  const telemetry = usePlayback(s => s.telemetry);
  const track = usePlayback(s => s.track);
  const playing = usePlayback(s => s.playing);
  const rate = usePlayback(s => s.rate);
  const unit = usePlayback(s => s.unit);
  const exporterMode = usePlayback(s => s.exporterMode);
  const videoUrl = usePlayback(s => s.videoUrl);
  const videoAspect = usePlayback(s => s.videoAspect);
  const previewAspect = usePlayback(s => s.previewAspect);
  const stageAspect = previewAspect ?? videoAspect;
  const videoWidth = usePlayback(s => s.videoWidth);
  const videoHeight = usePlayback(s => s.videoHeight);
  const trackCoordinateSystem = usePlayback(s => s.settings.trackCoordinateSystem);
  const snapToRoads = usePlayback(s => s.settings.snapToRoads);
  const snapMaxDistM = usePlayback(s => s.settings.snapMaxDistM);

  useEffect(() => startPlaybackLoop(), []);

  useEffect(() => {
    if (!trackSource) return;
    try {
      const parsed = parseTrackText(
        trackSource,
        {
          enabled: snapToRoads,
          maxDistM: snapMaxDistM,
        },
        trackCoordinateSystem,
      );
      const isNewSource = parsedTrackSourceRef.current !== trackSource;
      parsedTrackSourceRef.current = trackSource;
      usePlayback.getState().setTrack(parsed, { resetTimeline: isNewSource });
    } catch (e) {
      setError(`解析轨迹失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [trackSource, snapToRoads, snapMaxDistM, trackCoordinateSystem]);

  useEffect(() => {
    const stored = loadStoredExport();
    if (stored && stored.width > 0 && stored.height > 0) {
      usePlayback.getState().setPreviewAspect(stored.width / stored.height);
    }
    if (stored?.fps && stored.fps > 0) {
      usePlayback.getState().setProjectFps(stored.fps);
    }
  }, []);

  // URL params: ?telemetry=...&track=...&player=...&unit=mph&exporter=1&t=0
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const tel = q.get('telemetry');
    const trk = q.get('track');
    const player = q.get('player');
    const u = q.get('unit');
    const coord = q.get('coord');
    const exporter = q.get('exporter') === '1';
    const t0 = Number(q.get('t') ?? '0');
    const rangeStart = Number(q.get('rangeStart'));
    const rangeEnd = Number(q.get('rangeEnd'));
    const telemetryOffset = Number(q.get('telemetryOffset') ?? '0');
    const trackOffset = Number(q.get('trackOffset') ?? '0');
    const videoOffset = Number(q.get('videoOffset') ?? '0');

    if (player) usePlayback.getState().setProfile({ name: player });
    if (u === 'mph' || u === 'kmh') usePlayback.getState().setUnit(u);
    if (isCoordinateSystem(coord)) {
      usePlayback.getState().setSetting('trackCoordinateSystem', coord);
    }
    if (exporter) {
      usePlayback.getState().setExporterMode(true);
      document.body.classList.add('exporter');
    }

    (async () => {
      try {
        if (tel) {
          usePlayback.getState().setTelemetry(await loadTelemetryFromUrl(tel));
          if (Number.isFinite(telemetryOffset)) {
            usePlayback.getState().setTelemetryOffset(telemetryOffset);
          }
          setTelemetryUrl(tel);
        }
        if (trk) {
          const loaded = await loadTrackFromUrl(trk);
          const parsed = parseTrackText(
            loaded.source,
            {
              enabled: usePlayback.getState().settings.snapToRoads,
              maxDistM: usePlayback.getState().settings.snapMaxDistM,
            },
            usePlayback.getState().settings.trackCoordinateSystem,
          );
          parsedTrackSourceRef.current = loaded.source;
          usePlayback.getState().setTrack(parsed, { resetTimeline: true });
          if (Number.isFinite(trackOffset)) {
            usePlayback.getState().setTrackOffset(trackOffset);
          }
          setGpxSource(loaded.gpxSource);
          setTrackSource(loaded.source);
          setTrackUrl(trk);
        }
        if (Number.isFinite(videoOffset)) {
          usePlayback.getState().setVideoOffset(videoOffset);
        }
        if (Number.isFinite(rangeStart) && Number.isFinite(rangeEnd)) {
          usePlayback.getState().setSelection(rangeStart, rangeEnd);
        }
        if (!Number.isNaN(t0)) usePlayback.getState().seek(t0);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

  // Expose exporter API
  useEffect(() => {
    (window as any).seekTo = (t: number) => {
      // Exporter passes relative seconds from the selected range start.
      const s = usePlayback.getState();
      const [start] = effectiveRange(s);
      s.seek(start + t);
      usePlayback.setState({ playing: false });
    };
    (window as any).readyForFrame = () =>
      new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    (window as any).__hudState = () => usePlayback.getState();
  }, []);

  // Video ↔ playback sync: when a video is loaded, the <video> is the
  // authoritative clock. rAF poll pushes video.currentTime into the store,
  // and large deltas (user scrub) push the other direction to re-seek.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing && v.paused) v.play().catch(() => {});
    if (!playing && !v.paused) v.pause();
  }, [playing, videoUrl]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = rate;
  }, [rate, videoUrl]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !videoUrl) return;
    let raf = 0;
    const tick = () => {
      const s = usePlayback.getState();
      // Map between video time (0..videoDuration) and absolute axis time.
      const vt = v.currentTime;
      const ctAbsFromVideo = vt + s.videoOffset;
      const ct = s.currentTime;
      const [, end] = effectiveRange(s);
      if (Math.abs(ctAbsFromVideo - ct) > 0.3) {
        // Big jump — store moved (user seek/selection change). Push to video,
        // clamped within the video's own range.
        const targetVt = Math.max(0, Math.min(s.videoDuration, ct - s.videoOffset));
        v.currentTime = targetVt;
      } else if (s.playing && Math.abs(ctAbsFromVideo - ct) > 0.005) {
        // Normal playback — video drives store.
        const next = ctAbsFromVideo;
        if (next >= end) {
          usePlayback.setState({ currentTime: end, playing: false });
          v.pause();
        } else {
          usePlayback.setState({ currentTime: next });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [videoUrl]);

  const handleFiles = async (files: FileList) => {
    setError(null);
    for (const file of Array.from(files)) {
      const name = file.name.toLowerCase();
      try {
        if (name.endsWith('.mp4') || name.endsWith('.mov') || name.endsWith('.webm') || name.endsWith('.m4v')) {
          await loadVideoFile(file);
          continue;
        }
        const text = await file.text();
        if (name.endsWith('.csv')) {
          usePlayback.getState().setTelemetry(parseTelemetryCsv(text));
          setTelemetryUrl('');
        } else if (name.endsWith('.json')) {
          usePlayback.getState().setTelemetry(parseTelemetryJson(text));
          setTelemetryUrl('');
        } else if (name.endsWith('.gpx')) {
          setGpxSource({ name: file.name, text });
          setTrackSource({ kind: 'gpx', text });
          setTrackUrl(exportUrlForDroppedFileName(file.name, 'track'));
        } else if (name.endsWith('.geojson')) {
          setGpxSource(null);
          setTrackSource({ kind: 'geojson', text });
          setTrackUrl(exportUrlForDroppedFileName(file.name, 'track'));
        } else {
          setError(`Unknown file type: ${file.name}`);
        }
      } catch (e) {
        setError(`Failed to parse ${file.name}: ${e}`);
      }
    }
  };

  const loadVideoFile = async (file: File) => {
    let embeddedTimecodeStart: number | null = null;
    if (/\.(mp4|mov|m4v)$/i.test(file.name)) {
      try {
        const timecode = await parseMp4TimecodeFromBlob(file);
        if (timecode) {
          embeddedTimecodeStart = timecode.seconds;
          if (PROJECT_FPS_OPTIONS.includes(timecode.fps as any)) {
            usePlayback.getState().setProjectFps(timecode.fps);
          }
        }
      } catch {
        embeddedTimecodeStart = null;
      }
    }

    return new Promise<void>((res, rej) => {
      const url = URL.createObjectURL(file);
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.src = url;
      probe.onloadedmetadata = () => {
        const aspect =
          probe.videoWidth && probe.videoHeight
            ? probe.videoWidth / probe.videoHeight
            : 16 / 9;
        usePlayback
          .getState()
          .setVideo(
            url,
            aspect,
            probe.duration || 0,
            probe.videoWidth,
            probe.videoHeight,
            embeddedTimecodeStart,
          );
        res();
      };
      probe.onerror = () => {
        URL.revokeObjectURL(url);
        rej(new Error(`Failed to load video: ${file.name}`));
      };
    });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  };

  const loadSamples = async () => {
    try {
      usePlayback.getState().setTelemetry(await loadTelemetryFromUrl('/samples/telemetry.csv'));
      setTelemetryUrl('/samples/telemetry.csv');
      const loaded = await loadTrackFromUrl('/samples/track.gpx');
      setGpxSource(loaded.gpxSource);
      setTrackSource(loaded.source);
      setTrackUrl('/samples/track.gpx');
    } catch (e) {
      setError(String(e));
    }
  };

  const enrichCurrentGpx = async () => {
    if (!gpxSource || enrichingTrack) return;
    setError(null);
    setEnrichingTrack(true);
    try {
      const res = await fetch('/api/enrich-gpx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputName: gpxSource.name,
          gpxText: gpxSource.text,
          coordinateSystem: trackCoordinateSystem,
        }),
      });
      const contentType = res.headers.get('content-type') ?? '';
      const raw = await res.text();
      if (!contentType.includes('application/json')) {
        throw new Error('本地补全 API 未启用，请重启 npm run dev 后再试。');
      }
      const data = JSON.parse(raw);
      if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
      const geoJson = data.geoJson;
      setTrackSource({ kind: 'geojson', text: JSON.stringify(geoJson), normalizedWgs84: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(
        `GPX 路网补全失败：${
          message === 'The string did not match the expected pattern.'
            ? '本地补全 API 未启用，请重启 npm run dev 后再试。'
            : message
        }`,
      );
    } finally {
      setEnrichingTrack(false);
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative' }}>
      {/* Stage: 16:9 canvas */}
      <div
        ref={dropRef}
        onDragOver={e => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        style={{
          position: 'absolute',
          inset: exporterMode ? 0 : '56px 0 168px 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: exporterMode
              ? '100vw'
              : `min(100%, calc((100vh - 224px) * ${stageAspect}))`,
            aspectRatio: `${stageAspect}`,
            background: exporterMode
              ? 'transparent'
              : videoUrl
                ? '#000'
                : `repeating-conic-gradient(#1a1a1a 0 25%, #232323 0 50%) 50% 50% / 40px 40px`,
            outline: dragging ? '2px dashed #6cf' : 'none',
          }}
        >
          {videoUrl && !exporterMode && (
            <video
              ref={videoRef}
              src={videoUrl}
              muted
              playsInline
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'contain',
              }}
            />
          )}
          <Hud />
          {!telemetry && !videoUrl && !exporterMode && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                gap: 12,
                color: 'rgba(255,255,255,0.7)',
                fontSize: 18,
              }}
            >
              <div>拖入视频 / telemetry.csv / track.gpx 文件到此处</div>
              <button
                onClick={loadSamples}
                style={{
                  pointerEvents: 'auto',
                  padding: '6px 14px',
                  background: '#333',
                  border: '1px solid #555',
                  color: '#fff',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 14,
                }}
              >
                加载示例数据
              </button>
            </div>
          )}
        </div>
      </div>

      {!exporterMode && (
        <>
          <Toolbar
            unit={unit}
            canEnrichTrack={!!gpxSource}
            enrichingTrack={enrichingTrack}
            onEnrichTrack={enrichCurrentGpx}
            videoWidth={videoWidth}
            videoHeight={videoHeight}
            telemetryUrl={telemetryUrl}
            trackUrl={trackUrl}
            hasTelemetry={!!telemetry}
            hasTrack={!!track}
          />
          <Timeline />
          {error && (
            <div
              style={{
                position: 'absolute',
                left: 16,
                bottom: 180,
                background: '#3a1a1a',
                color: '#f88',
                padding: '6px 10px',
                fontSize: 12,
                borderRadius: 4,
              }}
            >
              {error}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Toolbar({
  unit,
  canEnrichTrack,
  enrichingTrack,
  onEnrichTrack,
  videoWidth,
  videoHeight,
  telemetryUrl,
  trackUrl,
  hasTelemetry,
  hasTrack,
}: {
  unit: SpeedUnit;
  canEnrichTrack: boolean;
  enrichingTrack: boolean;
  onEnrichTrack: () => void;
  videoWidth: number;
  videoHeight: number;
  telemetryUrl: string | null;
  trackUrl: string | null;
  hasTelemetry: boolean;
  hasTrack: boolean;
}) {
  const profile = usePlayback(s => s.profile);
  const editMode = usePlayback(s => s.editMode);
  const [exportOpen, setExportOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 56,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 16,
        background: '#181818',
        borderBottom: '1px solid #2a2a2a',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
      }}
    >
      <strong style={{ fontSize: 14 }}>FH5 HUD</strong>
      <label>
        单位
        <select
          value={unit}
          onChange={e => usePlayback.getState().setUnit(e.target.value as SpeedUnit)}
          style={{ marginLeft: 6 }}
        >
          <option value="kmh">km/h</option>
          <option value="mph">MPH</option>
        </select>
      </label>
      <label>
        玩家
        <input
          value={profile.name}
          onChange={e => usePlayback.getState().setProfile({ name: e.target.value })}
          style={{ marginLeft: 6, width: 120 }}
        />
      </label>
      <button
        onClick={() => usePlayback.getState().setEditMode(!editMode)}
        style={{
          padding: '4px 10px',
          background: editMode ? '#6ccfff' : '#333',
          color: editMode ? '#001' : '#fff',
          border: '1px solid #555',
          borderRadius: 3,
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 13,
        }}
      >
        {editMode ? '✓ 编辑布局' : '编辑布局'}
      </button>
      <button
        onClick={() => {
          if (confirm('重置所有 HUD 元素到默认位置？')) usePlayback.getState().resetLayout();
        }}
        style={{
          padding: '4px 10px',
          background: '#333',
          color: '#fff',
          border: '1px solid #555',
          borderRadius: 3,
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 13,
        }}
      >
        重置
      </button>
      <PresetControls />
      <button
        onClick={onEnrichTrack}
        disabled={!canEnrichTrack || enrichingTrack}
        title={canEnrichTrack ? '从 OpenStreetMap 补全周边路网并刷新小地图' : '先加载 GPX 轨迹'}
        style={{
          padding: '4px 10px',
          background: canEnrichTrack && !enrichingTrack ? '#333' : '#242424',
          color: canEnrichTrack && !enrichingTrack ? '#fff' : '#777',
          border: '1px solid #555',
          borderRadius: 3,
          cursor: canEnrichTrack && !enrichingTrack ? 'pointer' : 'default',
          fontFamily: 'inherit',
          fontSize: 13,
        }}
      >
        {enrichingTrack ? '补全中…' : '补全路网'}
      </button>
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setAdvancedOpen(v => !v)}
          style={{
            padding: '4px 10px',
            background: advancedOpen ? '#6ccfff' : '#333',
            color: advancedOpen ? '#001' : '#fff',
            border: '1px solid #555',
            borderRadius: 3,
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 13,
          }}
        >
          高级设置
        </button>
        {advancedOpen && <AdvancedSettingsPanel onClose={() => setAdvancedOpen(false)} />}
      </div>
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setExportOpen(v => !v)}
          style={{
            padding: '4px 10px',
            background: exportOpen ? '#6ccfff' : '#333',
            color: exportOpen ? '#001' : '#fff',
            border: '1px solid #555',
            borderRadius: 3,
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 13,
          }}
        >
          导出设置
        </button>
        {exportOpen && (
          <ExportSettingsPanel
            unit={unit}
            player={profile.name}
            defaultWidth={videoWidth > 0 ? videoWidth : 1920}
            defaultHeight={videoHeight > 0 ? videoHeight : 1080}
            defaultTelemetryUrl={telemetryUrl ?? (hasTelemetry ? '' : '/samples/telemetry.csv')}
            defaultTrackUrl={trackUrl ?? (hasTrack ? '' : '/samples/track.gpx')}
            onClose={() => setExportOpen(false)}
          />
        )}
      </div>
      <span style={{ marginLeft: 'auto', color: '#888' }}>
        {editMode ? '拖动 HUD 元素到想要的位置' : '拖入 CSV/JSON/GPX/GeoJSON 文件以加载'}
      </span>
    </div>
  );
}

function PresetControls() {
  const presets = usePlayback(s => s.presets);
  const [selected, setSelected] = useState('');
  const names = Object.keys(presets).sort();

  const inputStyle: React.CSSProperties = {
    background: '#111',
    border: '1px solid #444',
    color: '#eee',
    padding: '3px 6px',
    fontFamily: 'inherit',
    fontSize: 13,
    borderRadius: 3,
  };
  const btnStyle: React.CSSProperties = {
    padding: '4px 10px',
    background: '#333',
    color: '#fff',
    border: '1px solid #555',
    borderRadius: 3,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 13,
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <select
        title="布局预设"
        value={selected}
        onChange={e => {
          const v = e.target.value;
          setSelected(v);
          if (v === '') usePlayback.getState().resetLayout();
        }}
        style={{ ...inputStyle, minWidth: 120 }}
      >
        <option value="">默认布局</option>
        {names.map(n => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <button
        onClick={() => {
          if (!selected) return;
          usePlayback.getState().loadPreset(selected);
        }}
        disabled={!selected}
        style={{ ...btnStyle, opacity: selected ? 1 : 0.5 }}
      >
        加载
      </button>
      <button
        onClick={() => {
          const name = prompt('预设名称', selected || '');
          if (name && name.trim()) {
            const trimmed = name.trim();
            if (presets[trimmed] && !confirm(`覆盖已有预设 "${trimmed}"？`)) return;
            usePlayback.getState().savePreset(trimmed);
            setSelected(trimmed);
          }
        }}
        style={btnStyle}
      >
        保存
      </button>
      <button
        onClick={() => {
          if (!selected) return;
          if (!confirm(`删除预设 "${selected}"？`)) return;
          usePlayback.getState().deletePreset(selected);
          setSelected('');
        }}
        disabled={!selected}
        style={{ ...btnStyle, opacity: selected ? 1 : 0.5 }}
      >
        删除
      </button>
    </div>
  );
}

const EXPORT_STORAGE_KEY = 'hud5.export.v1';

function loadStoredExport(): {
  width: number;
  height: number;
  fps?: number;
  duration?: number;
} | null {
  try {
    const raw = localStorage.getItem(EXPORT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.width === 'number' && typeof parsed?.height === 'number') {
      return {
        width: parsed.width,
        height: parsed.height,
        fps: typeof parsed.fps === 'number' ? parsed.fps : undefined,
        duration: typeof parsed.duration === 'number' ? parsed.duration : undefined,
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

type ExportFormat = 'webm' | 'mov' | 'mp4' | 'png';

const FORMAT_META: Record<ExportFormat, { label: string; ext: string }> = {
  webm: { label: 'WebM (VP9 透明)', ext: '.webm' },
  mov: { label: 'MOV (ProRes 4444 透明)', ext: '.mov' },
  mp4: { label: 'MP4 (ProRes 4444)', ext: '.mp4' },
  png: { label: 'PNG 序列', ext: '.png' },
};

const RESOLUTION_PRESETS: { label: string; w: number; h: number }[] = [
  { label: '1080 × 1080 HD Square', w: 1080, h: 1080 },
  { label: '1280 × 720 HD 720P', w: 1280, h: 720 },
  { label: '1280 × 1080 HD 1280', w: 1280, h: 1080 },
  { label: '1828 × 1332 Academy', w: 1828, h: 1332 },
  { label: '1828 × 1556 Scope', w: 1828, h: 1556 },
  { label: '1920 × 1080 HD', w: 1920, h: 1080 },
  { label: '1998 × 1080 DCI Flat 1.85', w: 1998, h: 1080 },
  { label: '2048 × 858 DCI Scope 2.39', w: 2048, h: 858 },
  { label: '2048 × 1080 DCI', w: 2048, h: 1080 },
  { label: '2048 × 1152 2K 16:9', w: 2048, h: 1152 },
  { label: '2048 × 1556 Full Aperture', w: 2048, h: 1556 },
  { label: '2160 × 2160 Ultra HD Square', w: 2160, h: 2160 },
  { label: '3072 × 2048 VistaVision', w: 3072, h: 2048 },
  { label: '3654 × 2664 Academy', w: 3654, h: 2664 },
  { label: '3656 × 3112 Scope', w: 3656, h: 3112 },
  { label: '3840 × 2160 Ultra HD', w: 3840, h: 2160 },
  { label: '3996 × 2160 DCI Flat 1.85', w: 3996, h: 2160 },
  { label: '4096 × 1716 DCI Scope 2.39', w: 4096, h: 1716 },
  { label: '4096 × 2160 DCI', w: 4096, h: 2160 },
  { label: '4096 × 3112 Full Aperture', w: 4096, h: 3112 },
  { label: '7680 × 4320 8K Ultra HD', w: 7680, h: 4320 },
];

function shellQuote(v: string): string {
  if (v === '' || /[^A-Za-z0-9_@%+=:,./-]/.test(v)) {
    return `'${v.replace(/'/g, `'\\''`)}'`;
  }
  return v;
}

function ExportSettingsPanel({
  unit,
  player,
  defaultWidth,
  defaultHeight,
  defaultTelemetryUrl,
  defaultTrackUrl,
  onClose,
}: {
  unit: SpeedUnit;
  player: string;
  defaultWidth: number;
  defaultHeight: number;
  defaultTelemetryUrl: string;
  defaultTrackUrl: string;
  onClose: () => void;
}) {
  const [width, setWidth] = useState(() => loadStoredExport()?.width ?? defaultWidth);
  const [height, setHeight] = useState(() => loadStoredExport()?.height ?? defaultHeight);
  const fps = usePlayback(s => s.projectFps);
  const telemetryOffset = usePlayback(s => s.telemetryOffset);
  const trackOffset = usePlayback(s => s.trackOffset);
  const videoOffset = usePlayback(s => s.videoOffset);
  const [rangeStart, rangeEnd] = usePlayback(s => effectiveRange(s));
  const duration = Math.max(0, rangeEnd - rangeStart);
  const rangeStartFrame = secondsToFrame(rangeStart, fps);
  const rangeEndFrame = secondsToFrame(rangeEnd, fps);
  const durationFrames = Math.max(0, rangeEndFrame - rangeStartFrame);

  useEffect(() => {
    if (width > 0 && height > 0) {
      usePlayback.getState().setPreviewAspect(width / height);
    }
    usePlayback.getState().setProjectDuration(duration > 0 ? duration : null);
    try {
      localStorage.setItem(
        EXPORT_STORAGE_KEY,
        JSON.stringify({ width, height, fps }),
      );
    } catch {
      /* ignore */
    }
  }, [width, height, fps, duration]);
  const [format, setFormat] = useState<ExportFormat>('webm');
  const [telemetryUrl, setTelemetryUrl] = useState(defaultTelemetryUrl);
  const [trackUrl, setTrackUrl] = useState(defaultTrackUrl);
  const trackCoordinateSystem = usePlayback(s => s.settings.trackCoordinateSystem);

  useEffect(() => {
    setTelemetryUrl(defaultTelemetryUrl);
  }, [defaultTelemetryUrl]);
  useEffect(() => {
    setTrackUrl(defaultTrackUrl);
  }, [defaultTrackUrl]);
  const [outPath, setOutPath] = useState('out/hud.webm');
  const [copied, setCopied] = useState(false);
  const missingTelemetryExportUrl = telemetryUrl.trim() === '';
  const missingTrackExportUrl = trackUrl.trim() === '';
  const missingExportUrl = missingTelemetryExportUrl || missingTrackExportUrl;

  const presetValue = useMemo(() => {
    const idx = RESOLUTION_PRESETS.findIndex(p => p.w === width && p.h === height);
    return idx >= 0 ? String(idx) : 'custom';
  }, [width, height]);

  const command = useMemo(() => {
    const args = [
      'node',
      'scripts/export-frames.mjs',
      '--telemetry', telemetryUrl,
      '--track', trackUrl,
      '--duration', String(durationFrames),
      '--range-start', String(rangeStartFrame),
      '--range-end', String(rangeEndFrame),
      '--fps', String(fps),
      '--width', String(width),
      '--height', String(height),
      '--unit', unit,
      '--player', player,
      '--coord', trackCoordinateSystem,
      '--telemetry-offset', String(telemetryOffset),
      '--track-offset', String(trackOffset),
      '--video-offset', String(videoOffset),
      '--out', outPath,
    ];
    return args.map(shellQuote).join(' ');
  }, [
    telemetryUrl,
    trackUrl,
    duration,
    durationFrames,
    rangeStartFrame,
    rangeEndFrame,
    rangeStart,
    rangeEnd,
    fps,
    width,
    height,
    unit,
    player,
    trackCoordinateSystem,
    telemetryOffset,
    trackOffset,
    videoOffset,
    outPath,
  ]);

  const applyFormat = (f: ExportFormat) => {
    setFormat(f);
    const ext = FORMAT_META[f].ext;
    setOutPath(prev => {
      const m = prev.match(/^(.*?)(\.[^./\\]+)?$/);
      const base = m?.[1] || 'out/hud';
      return f === 'png' ? `${base}-frames` : `${base}${ext}`;
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const labelStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontSize: 12,
    color: '#bbb',
  };
  const inputStyle: React.CSSProperties = {
    background: '#111',
    border: '1px solid #444',
    color: '#eee',
    padding: '4px 6px',
    fontFamily: 'inherit',
    fontSize: 12,
    borderRadius: 3,
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(100% + 6px)',
        right: 0,
        width: 460,
        background: '#1e1e1e',
        border: '1px solid #333',
        borderRadius: 4,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        zIndex: 50,
        boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: 13 }}>导出设置</strong>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#888',
            cursor: 'pointer',
            fontSize: 16,
          }}
        >
          ×
        </button>
      </div>

      <label style={labelStyle}>
        分辨率
        <div style={{ display: 'flex', gap: 6 }}>
          <select
            value={presetValue}
            onChange={e => {
              const v = e.target.value;
              if (v === 'custom') return;
              const p = RESOLUTION_PRESETS[Number(v)];
              setWidth(p.w);
              setHeight(p.h);
            }}
            style={{ ...inputStyle, flex: 1 }}
          >
            {RESOLUTION_PRESETS.map((p, i) => (
              <option key={i} value={i}>
                {p.label}
              </option>
            ))}
            <option value="custom">自定义</option>
          </select>
          <input
            type="number"
            min={16}
            value={width}
            onChange={e => setWidth(Number(e.target.value) || 0)}
            style={{ ...inputStyle, width: 80 }}
          />
          <span style={{ alignSelf: 'center', color: '#666' }}>×</span>
          <input
            type="number"
            min={16}
            value={height}
            onChange={e => setHeight(Number(e.target.value) || 0)}
            style={{ ...inputStyle, width: 80 }}
          />
        </div>
      </label>

      <div style={{ display: 'flex', gap: 10 }}>
        <label style={{ ...labelStyle, flex: 1 }}>
          FPS
          <select
            value={fps}
            onChange={e => usePlayback.getState().setProjectFps(Number(e.target.value))}
            style={inputStyle}
          >
            {PROJECT_FPS_OPTIONS.map(v => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label style={{ ...labelStyle, flex: 1 }}>
          时长 (帧)
          <input
            type="number"
            min={0}
            step={0.1}
            value={durationFrames}
            readOnly
            title={`由 range-end - range-start 自动计算，约 ${duration.toFixed(3)} 秒`}
            style={{ ...inputStyle, color: '#aaa' }}
          />
        </label>
      </div>

      <label style={labelStyle}>
        编码格式
        <select
          value={format}
          onChange={e => applyFormat(e.target.value as ExportFormat)}
          style={inputStyle}
        >
          {(Object.keys(FORMAT_META) as ExportFormat[]).map(f => (
            <option key={f} value={f}>
              {FORMAT_META[f].label}
            </option>
          ))}
        </select>
      </label>

      <label style={labelStyle}>
        telemetry URL (请填写绝对路径)
        <input
          value={telemetryUrl}
          onChange={e => setTelemetryUrl(e.target.value)}
          style={inputStyle}
        />
      </label>
      <label style={labelStyle}>
        track URL (请填写绝对路径)
        <input value={trackUrl} onChange={e => setTrackUrl(e.target.value)} style={inputStyle} />
      </label>
      {missingExportUrl && (
        <div style={{ fontSize: 11, color: '#d6a84f', lineHeight: 1.4 }}>
          {[
            missingTelemetryExportUrl ? 'telemetry URL 为空' : null,
            missingTrackExportUrl ? 'track URL 为空' : null,
          ].filter(Boolean).join('，')}
          ；请填写 preview 可访问的路径，例如 /samples/telemetry.csv 或 /output/track.geojson。
        </div>
      )}
      <label style={labelStyle}>
        输出路径
        <input value={outPath} onChange={e => setOutPath(e.target.value)} style={inputStyle} />
      </label>

      <label style={labelStyle}>
        命令
        <textarea
          readOnly
          value={command}
          rows={4}
          style={{
            ...inputStyle,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            resize: 'vertical',
          }}
          onFocus={e => e.currentTarget.select()}
        />
      </label>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button
          onClick={copy}
          style={{
            padding: '4px 12px',
            background: copied ? '#6ccfff' : '#333',
            color: copied ? '#001' : '#fff',
            border: '1px solid #555',
            borderRadius: 3,
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 13,
          }}
        >
          {copied ? '已复制' : '复制命令'}
        </button>
      </div>
      <div style={{ fontSize: 11, color: '#777' }}>
        先运行 <code>npm run build && npm run preview</code>，再在另一个终端粘贴运行上面的命令。
      </div>
    </div>
  );
}

function AdvancedSettingsPanel({ onClose }: { onClose: () => void }) {
  const settings = usePlayback(s => s.settings);
  const setSetting = usePlayback(s => s.setSetting);
  const resetSettings = usePlayback(s => s.resetSettings);

  const labelStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontSize: 12,
    color: '#bbb',
  };
  const inputStyle: React.CSSProperties = {
    background: '#111',
    border: '1px solid #444',
    color: '#eee',
    padding: '4px 6px',
    fontFamily: 'inherit',
    fontSize: 12,
    borderRadius: 3,
  };
  const sectionTitle: React.CSSProperties = {
    fontSize: 11,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: '0.15em',
    marginTop: 4,
  };

  const numberField = <K extends keyof HudSettings>(
    key: K,
    label: string,
    suffix: string,
    opts: { min?: number; max?: number; step?: number },
  ) => (
    <label style={labelStyle} key={key as string}>
      {label} ({suffix})
      <input
        type="number"
        min={opts.min}
        max={opts.max}
        step={opts.step ?? 1}
        value={settings[key] as number}
        onChange={e => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) setSetting(key, v as HudSettings[K]);
        }}
        style={inputStyle}
      />
    </label>
  );

  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(100% + 6px)',
        right: 0,
        width: 360,
        background: '#1e1e1e',
        border: '1px solid #333',
        borderRadius: 4,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        zIndex: 50,
        boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: 13 }}>高级设置</strong>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#888',
            cursor: 'pointer',
            fontSize: 16,
          }}
        >
          ×
        </button>
      </div>

      <div style={sectionTitle}>轨迹坐标系</div>
      <label style={labelStyle}>
        原始坐标系
        <select
          value={settings.trackCoordinateSystem}
          onChange={e => {
            const value = e.target.value;
            if (isCoordinateSystem(value)) setSetting('trackCoordinateSystem', value);
          }}
          style={inputStyle}
        >
          {Object.entries(COORDINATE_SYSTEM_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div style={{ fontSize: 11, color: '#777', lineHeight: 1.5 }}>
        标准 GPX / GeoJSON / OSM 数据使用 WGS-84；国内地图导出的 GCJ-02 或 BD-09
        会在投影和路网补全前转换为 WGS-84。
      </div>

      <div style={sectionTitle}>路径吸附</div>
      <label
        style={{
          ...labelStyle,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          color: '#ddd',
        }}
      >
        <input
          type="checkbox"
          checked={settings.snapToRoads}
          onChange={e => setSetting('snapToRoads', e.target.checked)}
        />
        吸附到真实路网（需先补全路网）
      </label>
      {numberField('snapMaxDistM', '吸附阈值', 'm', { min: 0, max: 100, step: 0.5 })}
      <div style={{ fontSize: 11, color: '#777', lineHeight: 1.5 }}>
        GPS 点在该阈值内会垂直吸附到最近道路上；超过阈值保留原始点，避免误吸到平行道路。
        默认 5 m 适合车辆 GPS。
      </div>

      <div style={sectionTitle}>小地图</div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          {numberField('minimapViewRadiusM', '可视半径', 'm', {
            min: 10,
            max: 500,
            step: 5,
          })}
        </div>
        <div style={{ flex: 1 }}>
          {numberField('minimapTiltDeg', '俯视角', '°', { min: 0, max: 80, step: 1 })}
        </div>
      </div>
      {numberField('minimapStrokeWidth', '道路线宽', 'px', { min: 1, max: 30, step: 0.5 })}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
        <button
          onClick={() => {
            if (confirm('将高级设置恢复默认值？')) resetSettings();
          }}
          style={{
            padding: '4px 12px',
            background: '#333',
            color: '#fff',
            border: '1px solid #555',
            borderRadius: 3,
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 13,
          }}
        >
          恢复默认
        </button>
      </div>
      <div style={{ fontSize: 11, color: '#666' }}>
        默认值：坐标系 {COORDINATE_SYSTEM_LABELS[DEFAULT_SETTINGS.trackCoordinateSystem]} · 阈值{' '}
        {DEFAULT_SETTINGS.snapMaxDistM} m · 半径{' '}
        {DEFAULT_SETTINGS.minimapViewRadiusM} m · 俯视 {DEFAULT_SETTINGS.minimapTiltDeg}° · 线宽{' '}
        {DEFAULT_SETTINGS.minimapStrokeWidth}
      </div>
    </div>
  );
}
