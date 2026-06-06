import AppKit
import SwiftUI

struct RoadMapView: NSViewRepresentable {
    var roads: [Road]
    var route: [GeoPoint]
    var importedTrack: [GeoPoint]
    var snapPreview: [GeoPoint]
    var importedCursorPoint: GeoPoint?
    var snappedCursorPoint: GeoPoint?
    var marks: [RouteMark]
    var center: GeoPoint
    var radiusM: Double
    var selectedMarkID: Int?
    var disconnectedMarkIDs: Set<Int>
    var command: MapCommand
    var commandRevision: Int
    var contentRevision: Int
    var onClick: (GeoPoint) -> Void

    func makeNSView(context: Context) -> RoadMapNSView {
        let view = RoadMapNSView()
        view.onClick = onClick
        return view
    }

    func updateNSView(_ view: RoadMapNSView, context: Context) {
        if view.contentRevision != contentRevision {
            view.contentRevision = contentRevision
            view.roads = roads
            view.route = route
            view.importedTrack = importedTrack
            view.snapPreview = snapPreview
            view.marks = marks
            view.invalidateCachedPaths()
        }
        view.importedCursorPoint = importedCursorPoint
        view.snappedCursorPoint = snappedCursorPoint
        if view.centerPoint != center || view.radiusM != radiusM {
            view.centerPoint = center
            view.radiusM = radiusM
            view.invalidateCachedPaths()
        }
        view.selectedMarkID = selectedMarkID
        view.disconnectedMarkIDs = disconnectedMarkIDs
        view.onClick = onClick
        if view.commandRevision != commandRevision {
            view.commandRevision = commandRevision
            switch command {
            case .none: break
            case .reset: view.resetView()
            case .zoom(let factor): view.zoomFromCenter(by: factor)
            }
        }
        view.needsDisplay = true
    }
}

final class RoadMapNSView: NSView {
    var roads: [Road] = []
    var route: [GeoPoint] = []
    var importedTrack: [GeoPoint] = []
    var snapPreview: [GeoPoint] = []
    var importedCursorPoint: GeoPoint?
    var snappedCursorPoint: GeoPoint?
    var marks: [RouteMark] = []
    var centerPoint = GeoPoint(lat: 0, lon: 0)
    var radiusM = 1000.0
    var selectedMarkID: Int?
    var disconnectedMarkIDs: Set<Int> = []
    var onClick: ((GeoPoint) -> Void)?
    var commandRevision = 0
    var contentRevision = -1

    private var scale = 1.0
    private var offset = CGPoint.zero
    private var dragStart: CGPoint?
    private var dragOrigin = CGPoint.zero
    private var dragged = false
    private var cachedMajorRoads: NSBezierPath?
    private var cachedMinorRoads: NSBezierPath?
    private var cachedImportedTrack: NSBezierPath?
    private var cachedSnapPreview: NSBezierPath?
    private var cachedRoute: NSBezierPath?

    override var isFlipped: Bool { true }
    override var intrinsicContentSize: NSSize { NSSize(width: NSView.noIntrinsicMetric, height: NSView.noIntrinsicMetric) }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func layout() {
        super.layout()
        invalidateCachedPaths()
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        NSColor.controlBackgroundColor.setFill()
        dirtyRect.fill()
        guard bounds.width > 0, bounds.height > 0 else { return }
        drawGrid()
        rebuildCachedPathsIfNeeded()
        stroke(cachedMinorRoads, color: NSColor.secondaryLabelColor.withAlphaComponent(0.48), width: 2)
        stroke(cachedMajorRoads, color: NSColor.labelColor.withAlphaComponent(0.58), width: 4)
        stroke(cachedImportedTrack, color: NSColor.systemBlue.withAlphaComponent(0.8), width: 3, dashPattern: [7, 5])
        stroke(cachedSnapPreview, color: NSColor.systemGreen.withAlphaComponent(0.9), width: 4)
        stroke(cachedRoute, color: NSColor.controlAccentColor, width: 4)
        if let importedCursorPoint {
            drawCursorPoint(importedCursorPoint, color: .systemBlue, filled: false)
        }
        if let snappedCursorPoint {
            drawCursorPoint(snappedCursorPoint, color: .systemGreen, filled: true)
        }
        for (index, mark) in marks.sorted(by: { $0.time < $1.time }).enumerated() {
            drawMark(
                mark,
                label: "T\(index + 1)",
                selected: mark.id == selectedMarkID,
                disconnected: disconnectedMarkIDs.contains(mark.id)
            )
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
        invalidateCachedPaths()
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
        invalidateCachedPaths()
        needsDisplay = true
    }

    func zoomFromCenter(by factor: Double) {
        zoom(by: factor, around: CGPoint(x: bounds.midX, y: bounds.midY))
    }

    private func zoom(by factor: Double, around point: CGPoint) {
        let oldScale = scale
        scale = min(24, max(0.5, scale * factor))
        let applied = scale / oldScale
        offset = CGPoint(
            x: point.x - (point.x - offset.x) * applied,
            y: point.y - (point.y - offset.y) * applied
        )
        invalidateCachedPaths()
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
        let side = max(1, min(self.bounds.width, self.bounds.height))
        let originX = (self.bounds.width - side) / 2
        let originY = (self.bounds.height - side) / 2
        return CGPoint(
            x: originX + (point.lon - bounds.minLon) / (bounds.maxLon - bounds.minLon) * side,
            y: originY + side - (point.lat - bounds.minLat) / (bounds.maxLat - bounds.minLat) * side
        )
    }

    private func unproject(_ point: CGPoint) -> GeoPoint {
        let bounds = MapBounds(center: centerPoint, radiusM: radiusM)
        let side = max(1, min(self.bounds.width, self.bounds.height))
        let originX = (self.bounds.width - side) / 2
        let originY = (self.bounds.height - side) / 2
        return GeoPoint(
            lat: bounds.minLat + (side - (point.y - originY)) / side * (bounds.maxLat - bounds.minLat),
            lon: bounds.minLon + (point.x - originX) / side * (bounds.maxLon - bounds.minLon)
        )
    }

    func invalidateCachedPaths() {
        cachedMajorRoads = nil
        cachedMinorRoads = nil
        cachedImportedTrack = nil
        cachedSnapPreview = nil
        cachedRoute = nil
    }

    private func rebuildCachedPathsIfNeeded() {
        guard cachedMajorRoads == nil else { return }
        let major = NSBezierPath()
        let minor = NSBezierPath()
        for road in roads {
            append(road.points.map(\.geo), to: isMajorRoad(road.highway) ? major : minor)
        }
        cachedMajorRoads = major
        cachedMinorRoads = minor
        cachedImportedTrack = path(for: importedTrack)
        cachedSnapPreview = path(for: snapPreview)
        cachedRoute = path(for: route)
    }

    private func path(for points: [GeoPoint]) -> NSBezierPath {
        let path = NSBezierPath()
        append(points, to: path)
        return path
    }

    private func append(_ points: [GeoPoint], to path: NSBezierPath) {
        guard points.count > 1 else { return }
        path.move(to: mapToScreen(project(points[0])))
        for point in points.dropFirst() { path.line(to: mapToScreen(project(point))) }
    }

    private func stroke(_ path: NSBezierPath?, color: NSColor, width: CGFloat, dashPattern: [CGFloat] = []) {
        guard let path, !path.isEmpty else { return }
        path.lineCapStyle = .round
        path.lineJoinStyle = .round
        path.lineWidth = width
        path.setLineDash(dashPattern, count: dashPattern.count, phase: 0)
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
        NSColor.separatorColor.withAlphaComponent(0.28).setStroke()
        path.stroke()
    }

    private func drawMark(_ mark: RouteMark, label: String, selected: Bool, disconnected: Bool) {
        let point = mapToScreen(project(mark.point))
        let rect = CGRect(x: point.x - 7, y: point.y - 7, width: 14, height: 14)
        let color = disconnected ? NSColor.systemRed : (selected ? NSColor.systemGreen : NSColor.systemOrange)
        color.setFill()
        NSBezierPath(ovalIn: rect).fill()
        let attrs: [NSAttributedString.Key: Any] = [.foregroundColor: color, .font: NSFont.monospacedSystemFont(ofSize: 10, weight: .semibold)]
        label.draw(at: CGPoint(x: point.x + 10, y: point.y - 7), withAttributes: attrs)
    }

    private func drawCursorPoint(_ geoPoint: GeoPoint, color: NSColor, filled: Bool) {
        let point = mapToScreen(project(geoPoint))
        let outerRect = CGRect(x: point.x - 8, y: point.y - 8, width: 16, height: 16)
        let innerRect = CGRect(x: point.x - 3, y: point.y - 3, width: 6, height: 6)
        let outer = NSBezierPath(ovalIn: outerRect)
        outer.lineWidth = 3
        color.setStroke()
        outer.stroke()
        if filled {
            color.setFill()
            NSBezierPath(ovalIn: innerRect).fill()
        }
    }

    private func drawCenter() {
        let point = mapToScreen(project(centerPoint))
        let path = NSBezierPath()
        path.move(to: CGPoint(x: point.x - 10, y: point.y)); path.line(to: CGPoint(x: point.x + 10, y: point.y))
        path.move(to: CGPoint(x: point.x, y: point.y - 10)); path.line(to: CGPoint(x: point.x, y: point.y + 10))
        NSColor.controlAccentColor.setStroke()
        path.stroke()
    }

    private func isMajorRoad(_ highway: String) -> Bool {
        ["primary", "secondary", "tertiary"].contains(highway)
    }
}
