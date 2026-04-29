import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exportUrlForDroppedFileName } from '../src/util/exportUrls.ts';

const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const exportFramesSource = readFileSync(new URL('./export-frames.mjs', import.meta.url), 'utf8');

test('local dropped files are not presented as /samples export URLs', () => {
  assert.doesNotMatch(source, /setTelemetryUrl\(`\/samples\/\$\{file\.name\}`\)/);
  assert.doesNotMatch(source, /setTrackUrl\(`\/samples\/\$\{file\.name\}`\)/);
});

test('export settings only fall back to sample URLs when no data is loaded', () => {
  assert.match(source, /defaultTelemetryUrl=\{telemetryUrl \?\? \(hasTelemetry \? '' : '\/samples\/telemetry\.csv'\)\}/);
  assert.match(source, /defaultTrackUrl=\{trackUrl \?\? \(hasTrack \? '' : '\/samples\/track\.gpx'\)\}/);
});

test('export command carries timeline source offsets', () => {
  assert.match(source, /'--telemetry-offset', String\(telemetryOffset\)/);
  assert.match(source, /'--track-offset', String\(trackOffset\)/);
  assert.match(source, /'--video-offset', String\(videoOffset\)/);
  assert.match(source, /q\.get\('telemetryOffset'\)/);
  assert.match(source, /q\.get\('trackOffset'\)/);
  assert.match(source, /q\.get\('videoOffset'\)/);
});

test('export command carries progress range for preview parity', () => {
  assert.match(source, /const progressStart = usePlayback\(s => s\.progressStart\);/);
  assert.match(source, /const progressEnd = usePlayback\(s => s\.progressEnd\);/);
  assert.match(source, /'--progress-start', String\(progressStart\)/);
  assert.match(source, /'--progress-end', String\(progressEnd\)/);
  assert.match(source, /q\.get\('progressStart'\)/);
  assert.match(source, /q\.get\('progressEnd'\)/);
  assert.match(source, /setProgressStart\(progressStart\)/);
  assert.match(source, /setProgressEnd\(progressEnd\)/);
  assert.match(exportFramesSource, /PROGRESS_START = Number\(arg\('progress-start', 'NaN'\)\)/);
  assert.match(exportFramesSource, /PROGRESS_END = Number\(arg\('progress-end', 'NaN'\)\)/);
  assert.match(exportFramesSource, /url\.searchParams\.set\('progressStart', String\(PROGRESS_START\)\)/);
  assert.match(exportFramesSource, /url\.searchParams\.set\('progressEnd', String\(PROGRESS_END\)\)/);
});

test('export command carries advanced HUD settings', () => {
  assert.match(source, /const snapToRoads = usePlayback\(s => s\.settings\.snapToRoads\);/);
  assert.match(source, /const snapMaxDistM = usePlayback\(s => s\.settings\.snapMaxDistM\);/);
  assert.match(source, /const minimapViewRadiusM = usePlayback\(s => s\.settings\.minimapViewRadiusM\);/);
  assert.match(source, /const minimapTiltDeg = usePlayback\(s => s\.settings\.minimapTiltDeg\);/);
  assert.match(source, /const minimapStrokeWidth = usePlayback\(s => s\.settings\.minimapStrokeWidth\);/);
  assert.match(source, /'--snap-to-roads', snapToRoads \? '1' : '0'/);
  assert.match(source, /'--snap-max-dist', String\(snapMaxDistM\)/);
  assert.match(source, /'--minimap-radius', String\(minimapViewRadiusM\)/);
  assert.match(source, /'--minimap-tilt', String\(minimapTiltDeg\)/);
  assert.match(source, /'--minimap-stroke', String\(minimapStrokeWidth\)/);
  assert.match(source, /q\.get\('snapToRoads'\)/);
  assert.match(source, /q\.get\('snapMaxDistM'\)/);
  assert.match(source, /q\.get\('minimapViewRadiusM'\)/);
  assert.match(source, /q\.get\('minimapTiltDeg'\)/);
  assert.match(source, /q\.get\('minimapStrokeWidth'\)/);
  assert.match(source, /setSetting\('snapToRoads',/);
  assert.match(source, /setSetting\('snapMaxDistM',/);
  assert.match(source, /setSetting\('minimapViewRadiusM',/);
  assert.match(source, /setSetting\('minimapTiltDeg',/);
  assert.match(source, /setSetting\('minimapStrokeWidth',/);
  assert.match(exportFramesSource, /SNAP_TO_ROADS = arg\('snap-to-roads', null\)/);
  assert.match(exportFramesSource, /SNAP_MAX_DIST = arg\('snap-max-dist', null\)/);
  assert.match(exportFramesSource, /MINIMAP_RADIUS = arg\('minimap-radius', null\)/);
  assert.match(exportFramesSource, /MINIMAP_TILT = arg\('minimap-tilt', null\)/);
  assert.match(exportFramesSource, /MINIMAP_STROKE = arg\('minimap-stroke', null\)/);
  assert.match(exportFramesSource, /url\.searchParams\.set\('snapToRoads',/);
  assert.match(exportFramesSource, /url\.searchParams\.set\('snapMaxDistM',/);
  assert.match(exportFramesSource, /url\.searchParams\.set\('minimapViewRadiusM',/);
  assert.match(exportFramesSource, /url\.searchParams\.set\('minimapTiltDeg',/);
  assert.match(exportFramesSource, /url\.searchParams\.set\('minimapStrokeWidth',/);
});

test('enriched output track files use /output export URLs', () => {
  assert.equal(
    exportUrlForDroppedFileName('activity_256997965_enriched.geojson', 'track'),
    '/output/activity_256997965_enriched.geojson',
  );
  assert.equal(
    exportUrlForDroppedFileName('activity_256997965_enriched.gpx', 'track'),
    '/output/activity_256997965_enriched.gpx',
  );
  assert.equal(exportUrlForDroppedFileName('random-track.gpx', 'track'), '');
});

test('vite serves output files in dev and preview', () => {
  const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');

  assert.match(viteConfig, /serveOutputFiles\(server\.config\.root\)/);
  assert.match(viteConfig, /configurePreviewServer\(server\)/);
});
