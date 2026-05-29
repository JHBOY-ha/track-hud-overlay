import Foundation
import HUD5Core
import HUD5Render

// hud5-export — render a transparent HUD video natively (AVFoundation ProRes
// 4444 alpha), replacing the Puppeteer + FFmpeg pipeline.
//
// Usage:
//   hud5-export --telemetry t.csv --track track.gpx --out out.mov \
//               [--fps 60] [--duration 10] [--unit kmh|mph] \
//               [--start 0] [--width 1920] [--height 1080] \
//               [--telemetry-offset 0] [--track-offset 0] [--snap 0]

struct Args {
    var telemetry: String?
    var track: String?
    var out = "out.mov"
    var fps = 60
    var duration: Double?
    var start = 0.0
    var unit: SpeedUnit = .kmh
    var width = 1920
    var height = 1080
    var telemetryOffset = 0.0
    var trackOffset = 0.0
    var snapMaxDist = 0.0
}

func parseArgs() -> Args {
    var a = Args()
    var it = CommandLine.arguments.dropFirst().makeIterator()
    func next() -> String? { it.next() }
    while let flag = next() {
        switch flag {
        case "--telemetry": a.telemetry = next()
        case "--track": a.track = next()
        case "--out": a.out = next() ?? a.out
        case "--fps": a.fps = next().flatMap(Int.init) ?? a.fps
        case "--duration": a.duration = next().flatMap(Double.init)
        case "--start": a.start = next().flatMap(Double.init) ?? a.start
        case "--unit": a.unit = next() == "mph" ? .mph : .kmh
        case "--width": a.width = next().flatMap(Int.init) ?? a.width
        case "--height": a.height = next().flatMap(Int.init) ?? a.height
        case "--telemetry-offset": a.telemetryOffset = next().flatMap(Double.init) ?? 0
        case "--track-offset": a.trackOffset = next().flatMap(Double.init) ?? 0
        case "--snap": a.snapMaxDist = next().flatMap(Double.init) ?? 0
        case "-h", "--help":
            printUsage(); exit(0)
        default:
            FileHandle.standardError.write(Data("unknown flag: \(flag)\n".utf8))
            printUsage(); exit(2)
        }
    }
    return a
}

func printUsage() {
    print("""
    hud5-export --out out.mov [options]
      --telemetry <path>     CSV or JSON telemetry
      --track <path>         GPX or GeoJSON track
      --out <path>           output .mov (ProRes 4444, alpha)  [out.mov]
      --fps <n>              frames per second                  [60]
      --duration <sec>       export length; default = source duration
      --start <sec>          playhead start on shared axis      [0]
      --unit kmh|mph         speed unit                          [kmh]
      --width/--height <px>  stage size                          [1920x1080]
      --telemetry-offset <s> telemetry time offset               [0]
      --track-offset <s>     track time offset                   [0]
      --snap <m>             snap driven onto reference (0=off)  [0]
    """)
}

func readFile(_ path: String) -> String? {
    try? String(contentsOf: URL(fileURLWithPath: path), encoding: .utf8)
}

func loadTelemetry(_ path: String) -> TelemetryTrack? {
    guard let text = readFile(path) else {
        FileHandle.standardError.write(Data("cannot read telemetry: \(path)\n".utf8)); return nil
    }
    let lower = path.lowercased()
    return lower.hasSuffix(".json") ? parseTelemetryJson(text) : parseTelemetryCsv(text)
}

func loadTrack(_ path: String, snapMaxDist: Double) -> Track? {
    guard let text = readFile(path) else {
        FileHandle.standardError.write(Data("cannot read track: \(path)\n".utf8)); return nil
    }
    let opts = TrackParseOptions(
        snap: snapMaxDist > 0 ? .init(enabled: true, maxDistM: snapMaxDist) : nil
    )
    let lower = path.lowercased()
    return lower.hasSuffix(".geojson") || lower.hasSuffix(".json")
        ? parseGeoJson(text, options: opts)
        : parseGpx(text, options: opts)
}

// MARK: - Run

let args = parseArgs()

let telemetry = args.telemetry.flatMap(loadTelemetry)
let track = args.track.flatMap { loadTrack($0, snapMaxDist: args.snapMaxDist) }

if telemetry == nil && track == nil {
    FileHandle.standardError.write(Data("nothing to render: provide --telemetry and/or --track\n".utf8))
    exit(2)
}

// Determine duration from sources if not given.
let sourceDuration = max(telemetry?.duration ?? 0, track?.points.last?.t ?? 0)
let duration = args.duration ?? (sourceDuration > 0 ? sourceDuration : 5)
let totalFrames = max(1, Int((duration * Double(args.fps)).rounded()))

let builder = FrameStateBuilder(
    telemetry: telemetry,
    track: track,
    unit: args.unit,
    telemetryOffset: args.telemetryOffset,
    trackOffset: args.trackOffset,
    rangeStart: args.start
)

let outURL = URL(fileURLWithPath: args.out)
FileHandle.standardError.write(Data(
    "rendering \(totalFrames) frames @ \(args.fps)fps (\(String(format: "%.2f", duration))s) → \(args.out)\n".utf8))

do {
    let writer = try ProResWriter(url: outURL, width: args.width, height: args.height, fps: args.fps)
    let frameDuration = 1.0 / Double(args.fps)
    var lastPct = -1
    for frame in 0..<totalFrames {
        let t = args.start + Double(frame) * frameDuration
        let state = builder.state(at: t)
        try writer.append(frameIndex: frame) { ctx in
            HudRenderer.draw(state, in: ctx, width: CGFloat(args.width), height: CGFloat(args.height))
        }
        let pct = (frame + 1) * 100 / totalFrames
        if pct != lastPct {
            lastPct = pct
            FileHandle.standardError.write(Data("\rprogress: \(pct)%".utf8))
        }
    }
    try writer.finish()
    FileHandle.standardError.write(Data("\ndone: \(args.out)\n".utf8))
} catch {
    FileHandle.standardError.write(Data("\nexport failed: \(error)\n".utf8))
    exit(1)
}
