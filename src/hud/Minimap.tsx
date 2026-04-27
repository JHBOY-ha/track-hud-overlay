import { useEffect, useRef, useState } from 'react';
import type { Track, TrackLayer, TrackPoint, TelemetrySample } from '../data/schema';
import { poseAt } from '../data/track';
import { shortestAngleDeltaDeg, smoothAngleDeg } from '../util/heading';
import { Draggable } from './Draggable';
import { usePlayback } from '../playback/store';
import {
  MINIMAP_ANCHOR_Y as ANCHOR_Y,
  MINIMAP_DISC as DISC,
  MINIMAP_PLANE_SIDE_OVERDRAW,
  MINIMAP_PLANE_TOP_OVERDRAW,
  MINIMAP_PLANE_VIEWBOX_WIDTH,
  MINIMAP_PLANE_VIEWBOX_HEIGHT,
  MINIMAP_RADIUS as RADIUS,
  MINIMAP_TOP_FADE_OPACITY,
  minimapPlaneTransform,
} from './minimapViewport';

interface Props {
  track: Track | null;
  sample: TelemetrySample | null;
  currentTime: number;
  playerName: string;
}

const HEADING_SMOOTHING_TIME_S = 0.35;
const MAP_ALPHA_MASK =
  'radial-gradient(circle at 50% 50%, #000 0%, #000 38%, rgba(0,0,0,0.74) 56%, rgba(0,0,0,0.28) 74%, transparent 96%)';
const MAP_CONTENT_INSET = 10;
const MAP_CONTENT_MASK =
  'radial-gradient(circle at 50% 50%, #000 0%, #000 50%, rgba(0,0,0,0.72) 70%, rgba(0,0,0,0.3) 80%, transparent 100%)';

// Real-world scale: half-width of the visible disc in meters. The disc
// pixel radius maps to this many meters, so the visible diameter is 2×.
// mToPx is computed from the live viewRadiusM setting.
function toViewCoord(x: number, y: number, mToPx: number): [number, number] {
  return [DISC / 2 + x * mToPx, DISC / 2 + y * mToPx];
}

function pickScaleBarMeters(mToPx: number): number {
  const targetPx = RADIUS * 0.55;
  const targetM = targetPx / mToPx;
  const steps = [10, 20, 25, 50, 100, 200, 250, 500, 1000];
  let best = steps[0];
  for (const s of steps) if (s <= targetM) best = s;
  return best;
}

function splitLayerAtTarget(
  layer: TrackLayer,
  currentTime: number,
  progressFrac: number,
): { walked: TrackPoint[]; ahead: TrackPoint[] } {
  const pts = layer.points;
  if (pts.length < 2) return { walked: pts, ahead: [] };

  const hasTime = pts[0].t !== undefined;
  const target = hasTime ? currentTime : progressFrac * layer.totalLength;
  const firstValue = hasTime ? pts[0].t! : pts[0].distance;
  const lastValue = hasTime ? pts[pts.length - 1].t! : pts[pts.length - 1].distance;

  if (target <= firstValue) return { walked: pts.slice(0, 1), ahead: pts };
  if (target >= lastValue) return { walked: pts, ahead: pts.slice(-1) };

  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const value = hasTime ? pts[mid].t! : pts[mid].distance;
    if (value <= target) lo = mid;
    else hi = mid;
  }

  const a = pts[lo];
  const b = pts[lo + 1];
  const av = hasTime ? a.t! : a.distance;
  const bv = hasTime ? b.t! : b.distance;
  const f = (target - av) / ((bv - av) || 1);
  const current: TrackPoint = {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    distance: a.distance + (b.distance - a.distance) * f,
    t: hasTime ? target : undefined,
  };

  return {
    walked: [...pts.slice(0, lo + 1), current],
    ahead: [current, ...pts.slice(lo + 1)],
  };
}

export function Minimap({ track, sample, currentTime, playerName }: Props) {
  const discScale = usePlayback(s => s.layout['minimap.disc'].scale);
  const viewRadiusM = usePlayback(s => s.settings.minimapViewRadiusM);
  const tiltDeg = usePlayback(s => s.settings.minimapTiltDeg);
  const strokeWidth = usePlayback(s => s.settings.minimapStrokeWidth);
  const trackTrimStart = usePlayback(s => s.trackTrimStart);
  const trackTrimEnd = usePlayback(s => s.trackTrimEnd);
  const mToPx = RADIUS / viewRadiusM;
  const disc = DISC * discScale;
  const [displayMapAngle, setDisplayMapAngle] = useState(0);
  const headingRef = useRef<{
    displayedDeg: number;
    targetDeg: number;
    dataTime: number;
    frameTimeMs: number;
    raf: number;
    track: Track | null;
    initialized: boolean;
  }>({
    displayedDeg: 0,
    targetDeg: 0,
    dataTime: 0,
    frameTimeMs: 0,
    raf: 0,
    track: null,
    initialized: false,
  });

  const hasTrackTime = track?.points.length && track.points[0].t !== undefined;
  const pose = track
    ? poseAt(track, {
        time: hasTrackTime ? currentTime : undefined,
        progress: sample?.progress,
        trimStart: trackTrimStart,
        trimEnd: trackTrimEnd,
      })
    : null;

  const progressFrac = Math.max(0, Math.min(1, sample?.progress ?? 0));

  const pointsToPath = (pts: TrackPoint[]): string =>
    pts
      .map((p, i) => {
        const [vx, vy] = toViewCoord(p.x, p.y, mToPx);
        return `${i === 0 ? 'M' : 'L'} ${vx.toFixed(2)} ${vy.toFixed(2)}`;
      })
      .join(' ');

  const layers = track?.layers ?? [];
  const referenceLayers = layers.filter(l => l.kind === 'reference');
  const plannedLayer = layers.find(l => l.kind === 'planned');
  const drivenLayer = layers.find(l => l.kind === 'driven') ?? plannedLayer;

  const drivenSplit = drivenLayer
    ? splitLayerAtTarget(drivenLayer, currentTime, progressFrac)
    : null;

  const [mx, my] = pose ? toViewCoord(pose.x, pose.y, mToPx) : [DISC / 2, DISC / 2];
  // headingRad uses atan2(dx, -dy): 0 = north (up), CW. No offset needed.
  const headingDeg = pose ? (pose.headingRad * 180) / Math.PI : 0;
  const hasPose = !!pose;

  // Heading-up rotation: rotate map content so the heading points up.
  const targetMapAngle = -headingDeg;

  useEffect(() => {
    const headingState = headingRef.current;
    const trackChanged = headingState.track !== track;
    const elapsedDataTime = currentTime - headingState.dataTime;
    const shouldSnapHeading =
      !headingState.initialized ||
      !hasPose ||
      trackChanged ||
      elapsedDataTime < 0 ||
      elapsedDataTime > 1;

    headingState.targetDeg = targetMapAngle;
    headingState.dataTime = currentTime;
    headingState.track = track;

    const stopAnimation = () => {
      if (headingState.raf) {
        cancelAnimationFrame(headingState.raf);
        headingState.raf = 0;
      }
    };

    if (shouldSnapHeading) {
      stopAnimation();
      headingState.displayedDeg = targetMapAngle;
      headingState.frameTimeMs = 0;
      headingState.initialized = hasPose;
      setDisplayMapAngle(targetMapAngle);
      return;
    }

    headingState.initialized = true;
    if (headingState.raf) return;

    const animate = (nowMs: number) => {
      const state = headingRef.current;
      const previousFrameTime = state.frameTimeMs || nowMs;
      const deltaTimeSec = Math.min((nowMs - previousFrameTime) / 1000, 0.1);
      state.frameTimeMs = nowMs;

      const next = smoothAngleDeg(
        state.displayedDeg,
        state.targetDeg,
        deltaTimeSec,
        HEADING_SMOOTHING_TIME_S,
      );
      state.displayedDeg = next;
      setDisplayMapAngle(next);

      if (Math.abs(shortestAngleDeltaDeg(next, state.targetDeg)) > 0.05) {
        state.raf = requestAnimationFrame(animate);
      } else {
        state.displayedDeg = state.targetDeg;
        state.raf = 0;
        setDisplayMapAngle(state.targetDeg);
      }
    };

    headingState.frameTimeMs = performance.now();
    headingState.raf = requestAnimationFrame(animate);
  }, [currentTime, hasPose, targetMapAngle, track]);

  useEffect(() => {
    return () => {
      const raf = headingRef.current.raf;
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const mapAngle = displayMapAngle;

  // N label — anchored to true north, sitting on the upper (far) arc.
  const N_RADIUS = DISC / 2 - 22;
  const mapAngleRad = (mapAngle * Math.PI) / 180;
  const nx = DISC / 2 + Math.sin(mapAngleRad) * N_RADIUS;
  const ny = DISC / 2 - Math.cos(mapAngleRad) * N_RADIUS;

  // track.totalLength is already in meters (shared planar frame).
  const routeLayer = plannedLayer ?? drivenLayer;
  const trackLenM = routeLayer?.totalLength ?? 0;
  const distLabel = trackLenM > 0 ? `${(trackLenM / 1000).toFixed(2)} KM` : '— KM';

  const scaleBarM = pickScaleBarMeters(mToPx);
  const scaleBarPx = scaleBarM * mToPx;
  const scaleBarLabel = scaleBarM >= 1000 ? `${scaleBarM / 1000} KM` : `${scaleBarM} M`;
  const mapPlaneTransform = minimapPlaneTransform(discScale, tiltDeg);
  const mapPlaneLeft = -MINIMAP_PLANE_SIDE_OVERDRAW * discScale;
  const mapPlaneTop = -MINIMAP_PLANE_TOP_OVERDRAW * discScale;
  const mapPlaneWidth = MINIMAP_PLANE_VIEWBOX_WIDTH * discScale;
  const mapPlaneHeight = MINIMAP_PLANE_VIEWBOX_HEIGHT * discScale;
  const mapPlaneAnchorX = DISC / 2 + MINIMAP_PLANE_SIDE_OVERDRAW;
  const mapPlaneAnchorY = ANCHOR_Y + MINIMAP_PLANE_TOP_OVERDRAW;
  const finishLayer = plannedLayer ?? drivenLayer;
  const finish =
    finishLayer && finishLayer.points.length
      ? toViewCoord(
          finishLayer.points[finishLayer.points.length - 1].x,
          finishLayer.points[finishLayer.points.length - 1].y,
          mToPx,
        )
      : null;
  const altLabel =
    pose?.ele !== undefined && Number.isFinite(pose.ele)
      ? `${Math.round(pose.ele)}m`
      : '— m';

  return (
    <>
      <Draggable
        id="minimap.disc"
        anchor="bl"
        manualScale
        style={{
          position: 'absolute',
          left: 55,
          bottom: 63,
          width: disc,
          filter: 'drop-shadow(0 2px 10px rgba(0,0,0,0.6))',
          fontFamily: 'var(--mono)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 10 * discScale,
            letterSpacing: '0.22em',
            color: 'var(--ink-dim)',
            textTransform: 'uppercase',
            marginBottom: 8 * discScale,
          }}
        >
          <span>ROUTE · TRACK</span>
          <span>{distLabel}</span>
        </div>
        <div
          style={{
            position: 'relative',
            width: disc,
            height: disc,
            borderRadius: '50%',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              background:
                'radial-gradient(ellipse at 50% 34%, rgba(120, 210, 210, 0.1) 0%, rgba(120, 210, 210, 0.03) 34%, rgba(120, 210, 210, 0) 62%), radial-gradient(circle at 50% 50%, rgba(10,12,14,0.42) 0%, rgba(10,12,14,0.24) 48%, rgba(10,12,14,0) 84%)',
              WebkitMaskImage: MAP_ALPHA_MASK,
              maskImage: MAP_ALPHA_MASK,
              pointerEvents: 'none',
            }}
          />

          {/* outer ring */}
          <div
            style={{
              position: 'absolute',
              inset: 10,
              borderRadius: '50%',
              border: '1px solid rgba(255,255,255,0.18)',
              pointerEvents: 'none',
            }}
          />

          {/* Map content is clipped in screen space to the inner ring. */}
          <div
            style={{
              position: 'absolute',
              inset: MAP_CONTENT_INSET,
              borderRadius: '50%',
              overflow: 'hidden',
              WebkitMaskImage: MAP_CONTENT_MASK,
              maskImage: MAP_CONTENT_MASK,
              pointerEvents: 'none',
            }}
          >
            <svg
            viewBox={`0 0 ${MINIMAP_PLANE_VIEWBOX_WIDTH} ${MINIMAP_PLANE_VIEWBOX_HEIGHT}`}
            width={mapPlaneWidth}
            height={mapPlaneHeight}
            style={{
              position: 'absolute',
              left: mapPlaneLeft - MAP_CONTENT_INSET,
              top: mapPlaneTop - MAP_CONTENT_INSET,
              transform: mapPlaneTransform,
              transformOrigin: `${mapPlaneAnchorX * discScale}px ${mapPlaneAnchorY * discScale}px`,
            }}
          >
            <defs>
              <radialGradient
                id="mm-radial-fade"
                gradientUnits="userSpaceOnUse"
                cx={mapPlaneAnchorX}
                cy={mapPlaneAnchorY}
                r={Math.max(MINIMAP_PLANE_VIEWBOX_WIDTH, MINIMAP_PLANE_VIEWBOX_HEIGHT) * 0.7}
              >
                <stop offset="0%" stopColor="#fff" stopOpacity="1" />
                <stop offset="48%" stopColor="#fff" stopOpacity="1" />
                <stop offset="60%" stopColor="#fff" stopOpacity={MINIMAP_TOP_FADE_OPACITY} />
                <stop offset="100%" stopColor="#fff" stopOpacity="0" />
              </radialGradient>
              <mask
                id="mm-mask"
                maskUnits="userSpaceOnUse"
                x="0"
                y="0"
                width={MINIMAP_PLANE_VIEWBOX_WIDTH}
                height={MINIMAP_PLANE_VIEWBOX_HEIGHT}
              >
                <rect
                  width={MINIMAP_PLANE_VIEWBOX_WIDTH}
                  height={MINIMAP_PLANE_VIEWBOX_HEIGHT}
                  fill="url(#mm-radial-fade)"
                />
              </mask>
              <linearGradient
                id="mm-arrow-fill"
                gradientUnits="userSpaceOnUse"
                x1="0"
                y1="-72"
                x2="0"
                y2="38"
              >
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="52%" stopColor="#f8f7ff" />
                <stop offset="100%" stopColor="#dcd8ea" />
              </linearGradient>
              <filter
                id="mm-arrow-shadow"
                x="-40"
                y="-80"
                width="80"
                height="126"
                filterUnits="userSpaceOnUse"
              >
                <feDropShadow dx="0" dy="4.8" stdDeviation="2.2" floodColor="#171222" floodOpacity="0.76" />
                <feDropShadow dx="0" dy="0" stdDeviation="1.4" floodColor="#ffffff" floodOpacity="0.46" />
              </filter>
            </defs>

            {track && (
              <g mask="url(#mm-mask)">
                <g
                  transform={`translate(${mapPlaneAnchorX} ${mapPlaneAnchorY}) rotate(${mapAngle}) translate(${-mx} ${-my})`}
                >
                  {/* Reference layers — dim gray, background context */}
                  {referenceLayers.map((layer, i) => (
                    <path
                      key={`ref-${i}`}
                      d={pointsToPath(layer.points)}
                      fill="none"
                      stroke="rgba(255,255,255,0.18)"
                      strokeWidth={strokeWidth}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                  {/* Planned route — full length, dim teal */}
                  {plannedLayer && (
                    <path
                      d={pointsToPath(plannedLayer.points)}
                      fill="none"
                      stroke="var(--teal)"
                      strokeWidth={strokeWidth}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={0.45}
                    />
                  )}
                  {/* Driven ahead — dim continuation of current path */}
                  {drivenSplit && drivenSplit.ahead.length > 1 && !plannedLayer && (
                    <path
                      d={pointsToPath(drivenSplit.ahead)}
                      fill="none"
                      stroke="var(--teal)"
                      strokeWidth={strokeWidth}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={0.55}
                    />
                  )}
                  {/* Driven walked — bright amber, trailing from start to car */}
                  {drivenSplit && drivenSplit.walked.length > 1 && (
                    <path
                      d={pointsToPath(drivenSplit.walked)}
                      fill="none"
                      stroke="var(--amber)"
                      strokeWidth={strokeWidth}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                  {finish && (
                    <>
                      <circle
                        cx={finish[0]}
                        cy={finish[1]}
                        r={4}
                        fill="none"
                        stroke="var(--ink)"
                        strokeWidth={1.5}
                      />
                      <circle cx={finish[0]} cy={finish[1]} r={1.5} fill="var(--ink)" />
                    </>
                  )}
                </g>
              </g>
            )}

            {pose && (
              <g transform={`translate(${mapPlaneAnchorX} ${mapPlaneAnchorY})`}>
                <g transform="scale(0.7)">
                  <path
                    d="M 0 -70 L 15 36 L 0 21 L -15 36 Z"
                    fill="rgba(22, 17, 32, 0.36)"
                    transform="translate(0 6)"
                    opacity="0.78"
                  />
                  <path
                    d="M 0 -70 L 15 36 L 0 21 L -15 36 Z"
                    fill="url(#mm-arrow-fill)"
                    stroke="rgba(37, 30, 52, 0.95)"
                    strokeWidth="4.6"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    filter="url(#mm-arrow-shadow)"
                  />
                  <path
                    d="M 0 -58 L 8.8 22 L 0 13 L -8.8 22 Z"
                    fill="rgba(255, 255, 255, 0.44)"
                    stroke="rgba(255, 255, 255, 0.78)"
                    strokeWidth="1.45"
                    strokeLinejoin="round"
                    pointerEvents="none"
                  />
                  <path
                    d="M -11.6 31.5 L 0 20.7 L 11.6 31.5"
                    fill="none"
                    stroke="rgba(62, 52, 86, 0.68)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    pointerEvents="none"
                  />
                </g>
              </g>
            )}
            </svg>
          </div>

          {/* Overlay — N label and scale bar stay screen-facing. */}
          <svg
            viewBox={`0 0 ${DISC} ${DISC}`}
            width={disc}
            height={disc}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            <text
              x={nx}
              y={ny}
              textAnchor="middle"
              dominantBaseline="central"
              fill="var(--amber)"
              fontFamily="var(--mono)"
              fontSize={11}
              fontWeight={700}
              letterSpacing="0.15em"
            >
              N
            </text>

            {/* Scale bar — fixed, untilted */}
            <g transform={`translate(${DISC / 2 - scaleBarPx / 2} ${DISC - 18})`}>
              <line
                x1={0}
                y1={0}
                x2={scaleBarPx}
                y2={0}
                stroke="var(--ink)"
                strokeWidth={1.5}
              />
              <line x1={0} y1={-3} x2={0} y2={3} stroke="var(--ink)" strokeWidth={1.5} />
              <line
                x1={scaleBarPx}
                y1={-3}
                x2={scaleBarPx}
                y2={3}
                stroke="var(--ink)"
                strokeWidth={1.5}
              />
              <text
                x={scaleBarPx / 2}
                y={-6}
                textAnchor="middle"
                fill="var(--ink-dim)"
                fontFamily="var(--mono)"
                fontSize={9}
                letterSpacing="0.18em"
              >
                {scaleBarLabel}
              </text>
            </g>
          </svg>
        </div>
      </Draggable>

      <Draggable
        id="minimap.name"
        anchor="bl"
        style={{
          position: 'absolute',
          left: 55,
          bottom: 41,
          width: DISC,
          fontFamily: 'var(--mono)',
          filter: 'drop-shadow(0 2px 10px rgba(0,0,0,0.6))',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 10,
            letterSpacing: '0.2em',
            color: 'var(--ink-dim)',
            textTransform: 'uppercase',
          }}
        >
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: 'var(--ink)',
            }}
          >
            <span style={{ width: 8, height: 8, background: 'var(--amber)' }} />
            {playerName} · P{sample?.positionCurrent ?? '—'}
          </span>
          <span>ALT · {altLabel}</span>
        </div>
      </Draggable>
    </>
  );
}
