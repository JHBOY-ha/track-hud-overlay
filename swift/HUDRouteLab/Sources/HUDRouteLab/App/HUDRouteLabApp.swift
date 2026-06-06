import AppKit
import SwiftUI

@main
struct HUDRouteLabApp: App {
    init() {
        NSApplication.shared.setActivationPolicy(.regular)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    var body: some Scene {
        WindowGroup("HUD Route Lab") {
            ContentView()
        }
        .defaultSize(width: 1440, height: 900)
        .windowStyle(.titleBar)
        .commands {
            CommandGroup(after: .newItem) {
                Button("Export HUD GeoJSON…") {
                    NotificationCenter.default.post(name: .exportRoute, object: nil)
                }
                .keyboardShortcut("e", modifiers: [.command])
            }
        }
    }
}

extension Notification.Name {
    static let exportRoute = Notification.Name("HUDRouteLab.exportRoute")
}
