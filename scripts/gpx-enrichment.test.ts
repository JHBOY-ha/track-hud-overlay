import assert from 'node:assert/strict';
import test from 'node:test';

import { buildProjectGeoJson, parseGpxTrackPoints, parseOsmRoads } from '../src/data/gpxEnrichment.ts';

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>
    <trkpt lat="36.65" lon="117.05"><ele>90</ele><time>2023-07-14T15:00:42.000Z</time></trkpt>
    <trkpt lat="36.651" lon="117.051"><ele>91</ele><time>2023-07-14T15:00:43.000Z</time></trkpt>
  </trkseg></trk>
</gpx>`;

const OSM = `<?xml version="1.0" encoding="UTF-8"?>
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

test('buildProjectGeoJson creates minimap driven and reference layers', () => {
  const points = parseGpxTrackPoints(GPX);
  const roads = parseOsmRoads(OSM);
  const geo = buildProjectGeoJson(points, roads, 'https://example.test/osm');

  assert.equal(geo.features[0].properties.kind, 'driven');
  assert.equal(geo.features[0].properties.coordinateProperties.times.length, 2);
  assert.equal(geo.features[1].properties.kind, 'reference');
  assert.equal(geo.features[1].properties.highway, 'cycleway');
  assert.equal(geo.features[2].properties.kind, 'metadata');
});
