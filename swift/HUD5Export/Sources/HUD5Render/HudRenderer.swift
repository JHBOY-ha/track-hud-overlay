import Foundation
import CoreGraphics
import CoreText
import HUD5Core

/// Draws the HUD onto a CoreGraphics context at the fixed 1920×1080 stage.
///
/// Coordinates here are expressed top-left (matching the web stage) and
/// converted to the context's bottom-left origin via `flip`. This is a
/// functional first pass — it renders the core readouts (speed gauge, gear,
/// throttle/brake, elapsed/progress, position, minimap) on a transparent
/// background. Pixel-level fidelity with the CSS/SVG HUD is a later pass.
public enum HudRenderer {
    public static let stageWidth: CGFloat = 1920
    public static let stageHeight: CGFloat = 1080

    // Palette (approximate HUD ink + Forza-style accent).
    private static let ink = CGColor(red: 0.96, green: 0.96, blue: 0.98, alpha: 1)
    private static let inkFaint = CGColor(red: 0.96, green: 0.96, blue: 0.98, alpha: 0.4)
    private static let accent = CGColor(red: 1.0, green: 0.84, blue: 0.18, alpha: 1)
    private static let track = CGColor(red: 1, green: 1, blue: 1, alpha: 0.16)
    private static let brakeColor = CGColor(red: 1.0, green: 0.27, blue: 0.27, alpha: 1)
    private static let shadow = CGColor(red: 0, green: 0, blue: 0, alpha: 0.55)

    public static func draw(_ state: FrameState, in ctx: CGContext,
                            width: CGFloat = stageWidth, height: CGFloat = stageHeight) {
        ctx.clear(CGRect(x: 0, y: 0, width: width, height: height))
        ctx.setShouldAntialias(true)

        drawCornerBrackets(ctx, width: width, height: height)
        drawTopLeftStatus(state, ctx, width: width, height: height)
        drawTopRightPosition(state, ctx, width: width, height: height)
        drawMinimap(state, ctx, width: width, height: height)
        drawSpeedometer(state, ctx, width: width, height: height)
    }

    // MARK: Top-left → bottom-left conversion

    private static func flip(_ yTop: CGFloat, _ height: CGFloat) -> CGFloat { height - yTop }

    // MARK: Corner brackets

    private static func drawCornerBrackets(_ ctx: CGContext, width: CGFloat, height: CGFloat) {
        let size: CGFloat = 34, inset: CGFloat = 24
        ctx.setStrokeColor(inkFaint)
        ctx.setLineWidth(1)
        let corners: [(CGFloat, CGFloat, CGFloat, CGFloat)] = [
            // (cornerX, cornerYTop, dirX, dirY) — draw two strokes per corner
            (inset, inset, 1, 1),
            (width - inset, inset, -1, 1),
            (inset, height - inset, 1, -1),
            (width - inset, height - inset, -1, -1),
        ]
        for (cx, cyTop, dx, dy) in corners {
            let cy = flip(cyTop, height)
            ctx.beginPath()
            ctx.move(to: CGPoint(x: cx + dx * size, y: cy))
            ctx.addLine(to: CGPoint(x: cx, y: cy))
            ctx.addLine(to: CGPoint(x: cx, y: cy - dy * size))
            ctx.strokePath()
        }
    }

    // MARK: Top-left status (elapsed + throttle/brake)

    private static func drawTopLeftStatus(_ state: FrameState, _ ctx: CGContext, width: CGFloat, height: CGFloat) {
        let x: CGFloat = 70
        drawText(formatTimecode(state.elapsed, fps: 60), x: x, yTop: 70, size: 40, color: ink,
                 ctx: ctx, height: height, align: .left, weight: .semibold, mono: true)

        if let s = state.sample {
            var rowY: CGFloat = 132
            if let throttle = s.throttle {
                drawBar(label: "THR", value: clamp(throttle <= 1 ? throttle : throttle / 100, 0, 1),
                        x: x, yTop: rowY, color: accent, ctx: ctx, height: height)
                rowY += 40
            }
            if let brake = s.brake {
                drawBar(label: "BRK", value: clamp(brake <= 1 ? brake : brake / 100, 0, 1),
                        x: x, yTop: rowY, color: brakeColor, ctx: ctx, height: height)
            }
        }
    }

    private static func drawBar(label: String, value: Double, x: CGFloat, yTop: CGFloat,
                                color: CGColor, ctx: CGContext, height: CGFloat) {
        drawText(label, x: x, yTop: yTop, size: 22, color: inkFaint, ctx: ctx, height: height,
                 align: .left, weight: .medium, mono: true)
        let barX = x + 70, barW: CGFloat = 220, barH: CGFloat = 16
        let y = flip(yTop + 20, height)
        let bg = CGRect(x: barX, y: y, width: barW, height: barH)
        ctx.setFillColor(track)
        ctx.fill(bg)
        ctx.setFillColor(color)
        ctx.fill(CGRect(x: barX, y: y, width: barW * CGFloat(value), height: barH))
    }

    // MARK: Top-right position

    private static func drawTopRightPosition(_ state: FrameState, _ ctx: CGContext, width: CGFloat, height: CGFloat) {
        guard let s = state.sample, let cur = s.positionCurrent else { return }
        let rightX = width - 70
        let posText: String
        if let total = s.positionTotal {
            posText = "\(Int(cur)) / \(Int(total))"
        } else {
            posText = "\(Int(cur))"
        }
        drawText("POSITION", x: rightX, yTop: 70, size: 22, color: inkFaint, ctx: ctx,
                 height: height, align: .right, weight: .medium, mono: true)
        drawText(posText, x: rightX, yTop: 100, size: 54, color: ink, ctx: ctx,
                 height: height, align: .right, weight: .bold, mono: true)
    }

    // MARK: Minimap (bottom-left top-down)

    private static func drawMinimap(_ state: FrameState, _ ctx: CGContext, width: CGFloat, height: CGFloat) {
        let pts = state.trackPoints
        guard pts.count >= 2 else { return }

        let boxX: CGFloat = 70, boxYTop: CGFloat = height - 70 - 320
        let boxW: CGFloat = 320, boxH: CGFloat = 320, pad: CGFloat = 24

        var minX = pts[0].x, maxX = pts[0].x, minY = pts[0].y, maxY = pts[0].y
        for p in pts {
            minX = min(minX, p.x); maxX = max(maxX, p.x)
            minY = min(minY, p.y); maxY = max(maxY, p.y)
        }
        let spanX = max(maxX - minX, 1e-6), spanY = max(maxY - minY, 1e-6)
        let scale = min((boxW - pad * 2) / spanX, (boxH - pad * 2) / spanY)
        // Center the track in the box.
        let offX = boxX + (boxW - spanX * scale) / 2
        let offYTop = boxYTop + (boxH - spanY * scale) / 2

        // Track point (meters, y-down) → context point (bottom-left origin).
        func map(_ x: Double, _ y: Double) -> CGPoint {
            let sx = offX + (CGFloat(x) - CGFloat(minX)) * scale
            let syTop = offYTop + (CGFloat(y) - CGFloat(minY)) * scale
            return CGPoint(x: sx, y: flip(syTop, height))
        }

        // Track polyline.
        ctx.setStrokeColor(track)
        ctx.setLineWidth(3)
        ctx.setLineJoin(.round)
        ctx.beginPath()
        ctx.move(to: map(pts[0].x, pts[0].y))
        for p in pts.dropFirst() { ctx.addLine(to: map(p.x, p.y)) }
        ctx.strokePath()

        // Driven-progress overlay up to the current pose, then the car arrow.
        guard let pose = state.pose else { return }
        ctx.setStrokeColor(accent)
        ctx.setLineWidth(4)
        ctx.beginPath()
        ctx.move(to: map(pts[0].x, pts[0].y))
        for p in pts {
            // Truncate at the interpolated current position (see CLAUDE.md:
            // the driven bar must not lead the arrow).
            if p.distance > poseDistance(pts, pose) { break }
            ctx.addLine(to: map(p.x, p.y))
        }
        ctx.addLine(to: map(pose.x, pose.y))
        ctx.strokePath()

        drawCarArrow(at: map(pose.x, pose.y), headingRad: pose.headingRad, ctx: ctx)
    }

    /// Distance along the polyline of the point nearest the pose, used to
    /// truncate the driven overlay.
    private static func poseDistance(_ pts: [TrackPoint], _ pose: TrackPose) -> Double {
        var best = Double.infinity
        var bestDist = 0.0
        for p in pts {
            let dx = p.x - pose.x, dy = p.y - pose.y
            let d2 = dx * dx + dy * dy
            if d2 < best { best = d2; bestDist = p.distance }
        }
        return bestDist
    }

    private static func drawCarArrow(at p: CGPoint, headingRad: Double, ctx: CGContext) {
        ctx.saveGState()
        ctx.translateBy(x: p.x, y: p.y)
        // heading: 0 = north (up, +y in screen-top terms). Context is
        // bottom-left, so north is -y here; rotate clockwise by heading.
        ctx.rotate(by: -headingRad)
        ctx.beginPath()
        ctx.move(to: CGPoint(x: 0, y: 13))
        ctx.addLine(to: CGPoint(x: 9, y: -10))
        ctx.addLine(to: CGPoint(x: 0, y: -4))
        ctx.addLine(to: CGPoint(x: -9, y: -10))
        ctx.closePath()
        ctx.setFillColor(accent)
        ctx.fillPath()
        ctx.restoreGState()
    }

    // MARK: Speedometer (bottom-center arc)

    private static func drawSpeedometer(_ state: FrameState, _ ctx: CGContext, width: CGFloat, height: CGFloat) {
        let cx = width / 2
        let cyTop = height - 150
        let cy = flip(cyTop, height)
        let radius: CGFloat = 150
        // Arc spans 240° centered downward-ish: from 150° to -30° (CCW in CG).
        let startAngle = CGFloat.pi * (7.0 / 6.0)   // 210°
        let endAngle = CGFloat.pi * (-1.0 / 6.0)    // -30°

        // Background arc.
        ctx.setStrokeColor(track)
        ctx.setLineWidth(14)
        ctx.setLineCap(.round)
        ctx.beginPath()
        ctx.addArc(center: CGPoint(x: cx, y: cy), radius: radius,
                   startAngle: startAngle, endAngle: endAngle, clockwise: true)
        ctx.strokePath()

        // RPM sweep.
        if let s = state.sample, let rpm = s.rpm, state.rpmMax > 0 {
            let frac = clamp(rpm / state.rpmMax, 0, 1)
            let sweepEnd = startAngle + (endAngle - startAngle) * CGFloat(frac)
            ctx.setStrokeColor(accent)
            ctx.setLineWidth(14)
            ctx.beginPath()
            ctx.addArc(center: CGPoint(x: cx, y: cy), radius: radius,
                       startAngle: startAngle, endAngle: sweepEnd, clockwise: true)
            ctx.strokePath()
        }

        // Numeric speed.
        let speedKmh = state.sample?.speedKmh
        let displayed = speedKmh.map { Int(convertSpeed($0, unit: state.unit).rounded()) }
        let speedText = displayed.map(String.init) ?? "--"
        drawText(speedText, x: cx, yTop: cyTop - 6, size: 110, color: ink, ctx: ctx,
                 height: height, align: .center, weight: .bold, mono: true, baselineCenter: true)
        drawText(speedUnitLabel(state.unit), x: cx, yTop: cyTop + 64, size: 30, color: inkFaint,
                 ctx: ctx, height: height, align: .center, weight: .medium, mono: true)

        // Gear.
        if let gear = state.sample?.gear {
            drawText(gearString(gear), x: cx, yTop: cyTop - 110, size: 56, color: accent, ctx: ctx,
                     height: height, align: .center, weight: .bold, mono: true)
        }
    }

    private static func gearString(_ gear: GearValue) -> String {
        switch gear {
        case .neutral: return "N"
        case .reverse: return "R"
        case .number(let n): return String(Int(n))
        }
    }

    // MARK: Text

    enum Weight { case regular, medium, semibold, bold }
    enum Align { case left, center, right }

    private static func ctFont(size: CGFloat, weight: Weight, mono: Bool) -> CTFont {
        let traitWeight: CGFloat
        switch weight {
        case .regular: traitWeight = 0
        case .medium: traitWeight = 0.23
        case .semibold: traitWeight = 0.3
        case .bold: traitWeight = 0.4
        }
        // Pick a base family; fall back gracefully if a name is unavailable.
        let candidates: [String] = mono
            ? ["SFMono-Regular", "Menlo", "Courier"]
            : ["Helvetica Neue", "Helvetica"]
        var base = CTFontCreateWithName(candidates.last! as CFString, size, nil)
        for name in candidates {
            let f = CTFontCreateWithName(name as CFString, size, nil)
            if (CTFontCopyPostScriptName(f) as String).isEmpty == false {
                base = f
                break
            }
        }
        let traitsDict: [CFString: Any] = [kCTFontWeightTrait: traitWeight]
        let attrs: [CFString: Any] = [kCTFontTraitsAttribute: traitsDict]
        let desc = CTFontDescriptorCreateWithAttributes(attrs as CFDictionary)
        return CTFontCreateCopyWithAttributes(base, size, nil, desc)
    }

    private static func drawText(_ s: String, x: CGFloat, yTop: CGFloat, size: CGFloat,
                                 color: CGColor, ctx: CGContext, height: CGFloat,
                                 align: Align, weight: Weight, mono: Bool,
                                 baselineCenter: Bool = false) {
        let font = ctFont(size: size, weight: weight, mono: mono)
        let attrs: [NSAttributedString.Key: Any] = [
            NSAttributedString.Key(kCTFontAttributeName as String): font,
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): color,
        ]
        let attr = NSAttributedString(string: s, attributes: attrs)
        let line = CTLineCreateWithAttributedString(attr as CFAttributedString)
        var ascent: CGFloat = 0, descent: CGFloat = 0, leading: CGFloat = 0
        let textWidth = CGFloat(CTLineGetTypographicBounds(line, &ascent, &descent, &leading))

        var drawX = x
        switch align {
        case .left: drawX = x
        case .center: drawX = x - textWidth / 2
        case .right: drawX = x - textWidth
        }
        // yTop is the top of the cap box; baseline sits ascent below it.
        let baselineTop = baselineCenter ? yTop + ascent / 2 : yTop + ascent
        let baselineY = flip(baselineTop, height)

        ctx.saveGState()
        ctx.textMatrix = .identity
        ctx.textPosition = CGPoint(x: drawX, y: baselineY)
        CTLineDraw(line, ctx)
        ctx.restoreGState()
    }
}
