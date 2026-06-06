import AppKit
import SwiftUI

struct RoadMapView: NSViewRepresentable {
    var roads: [Road]
    var route: [GeoPoint]
    var marks: [RouteMark]
    var center: GeoPoint
    var radiusM: Double
    var selectedMarkID: Int?
    var onClick: (GeoPoint) -> Void

    func makeNSView(context: Context) -> RoadMapNSView {
        let view = RoadMapNSView()
        view.onClick = onClick
        return view
    }

    func updateNSView(_ view: RoadMapNSView, context: Context) {
        view.roads = roads
        view.route = route
        view.marks = marks
        view.centerPoint = center
        view.radiusM = radiusM
        view.selectedMarkID = selectedMarkID
        view.onClick = onClick
        view.needsDisplay = true
    }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView: RoadMapNSView, context: Context) -> CGSize? {
        CGSize(
            width: proposal.width?.isFinite == true ? proposal.width! : 900,
            height: proposal.height?.isFinite == true ? proposal.height! : 620
        )
    }
}

final class RoadMapNSView: NSView {
    var roads: [Road] = []
    var route: [GeoPoint] = []
    var marks: [RouteMark] = []
    var centerPoint = GeoPoint(lat: 0, lon: 0)
    var radiusM = 1000.0
    var selectedMarkID: Int?
    var onClick: ((GeoPoint) -> Void)?

    private var scale = 1.0
    private var offset = CGPoint.zero
    private var dragStart: CGPoint?
    private var dragOrigin = CGPoint.zero
    private var dragged = false

    override var isFlipped: Bool { true }
    override var intrinsicContentSize: NSSize { NSSize(width: 900, height: 620) }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        NSColor(calibratedRed: 0.025, green: 0.055, blue: 0.045, alpha: 1).setFill()
        dirtyRect.fill()
        guard bounds.width > 0, bounds.height > 0 else { return }
        drawGrid()
        for road in roads { drawPolyline(road.points.map(\.geo), color: roadColor(road.highway), width: roadWidth(road.highway)) }
        drawPolyline(route, color: NSColor(calibratedRed: 0.20, green: 0.93, blue: 0.57, alpha: 1), width: 4)
        for (index, mark) in marks.sorted(by: { $0.time < $1.time }).enumerated() {
            drawMark(mark, label: "T\(index + 1)", selected: mark.id == selectedMarkID)
        }
        drawCenter()
    }

    override func mouseDown(with event: NSEvent) {
        dragStart = convert(event.locationInWindow, from: nil)
        dragOrigin = offset
        dragged = false
    }

    override func mouseDragged(with event: NSEvent) {
        guard let start = dragStart else { return }
        let point = convert(event.locationInWindow, from: nil)
        if hypot(point.x - start.x, point.y - start.y) > 3 { dragged = true }
        offset = CGPoint(x: dragOrigin.x + point.x - start.x, y: dragOrigin.y + point.y - start.y)
        needsDisplay = true
    }

    override func mouseUp(with event: NSEvent) {
        defer { dragStart = nil }
        guard !dragged else { return }
        let point = convert(event.locationInWindow, from: nil)
        onClick?(unproject(screenToMap(point)))
    }

    override func scrollWheel(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        let factor = exp(-event.scrollingDeltaY * 0.012)
        zoom(by: factor, around: point)
    }

    override func magnify(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        zoom(by: 1 + event.magnification, around: point)
    }

    func resetView() {
        scale = 1
        offset = .zero
        needsDisplay = true
    }

    private func zoom(by factor: Double, around point: CGPoint) {
        let oldScale = scale
        scale = min(24, max(0.5, scale * factor))
        let applied = scale / oldScale
        offset = CGPoint(
            x: point.x - (point.x - offset.x) * applied,
            y: point.y - (point.y - offset.y) * applied
        )
        needsDisplay = true
    }

    private func mapToScreen(_ point: CGPoint) -> CGPoint {
        CGPoint(x: point.x * scale + offset.x, y: point.y * scale + offset.y)
    }

    private func screenToMap(_ point: CGPoint) -> CGPoint {
        CGPoint(x: (point.x - offset.x) / scale, y: (point.y - offset.y) / scale)
    }

    private func project(_ point: GeoPoint) -> CGPoint {
        let bounds = MapBounds(center: centerPoint, radiusM: radiusM)
        return CGPoint(
            x: (point.lon - bounds.minLon) / (bounds.maxLon - bounds.minLon) * self.bounds.width,
            y: self.bounds.height - (point.lat - bounds.minLat) / (bounds.maxLat - bounds.minLat) * self.bounds.height
        )
    }

    private func unproject(_ point: CGPoint) -> GeoPoint {
        let bounds = MapBounds(center: centerPoint, radiusM: radiusM)
        return GeoPoint(
            lat: bounds.minLat + (self.bounds.height - point.y) / self.bounds.height * (bounds.maxLat - bounds.minLat),
            lon: bounds.minLon + point.x / self.bounds.width * (bounds.maxLon - bounds.minLon)
        )
    }

    private func drawPolyline(_ points: [GeoPoint], color: NSColor, width: CGFloat) {
        guard points.count > 1 else { return }
        let path = NSBezierPath()
        path.lineCapStyle = .round
        path.lineJoinStyle = .round
        path.lineWidth = width
        path.move(to: mapToScreen(project(points[0])))
        for point in points.dropFirst() { path.line(to: mapToScreen(project(point))) }
        color.setStroke()
        path.stroke()
    }

    private func drawGrid() {
        let path = NSBezierPath()
        path.lineWidth = 1
        let step = 52.0 * scale
        var x = offset.x.truncatingRemainder(dividingBy: step)
        while x < bounds.width { path.move(to: CGPoint(x: x, y: 0)); path.line(to: CGPoint(x: x, y: bounds.height)); x += step }
        var y = offset.y.truncatingRemainder(dividingBy: step)
        while y < bounds.height { path.move(to: CGPoint(x: 0, y: y)); path.line(to: CGPoint(x: bounds.width, y: y)); y += step }
        NSColor.white.withAlphaComponent(0.035).setStroke()
        path.stroke()
    }

    private func drawMark(_ mark: RouteMark, label: String, selected: Bool) {
        let point = mapToScreen(project(mark.point))
        let rect = CGRect(x: point.x - 7, y: point.y - 7, width: 14, height: 14)
        (selected ? NSColor.systemGreen : NSColor.systemOrange).setFill()
        NSBezierPath(ovalIn: rect).fill()
        let attrs: [NSAttributedString.Key: Any] = [.foregroundColor: NSColor.systemOrange, .font: NSFont.monospacedSystemFont(ofSize: 10, weight: .semibold)]
        label.draw(at: CGPoint(x: point.x + 10, y: point.y - 7), withAttributes: attrs)
    }

    private func drawCenter() {
        let point = mapToScreen(project(centerPoint))
        let path = NSBezierPath()
        path.move(to: CGPoint(x: point.x - 10, y: point.y)); path.line(to: CGPoint(x: point.x + 10, y: point.y))
        path.move(to: CGPoint(x: point.x, y: point.y - 10)); path.line(to: CGPoint(x: point.x, y: point.y + 10))
        NSColor.systemGreen.setStroke()
        path.stroke()
    }

    private func roadColor(_ highway: String) -> NSColor {
        ["primary", "secondary", "tertiary"].contains(highway) ? NSColor(calibratedWhite: 0.48, alpha: 1) : NSColor(calibratedWhite: 0.30, alpha: 1)
    }

    private func roadWidth(_ highway: String) -> CGFloat {
        ["primary", "secondary", "tertiary"].contains(highway) ? 4 : 2
    }
}
