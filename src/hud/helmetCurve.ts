export interface HelmetCurve {
  rotateXDeg: number;
  rotateYDeg: number;
  z: number;
}

export const HUD_STAGE_W = 1920;
export const HUD_STAGE_H = 1080;

const ZERO_CURVE: HelmetCurve = { rotateXDeg: 0, rotateYDeg: 0, z: 0 };

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function helmetCurveAt(centerX: number, centerY: number, intensity: number): HelmetCurve {
  const amount = clamp(intensity, 0, 3);
  if (amount <= 0) return ZERO_CURVE;

  const x = clamp((centerX - HUD_STAGE_W / 2) / (HUD_STAGE_W / 2), -1, 1);
  const y = clamp((centerY - HUD_STAGE_H / 2) / (HUD_STAGE_H / 2), -1, 1);
  const side = Math.abs(x);
  const vertical = Math.abs(y);

  return {
    rotateXDeg: y * 4.5 * amount,
    rotateYDeg: -x * 15 * amount,
    z: (Math.pow(side, 1.25) * 74 + Math.pow(vertical, 1.6) * 18 - 30) * amount,
  };
}

export function helmetCurveTransform(curve: HelmetCurve): string {
  if (curve.rotateXDeg === 0 && curve.rotateYDeg === 0 && curve.z === 0) return '';
  return [
    `translateZ(${curve.z.toFixed(2)}px)`,
    `rotateY(${curve.rotateYDeg.toFixed(3)}deg)`,
    `rotateX(${curve.rotateXDeg.toFixed(3)}deg)`,
  ].join(' ');
}
