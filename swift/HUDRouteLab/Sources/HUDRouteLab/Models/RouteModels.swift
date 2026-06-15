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

    var timelineSeconds: [Double] {
        guard points.count > 1 else { return points.isEmpty ? [] : [0] }
        let dates = points.compactMap(\.time)
        guard dates.count == points.count,
              zip(dates, dates.dropFirst()).allSatisfy({ $0 <= $1 }) else {
            return evenlyDistributedTimeline
        }
        let duration = dates.last!.timeIntervalSince(dates.first!)
        guard duration > 0, duration <= 86_399 else { return evenlyDistributedTimeline }
        let firstSeconds = dates.first!.timeIntervalSince(Calendar.current.startOfDay(for: dates.first!))
        let start = min(firstSeconds, 86_399 - duration)
        return dates.map { start + $0.timeIntervalSince(dates.first!) }
    }

    var timelineRange: ClosedRange<Double>? {
        guard let first = timelineSeconds.first, let last = timelineSeconds.last else { return nil }
        return first ... last
    }

    func point(at seconds: Double, coordinates: [GeoPoint]? = nil) -> GeoPoint? {
        point(at: seconds, coordinates: coordinates ?? self.coordinates, timelineSeconds: timelineSeconds)
    }

    func point(at seconds: Double, coordinates source: [GeoPoint], timelineSeconds times: [Double]) -> GeoPoint? {
        guard source.count == times.count, let first = source.first else { return nil }
        if seconds <= times[0] { return first }
        if seconds >= times[times.count - 1] { return source.last }
        var low = 1
        var high = times.count - 1
        while low < high {
            let middle = (low + high) / 2
            if times[middle] < seconds {
                low = middle + 1
            } else {
                high = middle
            }
        }
        let duration = times[low] - times[low - 1]
        let fraction = duration > 0 ? (seconds - times[low - 1]) / duration : 0
        return GeoPoint(
            lat: source[low - 1].lat + (source[low].lat - source[low - 1].lat) * fraction,
            lon: source[low - 1].lon + (source[low].lon - source[low - 1].lon) * fraction
        )
    }

    private var evenlyDistributedTimeline: [Double] {
        let denominator = Double(max(1, points.count - 1))
        return points.indices.map { Double($0) / denominator * 86_399 }
    }
}

struct ImportedRouteDocument: Equatable, Sendable {
    var track: ImportedTrack
    var referenceRoads: [Road]
}

struct ImportedVideo: Equatable, Sendable {
    var name: String
    var url: URL
    var duration: Double
    var startSeconds: Double
    var embeddedTimecode: EmbeddedVideoTimecode?

    var timelineRange: ClosedRange<Double> {
        let start = min(86_399, max(0, startSeconds))
        return start ... min(86_399, start + duration)
    }
}

struct EmbeddedVideoTimecode: Equatable, Sendable {
    var seconds: Double
    var fps: Double
    var frameCount: Int32
}

/// Placement of a timeline clip (VIDEO / GEO) using non-linear-editor semantics.
/// `start` is the global timeline second of the clip's in-point; `inset` is how far
/// into the source content the in-point sits; `length` is the active span on the
/// timeline; `sourceDuration` is the full length of the underlying source.
struct ClipPlacement: Equatable, Sendable {
    var start: Double
    var inset: Double
    var length: Double
    var sourceDuration: Double

    static let minLength = 0.5
    static let timelineMax = 86_400.0

    var end: Double { start + length }
    var range: ClosedRange<Double> { start ... (start + length) }

    /// Map a global timeline second to a source-content second (clamped to the source).
    func sourceSeconds(forTimeline seconds: Double) -> Double {
        min(sourceDuration, max(0, inset + (seconds - start)))
    }

    /// Slide the whole clip so its in-point lands on `newStart` (content unchanged).
    func moved(toStart newStart: Double) -> ClipPlacement {
        var copy = self
        copy.start = min(max(0, newStart), Self.timelineMax - length)
        return copy
    }

    /// Trim the head by `delta` seconds (positive shortens). The remaining content
    /// stays anchored in place, so `start` and `inset` move together.
    func trimmedHead(byDelta delta: Double) -> ClipPlacement {
        var copy = self
        let clamped = min(max(delta, max(-start, -inset)), length - Self.minLength)
        copy.start += clamped
        copy.inset += clamped
        copy.length -= clamped
        return copy
    }

    /// Trim the tail by `delta` seconds (positive lengthens), bounded by the source.
    func trimmedTail(byDelta delta: Double) -> ClipPlacement {
        var copy = self
        let maxLength = min(sourceDuration - inset, Self.timelineMax - start)
        copy.length = min(max(length + delta, Self.minLength), maxLength)
        return copy
    }

    func applying(mode: ClipDragMode, delta: Double) -> ClipPlacement {
        switch mode {
        case .move: moved(toStart: start + delta)
        case .trimHead: trimmedHead(byDelta: delta)
        case .trimTail: trimmedTail(byDelta: delta)
        }
    }
}

enum TimelineClipKind: Equatable, Sendable {
    case video
    case geo
}

enum ClipDragMode: Equatable, Sendable {
    case move
    case trimHead
    case trimTail
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
