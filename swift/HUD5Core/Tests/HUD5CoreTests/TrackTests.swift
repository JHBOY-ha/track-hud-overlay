import XCTest
@testable import HUD5Core

final class TrackTests: XCTestCase {
    // A straight eastbound trk: lat constant, lon increasing ~11m/step,
    // 1s between points, with elevation.
    private func eastboundGpx() -> String {
        var pts = ""
        for i in 0..<5 {
            let lon = Double(i) * 0.0001
            let sec = String(format: "%02d", i)
            pts += "<trkpt lat=\"0.0\" lon=\"\(lon)\"><ele>\(100 + i)</ele>"
                + "<time>2026-05-28T09:27:\(sec)Z</time></trkpt>"
        }
        return """
        <?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
        <trk><name>my run</name><trkseg>\(pts)</trkseg></trk>
        </gpx>
        """
    }

    func testParseGpxBuildsDrivenLayerWithTimeAndElevation() {
        let track = parseGpx(eastboundGpx())
        XCTAssertEqual(track.layers.count, 1)
        XCTAssertEqual(track.layers[0].kind, .driven)
        XCTAssertEqual(track.points.count, 5)
        // 1s between consecutive points.
        for i in 1..<track.points.count {
            let dt = (track.points[i].t ?? 0) - (track.points[i - 1].t ?? 0)
            XCTAssertEqual(dt, 1.0, accuracy: 1e-6)
        }
        XCTAssertEqual(track.points[0].ele ?? 0, 100, accuracy: 1e-9)
        XCTAssertEqual(track.points[4].ele ?? 0, 104, accuracy: 1e-9)
        // Distances are monotonically increasing.
        for i in 1..<track.points.count {
            XCTAssertGreaterThan(track.points[i].distance, track.points[i - 1].distance)
        }
    }

    func testPoseAtByTimeHeadsEast() {
        let track = parseGpx(eastboundGpx())
        // Timestamps are anchored to local midnight, so sample at a real point
        // time rather than assuming a 0-based clock.
        let midTime = track.points[2].t!
        guard let pose = poseAt(track, time: midTime) else {
            return XCTFail("expected a pose at the middle point")
        }
        // 0 = north, clockwise; due east is +90° = pi/2.
        XCTAssertEqual(pose.headingRad, .pi / 2, accuracy: 1e-3)
        XCTAssertEqual(pose.y, 0, accuracy: 1e-6)
        XCTAssertEqual(pose.ele ?? 0, 102, accuracy: 1e-6)
    }

    func testPoseAtOutsideTimeRangeReturnsNil() {
        let track = parseGpx(eastboundGpx())
        let first = track.points.first!.t!
        let last = track.points.last!.t!
        XCTAssertNil(poseAt(track, time: first - 1))
        XCTAssertNil(poseAt(track, time: last + 1))
    }

    func testGpxDenoiseDropsSubMeterJitterPoint() {
        // Three points: two ~11m apart, plus one near-duplicate of the first
        // that should be removed as sub-meter jitter.
        let gpx = """
        <?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
        <trk><trkseg>
          <trkpt lat="0.0" lon="0.0"></trkpt>
          <trkpt lat="0.0" lon="0.000001"></trkpt>
          <trkpt lat="0.0" lon="0.0002"></trkpt>
        </trkseg></trk>
        </gpx>
        """
        let track = parseGpx(gpx)
        XCTAssertEqual(track.points.count, 2)
    }

    func testParseGeoJsonClassifiesAndSnapsDrivenToReference() {
        // Reference road along y=0; driven points ~0.55m north of it.
        let geojson = """
        {
          "type": "FeatureCollection",
          "features": [
            {
              "type": "Feature",
              "properties": {"kind": "reference"},
              "geometry": {"type": "LineString", "coordinates": [[0,0],[0.0005,0],[0.001,0]]}
            },
            {
              "type": "Feature",
              "properties": {"kind": "driven"},
              "geometry": {"type": "LineString",
                "coordinates": [[0.0001,0.000005],[0.0005,0.000005],[0.0009,0.000005]]}
            }
          ]
        }
        """
        let opts = TrackParseOptions(snap: .init(enabled: true, maxDistM: 5))
        let track = parseGeoJson(geojson, options: opts)
        XCTAssertEqual(track.layers.count, 2)
        // Primary is the driven layer, snapped onto the reference (y≈0).
        for p in track.points {
            XCTAssertEqual(p.y, 0, accuracy: 1e-6)
        }
    }

    func testParseGeoJsonWithoutSnapKeepsDrivenOffset() {
        // Reference at y=0 sets the shared origin; the driven layer sits ~0.55m
        // north of it. Without snapping that offset must survive (north maps to
        // -y, so the driven points are negative).
        let geojson = """
        {
          "type": "FeatureCollection",
          "features": [
            {
              "type": "Feature",
              "properties": {"kind": "reference"},
              "geometry": {"type": "LineString", "coordinates": [[0,0],[0.0005,0],[0.001,0]]}
            },
            {
              "type": "Feature",
              "properties": {"kind": "driven"},
              "geometry": {"type": "LineString",
                "coordinates": [[0,0.000005],[0.0005,0.000005],[0.001,0.000005]]}
            }
          ]
        }
        """
        let track = parseGeoJson(geojson)
        // Primary is driven; ~0.55m offset preserved.
        XCTAssertLessThan(track.points[0].y, -0.3)
    }

    func testParseGpxRouteIsPlanned() {
        let gpx = """
        <?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
        <rte><name>plan</name>
          <rtept lat="0.0" lon="0.0"></rtept>
          <rtept lat="0.0" lon="0.0002"></rtept>
          <rtept lat="0.0" lon="0.0004"></rtept>
        </rte>
        </gpx>
        """
        let track = parseGpx(gpx)
        XCTAssertEqual(track.layers.count, 1)
        XCTAssertEqual(track.layers[0].kind, .planned)
    }

    func testPoseAtByProgressReturnsMidpoint() {
        // No timestamps → progress-based sampling.
        let geojson = """
        {
          "type": "FeatureCollection",
          "features": [
            {
              "type": "Feature",
              "properties": {"kind": "driven"},
              "geometry": {"type": "LineString", "coordinates": [[0,0],[0.001,0]]}
            }
          ]
        }
        """
        let track = parseGeoJson(geojson)
        guard let pose = poseAt(track, progress: 0.5) else {
            return XCTFail("expected a pose at progress 0.5")
        }
        XCTAssertEqual(pose.x, track.totalLength / 2, accuracy: 1e-6)
        XCTAssertEqual(pose.y, 0, accuracy: 1e-9)
    }
}
