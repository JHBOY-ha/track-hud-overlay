import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MINIMAP_ANCHOR_Y,
  MINIMAP_DISC,
  MINIMAP_PLANE_TILT_DEG,
  MINIMAP_TOP_FADE_OPACITY,
} from '../src/hud/minimapViewport.ts';

test('minimap viewport keeps the forward map area visible', () => {
  assert.equal(MINIMAP_PLANE_TILT_DEG, 0);
  assert.ok(MINIMAP_ANCHOR_Y >= MINIMAP_DISC * 0.7);
  assert.ok(MINIMAP_TOP_FADE_OPACITY >= 0.55);
});
