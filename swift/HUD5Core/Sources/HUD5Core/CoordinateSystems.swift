import Foundation

/// Geographic datum of incoming coordinates. Mirrors `CoordinateSystem` in
/// src/util/coordinateSystems.ts.
public enum CoordinateSystem: String, Sendable, CaseIterable {
    case wgs84
    case gcj02
    case bd09
}

private let aAxis = 6_378_245.0
private let ee = 0.00669342162296594323
private let xPi = Double.pi * 3000.0 / 180.0

/// Port of `isCoordinateSystem` from src/util/coordinateSystems.ts.
public func isCoordinateSystem(_ value: String?) -> Bool {
    CoordinateSystem(rawValue: value ?? "") != nil
}

private func outsideChina(_ lon: Double, _ lat: Double) -> Bool {
    lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271
}

private func transformLat(_ x: Double, _ y: Double) -> Double {
    var ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y
    ret += 0.2 * sqrt(abs(x))
    ret += (20.0 * sin(6.0 * x * .pi) + 20.0 * sin(2.0 * x * .pi)) * 2.0 / 3.0
    ret += (20.0 * sin(y * .pi) + 40.0 * sin(y / 3.0 * .pi)) * 2.0 / 3.0
    ret += (160.0 * sin(y / 12.0 * .pi) + 320.0 * sin(y * .pi / 30.0)) * 2.0 / 3.0
    return ret
}

private func transformLon(_ x: Double, _ y: Double) -> Double {
    var ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y
    ret += 0.1 * sqrt(abs(x))
    ret += (20.0 * sin(6.0 * x * .pi) + 20.0 * sin(2.0 * x * .pi)) * 2.0 / 3.0
    ret += (20.0 * sin(x * .pi) + 40.0 * sin(x / 3.0 * .pi)) * 2.0 / 3.0
    ret += (150.0 * sin(x / 12.0 * .pi) + 300.0 * sin(x / 30.0 * .pi)) * 2.0 / 3.0
    return ret
}

private func wgs84ToGcj02(_ point: LonLat) -> LonLat {
    if outsideChina(point.lon, point.lat) { return point }

    var dLat = transformLat(point.lon - 105.0, point.lat - 35.0)
    var dLon = transformLon(point.lon - 105.0, point.lat - 35.0)
    let radLat = point.lat / 180.0 * .pi
    var magic = sin(radLat)
    magic = 1 - ee * magic * magic
    let sqrtMagic = sqrt(magic)
    dLat = dLat * 180.0 / ((aAxis * (1 - ee)) / (magic * sqrtMagic) * .pi)
    dLon = dLon * 180.0 / (aAxis / sqrtMagic * cos(radLat) * .pi)
    return LonLat(lon: point.lon + dLon, lat: point.lat + dLat)
}

private func gcj02ToWgs84(_ point: LonLat) -> LonLat {
    if outsideChina(point.lon, point.lat) { return point }

    var guess = point
    for _ in 0..<2 {
        let shifted = wgs84ToGcj02(guess)
        guess = LonLat(
            lon: guess.lon - (shifted.lon - point.lon),
            lat: guess.lat - (shifted.lat - point.lat)
        )
    }
    return guess
}

private func bd09ToGcj02(_ point: LonLat) -> LonLat {
    let x = point.lon - 0.0065
    let y = point.lat - 0.006
    let z = sqrt(x * x + y * y) - 0.00002 * sin(y * xPi)
    let theta = atan2(y, x) - 0.000003 * cos(x * xPi)
    return LonLat(lon: z * cos(theta), lat: z * sin(theta))
}

/// Convert a single coordinate to WGS-84 from its source datum.
/// Port of `convertLonLatToWgs84` from src/util/coordinateSystems.ts.
public func convertLonLatToWgs84(_ point: LonLat, source: CoordinateSystem = .wgs84) -> LonLat {
    switch source {
    case .wgs84: return point
    case .gcj02: return gcj02ToWgs84(point)
    case .bd09: return gcj02ToWgs84(bd09ToGcj02(point))
    }
}

/// Convert multiple layers of coordinates to WGS-84.
/// Port of `convertLonLatLayersToWgs84` from src/util/coordinateSystems.ts.
public func convertLonLatLayersToWgs84(_ layers: [[LonLat]], source: CoordinateSystem = .wgs84) -> [[LonLat]] {
    if source == .wgs84 { return layers }
    return layers.map { layer in layer.map { convertLonLatToWgs84($0, source: source) } }
}
