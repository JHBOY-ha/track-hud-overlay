import AppKit
import Foundation
import Observation
import UniformTypeIdentifiers

@MainActor
@Observable
final class RouteLabModel {
    var latitude = 39.915
    var longitude = 116.405
    var radiusM = 1000.0
    var roads: [Road] = []
    var importedTrack: ImportedTrack?
    var snapPreview: SnapPreview = .empty
    var snapDistanceM = 30.0 {
        didSet { rebuildSnapPreview() }
    }
    var showsOriginalTrack = true
    var showsSnapPreview = true
    var marks: [RouteMark] = []
    var route: RouteResult = .empty
    var cursorSeconds = 8.0 * 60 * 60
    var timelineHours = 24.0
    var timelineStartSeconds = 0.0
    var selectedMarkID: Int?
    var mapCommandRevision = 0
    var mapCommand: MapCommand = .none
    var isLoading = false
    var status = "输入中心坐标和半径，然后获取周边路网。"
    private var nextID = 1
    private let service = OSMRoadService()

    var center: GeoPoint { GeoPoint(lat: latitude, lon: longitude) }
    var importedCoordinates: [GeoPoint] { importedTrack?.coordinates ?? [] }
    var importedTimelineRange: ClosedRange<Double>? { importedTrack?.timelineRange }
    var importedCursorPoint: GeoPoint? {
        guard importedTimelineRange?.contains(cursorSeconds) == true else { return nil }
        return importedTrack?.point(at: cursorSeconds)
    }
    var snappedCursorPoint: GeoPoint? {
        guard importedTimelineRange?.contains(cursorSeconds) == true else { return nil }
        guard snapPreview.points.count == importedTrack?.points.count else { return nil }
        return importedTrack?.point(at: cursorSeconds, coordinates: snapPreview.points)
    }
    var orderedMarks: [RouteMark] { marks.sorted { $0.time < $1.time } }
    var hasDuplicateTimes: Bool {
        zip(orderedMarks, orderedMarks.dropFirst()).contains { $0.time >= $1.time }
    }
    var canExport: Bool { route.samples.count > 1 && route.disconnectedPair == nil && !hasDuplicateTimes }
    var statusText: String { status }
    var statusIsError: Bool {
        status.localizedCaseInsensitiveContains("failed")
            || status.localizedCaseInsensitiveContains("invalid")
            || status.localizedCaseInsensitiveContains("no roads")
            || status.contains("失败")
            || status.contains("无效")
            || status.contains("没有找到")
            || status.contains("过远")
    }
    var cursorTime: Date {
        Calendar.current.startOfDay(for: .now).addingTimeInterval(cursorSeconds)
    }
    var timelineEndSeconds: Double { min(86_399, timelineStartSeconds + timelineHours * 3600) }
    var routeIssueText: String? {
        if hasDuplicateTimes { return "时间标记必须严格递增且不能重复。" }
        if let pair = route.disconnectedPair { return "T\(pair + 1) 与 T\(pair + 2) 不在同一连通路网中。" }
        if marks.count < 2 { return "至少添加两个时间标记后才能导出。" }
        return nil
    }

    func fetchRoads() {
        guard (-90...90).contains(latitude), (-180...180).contains(longitude), (100...5000).contains(radiusM) else {
            status = "经纬度或半径无效，半径范围必须为 100–5000 米。"
            return
        }
        isLoading = true
        status = "正在获取 OpenStreetMap 路网..."
        Task {
            do {
                let fetched = try await service.fetchRoads(center: center, radiusM: radiusM)
                roads = fetched
                marks = []
                route = .empty
                selectedMarkID = nil
                if fetched.isEmpty {
                    status = "指定范围内没有找到道路。"
                } else {
                    status = "已载入 \(fetched.count) 条道路。选择时间后点击道路添加标记。"
                    resetMap()
                }
                rebuildSnapPreview()
            } catch {
                status = "路网获取失败：\(error.localizedDescription)"
            }
            isLoading = false
        }
    }

    func importTrack() {
        let panel = NSOpenPanel()
        panel.title = "导入 GPX 或 GeoJSON 轨迹"
        panel.prompt = "导入"
        panel.allowedContentTypes = ["gpx", "geojson", "json"].compactMap { UTType(filenameExtension: $0) }
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            let track = try TrackImportService.parse(data: Data(contentsOf: url), fileName: url.lastPathComponent)
            importedTrack = track
            snapPreview = .empty
            let bounds = MapBounds(points: track.coordinates, paddingM: 200)
            latitude = bounds.center.lat
            longitude = bounds.center.lon
            radiusM = max(250, bounds.radiusM)
            if let range = track.timelineRange {
                cursorSeconds = range.lowerBound
                revealCursor()
            }
            status = "已导入 \(track.name)，共 \(track.points.count) 个轨迹点。可补全路网并预览吸附效果。"
            resetMap()
            rebuildSnapPreview()
        } catch {
            status = "轨迹导入失败：\(error.localizedDescription)"
        }
    }

    func clearImportedTrack() {
        importedTrack = nil
        snapPreview = .empty
        status = "已移除导入轨迹。"
    }

    func completeRoadNetwork() {
        guard let track = importedTrack else {
            status = "请先导入 GPX 或 GeoJSON 轨迹。"
            return
        }
        let bounds = MapBounds(points: track.coordinates, paddingM: max(200, snapDistanceM * 4))
        guard bounds.radiusM <= 12_000 else {
            status = "导入轨迹范围过大，当前单次补全最多支持约 24 km 范围。"
            return
        }
        latitude = bounds.center.lat
        longitude = bounds.center.lon
        radiusM = max(250, bounds.radiusM)
        isLoading = true
        status = "正在补全导入轨迹周边路网..."
        Task {
            do {
                roads = try await service.fetchRoads(bounds: bounds)
                marks = []
                route = .empty
                selectedMarkID = nil
                rebuildSnapPreview()
                status = roads.isEmpty
                    ? "导入轨迹周边没有找到道路。"
                    : "已补全 \(roads.count) 条道路，吸附预览已更新。"
                resetMap()
            } catch {
                status = "路网补全失败：\(error.localizedDescription)"
            }
            isLoading = false
        }
    }

    func clickMap(at point: GeoPoint) {
        guard let projection = RouteEngine.projectToRoad(point, roads: roads) else {
            status = "请先获取路网，再添加标记。"
            return
        }
        guard projection.distanceM <= max(20, radiusM * 0.03) else {
            status = "点击位置离道路过远，请更靠近可见道路。"
            return
        }
        if let selectedMarkID, let index = marks.firstIndex(where: { $0.id == selectedMarkID }) {
            marks[index].roadID = projection.roadID
            marks[index].segmentIndex = projection.segmentIndex
            marks[index].segmentT = projection.segmentT
            marks[index].point = projection.point
            self.selectedMarkID = nil
            status = "标记位置已更新。"
        } else {
            marks.append(RouteMark(
                id: nextID, time: cursorTime, roadID: projection.roadID,
                segmentIndex: projection.segmentIndex, segmentT: projection.segmentT, point: projection.point
            ))
            nextID += 1
            status = "已在 \(cursorTime.formatted(date: .omitted, time: .standard)) 添加道路标记。"
        }
        rebuildRoute()
    }

    func deleteMark(_ id: Int) {
        marks.removeAll { $0.id == id }
        if selectedMarkID == id { selectedMarkID = nil }
        rebuildRoute()
    }
    func clearMarks() {
        marks = []
        selectedMarkID = nil
        rebuildRoute()
    }
    func undoMark() {
        _ = marks.popLast()
        rebuildRoute()
    }

    func updateTime(id: Int, time: Date, rebuild: Bool = true) {
        guard let index = marks.firstIndex(where: { $0.id == id }) else { return }
        marks[index].time = time
        if rebuild { rebuildRoute() }
    }

    func secondsForMark(_ id: Int) -> Double {
        guard let mark = marks.first(where: { $0.id == id }) else { return 0 }
        return mark.time.timeIntervalSince(Calendar.current.startOfDay(for: mark.time))
    }

    func updateMarkTime(_ id: Int, seconds: Double, rebuild: Bool = true) {
        guard let mark = marks.first(where: { $0.id == id }) else { return }
        updateTime(
            id: id,
            time: Calendar.current.startOfDay(for: mark.time).addingTimeInterval(seconds),
            rebuild: rebuild
        )
    }

    func rebuildCurrentRoute() { rebuildRoute() }

    func selectMarkForRelocation(_ id: Int) {
        selectedMarkID = id
        status = "点击道路，为选中的标记重新指定位置。"
    }

    func setTimelineHours(_ hours: Double) {
        timelineHours = hours
        timelineStartSeconds = min(timelineStartSeconds, max(0, 86_400 - hours * 3600))
        revealCursor()
    }

    func revealCursor() {
        let span = timelineHours * 3600
        if cursorSeconds < timelineStartSeconds || cursorSeconds > timelineStartSeconds + span {
            timelineStartSeconds = min(max(0, cursorSeconds - span / 2), max(0, 86_400 - span))
        }
    }

    func sendMapCommand(_ command: MapCommand) {
        mapCommand = command
        mapCommandRevision += 1
    }

    func resetMap() { sendMapCommand(.reset) }

    private func rebuildRoute() {
        route = RouteEngine.buildTimedRoute(roads: roads, marks: orderedMarks)
    }

    func rebuildSnapPreview() {
        snapPreview = RouteEngine.buildSnapPreview(
            points: importedCoordinates,
            roads: roads,
            maximumDistanceM: snapDistanceM
        )
    }

    func export() {
        guard canExport else { return }
        do {
            try GeoJSONExporter.export(roads: roads, route: route, center: center, radiusM: radiusM)
        } catch {
            status = "导出失败：\(error.localizedDescription)"
        }
    }

    var disconnectedMarkIDs: Set<Int> {
        guard let pair = route.disconnectedPair, orderedMarks.indices.contains(pair + 1) else { return [] }
        return [orderedMarks[pair].id, orderedMarks[pair + 1].id]
    }
}

enum MapCommand: Equatable {
    case none
    case reset
    case zoom(Double)
}
