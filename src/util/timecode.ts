export const PROJECT_FPS_OPTIONS = [24, 30, 48, 60, 120] as const;

export type ProjectFps = (typeof PROJECT_FPS_OPTIONS)[number];

export function normalizeProjectFps(fps: number): ProjectFps {
  return PROJECT_FPS_OPTIONS.includes(fps as ProjectFps) ? (fps as ProjectFps) : 60;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function formatTimecode(seconds: number, fps: number): string {
  if (!Number.isFinite(seconds)) return '--:--:--:--';

  const normalizedFps = normalizeProjectFps(Math.round(fps));
  const sign = seconds < 0 ? '-' : '';
  const totalFrames = Math.round(Math.abs(seconds) * normalizedFps);
  const framesPerHour = normalizedFps * 3600;
  const framesPerMinute = normalizedFps * 60;

  const hh = Math.floor(totalFrames / framesPerHour);
  const afterHours = totalFrames % framesPerHour;
  const mm = Math.floor(afterHours / framesPerMinute);
  const afterMinutes = afterHours % framesPerMinute;
  const ss = Math.floor(afterMinutes / normalizedFps);
  const ff = afterMinutes % normalizedFps;
  const frameDigits = String(normalizedFps - 1).length;

  return `${sign}${pad2(hh)}:${pad2(mm)}:${pad2(ss)}:${String(ff).padStart(frameDigits, '0')}`;
}
