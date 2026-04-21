export type GearValue = number | 'N' | 'R';

export interface TelemetrySample {
  t: number;
  speedKmh: number;
  rpm?: number;
  rpmMax?: number;
  gear?: GearValue;
  throttle?: number;
  brake?: number;
  abs?: boolean;
  tcs?: boolean;
  progress?: number;
  positionCurrent?: number;
  positionTotal?: number;
}

export interface TelemetryTrack {
  samples: TelemetrySample[];
  duration: number;
  rpmMax: number;
}

export interface TrackPoint {
  x: number;
  y: number;
  distance: number;
  t?: number;
  ele?: number;
}

export type TrackLayerKind = 'driven' | 'planned' | 'reference';

export interface TrackLayer {
  kind: TrackLayerKind;
  name?: string;
  points: TrackPoint[];
  totalLength: number;
}

export interface Track {
  layers: TrackLayer[];
  // Primary layer for player pose. Prefer driven, then planned, then first.
  points: TrackPoint[];
  totalLength: number;
}

export interface PlayerProfile {
  name: string;
}
