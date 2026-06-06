import Foundation

struct GeoPoint: Codable, Equatable, Sendable {
    var lat: Double
    var lon: Double
}

struct ImportedTrackPoint: Equatable, Sendable {
    var point: GeoPoint
    var time: Date?
}

struct ImportedTrack: Equatable, Sendable {
    var name: String
    var points: [ImportedTrackPoint]

    var coordinates: [GeoPoint] { points.map(\.point) }
}

struct SnapPreview: Equatable, Sendable {
    var points: [GeoPoint]
    var snappedCount: Int
    var averageOffsetM: Double
    var maxOffsetM: Double

    static let empty = SnapPreview(points: [], snappedCount: 0, averageOffsetM: 0, maxOffsetM: 0)
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

    init(points: [GeoPoint], paddingM: Double = 0) {
        let first = points.first ?? GeoPoint(lat: 0, lon: 0)
        minLat = points.map(\.lat).min() ?? first.lat
        minLon = points.map(\.lon).min() ?? first.lon
        maxLat = points.map(\.lat).max() ?? first.lat
        maxLon = points.map(\.lon).max() ?? first.lon
        let centerLat = (minLat + maxLat) / 2
        let latPadding = paddingM / 110_540
        let lonPadding = paddingM / max(1, 111_320 * cos(centerLat * .pi / 180))
        minLat -= latPadding
        minLon -= lonPadding
        maxLat += latPadding
        maxLon += lonPadding
    }

    var center: GeoPoint {
        GeoPoint(lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2)
    }

    var radiusM: Double {
        max(
            RouteEngine.distanceM(center, GeoPoint(lat: minLat, lon: center.lon)),
            RouteEngine.distanceM(center, GeoPoint(lat: center.lat, lon: minLon))
        )
    }
}
