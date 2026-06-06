import Foundation
import Testing
@testable import HUDRouteLab

struct RouteEngineTests {
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
