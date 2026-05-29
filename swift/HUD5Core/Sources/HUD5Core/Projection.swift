import Foundation

/// A geographic coordinate in degrees. Mirrors `LonLat` in src/util/projection.ts.
public struct LonLat: Equatable, Sendable {
    public var lon: Double
    public var lat: Double

    public init(lon: Double, lat: Double) {
        self.lon = lon
        self.lat = lat
    }
}

/// A point in the local planar frame, in meters. Mirrors `NormalizedPoint`.
public struct NormalizedPoint: Equatable, Sendable {
    public var x: Double
    public var y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

private let earthRadius = 6_378_137.0

/// Port of `projectLonLat` from src/util/projection.ts.
public func projectLonLat(_ points: [LonLat]) -> [NormalizedPoint] {
    projectLonLatLayers([points]).first ?? []
}

/// Project multiple layers into a shared local planar frame (meters) so they
/// align in the minimap. Origin is the first point of the first layer; cosLat
/// correction uses the mean latitude across all points.
///
/// Coordinates are returned in meters — downstream code owns the meters→pixel
/// scaling. Port of `projectLonLatLayers` from src/util/projection.ts.
public func projectLonLatLayers(_ layers: [[LonLat]]) -> [[NormalizedPoint]] {
    let all = layers.flatMap { $0 }
    if all.isEmpty {
        return layers.map { _ in [] }
    }

    let sumLat = all.reduce(0.0) { $0 + $1.lat }
    let centerLat = sumLat / Double(all.count)
    let cosLat = cos(centerLat * .pi / 180)
    let originLon = all[0].lon
    let originLat = all[0].lat

    return layers.map { layer in
        layer.map { p in
            NormalizedPoint(
                x: (p.lon - originLon) * .pi * earthRadius * cosLat / 180,
                // Flip Y so north is up (SVG/Core Animation y-axis points down).
                y: -((p.lat - originLat) * .pi * earthRadius) / 180
            )
        }
    }
}
