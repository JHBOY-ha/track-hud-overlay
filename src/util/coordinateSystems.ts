import type { LonLat } from './projection';

export type CoordinateSystem = 'wgs84' | 'gcj02' | 'bd09';

const A = 6378245.0;
const EE = 0.00669342162296594323;
const X_PI = (Math.PI * 3000.0) / 180.0;

export function isCoordinateSystem(value: string | null | undefined): value is CoordinateSystem {
  return value === 'wgs84' || value === 'gcj02' || value === 'bd09';
}

function outsideChina(lon: number, lat: number): boolean {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y;
  ret += 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLon(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y;
  ret += 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return ret;
}

function wgs84ToGcj02(point: LonLat): LonLat {
  if (outsideChina(point.lon, point.lat)) return { ...point };

  let dLat = transformLat(point.lon - 105.0, point.lat - 35.0);
  let dLon = transformLon(point.lon - 105.0, point.lat - 35.0);
  const radLat = (point.lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * Math.PI);
  dLon = (dLon * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { lon: point.lon + dLon, lat: point.lat + dLat };
}

function gcj02ToWgs84(point: LonLat): LonLat {
  if (outsideChina(point.lon, point.lat)) return { ...point };

  let guess = { ...point };
  for (let i = 0; i < 2; i++) {
    const shifted = wgs84ToGcj02(guess);
    guess = {
      lon: guess.lon - (shifted.lon - point.lon),
      lat: guess.lat - (shifted.lat - point.lat),
    };
  }
  return guess;
}

function bd09ToGcj02(point: LonLat): LonLat {
  const x = point.lon - 0.0065;
  const y = point.lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * X_PI);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI);
  return {
    lon: z * Math.cos(theta),
    lat: z * Math.sin(theta),
  };
}

export function convertLonLatToWgs84(
  point: LonLat,
  source: CoordinateSystem = 'wgs84',
): LonLat {
  if (source === 'wgs84') return { ...point };
  if (source === 'gcj02') return gcj02ToWgs84(point);
  return gcj02ToWgs84(bd09ToGcj02(point));
}

export function convertLonLatLayersToWgs84<T extends LonLat>(
  layers: T[][],
  source: CoordinateSystem = 'wgs84',
): T[][] {
  if (source === 'wgs84') return layers.map(layer => layer.map(p => ({ ...p })));
  return layers.map(layer =>
    layer.map(p => ({
      ...p,
      ...convertLonLatToWgs84(p, source),
    })),
  );
}
