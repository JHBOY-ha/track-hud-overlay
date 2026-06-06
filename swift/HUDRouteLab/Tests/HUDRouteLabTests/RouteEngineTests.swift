import Foundation
import Testing
@testable import HUDRouteLab

struct RouteEngineTests {
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
