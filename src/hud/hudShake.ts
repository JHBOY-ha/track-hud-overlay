import type { Track } from '../data/schema';
import { poseAt } from '../data/track';

export interface HudShake {
  x: number;
  y: number;
  rotateDeg: number;
}

const ZERO_SHAKE: HudShake = { x: 0, y: 0, rotateDeg: 0 };
const G = 9.80665;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function finite(n: number | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export function hudShakeAt(
  track: Track | null,
  opts: {
    time: number;
    progress?: number;
    trimStart?: number;
    trimEnd?: number;
    intensity: number;
  },
): HudShake {
  const intensity = clamp(opts.intensity, 0, 3);
  if (!track || intensity <= 0 || track.points.length < 3 || track.points[0].t === undefined) {
    return ZERO_SHAKE;
  }

  const dt = 0.28;
  const trimStart = opts.trimStart ?? 0;
  const trimEnd = opts.trimEnd ?? 0;
  const at = (time: number) =>
    poseAt(track, {
      time,
      progress: opts.progress,
      trimStart,
      trimEnd,
    });

  const prev = at(opts.time - dt);
  const cur = at(opts.time);
  const next = at(opts.time + dt);
  if (!prev || !cur || !next) return ZERO_SHAKE;

  const vx0 = (cur.x - prev.x) / dt;
  const vy0 = (cur.y - prev.y) / dt;
  const vx1 = (next.x - cur.x) / dt;
  const vy1 = (next.y - cur.y) / dt;
  const ax = (vx1 - vx0) / dt;
  const ay = (vy1 - vy0) / dt;
  const speed = Math.hypot(vx0 + vx1, vy0 + vy1) * 0.5;

  const heading = cur.headingRad;
  const forwardX = Math.sin(heading);
  const forwardY = -Math.cos(heading);
  const rightX = Math.cos(heading);
  const rightY = Math.sin(heading);

  const lateralG = clamp((ax * rightX + ay * rightY) / G, -1.2, 1.2);
  const longitudinalG = clamp((ax * forwardX + ay * forwardY) / G, -1.2, 1.2);
  const verticalG =
    finite(prev.ele) && finite(cur.ele) && finite(next.ele)
      ? clamp(((next.ele - 2 * cur.ele + prev.ele) / (dt * dt)) / G, -1.2, 1.2)
      : 0;

  const motion = clamp(speed / 32, 0, 1);
  const energy = clamp(
    0.25 + Math.abs(lateralG) * 0.7 + Math.abs(longitudinalG) * 0.35 + Math.abs(verticalG),
    0,
    1.5,
  );
  const roadX = Math.sin(opts.time * 43.7 + speed * 0.07) * motion * energy * 0.9;
  const roadY = Math.sin(opts.time * 59.3 + speed * 0.11 + 1.7) * motion * energy * 1.1;

  return {
    x: clamp((-lateralG * 8.5 + roadX) * intensity, -22, 22),
    y: clamp((longitudinalG * 2.5 - verticalG * 7.5 + roadY) * intensity, -18, 18),
    rotateDeg: clamp((-lateralG * 0.55 + longitudinalG * 0.12) * intensity, -1.4, 1.4),
  };
}
