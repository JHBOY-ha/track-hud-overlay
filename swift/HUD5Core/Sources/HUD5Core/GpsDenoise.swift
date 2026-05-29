import Foundation

/// A raw GPS point in degrees with an optional timestamp. Mirrors
/// `RawGpsPoint` in src/data/gpsDenoise.ts.
public struct RawGpsPoint: Equatable, Sendable {
    public var lon: Double
    public var lat: Double
    public var t: Double?
    public var ele: Double?

    public init(lon: Double, lat: Double, t: Double? = nil, ele: Double? = nil) {
        self.lon = lon
        self.lat = lat
        self.t = t
        self.ele = ele
    }
}

private let gpsJitterSpacingM = 1.5
private let gpsSpikeMinLegM = 12.0
private let gpsSpikeDetourRatio = 3.0
private let gpsSpikeDirectRatio = 0.6
private let earthRadiusM = 6_378_137.0

private func approxDistanceMeters(_ a: RawGpsPoint, _ b: RawGpsPoint) -> Double {
    let lat = (a.lat + b.lat) / 2 * .pi / 180
    let dx = (b.lon - a.lon) * .pi / 180 * earthRadiusM * cos(lat)
    let dy = (b.lat - a.lat) * .pi / 180 * earthRadiusM
    return (dx * dx + dy * dy).squareRoot()
}

private func removeCloseGpsJitter(_ points: [RawGpsPoint]) -> [RawGpsPoint] {
    if points.count <= 2 { return points }
    var out: [RawGpsPoint] = [points[0]]
    for i in 1..<(points.count - 1) {
        let previousAccepted = out[out.count - 1]
        let point = points[i]
        if approxDistanceMeters(previousAccepted, point) >= gpsJitterSpacingM {
            out.append(point)
        }
    }
    out.append(points[points.count - 1])
    return out
}

private func isIsolatedGpsSpike(_ previous: RawGpsPoint, _ point: RawGpsPoint, _ next: RawGpsPoint) -> Bool {
    let inDistance = approxDistanceMeters(previous, point)
    let outDistance = approxDistanceMeters(point, next)
    let directDistance = approxDistanceMeters(previous, next)
    let minLegDistance = min(inDistance, outDistance)

    if minLegDistance < gpsSpikeMinLegM { return false }
    if directDistance > minLegDistance * gpsSpikeDirectRatio { return false }
    return (inDistance + outDistance) / max(directDistance, 0.1) >= gpsSpikeDetourRatio
}

private func removeIsolatedGpsSpikes(_ points: [RawGpsPoint]) -> [RawGpsPoint] {
    var current = points
    for _ in 0..<3 {
        if current.count <= 2 { return current }
        var out: [RawGpsPoint] = [current[0]]
        var removed = false
        for i in 1..<(current.count - 1) {
            let previousAccepted = out[out.count - 1]
            let point = current[i]
            let next = current[i + 1]
            if isIsolatedGpsSpike(previousAccepted, point, next) {
                removed = true
                continue
            }
            out.append(point)
        }
        out.append(current[current.count - 1])
        current = out
        if !removed { return current }
    }
    return current
}

/// Remove isolated GPS spikes and sub-meter jitter. Port of `denoiseGpsPoints`.
public func denoiseGpsPoints(_ points: [RawGpsPoint]) -> [RawGpsPoint] {
    removeIsolatedGpsSpikes(removeCloseGpsJitter(points))
}
