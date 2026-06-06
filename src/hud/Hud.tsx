import { useEffect, useMemo, useRef } from 'react';
import { effectiveRange, usePlayback } from '../playback/store';
import { sampleAt } from '../data/telemetry';
import { progressAt } from '../data/track';
import { Speedometer } from './Speedometer';
import { Minimap } from './Minimap';
import { TopLeftStatus } from './TopLeftStatus';
import { TopRightPosition } from './TopRightPosition';
import { hudShakeAt } from './hudShake';
import {
  helmetCurveAt,
  helmetCurveTransform,
  HUD_STAGE_H,
  HUD_STAGE_W,
} from './helmetCurve';

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
  const trackTrimStart = usePlayback(s => s.trackTrimStart);
  const trackTrimEnd = usePlayback(s => s.trackTrimEnd);
  const unit = usePlayback(s => s.unit);
  const profile = usePlayback(s => s.profile);
  const rangeStart = usePlayback(s => effectiveRange(s)[0]);
  const hudShakeEnabled = usePlayback(s => s.settings.hudShakeEnabled);
  const hudShakeIntensity = usePlayback(s => s.settings.hudShakeIntensity);
  const hudCurvatureEnabled = usePlayback(s => s.settings.hudCurvatureEnabled);
  const hudCurvatureIntensity = usePlayback(s => s.settings.hudCurvatureIntensity);
  const editMode = usePlayback(s => s.editMode);

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
  const trackProgress = sample?.progress ?? progressAt(track, trackTime) ?? undefined;
  const elapsed = currentTime - rangeStart;
  const shake = useMemo(
    () =>
      hudShakeEnabled && !editMode
        ? hudShakeAt(track, {
            time: trackTime,
            progress: trackProgress,
            trimStart: trackTrimStart,
            trimEnd: trackTrimEnd,
            intensity: hudShakeIntensity,
          })
        : { x: 0, y: 0, rotateDeg: 0 },
    [
      hudShakeEnabled,
      hudShakeIntensity,
      editMode,
      track,
      trackTime,
      trackTrimStart,
      trackTrimEnd,
      trackProgress,
    ],
  );

  const rpmMax = telemetry?.rpmMax ?? 8000;
  const curvedBracket = (pos: 'tl' | 'tr' | 'bl' | 'br'): React.CSSProperties => {
    const x = pos[1] === 'l'
      ? BRACKET_INSET + BRACKET_SIZE / 2
      : HUD_STAGE_W - BRACKET_INSET - BRACKET_SIZE / 2;
    const y = pos[0] === 't'
      ? BRACKET_INSET + BRACKET_SIZE / 2
      : HUD_STAGE_H - BRACKET_INSET - BRACKET_SIZE / 2;
    const curve = hudCurvatureEnabled
      ? helmetCurveTransform(helmetCurveAt(x, y, hudCurvatureIntensity))
      : '';
    return {
      ...bracket(pos),
      transform: curve || undefined,
      transformOrigin: 'center center',
    };
  };

  const wrapRef = useRef<HTMLDivElement>(null);
  const scale = usePlayback(s => s.stageScale);
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
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: `translate(${shake.x.toFixed(2)}px, ${shake.y.toFixed(2)}px) rotate(${shake.rotateDeg.toFixed(3)}deg)`,
            transformOrigin: 'center center',
            perspective: hudCurvatureEnabled ? 1280 : undefined,
            perspectiveOrigin: '50% 50%',
            transformStyle: 'preserve-3d',
            willChange: hudShakeEnabled ? 'transform' : 'auto',
          }}
        >
          <div style={curvedBracket('tl')} />
          <div style={curvedBracket('tr')} />
          <div style={curvedBracket('bl')} />
          <div style={curvedBracket('br')} />

          <TopLeftStatus sample={sample} currentTime={elapsed} trackProgress={trackProgress} />
          <TopRightPosition sample={sample} />
          <Minimap
            track={track}
            sample={sample ? { ...sample, progress: trackProgress } : trackProgress === undefined ? null : { t: trackTime, speedKmh: 0, progress: trackProgress }}
            currentTime={trackTime}
            playerName={profile.name}
          />
          <Speedometer sample={sample} unit={unit} rpmMax={rpmMax} />
        </div>
      </div>
    </div>
  );
}
