import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  frameArgsToSeconds,
  frameNumberToTimecode,
  localFileUrlFor,
  normalizeMediaArg,
  secondsToFrameArg,
} from './export-frames.mjs';

test('normalizeMediaArg removes accidental literal shell quotes', () => {
  assert.equal(
    normalizeMediaArg("'/Users/jhboy/Documents/2604huddesign/local/clip telemetry.csv'"),
    '/Users/jhboy/Documents/2604huddesign/local/clip telemetry.csv',
  );
});

test('localFileUrlFor maps absolute local paths to the export file server', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hud5-export-test-'));
  const file = join(dir, 'a b.csv');
  writeFileSync(file, 't,speed_kmh\n0,0\n');
  const mapped = localFileUrlFor(file, 51321);
  assert.equal(
    mapped,
    'http://127.0.0.1:51321/file/0/a%20b.csv',
  );
});

test('localFileUrlFor leaves app-relative URLs unchanged', () => {
  assert.equal(localFileUrlFor('/samples/track.gpx', 51321), '/samples/track.gpx');
});

test('secondsToFrameArg converts timeline seconds to absolute frame numbers', () => {
  assert.equal(secondsToFrameArg(1254.857316685267, 48), 60233);
  assert.equal(secondsToFrameArg(1315.3807680771426, 48), 63138);
});

test('frameArgsToSeconds converts export frame args back to seconds', () => {
  assert.deepEqual(frameArgsToSeconds(2905, 60233, 63138, 48), {
    durationSeconds: 60.520833333333336,
    rangeStartSeconds: 1254.8541666666667,
    rangeEndSeconds: 1315.375,
  });
});

test('frameNumberToTimecode formats absolute frame numbers for ffmpeg metadata', () => {
  assert.equal(frameNumberToTimecode(60233, 48), '00:20:54:41');
  assert.equal(frameNumberToTimecode(28480, 24), '00:19:46:16');
});
