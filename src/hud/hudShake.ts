import type { Track } from '../data/schema';
import { poseAt } from '../data/track';

export interface HudShake {
  x: number;
  y: number;
  rotateDeg: number;
}

const ZERO_SHAKE: HudShake = { x: 0, y: 0, rotateDeg: 0 };
const G = 9.80665;

interface MotionChannels {
  lateralG: number;
  longitudinalG: number;
  verticalG: number;
  speed: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function smoothstep(edge0: number, edge1: number, n: number): number {
  const t = clamp((n - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
}

function finite(n: number | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function softenSigned(n: number, deadzone: number): number {
  const mag = Math.abs(n);
  if (mag <= deadzone) return 0;
  return Math.sign(n) * (mag - deadzone);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hash1(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return (x - Math.floor(x)) * 2 - 1;
}

function smoothNoise(time: number, seed: number): number {
  const i = Math.floor(time);
  const f = time - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash1(i + seed * 101), hash1(i + 1 + seed * 101), u);
}

function fbm(time: number, hz: number, seed: number): number {
  return (
    smoothNoise(time * hz, seed) * 0.62 +
    smoothNoise(time * hz * 1.9, seed + 11) * 0.28 +
    smoothNoise(time * hz * 3.4, seed + 29) * 0.1
  );
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

  const dt = 0.42;
  const trimStart = opts.trimStart ?? 0;
  const trimEnd = opts.trimEnd ?? 0;
  const firstT = track.points[0].t! + trimStart;
  const lastT = (track.points[track.points.length - 1].t ?? firstT) - trimEnd;
  const edgeFade = smoothstep(0, 1.4, Math.min(opts.time - firstT, lastT - opts.time));
  if (edgeFade <= 0) return ZERO_SHAKE;

  const at = (time: number) =>
    poseAt(track, {
      time,
      progress: opts.progress,
      trimStart,
      trimEnd,
    });

  const motionAt = (time: number): MotionChannels | null => {
    const prev = at(time - dt);
    const cur = at(time);
    const next = at(time + dt);
    if (!prev || !cur || !next) return null;

    const vx0 = (cur.x - prev.x) / dt;
    const vy0 = (cur.y - prev.y) / dt;
    const vx1 = (next.x - cur.x) / dt;
    const vy1 = (next.y - cur.y) / dt;
    const ax = (vx1 - vx0) / dt;
    const ay = (vy1 - vy0) / dt;
    const speed = (Math.hypot(vx0, vy0) + Math.hypot(vx1, vy1)) * 0.5;

    const heading = cur.headingRad;
    const forwardX = Math.sin(heading);
    const forwardY = -Math.cos(heading);
    const rightX = Math.cos(heading);
    const rightY = Math.sin(heading);
    const verticalG =
      finite(prev.ele) && finite(cur.ele) && finite(next.ele)
        ? ((next.ele - 2 * cur.ele + prev.ele) / (dt * dt)) / G
        : 0;

    return {
      lateralG: (ax * rightX + ay * rightY) / G,
      longitudinalG: (ax * forwardX + ay * forwardY) / G,
      verticalG,
      speed,
    };
  };

  const offsets = [-0.24, 0, 0.24];
  const weights = [0.25, 0.5, 0.25];
  const motion = offsets.reduce<MotionChannels | null>((acc, offset, i) => {
    const sample = motionAt(opts.time + offset);
    if (!sample) return acc;
    const w = weights[i];
    return {
      lateralG: (acc?.lateralG ?? 0) + sample.lateralG * w,
      longitudinalG: (acc?.longitudinalG ?? 0) + sample.longitudinalG * w,
      verticalG: (acc?.verticalG ?? 0) + sample.verticalG * w,
      speed: (acc?.speed ?? 0) + sample.speed * w,
    };
  }, null);
  if (!motion) return ZERO_SHAKE;

  const lateralG = clamp(softenSigned(motion.lateralG, 0.025), -0.85, 0.85);
  const longitudinalG = clamp(softenSigned(motion.longitudinalG, 0.035), -0.8, 0.8);
  const verticalG = clamp(softenSigned(motion.verticalG, 0.04), -0.65, 0.65);
  const speed = motion.speed;
  const speed01 = smoothstep(2, 44, speed);
  const highSpeed = smoothstep(24, 62, speed);
  const roadEnergy = speed01 * (0.32 + highSpeed * 0.68);
  const roadHz = 3.2 + speed * 0.045;
  const roadX = fbm(opts.time + speed * 0.019, roadHz, 3) * roadEnergy * 1.15;
  const roadY = fbm(opts.time + speed * 0.027, roadHz * 1.28, 19) * roadEnergy * 1.35;
  const roadRoll = fbm(opts.time + speed * 0.011, roadHz * 0.72, 41) * roadEnergy * 0.08;
  const scaledIntensity = intensity * edgeFade;

  return {
    x: clamp((-lateralG * 6.2 + longitudinalG * 0.8 + roadX) * scaledIntensity, -16, 16),
    y: clamp((longitudinalG * 2.1 - verticalG * 3.8 + roadY) * scaledIntensity, -13, 13),
    rotateDeg: clamp(
      (-lateralG * 0.42 + longitudinalG * 0.08 + roadRoll) * scaledIntensity,
      -1.05,
      1.05,
    ),
  };
}
