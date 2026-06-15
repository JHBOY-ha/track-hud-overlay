import AppKit
import AVFoundation
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
    var importedTrack: ImportedTrack? {
        didSet {
            importedCoordinates = importedTrack?.coordinates ?? []
            importedTimelineSeconds = importedTrack?.timelineSeconds ?? []
            mapContentRevision += 1
        }
    }
    private(set) var importedCoordinates: [GeoPoint] = []
    private var importedTimelineSeconds: [Double] = []
    var snapPreview: SnapPreview = .empty
    var snapDistanceM = 30.0 {
        didSet { rebuildSnapPreview() }
    }
    var showsOriginalTrack = true { didSet { mapContentRevision += 1 } }
    var showsSnapPreview = true { didSet { mapContentRevision += 1 } }
    var marks: [RouteMark] = []
    var route: RouteResult = .empty {
        didSet {
            routeSampleSeconds = route.samples.map {
                $0.time.timeIntervalSince(Calendar.current.startOfDay(for: $0.time))
            }
            mapContentRevision += 1
        }
    }
    private var routeSampleSeconds: [Double] = []
    var importedVideo: ImportedVideo?
    @ObservationIgnored var videoPlayer: AVPlayer?
    var showsVideoPreview = true
    var cursorSeconds = 8.0 * 60 * 60
    var isPlaying = false
    var playbackRate = 1.0
    private var lastPlaybackDirection = 1.0
    var timelineHours = 24.0
    var timelineStartSeconds = 0.0
    var selectedMarkID: Int?
    var mapCommandRevision = 0
    var mapCommand: MapCommand = .none
    var mapContentRevision = 0
    var isLoading = false
    var status = "输入中心坐标和半径，然后获取周边路网。"
    private var nextID = 1
    private let service = OSMRoadService()
    private var playbackTask: Task<Void, Never>?

    var center: GeoPoint { GeoPoint(lat: latitude, lon: longitude) }
    var importedTimelineRange: ClosedRange<Double>? {
        guard let first = importedTimelineSeconds.first, let last = importedTimelineSeconds.last else { return nil }
        return first ... last
    }
    var importedCursorPoint: GeoPoint? {
        guard importedTimelineRange?.contains(cursorSeconds) == true else { return nil }
        return importedTrack?.point(
            at: cursorSeconds,
            coordinates: importedCoordinates,
            timelineSeconds: importedTimelineSeconds
        )
    }
    var snappedCursorPoint: GeoPoint? {
        guard importedTimelineRange?.contains(cursorSeconds) == true else { return nil }
        guard snapPreview.points.count == importedTrack?.points.count else { return nil }
        return importedTrack?.point(
            at: cursorSeconds,
            coordinates: snapPreview.points,
            timelineSeconds: importedTimelineSeconds
        )
    }
    var routeTimelineRange: ClosedRange<Double>? {
        guard let first = routeSampleSeconds.first, let last = routeSampleSeconds.last else { return nil }
        return first ... last
    }
    var routeCursorPoint: GeoPoint? {
        guard routeTimelineRange?.contains(cursorSeconds) == true,
              route.samples.count == routeSampleSeconds.count else { return nil }
        if cursorSeconds <= routeSampleSeconds[0] { return route.samples[0].point }
        if cursorSeconds >= routeSampleSeconds[routeSampleSeconds.count - 1] { return route.samples.last?.point }
        var low = 1
        var high = routeSampleSeconds.count - 1
        while low < high {
            let middle = (low + high) / 2
            if routeSampleSeconds[middle] < cursorSeconds {
                low = middle + 1
            } else {
                high = middle
            }
        }
        let duration = routeSampleSeconds[low] - routeSampleSeconds[low - 1]
        let fraction = duration > 0 ? (cursorSeconds - routeSampleSeconds[low - 1]) / duration : 0
        let a = route.samples[low - 1].point
        let b = route.samples[low].point
        return GeoPoint(
            lat: a.lat + (b.lat - a.lat) * fraction,
            lon: a.lon + (b.lon - a.lon) * fraction
        )
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
    var videoTimelineRange: ClosedRange<Double>? { importedVideo?.timelineRange }
    var playbackRange: ClosedRange<Double> {
        let ranges = [importedTimelineRange, routeTimelineRange, videoTimelineRange].compactMap { $0 }
        guard let lower = ranges.map(\.lowerBound).min(),
              let upper = ranges.map(\.upperBound).max() else { return 0 ... 86_399 }
        return lower ... upper
    }
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
        pausePlayback()
        let panel = NSOpenPanel()
        panel.title = "导入 GPX 或 GeoJSON 轨迹"
        panel.prompt = "导入"
        panel.allowedContentTypes = ["gpx", "geojson", "json"].compactMap { UTType(filenameExtension: $0) }
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        isLoading = true
        status = "正在读取并解析文件..."
        Task {
            do {
                let fileName = url.lastPathComponent
                let document = try await Task.detached(priority: .userInitiated) {
                    try TrackImportService.parse(data: Data(contentsOf: url), fileName: fileName)
                }.value
                let track = document.track
                let bounds = MapBounds(points: track.coordinates, paddingM: 200)
                importedTrack = track
                roads = document.referenceRoads
                marks = []
                route = .empty
                selectedMarkID = nil
                snapPreview = .empty
                latitude = bounds.center.lat
                longitude = bounds.center.lon
                radiusM = max(250, bounds.radiusM)
                if let range = track.timelineRange {
                    cursorSeconds = range.lowerBound
                    revealCursor()
                }
                let hasReferenceRoads = !document.referenceRoads.isEmpty
                status = hasReferenceRoads
                    ? "已导入 \(track.name)，识别到 \(document.referenceRoads.count) 条参考道路，正在计算吸附预览..."
                    : "已导入 \(track.name)，共 \(track.points.count) 个轨迹点。可补全路网并预览吸附效果。"
                resetMap()
                if hasReferenceRoads {
                    await rebuildSnapPreviewInBackground()
                    status = "已导入 \(track.name)，识别到 \(document.referenceRoads.count) 条参考道路，吸附预览已更新。"
                }
            } catch {
                status = "轨迹导入失败：\(error.localizedDescription)"
            }
            isLoading = false
        }
    }

    func clearImportedTrack() {
        pausePlayback()
        importedTrack = nil
        snapPreview = .empty
        status = "已移除导入轨迹。"
    }

    func importVideo() {
        pausePlayback()
        let panel = NSOpenPanel()
        panel.title = "导入视频"
        panel.prompt = "导入"
        panel.allowedContentTypes = ["mov", "mp4", "m4v"].compactMap { UTType(filenameExtension: $0) }
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        isLoading = true
        status = "正在读取视频与内置 timecode..."
        Task {
            do {
                let video = try await VideoImportService.load(url: url)
                videoPlayer = AVPlayer(url: video.url)
                videoPlayer?.actionAtItemEnd = .pause
                importedVideo = video
                cursorSeconds = video.startSeconds
                showsVideoPreview = true
                revealCursor()
                seekVideo()
                if let timecode = video.embeddedTimecode {
                    status = "已导入 \(video.name)，读取到 \(formatTimecode(timecode.seconds, fps: timecode.fps)) @ \(timecode.fps.formatted()) fps。"
                } else {
                    status = "已导入 \(video.name)，未发现内置 tmcd timecode，视频从 00:00:00 开始。"
                }
            } catch {
                status = "视频导入失败：\(error.localizedDescription)"
            }
            isLoading = false
        }
    }

    func clearImportedVideo() {
        pausePlayback()
        videoPlayer = nil
        importedVideo = nil
        status = "已移除导入视频。"
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
                if roads.isEmpty {
                    status = "导入轨迹周边没有找到道路。"
                } else {
                    status = "已补全 \(roads.count) 条道路，正在计算吸附预览..."
                    resetMap()
                    await rebuildSnapPreviewInBackground()
                    status = "已补全 \(roads.count) 条道路，吸附预览已更新。"
                }
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

    func deleteSelectedMark() {
        guard let selectedMarkID else { return }
        deleteMark(selectedMarkID)
        status = "已删除选中的时间标记。"
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
        status = "已选中时间标记。按 Delete 删除，或点击道路重新指定位置。"
    }

    func setTimelineHours(_ hours: Double) {
        timelineHours = min(24, max(1.0 / 60, hours))
        timelineStartSeconds = min(timelineStartSeconds, max(0, 86_400 - timelineHours * 3600))
        revealCursor()
    }

    func panTimeline(byVisibleFraction fraction: Double) {
        let span = timelineHours * 3600
        timelineStartSeconds = min(
            max(0, timelineStartSeconds + span * fraction),
            max(0, 86_400 - span)
        )
    }

    func zoomTimeline(by factor: Double, anchorFraction: Double) {
        let oldSpan = timelineHours * 3600
        let anchor = timelineStartSeconds + oldSpan * min(1, max(0, anchorFraction))
        let newSpan = min(86_400, max(60, oldSpan * factor))
        timelineHours = newSpan / 3600
        timelineStartSeconds = min(
            max(0, anchor - newSpan * min(1, max(0, anchorFraction))),
            max(0, 86_400 - newSpan)
        )
    }

    func togglePlayback() {
        isPlaying ? pausePlayback() : play()
    }

    func play(direction: Double? = nil, speed: Double? = nil) {
        let direction = direction ?? lastPlaybackDirection
        let speed = speed ?? abs(playbackRate)
        playbackRate = (direction < 0 ? -1 : 1) * max(1, speed)
        lastPlaybackDirection = playbackRate < 0 ? -1 : 1
        guard !isPlaying else {
            syncVideoPlayback()
            return
        }
        let range = playbackRange
        if cursorSeconds < range.lowerBound || cursorSeconds > range.upperBound
            || (playbackRate > 0 && cursorSeconds >= range.upperBound)
            || (playbackRate < 0 && cursorSeconds <= range.lowerBound) {
            cursorSeconds = playbackRate < 0 ? range.upperBound : range.lowerBound
            revealCursor()
        }
        isPlaying = true
        seekVideo()
        syncVideoPlayback()
        playbackTask?.cancel()
        playbackTask = Task { [weak self] in
            var previous = Date.now
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(16))
                guard !Task.isCancelled, let self else { return }
                let now = Date.now
                let elapsed = now.timeIntervalSince(previous)
                previous = now
                self.advancePlayback(by: elapsed)
            }
        }
    }

    func shuttleReverse() {
        let nextSpeed = isPlaying && playbackRate < 0 ? nextShuttleSpeed(abs(playbackRate)) : 1
        play(direction: -1, speed: nextSpeed)
    }

    func shuttleForward() {
        let nextSpeed = isPlaying && playbackRate > 0 ? nextShuttleSpeed(abs(playbackRate)) : 1
        play(direction: 1, speed: nextSpeed)
    }

    private func nextShuttleSpeed(_ speed: Double) -> Double {
        if speed < 2 { return 2 }
        if speed < 4 { return 4 }
        return 1
    }

    func pausePlayback() {
        isPlaying = false
        videoPlayer?.pause()
        playbackTask?.cancel()
        playbackTask = nil
    }

    func scrubTimeline(to seconds: Double) {
        pausePlayback()
        cursorSeconds = min(86_399, max(0, seconds))
        seekVideo()
    }

    func advancePlayback(by seconds: Double) {
        guard isPlaying else { return }
        let range = playbackRange
        cursorSeconds = min(range.upperBound, max(range.lowerBound, cursorSeconds + max(0, seconds) * playbackRate))
        revealCursor()
        syncVideoPlayback()
        if cursorSeconds <= range.lowerBound || cursorSeconds >= range.upperBound {
            pausePlayback()
        }
    }

    private func syncVideoPlayback() {
        guard let range = videoTimelineRange, let videoPlayer else { return }
        if range.contains(cursorSeconds) {
            if playbackRate < 0 {
                videoPlayer.pause()
                seekVideo()
            } else {
                if videoPlayer.rate == 0 { seekVideo() }
                videoPlayer.rate = Float(playbackRate)
            }
        } else {
            videoPlayer.pause()
        }
    }

    private func seekVideo() {
        guard let video = importedVideo, let videoPlayer else { return }
        let seconds = min(video.duration, max(0, cursorSeconds - video.startSeconds))
        videoPlayer.seek(
            to: CMTime(seconds: seconds, preferredTimescale: 600),
            toleranceBefore: .zero,
            toleranceAfter: .zero
        )
    }

    private func formatTimecode(_ seconds: Double, fps: Double) -> String {
        let roundedFPS = max(1, Int(fps.rounded()))
        let totalFrames = max(0, Int((seconds * Double(roundedFPS)).rounded()))
        let frame = totalFrames % roundedFPS
        let totalSeconds = totalFrames / roundedFPS
        return String(
            format: "%02d:%02d:%02d:%02d",
            totalSeconds / 3600,
            totalSeconds % 3600 / 60,
            totalSeconds % 60,
            frame
        )
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
        mapContentRevision += 1
    }

    private func rebuildSnapPreviewInBackground() async {
        let coords = importedCoordinates
        let roadsSnapshot = roads
        let distM = snapDistanceM
        let preview = await Task.detached(priority: .userInitiated) {
            RouteEngine.buildSnapPreview(points: coords, roads: roadsSnapshot, maximumDistanceM: distM)
        }.value
        snapPreview = preview
        mapContentRevision += 1
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
