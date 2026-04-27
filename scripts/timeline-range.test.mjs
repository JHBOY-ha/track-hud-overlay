import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/playback/store.ts', import.meta.url), 'utf8');

test('newly loaded sources snap playback to the full axis start', () => {
  assert.match(
    source,
    /setTelemetry: t => \{\s*set\(\{ telemetry: t, telemetryOffset: 0, playing: false, playbackStart: null, playbackEnd: null \}\);\s*snapPlayheadToAxis\(set, get, \{ forceStart: true \}\);/s,
  );
  assert.match(
    source,
    /setVideo: [\s\S]*?playbackStart: null,\s*playbackEnd: null,[\s\S]*?\}\);\s*snapPlayheadToAxis\(set, get, \{ forceStart: true \}\);/s,
  );
  assert.match(
    source,
    /snapPlayheadToAxis\(set, get, \{ forceStart: resetTimeline \}\);/,
  );
});

test('advanced track reparsing can preserve the current selection', () => {
  assert.match(
    source,
    /const resetTimeline = opts\?\.resetTimeline \?\? true;/,
  );
  assert.match(
    source,
    /\.\.\.\(resetTimeline\s*\?\s*\{ trackOffset: 0, playbackStart: null, playbackEnd: null \}\s*:\s*null\)/s,
  );
  assert.match(
    source,
    /if \(opts\.forceStart\) \{\s*set\(\{ currentTime: lo \}\);\s*return;\s*\}/s,
  );
});
