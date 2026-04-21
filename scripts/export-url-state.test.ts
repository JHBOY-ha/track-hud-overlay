import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exportUrlForDroppedFileName } from '../src/util/exportUrls.ts';

const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('local dropped files are not presented as /samples export URLs', () => {
  assert.doesNotMatch(source, /setTelemetryUrl\(`\/samples\/\$\{file\.name\}`\)/);
  assert.doesNotMatch(source, /setTrackUrl\(`\/samples\/\$\{file\.name\}`\)/);
});

test('export settings only fall back to sample URLs when no data is loaded', () => {
  assert.match(source, /defaultTelemetryUrl=\{telemetryUrl \?\? \(hasTelemetry \? '' : '\/samples\/telemetry\.csv'\)\}/);
  assert.match(source, /defaultTrackUrl=\{trackUrl \?\? \(hasTrack \? '' : '\/samples\/track\.gpx'\)\}/);
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
