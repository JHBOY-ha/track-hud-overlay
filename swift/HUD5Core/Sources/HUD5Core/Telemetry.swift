import Foundation

private let defaultRpmMax = 8000.0

/// JS `Number(x)`-style coercion: trims, returns nil for empty/non-finite.
/// An empty string in JS coerces to 0, but the telemetry parser treats
/// undefined/null/"" uniformly via `num`, so we map "" -> nil here.
private func num(_ raw: String?) -> Double? {
    guard let raw, !raw.isEmpty else { return nil }
    let s = raw.trimmingCharacters(in: .whitespaces)
    if s.isEmpty { return nil }
    guard let n = Double(s), n.isFinite else { return nil }
    return n
}

private func parseGear(_ raw: String?) -> GearValue? {
    guard let raw, !raw.isEmpty else { return nil }
    let s = raw.trimmingCharacters(in: .whitespaces).uppercased()
    if s == "N" { return .neutral }
    if s == "R" { return .reverse }
    guard let n = Double(s), n.isFinite else { return nil }
    return .number(n)
}

private func bool(_ raw: String?) -> Bool? {
    guard let raw, !raw.isEmpty else { return nil }
    let s = raw.trimmingCharacters(in: .whitespaces).lowercased()
    if s == "1" || s == "true" || s == "yes" { return true }
    if s == "0" || s == "false" || s == "no" { return false }
    return nil
}

/// Port of `parseTelemetryCsv` from src/data/telemetry.ts.
public func parseTelemetryCsv(_ text: String) -> TelemetryTrack {
    let rows = CSV.parseObjects(text)
    var samples: [TelemetrySample] = []
    var rpmMax = defaultRpmMax

    for row in rows {
        guard let t = num(row["t"]) else { continue }
        guard let speed = num(row["speed_kmh"]) ?? num(row["speed"]) else { continue }
        let s = TelemetrySample(
            t: t,
            speedKmh: speed,
            rpm: num(row["rpm"]),
            rpmMax: num(row["rpm_max"]),
            gear: parseGear(row["gear"]),
            throttle: num(row["throttle"]),
            brake: num(row["brake"]),
            abs: bool(row["abs"]),
            tcs: bool(row["tcs"]),
            progress: num(row["progress"]),
            positionCurrent: num(row["position_current"]),
            positionTotal: num(row["position_total"])
        )
        if let rm = s.rpmMax, rm != 0 { rpmMax = rm }
        samples.append(s)
    }

    samples.sort { $0.t < $1.t }
    let duration = samples.last?.t ?? 0
    return TelemetryTrack(samples: samples, duration: duration, rpmMax: rpmMax)
}

/// JSON-value coercion mirroring JS `Number(x)`: accepts numbers and numeric
/// strings, returns nil for null/missing/non-finite.
private func jsonNum(_ value: Any?) -> Double? {
    switch value {
    case let n as Double: return n.isFinite ? n : nil
    case let n as Int: return Double(n)
    case let n as NSNumber: let d = n.doubleValue; return d.isFinite ? d : nil
    case let s as String: return num(s)
    default: return nil
    }
}

private func jsonGear(_ value: Any?) -> GearValue? {
    switch value {
    case let s as String: return parseGear(s)
    case let n as NSNumber: return .number(n.doubleValue)
    default: return nil
    }
}

private func jsonBool(_ value: Any?) -> Bool? {
    if let b = value as? Bool { return b }
    if let s = value as? String { return bool(s) }
    return nil
}

private func firstNonNil(_ dict: [String: Any], _ keys: [String]) -> Any? {
    for k in keys {
        if let v = dict[k], !(v is NSNull) { return v }
    }
    return nil
}

/// Port of `parseTelemetryJson` from src/data/telemetry.ts. Accepts a top-level
/// array or an object with a `samples` array; tolerant of camelCase and
/// snake_case keys.
public func parseTelemetryJson(_ text: String) -> TelemetryTrack {
    guard let data = text.data(using: .utf8),
          let root = try? JSONSerialization.jsonObject(with: data) else {
        return TelemetryTrack(samples: [], duration: 0, rpmMax: defaultRpmMax)
    }

    let arr: [[String: Any]]
    if let a = root as? [[String: Any]] {
        arr = a
    } else if let obj = root as? [String: Any], let s = obj["samples"] as? [[String: Any]] {
        arr = s
    } else {
        arr = []
    }

    var samples: [TelemetrySample] = []
    for r in arr {
        guard let t = jsonNum(r["t"]) else { continue }
        guard let speed = jsonNum(firstNonNil(r, ["speedKmh", "speed_kmh", "speed"])) else { continue }
        let s = TelemetrySample(
            t: t,
            speedKmh: speed,
            rpm: jsonNum(r["rpm"]),
            rpmMax: jsonNum(firstNonNil(r, ["rpmMax", "rpm_max"])),
            gear: jsonGear(r["gear"]),
            throttle: jsonNum(r["throttle"]),
            brake: jsonNum(r["brake"]),
            abs: jsonBool(r["abs"]),
            tcs: jsonBool(r["tcs"]),
            progress: jsonNum(r["progress"]),
            positionCurrent: jsonNum(firstNonNil(r, ["positionCurrent", "position_current"])),
            positionTotal: jsonNum(firstNonNil(r, ["positionTotal", "position_total"]))
        )
        samples.append(s)
    }

    samples.sort { $0.t < $1.t }
    let duration = samples.last?.t ?? 0
    let rpmMax = samples.first(where: { ($0.rpmMax ?? 0) != 0 })?.rpmMax ?? defaultRpmMax
    return TelemetryTrack(samples: samples, duration: duration, rpmMax: rpmMax)
}

/// Locate the index whose sample time brackets `t` from below. Mirrors the
/// binary search in src/data/telemetry.ts.
private func findIndex(_ samples: [TelemetrySample], _ t: Double) -> Int {
    if samples.isEmpty { return -1 }
    if t <= samples[0].t { return 0 }
    if t >= samples[samples.count - 1].t { return samples.count - 1 }
    var lo = 0
    var hi = samples.count - 1
    while hi - lo > 1 {
        let mid = (lo + hi) >> 1
        if samples[mid].t <= t { lo = mid } else { hi = mid }
    }
    return lo
}

private func lerpOpt(_ a: Double?, _ b: Double?, _ f: Double) -> Double? {
    if a == nil && b == nil { return nil }
    if a == nil { return b }
    if b == nil { return a }
    return lerp(a!, b!, f)
}

/// Interpolate a sample at time `t`, honoring trim. Returns nil when outside
/// the trimmed range. Port of `sampleAt` from src/data/telemetry.ts.
public func sampleAt(
    _ track: TelemetryTrack,
    _ t: Double,
    trimStart: Double = 0,
    trimEnd: Double = 0
) -> TelemetrySample? {
    let samples = track.samples
    if samples.isEmpty { return nil }
    let firstT = samples[0].t + trimStart
    let lastT = samples[samples.count - 1].t - trimEnd
    if t < firstT || t > lastT { return nil }
    let i = findIndex(samples, t)
    let a = samples[i]
    let b = samples[min(i + 1, samples.count - 1)]
    if i == min(i + 1, samples.count - 1) || b.t == a.t { return a }
    let f = (t - a.t) / (b.t - a.t)
    return TelemetrySample(
        t: t,
        speedKmh: lerp(a.speedKmh, b.speedKmh, f),
        rpm: lerpOpt(a.rpm, b.rpm, f),
        rpmMax: a.rpmMax ?? b.rpmMax,
        gear: a.gear,
        throttle: lerpOpt(a.throttle, b.throttle, f),
        brake: lerpOpt(a.brake, b.brake, f),
        abs: a.abs,
        tcs: a.tcs,
        progress: lerpOpt(a.progress, b.progress, f),
        positionCurrent: a.positionCurrent,
        positionTotal: a.positionTotal ?? b.positionTotal
    )
}
