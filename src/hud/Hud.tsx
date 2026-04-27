import { useEffect, useMemo, useRef } from 'react';
import { effectiveRange, usePlayback } from '../playback/store';
import { sampleAt } from '../data/telemetry';
import { Speedometer } from './Speedometer';
import { Minimap } from './Minimap';
import { TopLeftStatus } from './TopLeftStatus';
import { TopRightPosition } from './TopRightPosition';

const STAGE_W = 1920;
const STAGE_H = 1080;

const BRACKET_SIZE = 34;
const BRACKET_INSET = 24;
const BRACKET_BORDER = '1px solid var(--ink-faint)';

function bracket(pos: 'tl' | 'tr' | 'bl' | 'br'): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute',
    width: BRACKET_SIZE,
    height: BRACKET_SIZE,
    pointerEvents: 'none',
  };
  switch (pos) {
    case 'tl':
      return { ...base, top: BRACKET_INSET, left: BRACKET_INSET, borderTop: BRACKET_BORDER, borderLeft: BRACKET_BORDER };
    case 'tr':
      return { ...base, top: BRACKET_INSET, right: BRACKET_INSET, borderTop: BRACKET_BORDER, borderRight: BRACKET_BORDER };
    case 'bl':
      return { ...base, bottom: BRACKET_INSET, left: BRACKET_INSET, borderBottom: BRACKET_BORDER, borderLeft: BRACKET_BORDER };
    case 'br':
      return { ...base, bottom: BRACKET_INSET, right: BRACKET_INSET, borderBottom: BRACKET_BORDER, borderRight: BRACKET_BORDER };
  }
}

export function Hud() {
  const telemetry = usePlayback(s => s.telemetry);
  const track = usePlayback(s => s.track);
  const currentTime = usePlayback(s => s.currentTime);
  const telemetryOffset = usePlayback(s => s.telemetryOffset);
  const trackOffset = usePlayback(s => s.trackOffset);
  const telemetryTrimStart = usePlayback(s => s.telemetryTrimStart);
  const telemetryTrimEnd = usePlayback(s => s.telemetryTrimEnd);
  const unit = usePlayback(s => s.unit);
  const profile = usePlayback(s => s.profile);
  const rangeStart = usePlayback(s => effectiveRange(s)[0]);

  // Telemetry/track samples are keyed by their intrinsic absolute time;
  // playhead is on the shared axis, so subtract the source's offset.
  const sample = useMemo(
    () =>
      telemetry
        ? sampleAt(telemetry, currentTime - telemetryOffset, telemetryTrimStart, telemetryTrimEnd)
        : null,
    [telemetry, currentTime, telemetryOffset, telemetryTrimStart, telemetryTrimEnd],
  );
  const trackTime = currentTime - trackOffset;
  const elapsed = currentTime - rangeStart;

  const rpmMax = telemetry?.rpmMax ?? 8000;

  const wrapRef = useRef<HTMLDivElement>(null);
  const scale = usePlayback(s => s.stageScale);
  const editMode = usePlayback(s => s.editMode);
  const exporterMode = usePlayback(s => s.exporterMode);

  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      usePlayback.getState().setStageScale(Math.min(width / STAGE_W, height / STAGE_H));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: editMode && !exporterMode ? 'auto' : 'none',
      }}
    >
      <div
        className="hud-root"
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: STAGE_W,
          height: STAGE_H,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: 'center center',
        }}
      >
        <div style={bracket('tl')} />
        <div style={bracket('tr')} />
        <div style={bracket('bl')} />
        <div style={bracket('br')} />

        <TopLeftStatus sample={sample} currentTime={elapsed} />
        <TopRightPosition sample={sample} />
        <Minimap
          track={track}
          sample={sample}
          currentTime={trackTime}
          playerName={profile.name}
        />
        <Speedometer sample={sample} unit={unit} rpmMax={rpmMax} />
      </div>
    </div>
  );
}
