import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MINIMAP_ANCHOR_Y,
  MINIMAP_DISC,
  MINIMAP_PLANE_BOTTOM_OVERDRAW,
  MINIMAP_PLANE_SIDE_OVERDRAW,
  MINIMAP_PLANE_TILT_DEG,
  MINIMAP_PLANE_TOP_OVERDRAW,
  MINIMAP_PLANE_VIEWBOX_WIDTH,
  MINIMAP_PLANE_VIEWBOX_HEIGHT,
  MINIMAP_TOP_FADE_OPACITY,
} from '../src/hud/minimapViewport.ts';

test('minimap viewport uses a strong perspective with enough overdraw to fill the far edge', () => {
  assert.ok(MINIMAP_PLANE_TILT_DEG >= 46);
  assert.ok(MINIMAP_PLANE_TILT_DEG <= 75);
  assert.ok(MINIMAP_ANCHOR_Y >= MINIMAP_DISC * 0.7);
  assert.ok(MINIMAP_PLANE_SIDE_OVERDRAW >= 100);
  assert.ok(MINIMAP_PLANE_TOP_OVERDRAW >= 100);
  assert.ok(MINIMAP_PLANE_BOTTOM_OVERDRAW >= 100);
  assert.equal(
    MINIMAP_PLANE_VIEWBOX_WIDTH,
    MINIMAP_DISC + MINIMAP_PLANE_SIDE_OVERDRAW * 2,
  );
  assert.equal(
    MINIMAP_PLANE_VIEWBOX_HEIGHT,
    MINIMAP_DISC + MINIMAP_PLANE_TOP_OVERDRAW + MINIMAP_PLANE_BOTTOM_OVERDRAW,
  );
  assert.ok(MINIMAP_TOP_FADE_OPACITY >= 0.55);
});

test('minimap car arrow is rendered on the perspective plane', () => {
  const source = readFileSync(new URL('../src/hud/Minimap.tsx', import.meta.url), 'utf8');

  assert.match(source, /transform=\{`translate\(\$\{mapPlaneAnchorX\} \$\{mapPlaneAnchorY\}\)`\}/);
  assert.doesNotMatch(source, /transform=\{`translate\(\$\{DISC \/ 2\} \$\{ANCHOR_Y\}\)`\}/);
  assert.doesNotMatch(source, /Overlay — car arrow \+ N label, untilted on top of the plane/);
});

test('minimap plane uses a radial alpha blend from center to edges', () => {
  const source = readFileSync(new URL('../src/hud/Minimap.tsx', import.meta.url), 'utf8');

  assert.match(source, /<radialGradient\s+id="mm-radial-fade"/);
  assert.match(source, /fill="url\(#mm-radial-fade\)"/);
  assert.match(source, /cx=\{mapPlaneAnchorX\}/);
  assert.match(source, /cy=\{mapPlaneAnchorY\}/);
});

test('minimap car arrow has outlined dimensional styling', () => {
  const source = readFileSync(new URL('../src/hud/Minimap.tsx', import.meta.url), 'utf8');

  assert.match(source, /id="mm-arrow-fill"/);
  assert.match(source, /id="mm-arrow-shadow"/);
  assert.match(source, /stroke="rgba\(37, 30, 52, 0\.95\)"/);
  assert.match(source, /strokeLinejoin="round"/);
  assert.match(source, /fill="url\(#mm-arrow-fill\)"/);
  assert.doesNotMatch(source, /<polygon\s+points="0,-11 8,9 0,3 -8,9"/);
});
