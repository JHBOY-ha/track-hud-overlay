import { useEffect, useMemo, useRef, useState } from 'react';
import {
  axisRange,
  effectiveRange,
  sourceRanges,
  usePlayback,
  type Range,
  type SourceKey,
} from '../playback/store';
import { formatClock, formatTimecode, parseClock, PROJECT_FPS_OPTIONS } from '../util/timecode';

const LANE_META: Record<SourceKey, { label: string; color: string }> = {
  track: { label: 'GPX', color: '#5fa8ff' },
  telemetry: { label: 'CSV', color: '#5fd28a' },
  video: { label: 'VIDEO', color: '#d29a5f' },
};

const HANDLE_HIT_PX = 8;
const EDGE_HIT_PX = 6;
const MIN_TRIM_WIDTH = EDGE_HIT_PX * 2 + 4; // lane too narrow for trim edges
const MIN_VIEW_FRAMES = 8;
const SNAP_TO_PLAYHEAD_PX = 10;
const SHUTTLE_RATES = [1, 2, 4, 8];

interface DragState {
  kind: 'offset' | 'trim-left' | 'trim-right' | 'selection-move' | 'selection-resize-l' | 'selection-resize-r' | 'selection-new' | 'seek';
  source?: SourceKey;
  startPx: number;
  startTime: number;
  startClientX: number;
  startClientY: number;
  // Snapshots
  initialOffset?: number;
  initialTrimStart?: number;
  initialTrimEnd?: number;
  initialRangeStart?: number;
  initialRangeEnd?: number;
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

function clampN(n: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function nextShuttleRate(rate: number, playing: boolean, direction: 1 | -1): number {
  if (!playing || Math.sign(rate) !== direction) return direction;
  const abs = Math.abs(rate);
  const next = SHUTTLE_RATES.find(r => r > abs + 1e-6) ?? SHUTTLE_RATES[SHUTTLE_RATES.length - 1];
  return next * direction;
}

function snapTimeToFrame(t: number, fps: number): number {
  if (!Number.isFinite(t) || fps <= 0) return t;
  return Math.round(t * fps) / fps;
}

export function Timeline() {
  const playing = usePlayback(s => s.playing);
  const rate = usePlayback(s => s.rate);
  const currentTime = usePlayback(s => s.currentTime);
  const fps = usePlayback(s => s.projectFps);
  const playbackStart = usePlayback(s => s.playbackStart);
  const playbackEnd = usePlayback(s => s.playbackEnd);
  const exporterMode = usePlayback(s => s.exporterMode);
  const progressStart = usePlayback(s => s.progressStart);
  const progressEnd = usePlayback(s => s.progressEnd);
  const progressStartPct = usePlayback(s => s.progressStartPct);
  const progressEndPct = usePlayback(s => s.progressEndPct);
  const elapsedStart = usePlayback(s => s.elapsedStart);

  const telemetryOffset = usePlayback(s => s.telemetryOffset);
  const trackOffset = usePlayback(s => s.trackOffset);
  const videoOffset = usePlayback(s => s.videoOffset);

  const telemetryTrimStart = usePlayback(s => s.telemetryTrimStart);
  const telemetryTrimEnd = usePlayback(s => s.telemetryTrimEnd);
  const trackTrimStart = usePlayback(s => s.trackTrimStart);
  const trackTrimEnd = usePlayback(s => s.trackTrimEnd);
  const videoTrimStart = usePlayback(s => s.videoTrimStart);
  const videoTrimEnd = usePlayback(s => s.videoTrimEnd);

  const ranges = usePlayback(s => sourceRanges(s));
  const [axisStart, axisEnd] = usePlayback(s => axisRange(s));
  const [selStart, selEnd] = usePlayback(s => effectiveRange(s));

  const trackRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [selectedLane, setSelectedLane] = useState<SourceKey | null>(null);
  const [edgeHover, setEdgeHover] = useState<{ lane: SourceKey; side: 'left' | 'right' } | null>(null);
  const [elapsedStartText, setElapsedStartText] = useState(() => formatClock(elapsedStart));
  const [viewRange, setViewRange] = useState<Range | null>(null);

  useEffect(() => {
    if (!trackRef.current) return;
    const el = trackRef.current;
    const update = () => setWidth(el.getBoundingClientRect().width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hasAnyData = axisEnd > axisStart;
  const span = Math.max(axisEnd - axisStart, 0.001);
  // Keep a margin so a lane that was dragged outside still has room.
  const fullViewSpan = span * 1.05;
  const fullViewStart = axisStart - span * 0.025;
  const fullViewEnd = fullViewStart + fullViewSpan;
  const minViewSpan = Math.max(MIN_VIEW_FRAMES / fps, 0.05);
  const [activeViewStart, activeViewEnd] = viewRange ?? [fullViewStart, fullViewEnd];
  const viewStart = activeViewStart;
  const viewSpan = Math.max(activeViewEnd - activeViewStart, 0.001);
  const pxPerSec = width > 0 && viewSpan > 0 ? width / viewSpan : 0;
  const tToX = (t: number) => (t - viewStart) * pxPerSec;
  const xToT = (x: number) => viewStart + x / pxPerSec;
  const snapT = (t: number) => snapTimeToFrame(t, fps);
  const currentFrameTime = snapT(currentTime);

  const hasSelection = playbackStart !== null && playbackEnd !== null;
  const isZoomed = viewRange !== null;

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

  const deleteLane = (k: SourceKey) => {
    const st = usePlayback.getState();
    if (k === 'telemetry') st.setTelemetry(null);
    else if (k === 'track') st.setTrack(null);
    else st.clearVideo();
    setSelectedLane(null);
  };

  const trimOf = (k: SourceKey): [number, number] => {
    if (k === 'telemetry') return [telemetryTrimStart, telemetryTrimEnd];
    if (k === 'track') return [trackTrimStart, trackTrimEnd];
    return [videoTrimStart, videoTrimEnd];
  };

  const setTrim = (k: SourceKey, start: number, end: number) => {
    usePlayback.getState().setSourceTrim(k, start, end);
  };

  const snapEdgeToPlayhead = (t: number) => {
    const frameT = snapT(t);
    if (pxPerSec <= 0) return frameT;
    return Math.abs(tToX(frameT) - tToX(currentFrameTime)) <= SNAP_TO_PLAYHEAD_PX
      ? currentFrameTime
      : frameT;
  };

  const resetView = () => setViewRange(null);

  const revealTime = (t: number) => {
    setViewRange(prev => {
      if (!prev) return prev;
      const curSpan = prev[1] - prev[0];
      if (t >= prev[0] && t <= prev[1]) return prev;
      const nextStart = clampN(t - curSpan * 0.5, fullViewStart, fullViewEnd - curSpan);
      return [nextStart, nextStart + curSpan];
    });
  };

  const stepFrames = (frames: number) => {
    const st = usePlayback.getState();
    st.pause();
    const target = st.currentTime + frames / st.projectFps;
    st.seek(snapTimeToFrame(target, st.projectFps));
    revealTime(usePlayback.getState().currentTime);
  };

  const sourceDuration = (k: SourceKey, ranges: Record<SourceKey, [number, number] | null>): number => {
    const r = ranges[k];
    if (!r) return 0;
    // Remove trim contribution to get the raw (untrimmed) duration
    const [ts, te] = trimOf(k);
    const rawStart = r[0] - (k === 'telemetry' ? telemetryOffset : k === 'track' ? trackOffset : videoOffset) - ts;
    const rawEnd = r[1] - (k === 'telemetry' ? telemetryOffset : k === 'track' ? trackOffset : videoOffset) + te;
    return Math.max(0, rawEnd - rawStart);
  };

  // Pointer logic ----------------------------------------------------------
  const localX = (e: React.PointerEvent | PointerEvent) => {
    const rect = trackRef.current!.getBoundingClientRect();
    return e.clientX - rect.left;
  };

  const onLanePointerDown = (e: React.PointerEvent, k: SourceKey) => {
    if (!hasAnyData || !pxPerSec) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const px = localX(e);
    // Detect edge hit for trim vs middle for offset
    const range = ranges[k];
    if (range) {
      const laneStart = snapT(range[0]);
      const laneEnd = snapT(range[1]);
      const laneLeft = tToX(laneStart);
      const laneWidth = Math.max(2, tToX(laneEnd) - tToX(laneStart));
      const pxInLane = px - laneLeft;
      const [trimS, trimE] = trimOf(k);
      if (laneWidth >= MIN_TRIM_WIDTH && pxInLane < EDGE_HIT_PX) {
        setDrag({
          kind: 'trim-left',
          source: k,
          startPx: px,
          startTime: xToT(px),
          startClientX: e.clientX,
          startClientY: e.clientY,
          initialTrimStart: trimS,
          initialTrimEnd: trimE,
          initialRangeStart: range[0],
          initialRangeEnd: range[1],
        });
        return;
      }
      if (laneWidth >= MIN_TRIM_WIDTH && pxInLane > laneWidth - EDGE_HIT_PX) {
        setDrag({
          kind: 'trim-right',
          source: k,
          startPx: px,
          startTime: xToT(px),
          startClientX: e.clientX,
          startClientY: e.clientY,
          initialTrimStart: trimS,
          initialTrimEnd: trimE,
          initialRangeStart: range[0],
          initialRangeEnd: range[1],
        });
        return;
      }
    }
    setDrag({
      kind: 'offset',
      source: k,
      startPx: px,
      startTime: xToT(px),
      startClientX: e.clientX,
      startClientY: e.clientY,
      initialOffset: offsetOf(k),
      initialRangeStart: range?.[0],
      initialRangeEnd: range?.[1],
    });
  };

  const onTrackPointerDown = (e: React.PointerEvent) => {
    if (!hasAnyData || !pxPerSec) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const px = localX(e);
    const t = snapT(xToT(px));

    const hit = pickHandleHit(px, playbackStart, playbackEnd, t => tToX(snapT(t)));
    if (hit === 'l') {
      setDrag({
        kind: 'selection-resize-l',
        startPx: px,
        startTime: t,
        startClientX: e.clientX,
        startClientY: e.clientY,
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
        startClientX: e.clientX,
        startClientY: e.clientY,
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
        startClientX: e.clientX,
        startClientY: e.clientY,
        initialSelStart: playbackStart,
        initialSelEnd: playbackEnd,
      });
      return;
    }
    // Empty area: shift starts a brush; plain click seeks.
    setSelectedLane(null);
    if (e.shiftKey) {
      usePlayback.getState().setSelection(t, t);
      setDrag({ kind: 'selection-new', startPx: px, startTime: t, startClientX: e.clientX, startClientY: e.clientY });
    } else {
      usePlayback.getState().seek(t);
      setDrag({ kind: 'seek', startPx: px, startTime: t, startClientX: e.clientX, startClientY: e.clientY });
    }
  };

  const onTrackWheel = (e: React.WheelEvent) => {
    if (!hasAnyData || !pxPerSec || width <= 0) return;
    e.preventDefault();
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const focalX = clampN(e.clientX - rect.left, 0, width);
    const focalT = xToT(focalX);
    const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
    if (delta === 0) return;

    const nextSpan = clampN(viewSpan * Math.exp(delta * 0.0015), minViewSpan, fullViewSpan);
    if (nextSpan >= fullViewSpan * 0.999) {
      resetView();
      return;
    }
    const focalRatio = clampN((focalT - viewStart) / viewSpan, 0, 1);
    const nextStart = clampN(focalT - focalRatio * nextSpan, fullViewStart, fullViewEnd - nextSpan);
    setViewRange([nextStart, nextStart + nextSpan]);
  };

  useEffect(() => {
    if (!hasAnyData) {
      setViewRange(null);
      return;
    }
    setViewRange(prev => {
      if (!prev) return prev;
      const curSpan = prev[1] - prev[0];
      if (!Number.isFinite(curSpan) || curSpan <= 0 || curSpan >= fullViewSpan * 0.999) return null;
      const nextSpan = clampN(curSpan, minViewSpan, fullViewSpan);
      const nextStart = clampN(prev[0], fullViewStart, fullViewEnd - nextSpan);
      return [nextStart, nextStart + nextSpan];
    });
  }, [hasAnyData, fullViewStart, fullViewEnd, fullViewSpan, minViewSpan]);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      if (!trackRef.current || !pxPerSec) return;
      const rect = trackRef.current.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const dt = (px - drag.startPx) / pxPerSec;
      const t = snapT(xToT(px));

      if (drag.kind === 'offset' && drag.source) {
        const initialStart = drag.initialRangeStart ?? 0;
        const initialEnd = drag.initialRangeEnd ?? initialStart;
        const targetStart = initialStart + dt;
        const targetEnd = initialEnd + dt;
        let snappedStart = snapT(targetStart);
        if (Math.abs(tToX(snapT(targetStart)) - tToX(currentFrameTime)) <= SNAP_TO_PLAYHEAD_PX) {
          snappedStart = currentFrameTime;
        } else if (Math.abs(tToX(snapT(targetEnd)) - tToX(currentFrameTime)) <= SNAP_TO_PLAYHEAD_PX) {
          snappedStart = currentFrameTime - (initialEnd - initialStart);
        }
        setOffset(drag.source, (drag.initialOffset ?? 0) + (snappedStart - initialStart));
      } else if ((drag.kind === 'trim-left' || drag.kind === 'trim-right') && drag.source) {
        const k = drag.source;
        const [curStart, curEnd] = trimOf(k);
        const dur = sourceDuration(k, ranges);
        if (drag.kind === 'trim-left') {
          const rawStart = (drag.initialRangeStart ?? 0) - (drag.initialTrimStart ?? 0);
          const desiredEdge = snapEdgeToPlayhead((drag.initialRangeStart ?? 0) + dt);
          const newStart = Math.max(0, Math.min(dur - curEnd, desiredEdge - rawStart));
          setTrim(k, newStart, curEnd);
        } else {
          const rawEnd = (drag.initialRangeEnd ?? 0) + (drag.initialTrimEnd ?? 0);
          const desiredEdge = snapEdgeToPlayhead((drag.initialRangeEnd ?? 0) + dt);
          const newEnd = Math.max(0, Math.min(dur - curStart, rawEnd - desiredEdge));
          setTrim(k, curStart, newEnd);
        }
      } else if (drag.kind === 'selection-new') {
        const a = drag.startTime;
        const b = t;
        usePlayback.getState().setSelection(Math.min(a, b), Math.max(a, b));
      } else if (drag.kind === 'selection-move') {
        // Only commit a move once the pointer has clearly travelled — otherwise
        // a plain click inside the selection body would never reach the
        // pointer-up "seek" branch below.
        const dx = e.clientX - drag.startClientX;
        const dy = e.clientY - drag.startClientY;
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        const selStart0 = drag.initialSelStart ?? 0;
        const selEnd0 = drag.initialSelEnd ?? selStart0;
        const a = snapT(selStart0 + dt);
        const b = a + (selEnd0 - selStart0);
        usePlayback.getState().setSelection(a, b);
      } else if (drag.kind === 'selection-resize-l') {
        usePlayback.getState().setSelection(t, drag.initialSelEnd ?? t);
      } else if (drag.kind === 'selection-resize-r') {
        usePlayback.getState().setSelection(drag.initialSelStart ?? t, t);
      } else if (drag.kind === 'seek') {
        usePlayback.getState().seek(t);
      }
    };
    const onUp = (e: PointerEvent) => {
      if (drag.kind === 'selection-move') {
        const dx = e.clientX - drag.startClientX;
        const dy = e.clientY - drag.startClientY;
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
          usePlayback.getState().seek(snapT(drag.startTime));
          setDrag(null);
          return;
        }
      }
      if ((drag.kind === 'offset' || drag.kind === 'trim-left' || drag.kind === 'trim-right') && drag.source) {
        const dx = e.clientX - drag.startClientX;
        const dy = e.clientY - drag.startClientY;
        if ((dx === 0 || (dx > -3 && dx < 3)) && (dy === 0 || (dy > -3 && dy < 3))) {
          const src = drag.source;
          setSelectedLane(prev => (prev === src ? null : src));
          setDrag(null);
          return;
        }
      }
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [drag, pxPerSec, viewStart]);

  // Delete selected lane on Backspace / Delete
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedLane) {
        e.preventDefault();
        deleteLane(selectedLane);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedLane]);

  // NLE-style transport shortcuts: Space, J/K/L, frame stepping, range edges.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const st = usePlayback.getState();

      if (e.code === 'Space') {
        e.preventDefault();
        if (st.playing) st.pause();
        else {
          st.setRate(1);
          st.play();
        }
        return;
      }
      if (!hasAnyData) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepFrames(e.shiftKey ? -10 : -1);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepFrames(e.shiftKey ? 10 : 1);
        return;
      }
      if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        st.setRate(nextShuttleRate(st.rate, st.playing, -1));
        st.play();
        return;
      }
      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        st.pause();
        return;
      }
      if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        st.setRate(nextShuttleRate(st.rate, st.playing, 1));
        st.play();
        return;
      }
      if (e.key === 'Home') {
        e.preventDefault();
        const [start] = effectiveRange(usePlayback.getState());
        st.pause();
        st.seek(snapTimeToFrame(start, st.projectFps));
        revealTime(usePlayback.getState().currentTime);
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        const [, end] = effectiveRange(usePlayback.getState());
        st.pause();
        st.seek(snapTimeToFrame(end, st.projectFps));
        revealTime(usePlayback.getState().currentTime);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [hasAnyData, fullViewStart, fullViewEnd]);

  useEffect(() => {
    if (!playing || !viewRange) return;
    const guard = viewSpan * 0.08;
    if (currentTime < viewRange[0] + guard || currentTime > viewRange[1] - guard) {
      revealTime(currentTime);
    }
  }, [currentTime, playing, viewRange, viewSpan]);

  // Tick marks -------------------------------------------------------------
  const ticks = useMemo(() => {
    if (!pxPerSec || viewSpan <= 0) return [] as { t: number; major: boolean }[];
    const minPxBetween = 70;
    const frame = 1 / fps;
    const candidates = [frame, frame * 2, frame * 5, frame * 10, frame * 15, frame * 30, 1, 5, 10, 30, 60, 300, 600, 1800, 3600]
      .filter((v, i, arr) => v > 0 && arr.findIndex(x => Math.abs(x - v) < 1e-9) === i)
      .sort((a, b) => a - b);
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
      const frameIndex = Math.round(t * fps);
      const framesPerSecond = Math.round(fps);
      out.push({
        t: snapTimeToFrame(t, fps),
        major: stride < 1 ? frameIndex % framesPerSecond === 0 : stride >= 60 ? t % (stride * 5) === 0 : false,
      });
    }
    return out;
  }, [fps, pxPerSec, viewStart, viewSpan]);

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
        userSelect: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {/* Controls row */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button
          onClick={() => {
            const st = usePlayback.getState();
            if (st.playing) st.pause();
            else {
              if (st.rate < 0) st.setRate(1);
              st.play();
            }
          }}
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
          {playing ? (rate < 0 ? '◀' : '❚❚') : '▶'}
        </button>
        <span
          style={{
            minWidth: 240,
            color: '#bbb',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
          title={`${currentTime.toFixed(3)} s of day · ${fps}fps`}
        >
          {formatTimecode(currentFrameTime, fps)} &nbsp; <span style={{ color: '#777' }}>选区</span>{' '}
          {formatTimecode(selStart, fps)} - {formatTimecode(selEnd, fps)} ({formatTimecode(selEnd - selStart, fps)})
        </span>
        <label>
          FPS
          <select
            value={fps}
            onChange={e => {
              usePlayback.getState().setProjectFps(Number(e.target.value));
              e.currentTarget.blur();
            }}
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
            onChange={e => {
              usePlayback.getState().setRate(Number(e.target.value));
              e.currentTarget.blur();
            }}
            style={{ marginLeft: 6 }}
          >
            {[-8, -4, -2, -1, 0.25, 0.5, 1, 2, 4, 8].map(r => (
              <option key={r} value={r}>{r < 0 ? `◀ ${Math.abs(r)}×` : `${r}×`}</option>
            ))}
          </select>
        </label>
        <button
          onClick={resetView}
          disabled={!isZoomed}
          style={{
            padding: '4px 10px',
            background: '#333',
            color: '#fff',
            border: '1px solid #555',
            borderRadius: 3,
            cursor: isZoomed ? 'pointer' : 'default',
            opacity: isZoomed ? 1 : 0.55,
            fontFamily: 'inherit',
            fontSize: 12,
          }}
          title="将时间线缩放恢复到完整范围"
        >
          适合
        </button>
        <button
          onClick={() => {
            const st = usePlayback.getState();
            st.setTelemetryOffset(0);
            st.setTrackOffset(0);
            // Restore embedded SMPTE timecode, or fall back to aligning with the earliest data source.
            if (st.videoEmbeddedTimecode !== null) {
              st.setVideoOffset(st.videoEmbeddedTimecode);
            } else {
              const postReset = sourceRanges(st);
              const dataStart =
                (postReset.telemetry?.[0] ?? Infinity) <= (postReset.track?.[0] ?? Infinity)
                  ? postReset.telemetry?.[0]
                  : postReset.track?.[0];
              st.setVideoOffset(dataStart ?? 0);
            }
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
          onClick={() => selectedLane && deleteLane(selectedLane)}
          disabled={!selectedLane}
          style={{
            padding: '4px 10px',
            background: '#333',
            color: selectedLane ? '#f88' : '#555',
            border: '1px solid #555',
            borderRadius: 3,
            cursor: selectedLane ? 'pointer' : 'default',
            fontFamily: 'inherit',
            fontSize: 12,
          }}
          title="删除选中的数据源"
        >
          删除条带
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
            const cur = snapT(st.currentTime);
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
            const cur = snapT(st.currentTime);
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
        <span style={{ width: 1, height: 20, background: '#333' }} />
        <button
          onClick={() => usePlayback.getState().setProgressStart(snapT(usePlayback.getState().currentTime))}
          disabled={!hasAnyData}
          style={{
            padding: '4px 10px',
            background: '#333',
            color: '#9ad6ff',
            border: '1px solid #555',
            borderRadius: 3,
            cursor: hasAnyData ? 'pointer' : 'default',
            fontFamily: 'inherit',
            fontSize: 12,
          }}
          title="将当前时间设为左上角进度条起点"
        >
          进度起点
        </button>
        <input
          type="number"
          min={0}
          max={100}
          value={progressStartPct}
          disabled={progressStart === null}
          onChange={e => usePlayback.getState().setProgressStartPct(Number(e.target.value))}
          style={{
            width: 48,
            padding: '4px 6px',
            background: '#222',
            color: '#9ad6ff',
            border: '1px solid #555',
            borderRadius: 3,
            fontFamily: 'inherit',
            fontSize: 12,
          }}
          title="进度起点对应的百分比"
        />
        <span style={{ color: '#9ad6ff', fontSize: 11 }}>%</span>
        <button
          onClick={() => usePlayback.getState().setProgressEnd(snapT(usePlayback.getState().currentTime))}
          disabled={!hasAnyData}
          style={{
            padding: '4px 10px',
            background: '#333',
            color: '#9ad6ff',
            border: '1px solid #555',
            borderRadius: 3,
            cursor: hasAnyData ? 'pointer' : 'default',
            fontFamily: 'inherit',
            fontSize: 12,
          }}
          title="将当前时间设为左上角进度条终点"
        >
          进度终点
        </button>
        <input
          type="number"
          min={0}
          max={100}
          value={progressEndPct}
          disabled={progressEnd === null}
          onChange={e => usePlayback.getState().setProgressEndPct(Number(e.target.value))}
          style={{
            width: 48,
            padding: '4px 6px',
            background: '#222',
            color: '#9ad6ff',
            border: '1px solid #555',
            borderRadius: 3,
            fontFamily: 'inherit',
            fontSize: 12,
          }}
          title="进度终点对应的百分比"
        />
        <span style={{ color: '#9ad6ff', fontSize: 11 }}>%</span>
        <button
          onClick={() => usePlayback.getState().clearProgressRange()}
          disabled={progressStart === null && progressEnd === null}
          style={{
            padding: '4px 10px',
            background: '#333',
            color: '#fff',
            border: '1px solid #555',
            borderRadius: 3,
            cursor: progressStart !== null || progressEnd !== null ? 'pointer' : 'default',
            fontFamily: 'inherit',
            fontSize: 12,
          }}
          title="清除进度区间，恢复使用 telemetry progress 字段"
        >
          清除进度
        </button>
        <span style={{ width: 1, height: 20, background: '#333' }} />
        <span style={{ color: '#bbb', fontSize: 12 }}>Elapsed 起点</span>
        <input
          type="text"
          value={elapsedStartText}
          placeholder="时:分:秒"
          onChange={e => {
            const text = e.target.value;
            setElapsedStartText(text);
            const secs = parseClock(text);
            if (secs !== null) usePlayback.getState().setElapsedStart(secs);
          }}
          onBlur={() => setElapsedStartText(formatClock(usePlayback.getState().elapsedStart))}
          style={{
            width: 84,
            padding: '4px 6px',
            background: '#222',
            color: '#fff',
            border: '1px solid #555',
            borderRadius: 3,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 12,
          }}
          title="左上角 Elapsed 的起始时间（如 00:02:30 或 150）"
        />
      </div>

      {/* Track region */}
      <div
        ref={trackRef}
        onPointerDown={onTrackPointerDown}
        onWheel={onTrackWheel}
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
              left: tToX(snapT(selStart)),
              top: 0,
              bottom: 0,
              width: Math.max(1, tToX(snapT(selEnd)) - tToX(snapT(selStart))),
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
          const frameStart = snapT(r[0]);
          const frameEnd = snapT(r[1]);
          const left = tToX(frameStart);
          const w = Math.max(2, tToX(frameEnd) - tToX(frameStart));
          return (
            <div
              key={k}
              onPointerDown={e => onLanePointerDown(e, k)}
              onPointerMove={e => {
                if (drag) return;
                const px = localX(e);
                const laneLeft = tToX(frameStart);
                const laneWidth = Math.max(2, tToX(frameEnd) - tToX(frameStart));
                const pxInLane = px - laneLeft;
                if (laneWidth >= MIN_TRIM_WIDTH && pxInLane < EDGE_HIT_PX) {
                  setEdgeHover({ lane: k, side: 'left' });
                } else if (laneWidth >= MIN_TRIM_WIDTH && pxInLane > laneWidth - EDGE_HIT_PX) {
                  setEdgeHover({ lane: k, side: 'right' });
                } else {
                  setEdgeHover(null);
                }
              }}
              onPointerLeave={() => setEdgeHover(null)}
              style={{
                position: 'absolute',
                top,
                left,
                width: w,
                height: laneHeight,
                background: meta.color,
                borderRadius: 3,
                opacity: 0.85,
                cursor:
                  edgeHover?.lane === k && w >= MIN_TRIM_WIDTH ? 'col-resize' : drag ? undefined : 'ew-resize',
                display: 'flex',
                alignItems: 'center',
                paddingLeft: 6,
                color: '#001',
                fontWeight: 600,
                fontSize: 11,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                boxShadow: drag?.source === k ? '0 0 0 2px #fff inset' : 'none',
                outline: selectedLane === k ? '2px solid #fff' : 'none',
                outlineOffset: -2,
              }}
              title={`${meta.label}  ${formatTimecode(frameStart, fps)} -> ${formatTimecode(frameEnd, fps)}  · 偏移 ${offsetOf(k).toFixed(2)}s · 裁剪 ${trimOf(k)[0].toFixed(1)}+${trimOf(k)[1].toFixed(1)}s`}
            >
              {w >= MIN_TRIM_WIDTH && (
                <div style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
                  background: edgeHover?.lane === k && edgeHover.side === 'left'
                    ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.3)',
                  pointerEvents: 'none',
                }} />
              )}
              {w >= MIN_TRIM_WIDTH && (
                <div style={{
                  position: 'absolute', right: 0, top: 0, bottom: 0, width: 3,
                  background: edgeHover?.lane === k && edgeHover.side === 'right'
                    ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.3)',
                  pointerEvents: 'none',
                }} />
              )}
              {meta.label} {formatTimecode(frameStart, fps)}
            </div>
          );
        })}

        {/* Progress range markers */}
        {pxPerSec > 0 && progressStart !== null && progressEnd !== null && progressEnd > progressStart && (
          <div
            style={{
              position: 'absolute',
              left: tToX(snapT(progressStart)),
              top: 0,
              bottom: 0,
              width: Math.max(1, tToX(snapT(progressEnd)) - tToX(snapT(progressStart))),
              background: 'rgba(154, 214, 255, 0.08)',
              borderTop: '2px solid rgba(154, 214, 255, 0.7)',
              pointerEvents: 'none',
            }}
          />
        )}
        {pxPerSec > 0 && progressStart !== null && (
          <div
            style={{
              position: 'absolute',
              left: tToX(snapT(progressStart)),
              top: 0,
              bottom: 0,
              width: 1,
              background: '#9ad6ff',
              pointerEvents: 'none',
            }}
            title="进度起点"
          >
            <div style={{ position: 'absolute', top: 0, left: 0, fontSize: 9, color: '#9ad6ff', padding: '0 2px', background: '#101010' }}>{progressStartPct}%</div>
          </div>
        )}
        {pxPerSec > 0 && progressEnd !== null && (
          <div
            style={{
              position: 'absolute',
              left: tToX(snapT(progressEnd)),
              top: 0,
              bottom: 0,
              width: 1,
              background: '#9ad6ff',
              pointerEvents: 'none',
            }}
            title="进度终点"
          >
            <div style={{ position: 'absolute', top: 0, left: -28, fontSize: 9, color: '#9ad6ff', padding: '0 2px', background: '#101010' }}>{progressEndPct}%</div>
          </div>
        )}

        {/* Playhead */}
        {hasAnyData && pxPerSec > 0 && (
          <div
            style={{
              position: 'absolute',
              left: tToX(currentFrameTime),
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
                left: tToX(snapT(selStart)) - 3,
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
                left: tToX(snapT(selEnd)) - 3,
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
