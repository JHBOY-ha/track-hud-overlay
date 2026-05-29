import Foundation

/// Options controlling track ingestion. Mirrors `TrackParseOptions`.
public struct TrackParseOptions: Sendable {
    public struct Snap: Sendable {
        public var enabled: Bool
        public var maxDistM: Double
        public init(enabled: Bool, maxDistM: Double) {
            self.enabled = enabled
            self.maxDistM = maxDistM
        }
    }
    public var snap: Snap?
    public var coordinateSystem: CoordinateSystem

    public init(snap: Snap? = nil, coordinateSystem: CoordinateSystem = .wgs84) {
        self.snap = snap
        self.coordinateSystem = coordinateSystem
    }
}

// MARK: - Intermediate GeoJSON-like model

/// A geometry feature reduced to the fields the track pipeline needs.
/// GPX and GeoJSON front-ends both produce these, mirroring how the TS code
/// funnels GPX through @tmcw/togeojson into a GeoJSON FeatureCollection.
struct GeoFeature {
    /// One entry per segment (LineString → 1, MultiLineString → many).
    /// Each coordinate is [lon, lat] or [lon, lat, ele].
    var segments: [[[Double]]]
    var gpxType: String?      // "trk" | "rte" | nil
    var name: String?
    var explicitKind: String? // properties.kind / properties.type
    /// Flat time strings across all segments (coordinateProperties.times).
    var times: [String]?
}

private struct RawPoint {
    var lon: Double
    var lat: Double
    var t: Double?
    var ele: Double?
}

private struct RawLayer {
    var kind: TrackLayerKind
    var name: String?
    var points: [RawPoint]
}

private func classifyKind(explicitKind: String?, name: String?, gpxType: String?) -> TrackLayerKind {
    if gpxType == "rte" { return .planned }
    let explicit = (explicitKind ?? "").lowercased()
    if explicit == "driven" { return .driven }
    if explicit == "planned" { return .planned }
    if explicit == "reference" { return .reference }
    let lower = (name ?? "").lowercased()
    if lower.range(of: #"(^|\b)(ref|reference|bg|background|ghost)\b"#, options: .regularExpression) != nil {
        return .reference
    }
    if lower.range(of: #"(^|\b)(planned|route|plan)\b"#, options: .regularExpression) != nil {
        return .planned
    }
    return .driven
}

// MARK: - Time parsing

// Read-only after construction; ISO8601DateFormatter.date(from:) is safe to
// call concurrently in practice, so opt out of the Sendable check.
nonisolated(unsafe) private let isoWithFraction: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()

nonisolated(unsafe) private let isoPlain: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    return f
}()

/// Parse an ISO-8601 timestamp to epoch milliseconds, or nil. Mirrors
/// `Date.parse(ts)` for the timestamp shapes GPX emits.
private func parseEpochMs(_ ts: String) -> Double? {
    if let d = isoWithFraction.date(from: ts) { return d.timeIntervalSince1970 * 1000 }
    if let d = isoPlain.date(from: ts) { return d.timeIntervalSince1970 * 1000 }
    return nil
}

// MARK: - Raw layer assembly

private func rawLayersFromFeatures(_ features: [GeoFeature], denoiseGps: Bool) -> [RawLayer] {
    struct EpochPoint { var lon: Double; var lat: Double; var ele: Double?; var tMs: Double? }
    struct EpochLayer { var kind: TrackLayerKind; var name: String?; var points: [EpochPoint] }

    // Denoise while preserving ele/time alongside lon/lat.
    func denoiseEpoch(_ pts: [EpochPoint]) -> [EpochPoint] {
        let raw = pts.map { RawGpsPoint(lon: $0.lon, lat: $0.lat, t: $0.tMs, ele: $0.ele) }
        let cleaned = denoiseGpsPoints(raw)
        return cleaned.map { EpochPoint(lon: $0.lon, lat: $0.lat, ele: $0.ele, tMs: $0.t) }
    }

    var epochLayers: [EpochLayer] = []

    for feature in features {
        let kind = classifyKind(explicitKind: feature.explicitKind, name: feature.name, gpxType: feature.gpxType)
        let shouldDenoise = denoiseGps || feature.gpxType == "trk" || feature.gpxType == "rte"

        var base = 0
        for seg in feature.segments {
            var pts: [EpochPoint] = []
            pts.reserveCapacity(seg.count)
            for (i, c) in seg.enumerated() {
                let ts = feature.times.flatMap { idx -> String? in
                    let k = base + i
                    return k < idx.count ? idx[k] : nil
                }
                let ms = ts.flatMap(parseEpochMs)
                let ele = c.count > 2 ? c[2] : Double.nan
                pts.append(EpochPoint(
                    lon: c[0],
                    lat: c[1],
                    ele: ele.isFinite ? ele : nil,
                    tMs: ms
                ))
            }
            let denoised = shouldDenoise ? denoiseEpoch(pts) : pts
            epochLayers.append(EpochLayer(kind: kind, name: feature.name, points: denoised))
            base += seg.count
        }
    }

    // Anchor = local midnight of the earliest timestamp across all layers.
    var firstMs: Double?
    for l in epochLayers {
        for p in l.points {
            if let ms = p.tMs, firstMs == nil || ms < firstMs! { firstMs = ms }
        }
    }
    var anchorMs = 0.0
    if let firstMs {
        let d = Date(timeIntervalSince1970: firstMs / 1000)
        anchorMs = Calendar.current.startOfDay(for: d).timeIntervalSince1970 * 1000
    }

    return epochLayers.compactMap { l in
        let points = l.points.map { p in
            RawPoint(
                lon: p.lon,
                lat: p.lat,
                t: p.tMs.map { ($0 - anchorMs) / 1000 },
                ele: p.ele
            )
        }
        return points.isEmpty ? nil : RawLayer(kind: l.kind, name: l.name, points: points)
    }
}

private func buildLayer(_ raw: RawLayer, _ projected: [NormalizedPoint]) -> TrackLayer {
    var totalLength = 0.0
    var points: [TrackPoint] = []
    points.reserveCapacity(projected.count)
    for (i, p) in projected.enumerated() {
        if i > 0 {
            let dx = p.x - projected[i - 1].x
            let dy = p.y - projected[i - 1].y
            totalLength += (dx * dx + dy * dy).squareRoot()
        }
        points.append(TrackPoint(
            x: p.x,
            y: p.y,
            distance: totalLength,
            t: raw.points[i].t,
            ele: raw.points[i].ele
        ))
    }
    return TrackLayer(kind: raw.kind, name: raw.name, points: points, totalLength: totalLength)
}

private func pickPrimary(_ layers: [TrackLayer]) -> TrackLayer {
    layers.first(where: { $0.kind == .driven })
        ?? layers.first(where: { $0.kind == .planned })
        ?? layers[0]
}

private func toTrack(_ rawLayers: [RawLayer], _ opts: TrackParseOptions) -> Track {
    if rawLayers.isEmpty {
        return Track(layers: [], points: [], totalLength: 0)
    }
    let inputGroups = rawLayers.map { l in l.points.map { LonLat(lon: $0.lon, lat: $0.lat) } }
    let wgs84Groups = convertLonLatLayersToWgs84(inputGroups, source: opts.coordinateSystem)
    // Carry t/ele alongside the (possibly converted) lon/lat.
    let normalizedRawLayers: [RawLayer] = rawLayers.enumerated().map { (i, raw) in
        var copy = raw
        copy.points = zip(raw.points, wgs84Groups[i]).map { (orig, ll) in
            RawPoint(lon: ll.lon, lat: ll.lat, t: orig.t, ele: orig.ele)
        }
        return copy
    }
    let projectedGroups = projectLonLatLayers(wgs84Groups)

    var processed = projectedGroups
    if let snap = opts.snap, snap.enabled, snap.maxDistM > 0 {
        let refIndices = normalizedRawLayers.indices.filter { normalizedRawLayers[$0].kind == .reference }
        if !refIndices.isEmpty {
            let segments = buildSegments(refIndices.map { projectedGroups[$0] })
            processed = projectedGroups.enumerated().map { (i, g) in
                normalizedRawLayers[i].kind == .driven
                    ? snapPointsToSegments(g, segments, snap.maxDistM)
                    : g
            }
        }
    }

    let layers = normalizedRawLayers.enumerated().map { (i, raw) in buildLayer(raw, processed[i]) }
    let primary = pickPrimary(layers)
    return Track(layers: layers, points: primary.points, totalLength: primary.totalLength)
}

// MARK: - Public parsers

/// Parse GPX text into a Track. Port of `parseGpx` from src/data/track.ts.
public func parseGpx(_ text: String, options: TrackParseOptions = TrackParseOptions()) -> Track {
    let features = GpxParser.parse(text)
    return toTrack(rawLayersFromFeatures(features, denoiseGps: true), options)
}

/// Parse GeoJSON text into a Track. Port of `parseGeoJson`.
public func parseGeoJson(_ text: String, options: TrackParseOptions = TrackParseOptions()) -> Track {
    guard let data = text.data(using: .utf8),
          let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        return Track(layers: [], points: [], totalLength: 0)
    }
    let features = geoFeaturesFromGeoJson(root)
    return toTrack(rawLayersFromFeatures(features, denoiseGps: false), options)
}

private func geoFeaturesFromGeoJson(_ root: [String: Any]) -> [GeoFeature] {
    let rawFeatures = (root["features"] as? [[String: Any]]) ?? []
    var out: [GeoFeature] = []
    for feature in rawFeatures {
        guard let geometry = feature["geometry"] as? [String: Any],
              let type = geometry["type"] as? String else { continue }
        let props = (feature["properties"] as? [String: Any]) ?? [:]
        let name = props["name"] as? String
        let explicitKind = (props["kind"] as? String) ?? (props["type"] as? String)
        let gpxType = props["_gpxType"] as? String
        let times = (props["coordinateProperties"] as? [String: Any])?["times"] as? [String]

        var segments: [[[Double]]] = []
        if type == "LineString", let coords = geometry["coordinates"] as? [[Double]] {
            segments = [coords]
        } else if type == "MultiLineString", let coords = geometry["coordinates"] as? [[[Double]]] {
            segments = coords
        } else {
            continue
        }
        out.append(GeoFeature(segments: segments, gpxType: gpxType, name: name, explicitKind: explicitKind, times: times))
    }
    return out
}

// MARK: - Pose sampling

/// A position + heading along a track. Mirrors `TrackPose`.
public struct TrackPose: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var headingRad: Double
    public var ele: Double?

    public init(x: Double, y: Double, headingRad: Double, ele: Double? = nil) {
        self.x = x
        self.y = y
        self.headingRad = headingRad
        self.ele = ele
    }
}

/// Sample position/heading by time (if the track has timestamps) or by
/// progress fraction. Port of `poseAt` from src/data/track.ts.
public func poseAt(
    _ track: Track,
    time: Double? = nil,
    progress: Double? = nil,
    trimStart: Double = 0,
    trimEnd: Double = 0
) -> TrackPose? {
    let points = track.points
    if points.isEmpty { return nil }

    let hasTime = points[0].t != nil

    if hasTime, let time {
        let firstT = points[0].t! + trimStart
        let lastT = points[points.count - 1].t! - trimEnd
        if time < firstT || time > lastT { return nil }
    }

    var idx = 0
    var f = 0.0

    if hasTime, let t = time {
        if t <= points[0].t! {
            idx = 0; f = 0
        } else if t >= points[points.count - 1].t! {
            idx = points.count - 2; f = 1
        } else {
            var lo = 0, hi = points.count - 1
            while hi - lo > 1 {
                let mid = (lo + hi) >> 1
                if (points[mid].t ?? 0) <= t { lo = mid } else { hi = mid }
            }
            idx = lo
            let a = points[idx], b = points[idx + 1]
            let denom = (b.t! - a.t!)
            f = (t - a.t!) / (denom == 0 ? 1 : denom)
        }
    } else {
        let p = clamp(progress ?? 0, 0, 1)
        let targetDist = p * track.totalLength
        if points.count < 2 {
            return TrackPose(x: points[0].x, y: points[0].y, headingRad: 0, ele: points[0].ele)
        }
        var lo = 0, hi = points.count - 1
        while hi - lo > 1 {
            let mid = (lo + hi) >> 1
            if points[mid].distance <= targetDist { lo = mid } else { hi = mid }
        }
        idx = lo
        let a = points[idx], b = points[idx + 1]
        let denom = (b.distance - a.distance)
        f = (targetDist - a.distance) / (denom == 0 ? 1 : denom)
    }

    let a = points[idx]
    let b = points[min(idx + 1, points.count - 1)]
    let x = a.x + (b.x - a.x) * f
    let y = a.y + (b.y - a.y) * f

    // Heading uses a wider baseline (~HEADING_BASELINE_M ahead/behind current
    // position) so dense, noisy GPS sampling doesn't make rotation step
    // segment-by-segment on large-radius sweepers.
    let headingBaselineM = 8.0
    let curDist = a.distance + (b.distance - a.distance) * f
    var bi = idx + 1
    while bi < points.count - 1 && points[bi].distance - curDist < headingBaselineM { bi += 1 }
    var ai = idx
    while ai > 0 && curDist - points[ai].distance < headingBaselineM { ai -= 1 }
    let front = points[bi]
    let back = points[ai]
    let heading = atan2(front.x - back.x, -(front.y - back.y)) // 0 = north, CW

    let ele: Double?
    if let ae = a.ele, let be = b.ele {
        ele = ae + (be - ae) * f
    } else {
        ele = a.ele ?? b.ele
    }
    return TrackPose(x: x, y: y, headingRad: heading, ele: ele)
}
