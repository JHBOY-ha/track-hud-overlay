import assert from 'node:assert/strict';
import test from 'node:test';
import { formatTimecode } from '../src/util/timecode.ts';

test('formatTimecode formats seconds as non-drop-frame timecode', () => {
  assert.equal(formatTimecode(64800, 60), '18:00:00:00');
  assert.equal(formatTimecode(64800.5, 60), '18:00:00:30');
  assert.equal(formatTimecode(64800 + 1.999, 24), '18:00:02:00');
});

test('formatTimecode supports negative values and 120fps frame fields', () => {
  assert.equal(formatTimecode(-4.619031471469498, 60), '-00:00:04:37');
  assert.equal(formatTimecode(1 + 119 / 120, 120), '00:00:01:119');
});
