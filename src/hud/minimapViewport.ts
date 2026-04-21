export const MINIMAP_DISC = 240;
export const MINIMAP_RADIUS = MINIMAP_DISC / 2 - 12;
export const MINIMAP_ANCHOR_Y = MINIMAP_DISC * 0.72;

// Half-width of the visible disc in meters.
export const MINIMAP_VIEW_RADIUS_M = 50;

// Project the minimap as a strong ground plane, like the in-game reference.
// The SVG plane is taller than the visible disc and shifted upward before
// rotation so the far edge still contains map content after perspective.
export const MINIMAP_PLANE_TILT_DEG = 70;
export const MINIMAP_PLANE_SIDE_OVERDRAW = 180;
export const MINIMAP_PLANE_TOP_OVERDRAW = 800;
export const MINIMAP_PLANE_BOTTOM_OVERDRAW = 128;
export const MINIMAP_PLANE_VIEWBOX_WIDTH = MINIMAP_DISC + MINIMAP_PLANE_SIDE_OVERDRAW * 2;
export const MINIMAP_PLANE_VIEWBOX_HEIGHT =
  MINIMAP_DISC + MINIMAP_PLANE_TOP_OVERDRAW + MINIMAP_PLANE_BOTTOM_OVERDRAW;
export const MINIMAP_TOP_FADE_OPACITY = 0.4;

export function minimapPlaneTransform(
  discScale: number,
  tiltDeg: number = MINIMAP_PLANE_TILT_DEG,
): string | undefined {
  if (tiltDeg <= 0) return undefined;
  return `perspective(${760 * discScale}px) rotateX(${tiltDeg}deg)`;
}
