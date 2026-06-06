import AppKit
import Darwin
import SwiftUI

@main
enum HUDRouteLabMain {
    private static let instanceLockFD = open(
        "/tmp/com.local.HUDRouteLab.lock",
        O_CREAT | O_RDWR,
        S_IRUSR | S_IWUSR
    )

    static func main() {
        guard acquireSingleInstanceLock() else {
            activateExistingInstance()
            return
        }

        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.regular)
        application.run()
    }

    private static func acquireSingleInstanceLock() -> Bool {
        guard instanceLockFD >= 0 else { return true }
        return flock(instanceLockFD, LOCK_EX | LOCK_NB) == 0
    }

    private static func activateExistingInstance() {
        let currentPID = ProcessInfo.processInfo.processIdentifier
        let existing = NSWorkspace.shared.runningApplications.first {
            $0.processIdentifier != currentPID
                && ($0.bundleIdentifier == "com.local.HUDRouteLab" || $0.localizedName == "HUDRouteLab")
        }
        existing?.activate(options: [.activateAllWindows])
    }
}

@MainActor
private final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    private let model = RouteLabModel()

    func applicationDidFinishLaunching(_ notification: Notification) {
        let hostingController = NSHostingController(rootView: ContentView(model: model))

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 800),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "HUD Route Lab"
        window.subtitle = "HUD GeoJSON 路线编辑器"
        window.minSize = NSSize(width: 1080, height: 700)
        window.contentViewController = hostingController
        window.setFrameAutosaveName("HUDRouteLab.mainWindow")
        window.toolbarStyle = .unified
        window.center()
        window.makeKeyAndOrderFront(nil)
        self.window = window

        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window?.makeKeyAndOrderFront(nil)
        return true
    }
}

extension Notification.Name {
    static let exportRoute = Notification.Name("HUDRouteLab.exportRoute")
}
