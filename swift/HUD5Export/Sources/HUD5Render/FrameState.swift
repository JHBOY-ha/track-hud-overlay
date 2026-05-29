import Foundation
import HUD5Core

/// Everything the renderer needs to draw a single HUD frame. Computed from the
/// telemetry/track stores at a given playhead time, mirroring the inputs the
/// React `<Hud>` component derives in src/hud/Hud.tsx.
public struct FrameState: Sendable {
    public var unit: SpeedUnit
    public var rpmMax: Double
    public var elapsed: Double

    public var sample: TelemetrySample?
    public var pose: TrackPose?

    /// Whole projected track (primary layer) for the minimap, with its bounds.
    public var trackPoints: [TrackPoint]

    public init(
        unit: SpeedUnit,
        rpmMax: Double,
        elapsed: Double,
        sample: TelemetrySample?,
        pose: TrackPose?,
        trackPoints: [TrackPoint]
    ) {
        self.unit = unit
        self.rpmMax = rpmMax
        self.elapsed = elapsed
        self.sample = sample
        self.pose = pose
        self.trackPoints = trackPoints
    }
}

/// Inputs for building per-frame state across an export. Holds parsed sources
/// and the offsets/trims the playback store would otherwise apply.
public struct FrameStateBuilder: Sendable {
    public var telemetry: TelemetryTrack?
    public var track: Track?
    public var unit: SpeedUnit
    public var telemetryOffset: Double
    public var trackOffset: Double
    public var telemetryTrimStart: Double
    public var telemetryTrimEnd: Double
    public var rangeStart: Double

    public init(
        telemetry: TelemetryTrack?,
        track: Track?,
        unit: SpeedUnit = .kmh,
        telemetryOffset: Double = 0,
        trackOffset: Double = 0,
        telemetryTrimStart: Double = 0,
        telemetryTrimEnd: Double = 0,
        rangeStart: Double = 0
    ) {
        self.telemetry = telemetry
        self.track = track
        self.unit = unit
        self.telemetryOffset = telemetryOffset
        self.trackOffset = trackOffset
        self.telemetryTrimStart = telemetryTrimStart
        self.telemetryTrimEnd = telemetryTrimEnd
        self.rangeStart = rangeStart
    }

    /// Build the frame state at an absolute playhead time on the shared axis.
    public func state(at currentTime: Double) -> FrameState {
        let sample = telemetry.flatMap {
            sampleAt($0, currentTime - telemetryOffset, trimStart: telemetryTrimStart, trimEnd: telemetryTrimEnd)
        }
        let pose: TrackPose?
        if let track {
            let trackTime = currentTime - trackOffset
            let hasTime = track.points.first?.t != nil
            if hasTime {
                pose = poseAt(track, time: trackTime)
            } else {
                pose = poseAt(track, progress: sample?.progress)
            }
        } else {
            pose = nil
        }
        return FrameState(
            unit: unit,
            rpmMax: telemetry?.rpmMax ?? 8000,
            elapsed: currentTime - rangeStart,
            sample: sample,
            pose: pose,
            trackPoints: track?.points ?? []
        )
    }
}
