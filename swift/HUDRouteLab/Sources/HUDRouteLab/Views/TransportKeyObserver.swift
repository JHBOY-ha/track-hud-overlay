import AppKit
import SwiftUI

struct TransportKeyObserver: NSViewRepresentable {
    var onTogglePlayback: () -> Void
    var onReverse: () -> Void
    var onForward: () -> Void

    func makeNSView(context: Context) -> TransportKeyNSView {
        let view = TransportKeyNSView()
        update(view)
        return view
    }

    func updateNSView(_ view: TransportKeyNSView, context: Context) {
        update(view)
    }

    private func update(_ view: TransportKeyNSView) {
        view.onTogglePlayback = onTogglePlayback
        view.onReverse = onReverse
        view.onForward = onForward
    }
}

final class TransportKeyNSView: NSView {
    var onTogglePlayback: (() -> Void)?
    var onReverse: (() -> Void)?
    var onForward: (() -> Void)?
    private var eventMonitor: Any?

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if window == nil {
            removeEventMonitor()
        } else if eventMonitor == nil {
            eventMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
                guard let self, event.window === self.window else { return event }
                return self.handle(event) ? nil : event
            }
        }
    }

    private func handle(_ event: NSEvent) -> Bool {
        guard event.modifierFlags.intersection([.command, .control, .option]).isEmpty,
              !(window?.firstResponder is NSTextView) else { return false }
        switch event.charactersIgnoringModifiers?.lowercased() {
        case " ":
            onTogglePlayback?()
        case "j":
            onReverse?()
        case "k":
            onTogglePlayback?()
        case "l":
            onForward?()
        default:
            return false
        }
        return true
    }

    private func removeEventMonitor() {
        if let eventMonitor {
            NSEvent.removeMonitor(eventMonitor)
            self.eventMonitor = nil
        }
    }
}
