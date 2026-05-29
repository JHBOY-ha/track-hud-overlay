import SwiftUI
import AppKit
import HUD5Core
import HUD5Render

/// Hosts a plain NSView that draws the HUD with the shared HudRenderer, so the
/// live preview and the exporter render through identical code. The HUD draws
/// onto a transparent background at the fixed 1920×1080 stage, scaled to fit.
struct HudView: NSViewRepresentable {
    var state: FrameState

    func makeNSView(context: Context) -> HudNSView {
        let v = HudNSView()
        v.state = state
        return v
    }

    func updateNSView(_ nsView: HudNSView, context: Context) {
        nsView.state = state
        nsView.needsDisplay = true
    }
}

final class HudNSView: NSView {
    var state: FrameState? {
        didSet { needsDisplay = true }
    }

    override var isOpaque: Bool { false }
    override var wantsUpdateLayer: Bool { false }

    override func draw(_ dirtyRect: NSRect) {
        guard let state, let ctx = NSGraphicsContext.current?.cgContext else { return }

        let stageW = HudRenderer.stageWidth
        let stageH = HudRenderer.stageHeight
        let scale = min(bounds.width / stageW, bounds.height / stageH)
        let drawW = stageW * scale
        let drawH = stageH * scale
        let offsetX = (bounds.width - drawW) / 2
        let offsetY = (bounds.height - drawH) / 2

        ctx.saveGState()
        // Letterbox + scale the fixed stage into the view (bottom-left origin).
        ctx.translateBy(x: offsetX, y: offsetY)
        ctx.scaleBy(x: scale, y: scale)
        HudRenderer.draw(state, in: ctx, width: stageW, height: stageH)
        ctx.restoreGState()
    }
}
