import Foundation
import AVFoundation
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

    @ObservationIgnored
    var videoPlayer: AVPlayer?

    var videoDuration: Double = 0
    var telemetryOffset: Double = 0
    var trackOffset: Double = 0
    var telemetryTrimStart: Double = 0
    var telemetryTrimEnd: Double = 0

    var videoName: String?
    var telemetryName: String?
    var trackName: String?
    var lastError: String?

    /// Start of the shared absolute timeline. Sample files use local seconds
    /// from midnight, so the preview should begin at the first source time
    /// instead of at zero.
    var timelineStart: Double {
        var starts: [Double] = []
        if let first = telemetry?.samples.first?.t { starts.append(first + telemetryOffset) }
        if let first = track?.points.first?.t { starts.append(first + trackOffset) }
        return starts.min() ?? 0
    }

    /// End of the shared timeline (max of source durations), min 1s.
    var duration: Double {
        let sourceEnd = max(
            telemetry.map { $0.duration + telemetryOffset } ?? 0,
            track?.points.last?.t.map { $0 + trackOffset } ?? 0
        )
        let videoEnd = videoDuration > 0 ? timelineStart + videoDuration : 0
        return max(sourceEnd, videoEnd, timelineStart + 1)
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

    func loadVideo(url: URL) {
        let asset = AVURLAsset(url: url)
        let item = AVPlayerItem(asset: asset)
        videoPlayer = AVPlayer(playerItem: item)
        videoPlayer?.actionAtItemEnd = .pause
        videoName = url.lastPathComponent
        videoDuration = 0
        clampPlayhead()

        Task { @MainActor in
            let loaded = try? await asset.load(.duration).seconds
            guard videoName == url.lastPathComponent, let loaded, loaded.isFinite, loaded > 0 else { return }
            videoDuration = loaded
            clampPlayhead()
        }
    }

    // MARK: Transport

    func togglePlay() {
        isPlaying.toggle()
        if let videoPlayer {
            if isPlaying {
                if currentTime >= duration { seek(to: timelineStart) }
                videoPlayer.rate = Float(rate)
            } else {
                videoPlayer.pause()
            }
        }
    }

    func seek(to t: Double) {
        let clamped = min(max(t, timelineStart), duration)
        currentTime = clamped
        if let videoPlayer {
            let videoSeconds = max(0, clamped - timelineStart)
            videoPlayer.seek(to: CMTime(seconds: videoSeconds, preferredTimescale: 600))
        }
    }

    private func clampPlayhead() {
        if currentTime < timelineStart || currentTime > duration {
            seek(to: timelineStart)
        } else {
            seek(to: currentTime)
        }
    }

    /// Sync from AVPlayer when present; otherwise advance the internal
    /// no-video playhead. Loops at the end of the shared timeline.
    func tick(dt: Double) {
        if let videoPlayer {
            let seconds = videoPlayer.currentTime().seconds
            if seconds.isFinite {
                currentTime = min(max(timelineStart + seconds, timelineStart), duration)
            }
            if isPlaying, currentTime >= duration {
                seek(to: timelineStart)
                videoPlayer.rate = Float(rate)
            }
            return
        }

        guard isPlaying else { return }
        var next = currentTime + dt * rate
        if next >= duration {
            next = timelineStart
        }
        currentTime = next
    }
}
