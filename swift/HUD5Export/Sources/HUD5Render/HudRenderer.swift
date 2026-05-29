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

    // Palette — exact ports of src/styles/tokens.css (oklch → sRGB).
    // --ink: oklch(0.97 0.01 90); --ink-dim: /0.6; --ink-faint: /0.3
    private static let ink = CGColor(red: 0.971, green: 0.9605, blue: 0.9321, alpha: 1)
    private static let inkDim = CGColor(red: 0.971, green: 0.9605, blue: 0.9321, alpha: 0.6)
    private static let inkFaint = CGColor(red: 0.971, green: 0.9605, blue: 0.9321, alpha: 0.3)
    // --amber: oklch(0.82 0.14 75)
    private static let accent = CGColor(red: 0.9752, green: 0.7133, blue: 0.3113, alpha: 1)
    private static let track = CGColor(red: 1, green: 1, blue: 1, alpha: 0.16)
    private static let brakeColor = CGColor(red: 0.86, green: 0.30, blue: 0.22, alpha: 1)

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

    /// HH:MM:SS.mmm, mirroring formatElapsed in TopLeftStatus.tsx.
    private static func formatElapsed(_ t: Double) -> String {
        let tt = max(0, t)
        let ms = Int((tt - floor(tt)) * 1000)
        let s = Int(floor(tt)) % 60
        let m = (Int(floor(tt)) / 60) % 60
        let h = Int(floor(tt)) / 3600
        return String(format: "%02d:%02d:%02d.%03d", h, m, s, ms)
    }

    private static func drawTopLeftStatus(_ state: FrameState, _ ctx: CGContext, width: CGFloat, height: CGFloat) {
        let left: CGFloat = 48, top: CGFloat = 36
        let progress = clamp(state.sample?.progress ?? 0, 0, 1)
        let pct = Int((progress * 100).rounded())

        drawText("STAGE PROGRESS", x: left, yTop: top, size: 11, color: inkFaint, ctx: ctx,
                 height: height, align: .left, weight: .medium, mono: true, tracking: 2)

        // Big percent + "%".
        let numY = top + 24
        drawText(String(pct), x: left, yTop: numY, size: 48, color: ink, ctx: ctx,
                 height: height, align: .left, weight: .black, mono: false)
        let pctW = measure(String(pct), size: 48, weight: .black, mono: false)
        drawText("%", x: left + pctW + 10, yTop: numY + 30, size: 14, color: inkFaint, ctx: ctx,
                 height: height, align: .left, weight: .medium, mono: true, tracking: 2)

        // Progress strip (width 300, height 7) with a skewed right edge + ticks.
        let stripW: CGFloat = 300, stripH: CGFloat = 7
        let stripTop = numY + 64
        let stripY = flip(stripTop + stripH, height)  // bottom edge in CG space
        let skew: CGFloat = 7
        let poly = CGMutablePath()
        poly.move(to: CGPoint(x: left, y: stripY + stripH))
        poly.addLine(to: CGPoint(x: left + stripW, y: stripY + stripH))
        poly.addLine(to: CGPoint(x: left + stripW - skew, y: stripY))
        poly.addLine(to: CGPoint(x: left, y: stripY))
        poly.closeSubpath()

        ctx.saveGState()
        ctx.addPath(poly)
        ctx.clip()
        ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.14))
        ctx.fill(CGRect(x: left, y: stripY, width: stripW, height: stripH))
        ctx.setFillColor(accent)
        ctx.fill(CGRect(x: left, y: stripY, width: stripW * progress, height: stripH))
        // 10 evenly spaced tick separators.
        ctx.setFillColor(CGColor(red: 0, green: 0, blue: 0, alpha: 0.35))
        for i in 0..<10 {
            let tx = left + stripW * CGFloat(i) / 10
            ctx.fill(CGRect(x: tx, y: stripY, width: 1, height: stripH))
        }
        ctx.restoreGState()

        // Elapsed row.
        let rowTop = stripTop + stripH + 18
        drawText("Elapsed", x: left, yTop: rowTop, size: 12, color: inkFaint, ctx: ctx,
                 height: height, align: .left, weight: .regular, mono: true)
        drawText(formatElapsed(state.elapsed), x: left + 90, yTop: rowTop, size: 12, color: ink,
                 ctx: ctx, height: height, align: .left, weight: .medium, mono: true)
    }

    // MARK: Top-right position

    private static func drawTopRightPosition(_ state: FrameState, _ ctx: CGContext, width: CGFloat, height: CGFloat) {
        let rightX = width - 48
        let top: CGFloat = 36
        let cur = Int(state.sample?.positionCurrent ?? 1)
        let tot = Int(state.sample?.positionTotal ?? 2)

        drawText("GRID POSITION", x: rightX, yTop: top, size: 11, color: inkFaint, ctx: ctx,
                 height: height, align: .right, weight: .medium, mono: true, tracking: 2)

        // "{cur} / {tot}" — cur big amber, "/ tot" small dim, baseline-aligned.
        let numY = top + 20
        let totStr = "/ \(tot)"
        drawText(totStr, x: rightX, yTop: numY + 50, size: 20, color: inkFaint, ctx: ctx,
                 height: height, align: .right, weight: .medium, mono: true)
        let totW = measure(totStr, size: 20, weight: .medium, mono: true)
        drawText(String(cur), x: rightX - totW - 8, yTop: numY, size: 72, color: accent, ctx: ctx,
                 height: height, align: .right, weight: .black, mono: false)

        // Position pips, right-aligned.
        let pipW: CGFloat = 14, pipH: CGFloat = 4, gap: CGFloat = 3
        let totalW = CGFloat(tot) * pipW + CGFloat(max(tot - 1, 0)) * gap
        let pipsTop = numY + 78
        let pipY = flip(pipsTop + pipH, height)
        var px = rightX - totalW
        for i in 0..<max(tot, 0) {
            let rank = i + 1
            let color: CGColor
            if rank == cur { color = accent }
            else if rank < cur { color = CGColor(red: 1, green: 1, blue: 1, alpha: 0.45) }
            else { color = CGColor(red: 1, green: 1, blue: 1, alpha: 0.2) }
            ctx.setFillColor(color)
            ctx.fill(CGRect(x: px, y: pipY, width: pipW, height: pipH))
            px += pipW + gap
        }
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

    // MARK: Speedometer (open-bottom gauge, bottom-right)
    //
    // Geometry mirrors src/hud/Speedometer.tsx: a GAUGE=340 disc anchored
    // bottom-right; the RPM ring sweeps START_DEG(135°)→END_DEG(405°) clockwise
    // in SVG (y-down) space, leaving an open bottom. We build arcs in that same
    // top-down space and convert each sampled point to the context's
    // bottom-left origin via `flip`, so the result matches the web exactly.

    private static let gaugeSize: CGFloat = 340
    private static let gaugeR: CGFloat = 146
    private static let gaugeInnerR: CGFloat = 108
    private static let gaugeStartDeg: CGFloat = 135
    private static let gaugeEndDeg: CGFloat = 405
    private static let gaugeRedFrac: CGFloat = 7000.0 / 8000.0
    private static let brakeStartDeg: CGFloat = 150
    private static let brakeEndDeg: CGFloat = 220
    private static let throttleStartDeg: CGFloat = 320
    private static let throttleEndDeg: CGFloat = 390

    private static let redZone = CGColor(red: 0.78, green: 0.13, blue: 0.12, alpha: 0.85)
    private static let throttleColor = CGColor(red: 0.30, green: 0.56, blue: 0.95, alpha: 1)
    private static let activeArc = CGColor(red: 1, green: 1, blue: 1, alpha: 0.9)
    // --teal: oklch(0.78 0.11 195)
    private static let teal = CGColor(red: 0.3093, green: 0.8048, blue: 0.8041, alpha: 1)

    /// Build a stroked arc path in SVG-like top-down space, sampled finely and
    /// flipped into the context's bottom-left origin.
    private static func arcPath(cx: CGFloat, cyTopDown: CGFloat, radius: CGFloat,
                                startDeg: CGFloat, endDeg: CGFloat, height: CGFloat) -> CGPath {
        let path = CGMutablePath()
        let step: CGFloat = 1.5
        var deg = startDeg
        var first = true
        while deg <= endDeg + 0.0001 {
            let r = deg * .pi / 180
            let x = cx + cos(r) * radius
            let yTopDown = cyTopDown + sin(r) * radius
            let p = CGPoint(x: x, y: flip(yTopDown, height))
            if first { path.move(to: p); first = false } else { path.addLine(to: p) }
            deg += step
        }
        return path
    }

    private static func strokeArc(_ ctx: CGContext, cx: CGFloat, cy: CGFloat, radius: CGFloat,
                                  from: CGFloat, to: CGFloat, color: CGColor, lineWidth: CGFloat,
                                  cap: CGLineCap = .butt, height: CGFloat) {
        guard to > from + 0.001 else { return }
        ctx.setStrokeColor(color)
        ctx.setLineWidth(lineWidth)
        ctx.setLineCap(cap)
        ctx.addPath(arcPath(cx: cx, cyTopDown: cy, radius: radius, startDeg: from, endDeg: to, height: height))
        ctx.strokePath()
    }

    private static func drawSpeedometer(_ state: FrameState, _ ctx: CGContext, width: CGFloat, height: CGFloat) {
        let s = state.sample
        // Disc anchored bottom-right (right:48, bottom:45 in the web stage).
        let boxLeft = width - 48 - gaugeSize
        let boxTopDown = height - 45 - gaugeSize
        let cx = boxLeft + gaugeSize / 2
        let cy = boxTopDown + gaugeSize / 2  // top-down center

        // Concentric guide rings.
        for (r, a) in [(gaugeR + 16, 0.06), (gaugeR + 8, 0.12), (gaugeR - 22, 0.08)] {
            strokeArc(ctx, cx: cx, cy: cy, radius: r, from: 0, to: 360,
                      color: CGColor(red: 1, green: 1, blue: 1, alpha: a), lineWidth: 1, height: height)
        }

        // RPM background track.
        strokeArc(ctx, cx: cx, cy: cy, radius: gaugeR, from: gaugeStartDeg, to: gaugeEndDeg,
                  color: track, lineWidth: 8, height: height)

        let sweep = gaugeEndDeg - gaugeStartDeg
        let redDeg = gaugeStartDeg + sweep * gaugeRedFrac
        // Red zone.
        strokeArc(ctx, cx: cx, cy: cy, radius: gaugeR, from: redDeg, to: gaugeEndDeg,
                  color: redZone, lineWidth: 8, height: height)

        let rpm = CGFloat(s?.rpm ?? 0)
        let maxRpm = CGFloat(s?.rpmMax ?? state.rpmMax)
        let rpmFrac = max(0, min(rpm / max(maxRpm, 1), 1))
        let curDeg = gaugeStartDeg + sweep * rpmFrac
        let whiteEnd = min(curDeg, redDeg)
        // Active white arc.
        strokeArc(ctx, cx: cx, cy: cy, radius: gaugeR, from: gaugeStartDeg, to: whiteEnd,
                  color: activeArc, lineWidth: 8, height: height)

        // Inner brake arc (left): fills from the bottom end upward.
        let brake = CGFloat(clamp(Double(s?.brake ?? 0), 0, 1))
        strokeArc(ctx, cx: cx, cy: cy, radius: gaugeInnerR, from: brakeStartDeg, to: brakeEndDeg,
                  color: CGColor(red: 1, green: 1, blue: 1, alpha: 0.1), lineWidth: 6, cap: .round, height: height)
        if brake > 0.001 {
            let fillStart = brakeEndDeg - (brakeEndDeg - brakeStartDeg) * brake
            strokeArc(ctx, cx: cx, cy: cy, radius: gaugeInnerR, from: fillStart, to: brakeEndDeg,
                      color: brakeColor, lineWidth: 6, cap: .round, height: height)
        }

        // Inner throttle arc (right): fills from the bottom end upward.
        let throttle = CGFloat(clamp(Double(s?.throttle ?? 0), 0, 1))
        strokeArc(ctx, cx: cx, cy: cy, radius: gaugeInnerR, from: throttleStartDeg, to: throttleEndDeg,
                  color: CGColor(red: 1, green: 1, blue: 1, alpha: 0.1), lineWidth: 6, cap: .round, height: height)
        if throttle > 0.001 {
            let fillEnd = throttleStartDeg + (throttleEndDeg - throttleStartDeg) * throttle
            strokeArc(ctx, cx: cx, cy: cy, radius: gaugeInnerR, from: throttleStartDeg, to: fillEnd,
                      color: throttleColor, lineWidth: 6, cap: .round, height: height)
        }

        // Marker dot at the current RPM position.
        if rpmFrac > 0.001 {
            let r = curDeg * .pi / 180
            let dot = CGPoint(x: cx + cos(r) * gaugeR, y: flip(cy + sin(r) * gaugeR, height))
            ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
            ctx.fillEllipse(in: CGRect(x: dot.x - 5, y: dot.y - 5, width: 10, height: 10))
        }

        // Center stack: speed / unit / gear / rpm / RPM, vertically centered.
        let speedKmh = s?.speedKmh ?? 0
        let speedText = String(max(0, Int(convertSpeed(speedKmh, unit: state.unit).rounded())))
        let gear = gearString(s?.gear ?? .neutral)
        let rpmText = String(Int(rpm.rounded()))

        // Column metrics mirror the flex stack in Speedometer.tsx.
        let startY = cy - 101
        drawText(speedText, x: cx, yTop: startY, size: 32, color: ink, ctx: ctx,
                 height: height, align: .center, weight: .bold, mono: false)
        drawText(speedUnitLabel(state.unit), x: cx, yTop: startY + 35, size: 10, color: inkFaint,
                 ctx: ctx, height: height, align: .center, weight: .medium, mono: true, tracking: 2)
        drawText(gear, x: cx, yTop: startY + 51, size: 100, color: ink, ctx: ctx,
                 height: height, align: .center, weight: .black, mono: false)
        drawText(rpmText, x: cx, yTop: startY + 159, size: 30, color: ink, ctx: ctx,
                 height: height, align: .center, weight: .bold, mono: false)
        drawText("RPM", x: cx, yTop: startY + 192, size: 10, color: inkFaint, ctx: ctx,
                 height: height, align: .center, weight: .medium, mono: true, tracking: 2)

        // Assist badges near the bottom of the disc.
        let abs = s?.abs ?? false
        let tcs = s?.tcs ?? false
        let badgeY = boxTopDown + gaugeSize - 58
        drawText("ABS", x: cx - 44, yTop: badgeY, size: 11, color: abs ? teal : inkFaint, ctx: ctx,
                 height: height, align: .center, weight: .medium, mono: true, tracking: 1.5)
        drawText("TCR", x: cx, yTop: badgeY, size: 11, color: tcs ? teal : inkFaint, ctx: ctx,
                 height: height, align: .center, weight: .medium, mono: true, tracking: 1.5)
        drawText("ESP", x: cx + 44, yTop: badgeY, size: 11, color: inkFaint, ctx: ctx,
                 height: height, align: .center, weight: .medium, mono: true, tracking: 1.5)
    }

    private static func gearString(_ gear: GearValue) -> String {
        switch gear {
        case .neutral: return "N"
        case .reverse: return "R"
        case .number(let n): return String(Int(n))
        }
    }

    // MARK: Text

    enum Weight { case regular, medium, semibold, bold, black }
    enum Align { case left, center, right }

    /// Register the bundled Archivo + JetBrains Mono variable fonts once, so
    /// the renderer matches the web app's `--sans` / `--mono` exactly.
    private static let registerFonts: Void = {
        for name in ["Archivo", "JetBrainsMono"] {
            if let url = Bundle.module.url(forResource: name, withExtension: "ttf") {
                CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
            }
        }
    }()

    private static func ctFont(size: CGFloat, weight: Weight, mono: Bool) -> CTFont {
        _ = registerFonts
        let traitWeight: CGFloat
        switch weight {
        case .regular: traitWeight = 0
        case .medium: traitWeight = 0.23
        case .semibold: traitWeight = 0.3
        case .bold: traitWeight = 0.4
        case .black: traitWeight = 0.62
        }
        // --sans: Archivo, --mono: JetBrains Mono (variable fonts). Weight is
        // applied via the standard weight trait, which CoreText maps onto the
        // font's `wght` variation axis.
        let family = mono ? "JetBrains Mono" : "Archivo"
        let base = CTFontCreateWithName(family as CFString, size, nil)
        let traitsDict: [CFString: Any] = [kCTFontWeightTrait: traitWeight]
        let attrs: [CFString: Any] = [kCTFontTraitsAttribute: traitsDict]
        let desc = CTFontDescriptorCreateWithAttributes(attrs as CFDictionary)
        return CTFontCreateCopyWithAttributes(base, size, nil, desc)
    }

    /// Typographic width of a string in the given style (for manual layout).
    private static func measure(_ s: String, size: CGFloat, weight: Weight, mono: Bool, tracking: CGFloat = 0) -> CGFloat {
        let font = ctFont(size: size, weight: weight, mono: mono)
        var attrs: [NSAttributedString.Key: Any] = [
            NSAttributedString.Key(kCTFontAttributeName as String): font
        ]
        if tracking != 0 {
            attrs[NSAttributedString.Key(kCTKernAttributeName as String)] = tracking
        }
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: s, attributes: attrs) as CFAttributedString)
        return CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
    }

    private static func drawText(_ s: String, x: CGFloat, yTop: CGFloat, size: CGFloat,
                                 color: CGColor, ctx: CGContext, height: CGFloat,
                                 align: Align, weight: Weight, mono: Bool,
                                 baselineCenter: Bool = false, tracking: CGFloat = 0) {
        let font = ctFont(size: size, weight: weight, mono: mono)
        var attrs: [NSAttributedString.Key: Any] = [
            NSAttributedString.Key(kCTFontAttributeName as String): font,
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): color,
        ]
        if tracking != 0 {
            attrs[NSAttributedString.Key(kCTKernAttributeName as String)] = tracking
        }
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
