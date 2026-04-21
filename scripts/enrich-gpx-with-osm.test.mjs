import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildGeoJsonFeatureCollection, enrichGpxText, splitBbox } from './enrich-gpx-with-osm.mjs';

test('buildGeoJsonFeatureCollection emits project layer kinds', () => {
  const points = [
    { idx: 0, lat: 36.65, lon: 117.05, ele: '90', time: '2023-07-14T15:00:42.000Z' },
    { idx: 1, lat: 36.651, lon: 117.051, ele: '91', time: '2023-07-14T15:00:43.000Z' },
  ];
  const roads = [
    {
      id: '100',
      tags: { highway: 'cycleway', name: 'Bike Road' },
      coords: [
        { lat: 36.65, lon: 117.05 },
        { lat: 36.651, lon: 117.051 },
      ],
    },
  ];
  const enriched = [
    {
      point_index: 0,
      time: points[0].time,
      lat: '36.65000000',
      lon: '117.05000000',
      nearest_way_id: '100',
      nearest_way_distance_m: '0.00',
      osm_name: 'Bike Road',
      osm_highway: 'cycleway',
    },
    {
      point_index: 1,
      time: points[1].time,
      lat: '36.65100000',
      lon: '117.05100000',
      nearest_way_id: '100',
      nearest_way_distance_m: '0.00',
      osm_name: 'Bike Road',
      osm_highway: 'cycleway',
    },
  ];

  const geo = buildGeoJsonFeatureCollection(points, enriched, roads, 'https://example.test/osm');

  assert.equal(geo.features[0].properties.kind, 'driven');
  assert.deepEqual(geo.features[0].properties.coordinateProperties.times, [
    '2023-07-14T15:00:42.000Z',
    '2023-07-14T15:00:43.000Z',
  ]);
  assert.equal(geo.features[1].properties.kind, 'reference');
  assert.equal(geo.features[1].properties.highway, 'cycleway');
});

test('enrichGpxText writes enriched outputs into the requested output directory', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud5-gpx-'));
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>
    <trkpt lat="36.65" lon="117.05"><ele>90</ele><time>2023-07-14T15:00:42.000Z</time></trkpt>
    <trkpt lat="36.651" lon="117.051"><ele>91</ele><time>2023-07-14T15:00:43.000Z</time></trkpt>
  </trkseg></trk>
</gpx>`;
  const osm = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6">
  <node id="1" lat="36.65" lon="117.05"/>
  <node id="2" lat="36.651" lon="117.051"/>
  <way id="100">
    <nd ref="1"/>
    <nd ref="2"/>
    <tag k="highway" v="cycleway"/>
    <tag k="name" v="Bike Road"/>
  </way>
</osm>`;
  fs.writeFileSync(path.join(outDir, 'demo_osm_bbox.osm'), osm, 'utf8');

  const result = await enrichGpxText(gpx, { inputName: 'demo.gpx', outDir });

  assert.equal(result.downloaded, false);
  assert.equal(result.paths.gpx, path.join(outDir, 'demo_enriched.gpx'));
  assert.equal(result.paths.geoJson, path.join(outDir, 'demo_enriched.geojson'));
  assert.ok(fs.existsSync(result.paths.gpx));
  assert.ok(fs.existsSync(result.paths.geoJson));
});

test('enrichGpxText normalizes GCJ-02 GPX before matching and GeoJSON output', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud5-gcj-gpx-'));
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>
    <trkpt lat="39.91640428150164" lon="116.41024449916938"><ele>90</ele><time>2023-07-14T15:00:42.000Z</time></trkpt>
    <trkpt lat="39.91640428150164" lon="116.41124449916938"><ele>91</ele><time>2023-07-14T15:00:43.000Z</time></trkpt>
  </trkseg></trk>
</gpx>`;
  const osm = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6">
  <node id="1" lat="39.915" lon="116.404"/>
  <node id="2" lat="39.915" lon="116.405"/>
  <way id="100">
    <nd ref="1"/>
    <nd ref="2"/>
    <tag k="highway" v="primary"/>
  </way>
</osm>`;
  fs.writeFileSync(path.join(outDir, 'demo_osm_bbox.osm'), osm, 'utf8');

  const result = await enrichGpxText(gpx, {
    inputName: 'demo.gpx',
    outDir,
    coordinateSystem: 'gcj02',
  });
  const driven = result.geoJson.features[0].geometry.coordinates;

  assert.ok(Math.abs(driven[0][0] - 116.404) < 0.00002);
  assert.ok(Math.abs(driven[0][1] - 39.915) < 0.00002);
  assert.ok(Number(result.geoJson.features[2].properties.nearest_way_distance_m) < 0.5);
});

test('splitBbox breaks long routes into OSM-sized tiles', () => {
  const tiles = splitBbox([116.7936578, 37.589797, 117.1149046, 38.7087718], 0.08);

  assert.ok(tiles.length > 1);
  for (const [west, south, east, north] of tiles) {
    assert.ok(east - west <= 0.0800001);
    assert.ok(north - south <= 0.0800001);
  }
});
