import Foundation
import Observation
import HUD5Core
import HUD5Render

/// Single source of truth for the preview UI — the Swift analogue of the
/// Zustand playback store in src/playback/store.ts. Owns loaded sources, the
/// playhead, and playback flags; the UI reads from it and the tick loop
/// advances it.
@MainActor
@Observable
final class AppModel {
    var telemetry: TelemetryTrack?
    var track: Track?

    var currentTime: Double = 0
    var isPlaying = false
    var rate: Double = 1
    var unit: SpeedUnit = .kmh

    var telemetryOffset: Double = 0
    var trackOffset: Double = 0
    var telemetryTrimStart: Double = 0
    var telemetryTrimEnd: Double = 0

    var telemetryName: String?
    var trackName: String?
    var lastError: String?

    /// End of the shared timeline (max of source durations), min 1s.
    var duration: Double {
        max(telemetry?.duration ?? 0, track?.points.last?.t ?? 0, 1)
    }

    private var builder: FrameStateBuilder {
        FrameStateBuilder(
            telemetry: telemetry,
            track: track,
            unit: unit,
            telemetryOffset: telemetryOffset,
            trackOffset: trackOffset,
            telemetryTrimStart: telemetryTrimStart,
            telemetryTrimEnd: telemetryTrimEnd,
            rangeStart: 0
        )
    }

    func frameState() -> FrameState {
        builder.state(at: currentTime)
    }

    // MARK: Loading

    func loadTelemetry(url: URL) {
        guard let text = try? String(contentsOf: url, encoding: .utf8) else {
            lastError = "Could not read \(url.lastPathComponent)"
            return
        }
        let lower = url.pathExtension.lowercased()
        telemetry = lower == "json" ? parseTelemetryJson(text) : parseTelemetryCsv(text)
        telemetryName = url.lastPathComponent
        clampPlayhead()
    }

    func loadTrack(url: URL, snapMaxDist: Double = 0) {
        guard let text = try? String(contentsOf: url, encoding: .utf8) else {
            lastError = "Could not read \(url.lastPathComponent)"
            return
        }
        let opts = TrackParseOptions(snap: snapMaxDist > 0 ? .init(enabled: true, maxDistM: snapMaxDist) : nil)
        let lower = url.pathExtension.lowercased()
        track = (lower == "geojson" || lower == "json")
            ? parseGeoJson(text, options: opts)
            : parseGpx(text, options: opts)
        trackName = url.lastPathComponent
        clampPlayhead()
    }

    // MARK: Transport

    func togglePlay() { isPlaying.toggle() }
    func seek(to t: Double) { currentTime = min(max(t, 0), duration) }

    private func clampPlayhead() {
        currentTime = min(currentTime, duration)
    }

    /// Advance the playhead by `dt` seconds when playing (no-video time source,
    /// mirroring the rAF loop in src/playback/store.ts). Loops at the end.
    func tick(dt: Double) {
        guard isPlaying else { return }
        var next = currentTime + dt * rate
        if next >= duration {
            next = 0
        }
        currentTime = next
    }
}
