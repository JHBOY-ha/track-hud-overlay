import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSegments, snapPointsToSegments } from '../src/util/snapToRoads.ts';

test('snaps noisy points onto a straight reference road within threshold', () => {
  const road = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];
  const segments = buildSegments([road]);
  const noisy = [
    { x: 10, y: 2 },
    { x: 50, y: -3 },
    { x: 90, y: 1 },
  ];
  const snapped = snapPointsToSegments(noisy, segments, 5);
  for (const p of snapped) assert.equal(p.y, 0);
  assert.equal(snapped[0].x, 10);
  assert.equal(snapped[1].x, 50);
});

test('keeps original point when nearest segment is farther than threshold', () => {
  const road = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];
  const segments = buildSegments([road]);
  const far = [{ x: 50, y: 20 }];
  const snapped = snapPointsToSegments(far, segments, 5);
  assert.deepEqual(snapped[0], { x: 50, y: 20 });
});

test('clamps projection to segment endpoints', () => {
  const road = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];
  const segments = buildSegments([road]);
  const beyond = [{ x: 120, y: 1 }];
  const snapped = snapPointsToSegments(beyond, segments, 30);
  assert.equal(snapped[0].x, 100);
  assert.equal(snapped[0].y, 0);
});

test('picks the nearest of several parallel roads', () => {
  const segments = buildSegments([
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    [
      { x: 0, y: 10 },
      { x: 100, y: 10 },
    ],
  ]);
  const snapped = snapPointsToSegments([{ x: 50, y: 8.5 }], segments, 5);
  assert.equal(snapped[0].y, 10);
});

test('does not flicker onto a short side branch at a junction', () => {
  const segments = buildSegments([
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    [
      { x: 50, y: 0 },
      { x: 50, y: 20 },
    ],
  ]);
  const noisy = [
    { x: 46, y: 0.4 },
    { x: 48, y: 0.3 },
    { x: 49.7, y: 0.2 },
    { x: 50.2, y: 0.3 },
    { x: 52, y: 0.2 },
    { x: 54, y: 0.4 },
  ];

  const snapped = snapPointsToSegments(noisy, segments, 5);

  for (const p of snapped) assert.equal(p.y, 0);
});

test('smooths a short wrong-way island back to the surrounding way', () => {
  const segments = buildSegments([
    [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
    ],
    [
      { x: 10, y: 1 },
      { x: 20, y: 1 },
    ],
  ]);
  const noisy = [
    { x: 8, y: 0.2 },
    { x: 9, y: 0.2 },
    { x: 10, y: 0.8 },
    { x: 10.5, y: 0.8 },
    { x: 11, y: 0.8 },
    { x: 11.5, y: 0.8 },
    { x: 12, y: 0.8 },
    { x: 12.5, y: 0.8 },
    { x: 13, y: 0.8 },
    { x: 13.5, y: 0.8 },
    { x: 14, y: 0.2 },
    { x: 15, y: 0.2 },
    { x: 16, y: 0.2 },
    { x: 17, y: 0.2 },
  ];

  const snapped = snapPointsToSegments(noisy, segments, 5);

  for (const p of snapped) assert.equal(p.y, 0);
});

test('smooths a longer low-distance wrong-way island back to the surrounding way', () => {
  const segments = buildSegments([
    [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ],
    [
      { x: 10, y: 1 },
      { x: 30, y: 1 },
    ],
  ]);
  const noisy = [
    { x: 7, y: 0.2 },
    { x: 8, y: 0.2 },
    { x: 9, y: 0.2 },
    { x: 10, y: 0.8 },
    { x: 11, y: 0.8 },
    { x: 12, y: 0.8 },
    { x: 13, y: 0.8 },
    { x: 14, y: 0.8 },
    { x: 15, y: 0.8 },
    { x: 16, y: 0.8 },
    { x: 17, y: 0.8 },
    { x: 18, y: 0.8 },
    { x: 19, y: 0.2 },
    { x: 20, y: 0.2 },
    { x: 21, y: 0.2 },
    { x: 22, y: 0.2 },
  ];

  const snapped = snapPointsToSegments(noisy, segments, 5);

  for (const p of snapped) assert.equal(p.y, 0);
});

test('returns original points when no segments are provided', () => {
  const pts = [{ x: 1, y: 2 }];
  assert.deepEqual(snapPointsToSegments(pts, [], 5), pts);
});
