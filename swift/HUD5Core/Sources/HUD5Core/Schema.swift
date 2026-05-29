import Foundation

/// Gear value: a numeric gear, neutral, or reverse. Mirrors `GearValue`
/// (`number | 'N' | 'R'`) in src/data/schema.ts.
public enum GearValue: Equatable, Sendable {
    case number(Double)
    case neutral  // 'N'
    case reverse  // 'R'
}

/// One telemetry sample indexed by time. Mirrors `TelemetrySample`.
public struct TelemetrySample: Equatable, Sendable {
    public var t: Double
    public var speedKmh: Double
    public var rpm: Double?
    public var rpmMax: Double?
    public var gear: GearValue?
    public var throttle: Double?
    public var brake: Double?
    public var abs: Bool?
    public var tcs: Bool?
    public var progress: Double?
    public var positionCurrent: Double?
    public var positionTotal: Double?

    public init(
        t: Double,
        speedKmh: Double,
        rpm: Double? = nil,
        rpmMax: Double? = nil,
        gear: GearValue? = nil,
        throttle: Double? = nil,
        brake: Double? = nil,
        abs: Bool? = nil,
        tcs: Bool? = nil,
        progress: Double? = nil,
        positionCurrent: Double? = nil,
        positionTotal: Double? = nil
    ) {
        self.t = t
        self.speedKmh = speedKmh
        self.rpm = rpm
        self.rpmMax = rpmMax
        self.gear = gear
        self.throttle = throttle
        self.brake = brake
        self.abs = abs
        self.tcs = tcs
        self.progress = progress
        self.positionCurrent = positionCurrent
        self.positionTotal = positionTotal
    }
}

/// A parsed telemetry stream. Mirrors `TelemetryTrack`.
public struct TelemetryTrack: Equatable, Sendable {
    public var samples: [TelemetrySample]
    public var duration: Double
    public var rpmMax: Double

    public init(samples: [TelemetrySample], duration: Double, rpmMax: Double) {
        self.samples = samples
        self.duration = duration
        self.rpmMax = rpmMax
    }
}

/// A point in the local planar frame (meters) with optional time/elevation.
/// Mirrors `TrackPoint`.
public struct TrackPoint: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var distance: Double
    public var t: Double?
    public var ele: Double?

    public init(x: Double, y: Double, distance: Double, t: Double? = nil, ele: Double? = nil) {
        self.x = x
        self.y = y
        self.distance = distance
        self.t = t
        self.ele = ele
    }
}

/// Track layer category. Mirrors `TrackLayerKind`.
public enum TrackLayerKind: String, Sendable {
    case driven
    case planned
    case reference
}

/// A single polyline layer. Mirrors `TrackLayer`.
public struct TrackLayer: Equatable, Sendable {
    public var kind: TrackLayerKind
    public var name: String?
    public var points: [TrackPoint]
    public var totalLength: Double

    public init(kind: TrackLayerKind, name: String?, points: [TrackPoint], totalLength: Double) {
        self.kind = kind
        self.name = name
        self.points = points
        self.totalLength = totalLength
    }
}

/// A parsed track. `points` is the primary layer used for the player pose.
/// Mirrors `Track`.
public struct Track: Equatable, Sendable {
    public var layers: [TrackLayer]
    public var points: [TrackPoint]
    public var totalLength: Double

    public init(layers: [TrackLayer], points: [TrackPoint], totalLength: Double) {
        self.layers = layers
        self.points = points
        self.totalLength = totalLength
    }
}
