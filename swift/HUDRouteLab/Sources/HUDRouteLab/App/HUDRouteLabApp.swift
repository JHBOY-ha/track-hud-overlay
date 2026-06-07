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
        if let iconURL = Bundle.module.url(forResource: "HUDRouteLab", withExtension: "icns") {
            application.applicationIconImage = NSImage(contentsOf: iconURL)
        }
        ApplicationMenu.install(on: application)
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
enum ApplicationMenu {
    static func install(on application: NSApplication) {
        let mainMenu = NSMenu()
        mainMenu.addItem(applicationMenu())
        mainMenu.addItem(editMenu())
        mainMenu.addItem(windowMenu(application: application))
        application.mainMenu = mainMenu
    }

    private static func applicationMenu() -> NSMenuItem {
        let item = NSMenuItem()
        let menu = NSMenu(title: "HUD Route Lab")
        menu.addItem(withTitle: "关于 HUD Route Lab", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        menu.addItem(.separator())
        let quit = menu.addItem(withTitle: "退出 HUD Route Lab", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        quit.keyEquivalentModifierMask = [.command]
        item.submenu = menu
        return item
    }

    private static func editMenu() -> NSMenuItem {
        let item = NSMenuItem()
        let menu = NSMenu(title: "编辑")
        menu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        menu.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "Z")
        menu.addItem(.separator())
        menu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        menu.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        menu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        menu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        item.submenu = menu
        return item
    }

    private static func windowMenu(application: NSApplication) -> NSMenuItem {
        let item = NSMenuItem()
        let menu = NSMenu(title: "窗口")
        menu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        menu.addItem(withTitle: "缩放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "前置全部窗口", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
        application.windowsMenu = menu
        item.submenu = menu
        return item
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
