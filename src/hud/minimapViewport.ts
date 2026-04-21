export const MINIMAP_DISC = 240;
export const MINIMAP_RADIUS = MINIMAP_DISC / 2 - 12;
export const MINIMAP_ANCHOR_Y = MINIMAP_DISC * 0.72;

// Half-width of the visible disc in meters.
export const MINIMAP_VIEW_RADIUS_M = 200;

// Keep the map plane flat. Perspective tilt compressed the far/top edge into
// an empty fan shape on real routes.
export const MINIMAP_PLANE_TILT_DEG = 0;
export const MINIMAP_TOP_FADE_OPACITY = 0.62;

export function minimapPlaneTransform(discScale: number): string | undefined {
  if (MINIMAP_PLANE_TILT_DEG <= 0) return undefined;
  return `perspective(${760 * discScale}px) rotateX(${MINIMAP_PLANE_TILT_DEG}deg)`;
}
