import assert from 'node:assert/strict';
import test from 'node:test';

import { convertLonLatToWgs84 } from '../src/util/coordinateSystems.ts';

test('GCJ-02 coordinates are normalized to WGS-84 inside China', () => {
  const pt = convertLonLatToWgs84(
    { lon: 116.41024449916938, lat: 39.91640428150164 },
    'gcj02',
  );

  assert.ok(Math.abs(pt.lon - 116.404) < 0.00002);
  assert.ok(Math.abs(pt.lat - 39.915) < 0.00002);
});

test('BD-09 coordinates are normalized to WGS-84 inside China', () => {
  const pt = convertLonLatToWgs84(
    { lon: 116.416627243787, lat: 39.922699552216 },
    'bd09',
  );

  assert.ok(Math.abs(pt.lon - 116.404) < 0.00002);
  assert.ok(Math.abs(pt.lat - 39.915) < 0.00002);
});

test('GCJ-02 conversion leaves overseas coordinates unchanged', () => {
  const pt = convertLonLatToWgs84({ lon: -122.4194, lat: 37.7749 }, 'gcj02');

  assert.deepEqual(pt, { lon: -122.4194, lat: 37.7749 });
});
