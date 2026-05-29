import Foundation

/// Allowed project frame rates. Mirrors `PROJECT_FPS_OPTIONS` in src/util/timecode.ts.
public let projectFpsOptions: [Int] = [24, 30, 48, 60, 120]

/// Port of `normalizeProjectFps` from src/util/timecode.ts.
public func normalizeProjectFps(_ fps: Int) -> Int {
    projectFpsOptions.contains(fps) ? fps : 60
}

private func pad2(_ n: Int) -> String {
    String(format: "%02d", n)
}

private func padLeft(_ value: Int, width: Int) -> String {
    let s = String(value)
    if s.count >= width { return s }
    return String(repeating: "0", count: width - s.count) + s
}

/// Format seconds as non-drop-frame timecode (HH:MM:SS:FF). Frame field width
/// follows the fps (e.g. 120fps uses 3 digits). Port of `formatTimecode`.
public func formatTimecode(_ seconds: Double, fps: Double) -> String {
    guard seconds.isFinite else { return "--:--:--:--" }

    let normalizedFps = normalizeProjectFps(Int((fps).rounded()))
    let sign = seconds < 0 ? "-" : ""
    let totalFrames = Int((abs(seconds) * Double(normalizedFps)).rounded())
    let framesPerHour = normalizedFps * 3600
    let framesPerMinute = normalizedFps * 60

    let hh = totalFrames / framesPerHour
    let afterHours = totalFrames % framesPerHour
    let mm = afterHours / framesPerMinute
    let afterMinutes = afterHours % framesPerMinute
    let ss = afterMinutes / normalizedFps
    let ff = afterMinutes % normalizedFps
    let frameDigits = String(normalizedFps - 1).count

    return "\(sign)\(pad2(hh)):\(pad2(mm)):\(pad2(ss)):\(padLeft(ff, width: frameDigits))"
}
