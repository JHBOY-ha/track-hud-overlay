import SwiftUI
import AppKit

@main
struct HUD5App: App {
    init() {
        // Behave as a regular foreground GUI app even when launched as a bare
        // SwiftPM executable (no .app bundle).
        NSApplication.shared.setActivationPolicy(.regular)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    var body: some Scene {
        WindowGroup("HUD5 Overlay") {
            ContentView()
        }
        .windowStyle(.titleBar)
    }
}
