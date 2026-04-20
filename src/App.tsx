import { useEffect, useRef, useState } from 'react';
import { Hud } from './hud/Hud';
import { usePlayback, startPlaybackLoop } from './playback/store';
import { parseTelemetryCsv, parseTelemetryJson } from './data/telemetry';
import { parseGpx, parseGeoJson } from './data/track';
import { enrichGpxWithOsm } from './data/gpxEnrichment';
import type { SpeedUnit } from './util/units';

async function loadTelemetryFromUrl(url: string) {
  const res = await fetch(url);
  const text = await res.text();
  return url.endsWith('.json') ? parseTelemetryJson(text) : parseTelemetryCsv(text);
}

async function loadTrackFromUrl(url: string) {
  const res = await fetch(url);
  const text = await res.text();
  return {
    track: url.match(/\.geojson$/i) ? parseGeoJson(text) : parseGpx(text),
    gpxSource: url.match(/\.gpx$/i) ? { name: url.split('/').pop() ?? 'track.gpx', text } : null,
  };
}

export function App() {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gpxSource, setGpxSource] = useState<{ name: string; text: string } | null>(null);
  const [enrichingTrack, setEnrichingTrack] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const telemetry = usePlayback(s => s.telemetry);
  const track = usePlayback(s => s.track);
  const currentTime = usePlayback(s => s.currentTime);
  const playing = usePlayback(s => s.playing);
  const rate = usePlayback(s => s.rate);
  const unit = usePlayback(s => s.unit);
  const exporterMode = usePlayback(s => s.exporterMode);
  const videoUrl = usePlayback(s => s.videoUrl);
  const videoAspect = usePlayback(s => s.videoAspect);
  const videoDuration = usePlayback(s => s.videoDuration);

  useEffect(() => startPlaybackLoop(), []);

  // URL params: ?telemetry=...&track=...&player=...&unit=mph&exporter=1&t=0
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const tel = q.get('telemetry');
    const trk = q.get('track');
    const player = q.get('player');
    const u = q.get('unit');
    const exporter = q.get('exporter') === '1';
    const t0 = Number(q.get('t') ?? '0');

    if (player) usePlayback.getState().setProfile({ name: player });
    if (u === 'mph' || u === 'kmh') usePlayback.getState().setUnit(u);
    if (exporter) {
      usePlayback.getState().setExporterMode(true);
      document.body.classList.add('exporter');
    }

    (async () => {
      try {
        if (tel) usePlayback.getState().setTelemetry(await loadTelemetryFromUrl(tel));
        if (trk) {
          const loaded = await loadTrackFromUrl(trk);
          usePlayback.getState().setTrack(loaded.track);
          setGpxSource(loaded.gpxSource);
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
      usePlayback.setState({ currentTime: t, playing: false });
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
      const vt = v.currentTime;
      const ct = s.currentTime;
      if (Math.abs(vt - ct) > 0.3) {
        // Big jump — treat as external seek and push store → video.
        v.currentTime = ct;
      } else if (s.playing && Math.abs(vt - ct) > 0.005) {
        // Normal playback — video drives store.
        usePlayback.setState({ currentTime: vt });
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
        } else if (name.endsWith('.json')) {
          usePlayback.getState().setTelemetry(parseTelemetryJson(text));
        } else if (name.endsWith('.gpx')) {
          usePlayback.getState().setTrack(parseGpx(text));
          setGpxSource({ name: file.name, text });
        } else if (name.endsWith('.geojson')) {
          usePlayback.getState().setTrack(parseGeoJson(text));
          setGpxSource(null);
        } else {
          setError(`Unknown file type: ${file.name}`);
        }
      } catch (e) {
        setError(`Failed to parse ${file.name}: ${e}`);
      }
    }
  };

  const loadVideoFile = (file: File) =>
    new Promise<void>((res, rej) => {
      const url = URL.createObjectURL(file);
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.src = url;
      probe.onloadedmetadata = () => {
        const aspect =
          probe.videoWidth && probe.videoHeight
            ? probe.videoWidth / probe.videoHeight
            : 16 / 9;
        usePlayback.getState().setVideo(url, aspect, probe.duration || 0);
        res();
      };
      probe.onerror = () => {
        URL.revokeObjectURL(url);
        rej(new Error(`Failed to load video: ${file.name}`));
      };
    });

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  };

  const loadSamples = async () => {
    try {
      usePlayback.getState().setTelemetry(await loadTelemetryFromUrl('/samples/telemetry.csv'));
      const loaded = await loadTrackFromUrl('/samples/track.gpx');
      usePlayback.getState().setTrack(loaded.track);
      setGpxSource(loaded.gpxSource);
    } catch (e) {
      setError(String(e));
    }
  };

  const enrichCurrentGpx = async () => {
    if (!gpxSource || enrichingTrack) return;
    setError(null);
    setEnrichingTrack(true);
    try {
      const { geoJson } = await enrichGpxWithOsm(gpxSource.text);
      usePlayback.getState().setTrack(parseGeoJson(JSON.stringify(geoJson)));
    } catch (e) {
      setError(`GPX 路网补全失败：${e instanceof Error ? e.message : String(e)}`);
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
          inset: exporterMode ? 0 : '56px 0 96px 0',
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
              : `min(100%, calc((100vh - 152px) * ${videoAspect}))`,
            aspectRatio: `${videoAspect}`,
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
          />
          <Timeline
            duration={Math.max(telemetry?.duration ?? 0, videoDuration)}
            currentTime={currentTime}
            playing={playing}
            rate={rate}
            hasTrack={!!track}
            hasVideo={!!videoUrl}
          />
          {error && (
            <div
              style={{
                position: 'absolute',
                left: 16,
                bottom: 108,
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
}: {
  unit: SpeedUnit;
  canEnrichTrack: boolean;
  enrichingTrack: boolean;
  onEnrichTrack: () => void;
}) {
  const profile = usePlayback(s => s.profile);
  const editMode = usePlayback(s => s.editMode);
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 56,
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
      <span style={{ marginLeft: 'auto', color: '#888' }}>
        {editMode ? '拖动 HUD 元素到想要的位置' : '拖入 CSV/JSON/GPX/GeoJSON 文件以加载'}
      </span>
    </div>
  );
}

function Timeline({
  duration,
  currentTime,
  playing,
  rate,
  hasTrack,
  hasVideo,
}: {
  duration: number;
  currentTime: number;
  playing: boolean;
  rate: number;
  hasTrack: boolean;
  hasVideo: boolean;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 96,
        background: '#181818',
        borderTop: '1px solid #2a2a2a',
        padding: '12px 16px',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button
          onClick={() => usePlayback.getState().toggle()}
          disabled={duration === 0}
          style={{
            width: 32,
            height: 28,
            background: '#333',
            border: '1px solid #555',
            color: '#fff',
            cursor: duration ? 'pointer' : 'default',
          }}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <span style={{ width: 120, color: '#aaa' }}>
          {currentTime.toFixed(2)} / {duration.toFixed(2)} s
        </span>
        <label>
          倍速
          <select
            value={rate}
            onChange={e => usePlayback.getState().setRate(Number(e.target.value))}
            style={{ marginLeft: 6 }}
          >
            {[0.25, 0.5, 1, 2, 4].map(r => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
        </label>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
          <span style={{ color: hasVideo ? '#6c6' : '#666' }}>
            {hasVideo ? '✓ 视频已加载' : '无视频'}
          </span>
          <span style={{ color: hasTrack ? '#6c6' : '#666' }}>
            {hasTrack ? '✓ GPX 已加载' : '无 GPX'}
          </span>
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={duration || 1}
        step={0.01}
        value={currentTime}
        onChange={e => usePlayback.getState().seek(Number(e.target.value))}
        style={{ width: '100%' }}
        disabled={duration === 0}
      />
    </div>
  );
}
