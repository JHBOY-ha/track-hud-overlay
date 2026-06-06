import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHudGeoJson,
  buildTimedRoute,
  projectToRoad,
  type Road,
  type RouteMark,
} from '../src/generator/routeCore.ts';

const roads: Road[] = [
  {
    id: 'a',
    name: 'A Road',
    highway: 'primary',
    points: [
      { nodeId: '1', lat: 39, lon: 116 },
      { nodeId: '2', lat: 39, lon: 116.001 },
      { nodeId: '3', lat: 39.001, lon: 116.001 },
    ],
  },
  {
    id: 'b',
    name: 'B Road',
    highway: 'secondary',
    points: [
      { nodeId: '2', lat: 39, lon: 116.001 },
      { nodeId: '4', lat: 38.999, lon: 116.001 },
    ],
  },
];

test('projectToRoad keeps a click on the nearest road segment', () => {
  const projected = projectToRoad({ lat: 39.00005, lon: 116.0005 }, roads);
  assert.equal(projected?.roadId, 'a');
  assert.equal(projected?.segmentIndex, 0);
  assert.ok(Math.abs((projected?.segmentT ?? 0) - 0.5) < 0.01);
});

test('buildTimedRoute connects inserted segment marks and samples at 10 Hz', () => {
  const start = Date.parse('2026-06-06T08:00:00.000Z');
  const end = start + 1000;
  const marks: RouteMark[] = [
    { id: 1, timeMs: start, roadId: 'a', segmentIndex: 0, segmentT: 0.5, point: { lat: 39, lon: 116.0005 } },
    { id: 2, timeMs: end, roadId: 'a', segmentIndex: 1, segmentT: 0.5, point: { lat: 39.0005, lon: 116.001 } },
  ];
  const route = buildTimedRoute(roads, marks, 10);
  assert.equal(route.disconnectedPair, null);
  assert.equal(route.samples.length, 11);
  assert.equal(route.samples[0].timeMs, start);
  assert.equal(route.samples[10].timeMs, end);
  assert.equal(route.samples[0].progress, 0);
  assert.equal(route.samples[10].progress, 1);
  assert.ok(route.samples.every((point, i) => i === 0 || point.progress >= route.samples[i - 1].progress));
});

test('buildTimedRoute reports disconnected roads', () => {
  const isolated: Road = {
    id: 'x',
    name: 'Isolated',
    highway: 'road',
    points: [
      { nodeId: 'x1', lat: 40, lon: 117 },
      { nodeId: 'x2', lat: 40.001, lon: 117 },
    ],
  };
  const marks: RouteMark[] = [
    { id: 1, timeMs: 0, roadId: 'a', segmentIndex: 0, segmentT: 0, point: { lat: 39, lon: 116 } },
    { id: 2, timeMs: 1000, roadId: 'x', segmentIndex: 0, segmentT: 0, point: { lat: 40, lon: 117 } },
  ];
  assert.equal(buildTimedRoute([...roads, isolated], marks).disconnectedPair, 0);
});

test('buildHudGeoJson emits HUD driven route progress and reference roads', () => {
  const marks: RouteMark[] = [
    { id: 1, timeMs: 0, roadId: 'a', segmentIndex: 0, segmentT: 0, point: { lat: 39, lon: 116 } },
    { id: 2, timeMs: 1000, roadId: 'a', segmentIndex: 0, segmentT: 1, point: { lat: 39, lon: 116.001 } },
  ];
  const geo = buildHudGeoJson(roads, buildTimedRoute(roads, marks), { lat: 39, lon: 116 }, 1000);
  const driven = geo.features[0] as any;
  assert.equal(driven.properties.kind, 'driven');
  assert.equal(driven.properties.coordinateProperties.times.length, driven.geometry.coordinates.length);
  assert.equal(driven.properties.coordinateProperties.progresses.length, driven.geometry.coordinates.length);
  assert.equal(geo.features[1].properties.kind, 'reference');
});
