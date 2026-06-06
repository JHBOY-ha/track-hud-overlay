import Foundation
import AppKit
import Testing
@testable import HUDRouteLab

struct RouteEngineTests {
    @Test @MainActor func applicationMenuProvidesCommandQQuitAction() {
        let application = NSApplication.shared
        ApplicationMenu.install(on: application)
        let quitItem = application.mainMenu?.items
            .compactMap(\.submenu)
            .flatMap(\.items)
            .first { $0.action == #selector(NSApplication.terminate(_:)) }

        #expect(quitItem?.keyEquivalent == "q")
        #expect(quitItem?.keyEquivalentModifierMask.contains(.command) == true)
    }

    @Test @MainActor func timelineWindowClampsAndRevealsCursor() {
        let model = RouteLabModel()
        model.cursorSeconds = 23 * 3600
        model.setTimelineHours(3)
        #expect(model.timelineStartSeconds == 21 * 3600)
        #expect(model.timelineEndSeconds == 86_399)

        model.cursorSeconds = 30 * 60
        model.revealCursor()
        #expect(model.timelineStartSeconds == 0)
    }

    @Test @MainActor func playbackUsesImportedTrackRangeAndStopsAtEnd() {
        let model = RouteLabModel()
        let start = Calendar.current.startOfDay(for: .now).addingTimeInterval(100)
        model.importedTrack = ImportedTrack(name: "timed", points: [
            ImportedTrackPoint(point: GeoPoint(lat: 0, lon: 0), time: start),
            ImportedTrackPoint(point: GeoPoint(lat: 0, lon: 1), time: start.addingTimeInterval(10)),
        ])
        model.cursorSeconds = 50

        model.play()
        #expect(model.cursorSeconds == 100)
        #expect(model.isPlaying)

        model.advancePlayback(by: 12)
        #expect(model.cursorSeconds == 110)
        #expect(!model.isPlaying)
    }

    @Test @MainActor func timelineScrubbingPausesPlayback() {
        let model = RouteLabModel()
        model.play()
        model.scrubTimeline(to: 200)

        #expect(model.cursorSeconds == 200)
        #expect(!model.isPlaying)
    }

    @Test func parsesSharedOSMNodesForRouting() throws {
        let xml = """
        <osm version="0.6">
          <node id="1" lat="0" lon="0"/>
          <node id="2" lat="0" lon="0.001"/>
          <node id="3" lat="0.001" lon="0.001"/>
          <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way>
          <way id="11"><nd ref="2"/><nd ref="3"/><tag k="highway" v="residential"/></way>
        </osm>
        """
        let roads = try OSMXMLParser.parse(Data(xml.utf8))
        #expect(roads.count == 2)
        #expect(roads[0].points.last?.nodeID == roads[1].points.first?.nodeID)
    }

    @Test func projectsToRoadSegmentInsteadOfEndpoint() {
        let road = Road(
            id: "1",
            name: "test",
            highway: "residential",
            points: [
                RoadPoint(nodeID: "1", lat: 0, lon: 0),
                RoadPoint(nodeID: "2", lat: 0, lon: 0.01),
            ]
        )

        let projection = RouteEngine.projectToRoad(
            GeoPoint(lat: 0.001, lon: 0.005),
            roads: [road]
        )

        #expect(projection != nil)
        #expect(abs((projection?.point.lon ?? 0) - 0.005) < 0.00001)
        #expect((projection?.distanceM ?? 0) > 100)
    }

    @Test func buildsSnapPreviewWithinMaximumDistance() {
        let road = Road(
            id: "1",
            name: "test",
            highway: "residential",
            points: [
                RoadPoint(nodeID: "1", lat: 0, lon: 0),
                RoadPoint(nodeID: "2", lat: 0, lon: 0.01),
            ]
        )
        let points = [
            GeoPoint(lat: 0.0001, lon: 0.005),
            GeoPoint(lat: 0.01, lon: 0.005),
        ]

        let preview = RouteEngine.buildSnapPreview(points: points, roads: [road], maximumDistanceM: 30)

        #expect(preview.points.count == 2)
        #expect(preview.snappedCount == 1)
        #expect(abs(preview.points[0].lat) < 0.000001)
        #expect(preview.points[1] == points[1])
    }

    @Test func importsGPXTrackWithTimes() throws {
        let gpx = """
        <gpx version="1.1"><trk><trkseg>
          <trkpt lat="39.9" lon="116.4"><time>2026-06-06T00:00:00Z</time></trkpt>
          <trkpt lat="39.91" lon="116.41"><time>2026-06-06T00:00:01.000Z</time></trkpt>
        </trkseg></trk></gpx>
        """

        let document = try TrackImportService.parse(data: Data(gpx.utf8), fileName: "sample.gpx")
        let track = document.track

        #expect(track.points.count == 2)
        #expect(track.points[0].point == GeoPoint(lat: 39.9, lon: 116.4))
        #expect(track.points.allSatisfy { $0.time != nil })
        #expect(document.referenceRoads.isEmpty)
    }

    @Test func importsDrivenGeoJSONBeforeReferenceRoads() throws {
        let geoJSON = """
        {
          "type": "FeatureCollection",
          "features": [
            {"type":"Feature","properties":{"kind":"reference"},"geometry":{"type":"LineString","coordinates":[[1,1],[2,2]]}},
            {"type":"Feature","properties":{"kind":"driven","name":"HUD route","coordinateProperties":{"times":["2026-06-06T00:00:00.000Z","2026-06-06T00:00:01.000Z"]}},"geometry":{"type":"LineString","coordinates":[[116.4,39.9,0],[116.41,39.91,0]]}}
          ]
        }
        """

        let document = try TrackImportService.parse(data: Data(geoJSON.utf8), fileName: "sample.geojson")
        let track = document.track

        #expect(track.name == "HUD route")
        #expect(track.points.count == 2)
        #expect(track.points[0].point == GeoPoint(lat: 39.9, lon: 116.4))
        #expect(document.referenceRoads.count == 1)
        #expect(document.referenceRoads[0].points.count == 2)
    }

    @Test func importsReferenceRoadMetadataAndSharedCoordinateNodes() throws {
        let geoJSON = """
        {
          "type": "FeatureCollection",
          "features": [
            {"type":"Feature","properties":{"kind":"driven"},"geometry":{"type":"LineString","coordinates":[[0,0],[0.001,0]]}},
            {"type":"Feature","properties":{"kind":"reference","osm_way_id":10,"highway":"primary","name":"A"},"geometry":{"type":"LineString","coordinates":[[0,0],[0.001,0]]}},
            {"type":"Feature","properties":{"kind":"reference","osm_way_id":"11","highway":"secondary","name":"B"},"geometry":{"type":"MultiLineString","coordinates":[[[0.001,0],[0.001,0.001]],[[1,1],[2,2]]]}}
          ]
        }
        """

        let document = try TrackImportService.parse(data: Data(geoJSON.utf8), fileName: "enriched.geojson")

        #expect(document.referenceRoads.count == 3)
        #expect(document.referenceRoads[0].id == "10")
        #expect(document.referenceRoads[0].highway == "primary")
        #expect(document.referenceRoads[0].points.last?.nodeID == document.referenceRoads[1].points.first?.nodeID)
    }

    @Test func importedTrackUsesTimestampDurationAndInterpolatesCursorPosition() {
        let start = Date(timeIntervalSince1970: 8 * 3600)
        let track = ImportedTrack(name: "timed", points: [
            ImportedTrackPoint(point: GeoPoint(lat: 0, lon: 0), time: start),
            ImportedTrackPoint(point: GeoPoint(lat: 0, lon: 0.01), time: start.addingTimeInterval(10)),
        ])

        #expect(track.timelineSeconds.count == 2)
        #expect(track.timelineSeconds[1] - track.timelineSeconds[0] == 10)
        let middle = track.point(at: track.timelineSeconds[0] + 5)
        #expect(abs((middle?.lon ?? 0) - 0.005) < 0.000001)
    }

    @Test func importedTrackWithoutTimesFillsTimeline() {
        let track = ImportedTrack(name: "untimed", points: [
            ImportedTrackPoint(point: GeoPoint(lat: 0, lon: 0), time: nil),
            ImportedTrackPoint(point: GeoPoint(lat: 0, lon: 1), time: nil),
            ImportedTrackPoint(point: GeoPoint(lat: 0, lon: 2), time: nil),
        ])

        #expect(track.timelineSeconds == [0, 43_199.5, 86_399])
    }

    @Test func interpolatesLargeImportedTrackUsingCachedTimelineData() {
        let points = (0...10_000).map {
            ImportedTrackPoint(point: GeoPoint(lat: 0, lon: Double($0) / 10_000), time: nil)
        }
        let track = ImportedTrack(name: "large", points: points)
        let coordinates = track.coordinates
        let timeline = track.timelineSeconds

        let middle = track.point(at: 43_199.5, coordinates: coordinates, timelineSeconds: timeline)

        #expect(abs((middle?.lon ?? 0) - 0.5) < 0.000001)
    }

    @Test func snapsLargeTrackAgainstIndexedRoadNetwork() {
        let roads = (0..<200).map { index in
            let latitude = Double(index) * 0.001
            return Road(id: "\(index)", name: "", highway: "residential", points: [
                RoadPoint(nodeID: "\(index)-a", lat: latitude, lon: 0),
                RoadPoint(nodeID: "\(index)-b", lat: latitude, lon: 0.02),
            ])
        }
        let points = (0..<1_000).map {
            GeoPoint(lat: 0.00005, lon: Double($0) / 1_000 * 0.02)
        }

        let preview = RouteEngine.buildSnapPreview(points: points, roads: roads, maximumDistanceM: 20)

        #expect(preview.snappedCount == points.count)
        #expect(preview.points.allSatisfy { abs($0.lat) < 0.000001 })
    }

    @Test func samplesConnectedRouteAtTenHertz() throws {
        let road = Road(
            id: "1",
            name: "test",
            highway: "residential",
            points: [
                RoadPoint(nodeID: "1", lat: 0, lon: 0),
                RoadPoint(nodeID: "2", lat: 0, lon: 0.001),
            ]
        )
        let start = Date(timeIntervalSince1970: 0)
        let marks = [
            RouteMark(id: 1, time: start, roadID: road.id, segmentIndex: 0, segmentT: 0, point: road.points[0].geo),
            RouteMark(id: 2, time: start.addingTimeInterval(1), roadID: road.id, segmentIndex: 0, segmentT: 1, point: road.points[1].geo),
        ]

        let result = RouteEngine.buildTimedRoute(roads: [road], marks: marks)
        #expect(result.disconnectedPair == nil)
        #expect(result.samples.count == 11)
        #expect(result.samples.first?.progress == 0)
        #expect(result.samples.last?.progress == 1)
    }

    @Test func detectsDisconnectedRoads() throws {
        let roads = [
            Road(id: "1", name: "", highway: "residential", points: [
                RoadPoint(nodeID: "1", lat: 0, lon: 0),
                RoadPoint(nodeID: "2", lat: 0, lon: 0.001),
            ]),
            Road(id: "2", name: "", highway: "residential", points: [
                RoadPoint(nodeID: "3", lat: 1, lon: 1),
                RoadPoint(nodeID: "4", lat: 1, lon: 1.001),
            ]),
        ]
        let start = Date(timeIntervalSince1970: 0)
        let marks = [
            RouteMark(id: 1, time: start, roadID: "1", segmentIndex: 0, segmentT: 0, point: roads[0].points[0].geo),
            RouteMark(id: 2, time: start.addingTimeInterval(1), roadID: "2", segmentIndex: 0, segmentT: 0, point: roads[1].points[0].geo),
        ]

        let result = RouteEngine.buildTimedRoute(roads: roads, marks: marks)
        #expect(result.disconnectedPair == 0)
    }
}
