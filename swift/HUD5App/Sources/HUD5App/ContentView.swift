import SwiftUI
import UniformTypeIdentifiers
import HUD5Core

struct ContentView: View {
    @State private var model = AppModel()
    // ~60Hz tick for the no-video time source.
    private let tick = Timer.publish(every: 1.0 / 60.0, on: .main, in: .common).autoconnect()
    @State private var lastTickDate = Date()

    var body: some View {
        VStack(spacing: 0) {
            preview
            Divider()
            transport
        }
        .frame(minWidth: 960, minHeight: 600)
        .onReceive(tick) { now in
            let dt = now.timeIntervalSince(lastTickDate)
            lastTickDate = now
            model.tick(dt: dt)
        }
    }

    private var preview: some View {
        ZStack {
            if model.videoPlayer != nil {
                VideoPreview(player: model.videoPlayer)
                    .background(Color.black)
            } else {
                // Neutral checker-ish backdrop so the transparent HUD is visible.
                Color(white: 0.16)
            }
            HudView(state: model.frameState())
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
    }

    private var transport: some View {
        VStack(spacing: 8) {
            HStack(spacing: 12) {
                Button(model.isPlaying ? "Pause" : "Play") { model.togglePlay() }
                    .keyboardShortcut(.space, modifiers: [])

                Slider(
                    value: Binding(get: { model.currentTime }, set: { model.seek(to: $0) }),
                    in: model.timelineStart...model.duration
                )

                Text(formatTimecode(model.currentTime, fps: 60))
                    .monospacedDigit()
                    .frame(width: 120, alignment: .trailing)
            }

            HStack(spacing: 12) {
                Button("Open Video…") { openVideo() }
                Button("Open Telemetry…") { openTelemetry() }
                Button("Open Track…") { openTrack() }

                Picker("Unit", selection: Binding(
                    get: { model.unit }, set: { model.unit = $0 }
                )) {
                    Text("km/h").tag(SpeedUnit.kmh)
                    Text("mph").tag(SpeedUnit.mph)
                }
                .pickerStyle(.segmented)
                .frame(width: 140)

                Spacer()

                Text(sourceLabel)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(12)
    }

    private var sourceLabel: String {
        var parts: [String] = []
        if let t = model.videoName { parts.append("video: \(t)") }
        if let t = model.telemetryName { parts.append("telemetry: \(t)") }
        if let t = model.trackName { parts.append("track: \(t)") }
        if let e = model.lastError { parts.append("⚠︎ \(e)") }
        return parts.isEmpty ? "No sources loaded" : parts.joined(separator: "   ")
    }

    private func openVideo() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.movie, .quickTimeMovie, .mpeg4Movie]
        panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url {
            model.loadVideo(url: url)
        }
    }

    private func openTelemetry() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.commaSeparatedText, .json, UTType(filenameExtension: "csv") ?? .plainText]
        panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url {
            model.loadTelemetry(url: url)
        }
    }

    private func openTrack() {
        let panel = NSOpenPanel()
        let gpx = UTType(filenameExtension: "gpx") ?? .xml
        let geojson = UTType(filenameExtension: "geojson") ?? .json
        panel.allowedContentTypes = [gpx, geojson, .json, .xml]
        panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url {
            model.loadTrack(url: url)
        }
    }
}
