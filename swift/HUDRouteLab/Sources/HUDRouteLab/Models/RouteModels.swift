import Foundation

struct GeoPoint: Codable, Equatable, Sendable {
    var lat: Double
    var lon: Double
}

struct RoadPoint: Codable, Equatable, Sendable {
    var nodeID: String
    var lat: Double
    var lon: Double
    var geo: GeoPoint { GeoPoint(lat: lat, lon: lon) }
}

struct Road: Identifiable, Equatable, Sendable {
    var id: String
    var name: String
    var highway: String
    var points: [RoadPoint]
}

struct RouteMark: Identifiable, Equatable, Sendable {
    var id: Int
    var time: Date
    var roadID: String
    var segmentIndex: Int
    var segmentT: Double
    var point: GeoPoint
}

struct TimedRoutePoint: Equatable, Sendable {
    var point: GeoPoint
    var time: Date
    var progress: Double
}

struct RouteResult: Equatable, Sendable {
    var path: [GeoPoint]
    var samples: [TimedRoutePoint]
    var lengthM: Double
    var disconnectedPair: Int?

    static let empty = RouteResult(path: [], samples: [], lengthM: 0, disconnectedPair: nil)
}

struct RoadProjection: Equatable, Sendable {
    var roadID: String
    var segmentIndex: Int
    var segmentT: Double
    var point: GeoPoint
    var distanceM: Double
}

struct MapBounds: Equatable, Sendable {
    var minLat: Double
    var minLon: Double
    var maxLat: Double
    var maxLon: Double

    init(center: GeoPoint, radiusM: Double) {
        let latDelta = radiusM / 110_540
        let lonDelta = radiusM / (111_320 * cos(center.lat * .pi / 180))
        minLat = center.lat - latDelta
        minLon = center.lon - lonDelta
        maxLat = center.lat + latDelta
        maxLon = center.lon + lonDelta
    }
}
