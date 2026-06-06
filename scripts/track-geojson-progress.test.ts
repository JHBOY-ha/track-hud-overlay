import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const trackSource = readFileSync(new URL('../src/data/track.ts', import.meta.url), 'utf8');
const schemaSource = readFileSync(new URL('../src/data/schema.ts', import.meta.url), 'utf8');
const hudSource = readFileSync(new URL('../src/hud/Hud.tsx', import.meta.url), 'utf8');

test('HUD GeoJSON parser retains coordinate progresses on track points', () => {
  assert.match(trackSource, /const progresses: number\[\] \| undefined = props\.coordinateProperties\?\.progresses/);
  assert.match(trackSource, /progress: Number\.isFinite\(Number\(progresses\?\.\[base \+ i\]\)\)/);
  assert.match(trackSource, /progress: raw\.points\[i\]\.progress/);
  assert.match(schemaSource, /progress\?: number;/);
});

test('HUD falls back to interpolated track progress when telemetry is absent', () => {
  assert.match(trackSource, /export function progressAt\(/);
  assert.match(hudSource, /sample\?\.progress \?\? progressAt\(track, trackTime\) \?\? undefined/);
  assert.match(hudSource, /trackProgress=\{trackProgress\}/);
});
