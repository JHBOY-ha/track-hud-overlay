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

    // MARK: Minimap
    //
    // Faithful port of src/hud/Minimap.tsx (flat mode — the web's tilt=0
    // setting): a DISC=240 disc anchored bottom-left showing a viewRadiusM=50
    // window centered on the car, rotated heading-up, with reference/planned/
    // driven layers, an outer ring, a compass N, a scale bar, and the route/
    // player/altitude labels. The 70° perspective tilt is a later step.

    private static let mmDisc: CGFloat = 240
    private static let mmRadius: CGFloat = 240 / 2 - 12   // 108
    private static let mmViewRadiusM: CGFloat = 50
    private static let mmStroke: CGFloat = 3
    private static let mmLeft: CGFloat = 55
    private static let mmBottom: CGFloat = 63
    private static let mmAnchorFrac: CGFloat = 0.72  // MINIMAP_ANCHOR_Y = DISC*0.72
    private static let mmTiltDeg: CGFloat = 70       // MINIMAP_PLANE_TILT_DEG
    private static let mmPerspective: CGFloat = 760  // perspective(760px)

    private static func drawMinimap(_ state: FrameState, _ ctx: CGContext, width: CGFloat, height: CGFloat) {
        let mToPx = mmRadius / mmViewRadiusM
        let discTopTopDown = height - mmBottom - mmDisc
        let cxv = mmLeft + mmDisc / 2
        let cyTopDown = discTopTopDown + mmDisc / 2
        let centerCG = CGPoint(x: cxv, y: flip(cyTopDown, height))
        // The car sits at 0.72·DISC down the disc; the ground plane tilts back
        // around this anchor so the road ahead recedes upward.
        let anchorYTopDown = discTopTopDown + mmDisc * mmAnchorFrac
        let anchorCG = CGPoint(x: cxv, y: flip(anchorYTopDown, height))

        let planned = state.layers.first { $0.kind == .planned }
        let driven = state.layers.first { $0.kind == .driven } ?? planned
        let references = state.layers.filter { $0.kind == .reference }
        let routeLayer = planned ?? driven
        let trackLenM = routeLayer?.totalLength ?? 0

        // Header: ROUTE · TRACK   X.XX KM
        let headerY = discTopTopDown - 22
        drawText("ROUTE · TRACK", x: mmLeft, yTop: headerY, size: 10, color: inkDim, ctx: ctx,
                 height: height, align: .left, weight: .medium, mono: true, tracking: 2)
        let distLabel = trackLenM > 0 ? String(format: "%.2f KM", trackLenM / 1000) : "— KM"
        drawText(distLabel, x: mmLeft + mmDisc, yTop: headerY, size: 10, color: inkDim, ctx: ctx,
                 height: height, align: .right, weight: .medium, mono: true, tracking: 2)

        // Disc background — dark radial fade (port of the stacked gradients +
        // alpha mask, simplified to one dark fade).
        let cs = CGColorSpace(name: CGColorSpace.sRGB)!
        let comps: [CGFloat] = [
            0.039, 0.047, 0.055, 0.42,
            0.039, 0.047, 0.055, 0.24,
            0.039, 0.047, 0.055, 0.0,
        ]
        if let grad = CGGradient(colorSpace: cs, colorComponents: comps, locations: [0, 0.48, 0.84], count: 3) {
            ctx.saveGState()
            ctx.setShadow(offset: CGSize(width: 0, height: -2), blur: 10, color: CGColor(gray: 0, alpha: 0.6))
            ctx.drawRadialGradient(grad, startCenter: centerCG, startRadius: 0,
                                   endCenter: centerCG, endRadius: mmDisc / 2, options: [])
            ctx.restoreGState()
        }

        // Map content, clipped to the inner ring (radius DISC/2 - 10).
        let innerR = mmDisc / 2 - 10
        if let pose = state.pose {
            let a = -pose.headingRad  // mapAngle = -headingDeg, heading-up
            let cosA = cos(a), sinA = sin(a)
            let tilt = mmTiltDeg * .pi / 180
            let cosT = cos(tilt), sinT = sin(tilt)
            // Port of `perspective(760px) rotateX(70deg)` about the anchor:
            // rotate the plane point about the horizontal axis (y-z), then
            // project with the CSS perspective scale P/(P - z).
            // Returns nil when the point falls at/behind the perspective
            // horizon (z ≥ camera), so callers can break the polyline there.
            func mapPoint(_ x: Double, _ y: Double) -> CGPoint? {
                let mx = (CGFloat(x) - CGFloat(pose.x)) * mToPx
                let my = (CGFloat(y) - CGFloat(pose.y)) * mToPx
                let rx = mx * cosA - my * sinA           // heading-up rotation
                let ry = mx * sinA + my * cosA           // (plane, y-down)
                let zt = ry * sinT                        // depth after tilt
                let denom = mmPerspective - zt
                if denom <= 1 { return nil }              // behind the camera
                let s = mmPerspective / denom
                let px = rx * s
                let py = (ry * cosT) * s
                return CGPoint(x: cxv + px, y: flip(anchorYTopDown + py, height))
            }
            func strokeLayer(_ pts: [TrackPoint], _ color: CGColor, _ wPx: CGFloat) {
                guard pts.count > 1 else { return }
                ctx.setStrokeColor(color)
                ctx.setLineWidth(wPx)
                ctx.setLineCap(.round)
                ctx.setLineJoin(.round)
                var penDown = false
                for p in pts {
                    if let cg = mapPoint(p.x, p.y) {
                        if penDown { ctx.addLine(to: cg) } else { ctx.move(to: cg); penDown = true }
                    } else {
                        penDown = false  // break the path at the horizon
                    }
                }
                ctx.strokePath()
            }

            ctx.saveGState()
            ctx.addEllipse(in: CGRect(x: centerCG.x - innerR, y: centerCG.y - innerR, width: innerR * 2, height: innerR * 2))
            ctx.clip()

            for ref in references { strokeLayer(ref.points, CGColor(red: 1, green: 1, blue: 1, alpha: 0.18), mmStroke) }
            if let planned { strokeLayer(planned.points, withAlpha(teal, 0.45), mmStroke) }

            // Driven split at the car: walked (amber) trails behind, ahead
            // (teal) continues — only shown when there's no planned route.
            if let driven {
                let poseDist = nearestDistance(driven.points, pose)
                var walked = driven.points.filter { $0.distance <= poseDist }
                walked.append(TrackPoint(x: pose.x, y: pose.y, distance: poseDist))
                var ahead = [TrackPoint(x: pose.x, y: pose.y, distance: poseDist)]
                ahead.append(contentsOf: driven.points.filter { $0.distance > poseDist })
                if planned == nil { strokeLayer(ahead, withAlpha(teal, 0.55), mmStroke) }
                strokeLayer(walked, accent, mmStroke)
            }

            // Finish marker at the route end.
            if let last = (planned ?? driven)?.points.last, let f = mapPoint(last.x, last.y) {
                ctx.setStrokeColor(ink); ctx.setLineWidth(1.5)
                ctx.strokeEllipse(in: CGRect(x: f.x - 4, y: f.y - 4, width: 8, height: 8))
                ctx.setFillColor(ink)
                ctx.fillEllipse(in: CGRect(x: f.x - 1.5, y: f.y - 1.5, width: 3, height: 3))
            }
            ctx.restoreGState()
        }

        // Outer ring.
        ctx.setStrokeColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.18))
        ctx.setLineWidth(1)
        ctx.strokeEllipse(in: CGRect(x: centerCG.x - innerR, y: centerCG.y - innerR, width: innerR * 2, height: innerR * 2))

        // Car arrow at the anchor (untilted), pointing up.
        if state.pose != nil { drawCarArrow(at: anchorCG, ctx: ctx) }

        // Compass N — screen-facing, on the far arc toward true north.
        if let pose = state.pose {
            let a = -pose.headingRad
            let nR = mmDisc / 2 - 22
            let nxTopDown = cxv + sin(a) * nR
            let nyTopDown = cyTopDown - cos(a) * nR
            drawText("N", x: nxTopDown, yTop: nyTopDown - 7, size: 11, color: accent, ctx: ctx,
                     height: height, align: .center, weight: .bold, mono: true, baselineCenter: true, tracking: 1.5)
        }

        // Scale bar (fixed): 25 M etc.
        let scaleM = pickScaleBarMeters(mToPx)
        let scaleBarPx = scaleM * mToPx
        let barY = flip(discTopTopDown + mmDisc - 18, height)
        let barX0 = cxv - scaleBarPx / 2
        ctx.setStrokeColor(ink); ctx.setLineWidth(1.5)
        ctx.beginPath()
        ctx.move(to: CGPoint(x: barX0, y: barY)); ctx.addLine(to: CGPoint(x: barX0 + scaleBarPx, y: barY))
        ctx.move(to: CGPoint(x: barX0, y: barY - 3)); ctx.addLine(to: CGPoint(x: barX0, y: barY + 3))
        ctx.move(to: CGPoint(x: barX0 + scaleBarPx, y: barY - 3)); ctx.addLine(to: CGPoint(x: barX0 + scaleBarPx, y: barY + 3))
        ctx.strokePath()
        let scaleLabel = scaleM >= 1000 ? "\(Int(scaleM / 1000)) KM" : "\(Int(scaleM)) M"
        drawText(scaleLabel, x: cxv, yTop: discTopTopDown + mmDisc - 18 - 16, size: 9, color: inkDim,
                 ctx: ctx, height: height, align: .center, weight: .regular, mono: true, tracking: 1.5)

        // Player / altitude row below the disc.
        let rowY = height - 51
        let posStr = state.sample?.positionCurrent.map { "P\(Int($0))" } ?? "P—"
        // amber square + "NAME · P#"
        ctx.setFillColor(accent)
        ctx.fill(CGRect(x: mmLeft, y: flip(rowY + 8, height), width: 8, height: 8))
        drawText("\(state.playerName) · \(posStr)", x: mmLeft + 16, yTop: rowY, size: 10, color: ink,
                 ctx: ctx, height: height, align: .left, weight: .medium, mono: true, tracking: 1.5)
        let altLabel: String
        if let ele = state.pose?.ele, ele.isFinite { altLabel = "\(Int(ele.rounded()))m" } else { altLabel = "— m" }
        drawText("ALT · \(altLabel)", x: mmLeft + mmDisc, yTop: rowY, size: 10, color: inkDim, ctx: ctx,
                 height: height, align: .right, weight: .medium, mono: true, tracking: 1.5)
    }

    /// Scale-bar step matching pickScaleBarMeters in Minimap.tsx.
    private static func pickScaleBarMeters(_ mToPx: CGFloat) -> CGFloat {
        let targetM = mmRadius * 0.55 / mToPx
        let steps: [CGFloat] = [10, 20, 25, 50, 100, 200, 250, 500, 1000]
        var best = steps[0]
        for s in steps where s <= targetM { best = s }
        return best
    }

    private static func nearestDistance(_ pts: [TrackPoint], _ pose: TrackPose) -> Double {
        var best = Double.infinity, bestDist = 0.0
        for p in pts {
            let dx = p.x - pose.x, dy = p.y - pose.y
            let d2 = dx * dx + dy * dy
            if d2 < best { best = d2; bestDist = p.distance }
        }
        return bestDist
    }

    private static func withAlpha(_ c: CGColor, _ a: CGFloat) -> CGColor {
        c.copy(alpha: a) ?? c
    }

    /// The detailed car arrow from Minimap.tsx (scale 0.7), pointing up.
    /// SVG path "M 0 -70 L 15 36 L 0 21 L -15 36 Z" (y-down) → CG with y negated.
    private static func drawCarArrow(at p: CGPoint, ctx: CGContext) {
        let s: CGFloat = 0.7
        func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: p.x + x * s, y: p.y - y * s)  // negate y: SVG up(-) → CG up(+)
        }
        ctx.saveGState()
        ctx.setShadow(offset: CGSize(width: 0, height: -3), blur: 3, color: CGColor(red: 0.09, green: 0.07, blue: 0.13, alpha: 0.76))
        // Main body.
        let body = CGMutablePath()
        body.move(to: pt(0, -70)); body.addLine(to: pt(15, 36)); body.addLine(to: pt(0, 21)); body.addLine(to: pt(-15, 36)); body.closeSubpath()
        ctx.addPath(body)
        ctx.setFillColor(CGColor(red: 0.973, green: 0.969, blue: 1.0, alpha: 1))
        ctx.setStrokeColor(CGColor(red: 0.145, green: 0.118, blue: 0.204, alpha: 0.95))
        ctx.setLineWidth(4.6 * s)
        ctx.setLineJoin(.round)
        ctx.drawPath(using: .fillStroke)
        ctx.restoreGState()
        // Inner highlight.
        let inner = CGMutablePath()
        inner.move(to: pt(0, -58)); inner.addLine(to: pt(8.8, 22)); inner.addLine(to: pt(0, 13)); inner.addLine(to: pt(-8.8, 22)); inner.closeSubpath()
        ctx.addPath(inner)
        ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.44))
        ctx.fillPath()
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
        let center = CGPoint(x: cx, y: flip(cy, height))

        // Dark translucent disc backing — radial-gradient(circle,
        // rgba(10,12,14,0.4) 0%, …0.2 55%, …0 72%) from Speedometer.tsx, with
        // the gauge's drop-shadow(0 4px 16px rgba(0,0,0,0.7)).
        let cs = CGColorSpace(name: CGColorSpace.sRGB)!
        let comps: [CGFloat] = [
            0.039, 0.047, 0.055, 0.40,
            0.039, 0.047, 0.055, 0.20,
            0.039, 0.047, 0.055, 0.0,
            0.039, 0.047, 0.055, 0.0,
        ]
        let locs: [CGFloat] = [0, 0.55, 0.72, 1.0]
        if let grad = CGGradient(colorSpace: cs, colorComponents: comps, locations: locs, count: 4) {
            ctx.saveGState()
            ctx.setShadow(offset: CGSize(width: 0, height: -4), blur: 16,
                          color: CGColor(gray: 0, alpha: 0.7))
            ctx.drawRadialGradient(grad, startCenter: center, startRadius: 0,
                                   endCenter: center, endRadius: gaugeSize / 2, options: [])
            ctx.restoreGState()
        }

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
