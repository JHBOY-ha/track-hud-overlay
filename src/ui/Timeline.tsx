import { useEffect, useMemo, useRef, useState } from 'react';
import {
  axisRange,
  effectiveRange,
  sourceRanges,
  usePlayback,
  type Range,
} from '../playback/store';
import { formatTimecode, PROJECT_FPS_OPTIONS } from '../util/timecode';

type SourceKey = 'track' | 'telemetry' | 'video';

const LANE_META: Record<SourceKey, { label: string; color: string }> = {
  track: { label: 'GPX', color: '#5fa8ff' },
  telemetry: { label: 'CSV', color: '#5fd28a' },
  video: { label: 'VIDEO', color: '#d29a5f' },
};

const HANDLE_HIT_PX = 8;

interface DragState {
  kind: 'offset' | 'selection-move' | 'selection-resize-l' | 'selection-resize-r' | 'selection-new' | 'seek';
  source?: SourceKey;
  startPx: number;
  startTime: number;
  // Snapshots
  initialOffset?: number;
  initialSelStart?: number | null;
  initialSelEnd?: number | null;
}

function pickHandleHit(
  px: number,
  selStart: number | null,
  selEnd: number | null,
  tToX: (t: number) => number,
): 'l' | 'r' | 'body' | null {
  if (selStart === null || selEnd === null) return null;
  const xL = tToX(selStart);
  const xR = tToX(selEnd);
  if (Math.abs(px - xL) <= HANDLE_HIT_PX) return 'l';
  if (Math.abs(px - xR) <= HANDLE_HIT_PX) return 'r';
  if (px > xL && px < xR) return 'body';
  return null;
}

export function Timeline() {
  const playing = usePlayback(s => s.playing);
  const rate = usePlayback(s => s.rate);
  const currentTime = usePlayback(s => s.currentTime);
  const fps = usePlayback(s => s.projectFps);
  const playbackStart = usePlayback(s => s.playbackStart);
  const playbackEnd = usePlayback(s => s.playbackEnd);
  const exporterMode = usePlayback(s => s.exporterMode);

  const telemetryOffset = usePlayback(s => s.telemetryOffset);
  const trackOffset = usePlayback(s => s.trackOffset);
  const videoOffset = usePlayback(s => s.videoOffset);

  const ranges = usePlayback(s => sourceRanges(s));
  const [axisStart, axisEnd] = usePlayback(s => axisRange(s));
  const [selStart, selEnd] = usePlayback(s => effectiveRange(s));

  const trackRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);

  useEffect(() => {
    if (!trackRef.current) return;
    const el = trackRef.current;
    const update = () => setWidth(el.getBoundingClientRect().width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const span = Math.max(axisEnd - axisStart, 0.001);
  // Keep a margin so a lane that was dragged outside still has room.
  const viewSpan = span * 1.05;
  const viewStart = axisStart - span * 0.025;
  const pxPerSec = width > 0 && viewSpan > 0 ? width / viewSpan : 0;
  const tToX = (t: number) => (t - viewStart) * pxPerSec;
  const xToT = (x: number) => viewStart + x / pxPerSec;

  const hasAnyData = axisEnd > axisStart;
  const hasSelection = playbackStart !== null && playbackEnd !== null;

  const lanes = (Object.entries(ranges) as [SourceKey, Range | null][])
    .filter(([, r]) => r !== null) as [SourceKey, Range][];

  const offsetOf = (k: SourceKey) =>
    k === 'telemetry' ? telemetryOffset : k === 'track' ? trackOffset : videoOffset;

  const setOffset = (k: SourceKey, v: number) => {
    const st = usePlayback.getState();
    if (k === 'telemetry') st.setTelemetryOffset(v);
    else if (k === 'track') st.setTrackOffset(v);
    else st.setVideoOffset(v);
  };

  // Pointer logic ----------------------------------------------------------
  const localX = (e: React.PointerEvent | PointerEvent) => {
    const rect = trackRef.current!.getBoundingClientRect();
    return e.clientX - rect.left;
  };

  const onLanePointerDown = (e: React.PointerEvent, k: SourceKey) => {
    if (!hasAnyData || !pxPerSec) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const px = localX(e);
    setDrag({
      kind: 'offset',
      source: k,
      startPx: px,
      startTime: xToT(px),
      initialOffset: offsetOf(k),
    });
  };

  const onTrackPointerDown = (e: React.PointerEvent) => {
    if (!hasAnyData || !pxPerSec) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const px = localX(e);
    const t = xToT(px);

    const hit = pickHandleHit(px, playbackStart, playbackEnd, tToX);
    if (hit === 'l') {
      setDrag({
        kind: 'selection-resize-l',
        startPx: px,
        startTime: t,
        initialSelStart: playbackStart,
        initialSelEnd: playbackEnd,
      });
      return;
    }
    if (hit === 'r') {
      setDrag({
        kind: 'selection-resize-r',
        startPx: px,
        startTime: t,
        initialSelStart: playbackStart,
        initialSelEnd: playbackEnd,
      });
      return;
    }
    if (hit === 'body') {
      setDrag({
        kind: 'selection-move',
        startPx: px,
        startTime: t,
        initialSelStart: playbackStart,
        initialSelEnd: playbackEnd,
      });
      return;
    }
    // Empty area: shift starts a brush; plain click seeks.
    if (e.shiftKey) {
      usePlayback.getState().setSelection(t, t);
      setDrag({ kind: 'selection-new', startPx: px, startTime: t });
    } else {
      usePlayback.getState().seek(t);
      setDrag({ kind: 'seek', startPx: px, startTime: t });
    }
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      if (!trackRef.current || !pxPerSec) return;
      const rect = trackRef.current.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const dt = (px - drag.startPx) / pxPerSec;
      const t = xToT(px);

      if (drag.kind === 'offset' && drag.source) {
        setOffset(drag.source, (drag.initialOffset ?? 0) + dt);
      } else if (drag.kind === 'selection-new') {
        const a = drag.startTime;
        const b = t;
        usePlayback.getState().setSelection(Math.min(a, b), Math.max(a, b));
      } else if (drag.kind === 'selection-move') {
        const a = (drag.initialSelStart ?? 0) + dt;
        const b = (drag.initialSelEnd ?? 0) + dt;
        usePlayback.getState().setSelection(a, b);
      } else if (drag.kind === 'selection-resize-l') {
        usePlayback.getState().setSelection(t, drag.initialSelEnd ?? t);
      } else if (drag.kind === 'selection-resize-r') {
        usePlayback.getState().setSelection(drag.initialSelStart ?? t, t);
      } else if (drag.kind === 'seek') {
        usePlayback.getState().seek(t);
      }
    };
    const onUp = () => setDrag(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [drag, pxPerSec, viewStart]);

  // Tick marks -------------------------------------------------------------
  const ticks = useMemo(() => {
    if (!pxPerSec || viewSpan <= 0) return [] as { t: number; major: boolean }[];
    const minPxBetween = 70;
    const candidates = [1, 5, 10, 30, 60, 300, 600, 1800, 3600];
    let stride = candidates[candidates.length - 1];
    for (const c of candidates) {
      if (c * pxPerSec >= minPxBetween) {
        stride = c;
        break;
      }
    }
    const out: { t: number; major: boolean }[] = [];
    const first = Math.ceil(viewStart / stride) * stride;
    for (let t = first; t <= viewStart + viewSpan; t += stride) {
      out.push({ t, major: stride >= 60 ? t % (stride * 5) === 0 : false });
    }
    return out;
  }, [pxPerSec, viewStart, viewSpan]);

  if (exporterMode) return null;

  // Layout ----------------------------------------------------------------
  const laneHeight = 22;
  const laneGap = 4;
  const lanesRegionH = lanes.length * (laneHeight + laneGap) + (lanes.length ? laneGap : 0);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        boxSizing: 'border-box',
        background: '#181818',
        borderTop: '1px solid #2a2a2a',
        padding: '8px 16px 12px 16px',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {/* Controls row */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button
          onClick={() => usePlayback.getState().toggle()}
          disabled={!hasAnyData}
          style={{
            width: 32,
            height: 26,
            background: '#333',
            border: '1px solid #555',
            color: '#fff',
            cursor: hasAnyData ? 'pointer' : 'default',
          }}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <span
          style={{
            minWidth: 240,
            color: '#bbb',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
          title={`${currentTime.toFixed(3)} s of day · ${fps}fps`}
        >
          {formatTimecode(currentTime, fps)} &nbsp; <span style={{ color: '#777' }}>选区</span>{' '}
          {formatTimecode(selStart, fps)} - {formatTimecode(selEnd, fps)} ({formatTimecode(selEnd - selStart, fps)})
        </span>
        <label>
          FPS
          <select
            value={fps}
            onChange={e => usePlayback.getState().setProjectFps(Number(e.target.value))}
            style={{ marginLeft: 6 }}
          >
            {PROJECT_FPS_OPTIONS.map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          倍速
          <select
            value={rate}
            onChange={e => usePlayback.getState().setRate(Number(e.target.value))}
            style={{ marginLeft: 6 }}
          >
            {[0.25, 0.5, 1, 2, 4].map(r => (
              <option key={r} value={r}>{r}×</option>
            ))}
          </select>
        </label>
        <button
          onClick={() => {
            const st = usePlayback.getState();
            st.setTelemetryOffset(0);
            st.setTrackOffset(0);
            const dataStart =
              (ranges.telemetry?.[0] ?? Infinity) <= (ranges.track?.[0] ?? Infinity)
                ? ranges.telemetry?.[0]
                : ranges.track?.[0];
            if (dataStart !== undefined) st.setVideoOffset(dataStart);
            else st.setVideoOffset(0);
          }}
          disabled={lanes.length === 0}
          style={{
            padding: '4px 10px',
            background: '#333',
            color: '#fff',
            border: '1px solid #555',
            borderRadius: 3,
            cursor: lanes.length ? 'pointer' : 'default',
            fontFamily: 'inherit',
            fontSize: 12,
          }}
          title="清除所有数据源的偏移量"
        >
          重置对齐
        </button>
        <button
          onClick={() => usePlayback.getState().setSelection(null, null)}
          disabled={!hasSelection}
          style={{
            padding: '4px 10px',
            background: '#333',
            color: '#fff',
            border: '1px solid #555',
            borderRadius: 3,
            cursor: hasSelection ? 'pointer' : 'default',
            fontFamily: 'inherit',
            fontSize: 12,
          }}
        >
          清除选区
        </button>
        <button
          onClick={() => {
            const st = usePlayback.getState();
            const cur = st.currentTime;
            const end = st.playbackEnd ?? axisEnd;
            st.setSelection(cur, Math.max(cur, end));
          }}
          disabled={!hasAnyData}
          style={{
            padding: '4px 10px',
            background: '#333',
            color: '#fff',
            border: '1px solid #555',
            borderRadius: 3,
            cursor: hasAnyData ? 'pointer' : 'default',
            fontFamily: 'inherit',
            fontSize: 12,
          }}
          title="将当前时间设为选区起点"
        >
          设为起点
        </button>
        <button
          onClick={() => {
            const st = usePlayback.getState();
            const cur = st.currentTime;
            const start = st.playbackStart ?? axisStart;
            st.setSelection(Math.min(start, cur), cur);
          }}
          disabled={!hasAnyData}
          style={{
            padding: '4px 10px',
            background: '#333',
            color: '#fff',
            border: '1px solid #555',
            borderRadius: 3,
            cursor: hasAnyData ? 'pointer' : 'default',
            fontFamily: 'inherit',
            fontSize: 12,
          }}
          title="将当前时间设为选区终点"
        >
          设为终点
        </button>
        <span style={{ marginLeft: 'auto', color: '#777', fontSize: 11 }}>
          拖条带=对齐 · Shift+拖=框选 · 拖端把手=改选区 · 点空白=跳转
        </span>
      </div>

      {/* Track region */}
      <div
        ref={trackRef}
        onPointerDown={onTrackPointerDown}
        style={{
          position: 'relative',
          width: '100%',
          height: 18 + lanesRegionH + 6,
          background: '#101010',
          border: '1px solid #2a2a2a',
          borderRadius: 3,
          cursor: hasAnyData ? 'crosshair' : 'default',
          overflow: 'hidden',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
        {/* Tick labels */}
        <div style={{ position: 'absolute', inset: 0 }}>
          {ticks.map((tk, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: tToX(tk.t),
                top: 0,
                bottom: 0,
                width: 1,
                background: tk.major ? '#333' : '#222',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: 2,
                  top: 1,
                  fontSize: 10,
                  color: '#666',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                }}
              >
                {formatTimecode(tk.t, fps)}
              </div>
            </div>
          ))}
        </div>

        {/* Selection band */}
        {hasSelection && pxPerSec > 0 && (
          <div
            style={{
              position: 'absolute',
              left: tToX(selStart),
              top: 0,
              bottom: 0,
              width: Math.max(1, tToX(selEnd) - tToX(selStart)),
              background: 'rgba(108, 207, 255, 0.18)',
              borderLeft: '1px solid rgba(108, 207, 255, 0.7)',
              borderRight: '1px solid rgba(108, 207, 255, 0.7)',
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Lanes */}
        {lanes.map(([k, r], i) => {
          const meta = LANE_META[k];
          const top = 18 + laneGap + i * (laneHeight + laneGap);
          const left = tToX(r[0]);
          const w = Math.max(2, tToX(r[1]) - tToX(r[0]));
          return (
            <div
              key={k}
              onPointerDown={e => onLanePointerDown(e, k)}
              style={{
                position: 'absolute',
                top,
                left,
                width: w,
                height: laneHeight,
                background: meta.color,
                borderRadius: 3,
                opacity: 0.85,
                cursor: 'ew-resize',
                display: 'flex',
                alignItems: 'center',
                paddingLeft: 6,
                color: '#001',
                fontWeight: 600,
                fontSize: 11,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                boxShadow: drag?.source === k ? '0 0 0 2px #fff inset' : 'none',
              }}
              title={`${meta.label}  ${formatTimecode(r[0], fps)} -> ${formatTimecode(r[1], fps)}  · 偏移 ${offsetOf(k).toFixed(2)}s`}
            >
              {meta.label} {formatTimecode(r[0], fps)}
            </div>
          );
        })}

        {/* Playhead */}
        {hasAnyData && pxPerSec > 0 && (
          <div
            style={{
              position: 'absolute',
              left: tToX(currentTime),
              top: 0,
              bottom: 0,
              width: 1,
              background: '#ff5e5e',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: -1,
                left: -4,
                width: 9,
                height: 6,
                background: '#ff5e5e',
                clipPath: 'polygon(0 0, 100% 0, 50% 100%)',
              }}
            />
          </div>
        )}

        {/* Selection edge handles (visible) */}
        {hasSelection && pxPerSec > 0 && (
          <>
            <div
              style={{
                position: 'absolute',
                left: tToX(selStart) - 3,
                top: 0,
                bottom: 0,
                width: 6,
                cursor: 'ew-resize',
                background: 'transparent',
                pointerEvents: 'none',
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: tToX(selEnd) - 3,
                top: 0,
                bottom: 0,
                width: 6,
                cursor: 'ew-resize',
                background: 'transparent',
                pointerEvents: 'none',
              }}
            />
          </>
        )}

        {!hasAnyData && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#555',
              fontSize: 12,
              pointerEvents: 'none',
            }}
          >
            导入 CSV / GPX / 视频 后这里会出现时间轴
          </div>
        )}
      </div>
    </div>
  );
}
