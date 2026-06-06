import Foundation
import Observation

@MainActor
@Observable
final class RouteLabModel {
    var latitude = 39.915
    var longitude = 116.405
    var radiusM = 1000.0
    var roads: [Road] = []
    var marks: [RouteMark] = []
    var cursorTime = Calendar.current.date(bySettingHour: 8, minute: 0, second: 0, of: .now) ?? .now
    var selectedMarkID: Int?
    var isLoading = false
    var status = "Enter a center coordinate and radius, then fetch roads."
    private var nextID = 1
    private let service = OSMRoadService()

    var center: GeoPoint { GeoPoint(lat: latitude, lon: longitude) }
    var orderedMarks: [RouteMark] { marks.sorted { $0.time < $1.time } }
    var hasDuplicateTimes: Bool {
        zip(orderedMarks, orderedMarks.dropFirst()).contains { $0.time >= $1.time }
    }
    var route: RouteResult { RouteEngine.buildTimedRoute(roads: roads, marks: orderedMarks) }
    var canExport: Bool { route.samples.count > 1 && route.disconnectedPair == nil && !hasDuplicateTimes }
    var statusText: String { status }
    var statusIsError: Bool {
        status.localizedCaseInsensitiveContains("failed") || status.localizedCaseInsensitiveContains("invalid")
    }
    var cursorSeconds: Double {
        get {
            cursorTime.timeIntervalSince(Calendar.current.startOfDay(for: cursorTime))
        }
        set {
            cursorTime = Calendar.current.startOfDay(for: cursorTime).addingTimeInterval(newValue)
        }
    }

    func fetchRoads() {
        guard (-90...90).contains(latitude), (-180...180).contains(longitude), (100...5000).contains(radiusM) else {
            status = "Latitude, longitude, or radius is invalid. Radius must be 100–5000 m."
            return
        }
        isLoading = true
        status = "Fetching OpenStreetMap roads…"
        Task {
            do {
                let fetched = try await service.fetchRoads(center: center, radiusM: radiusM)
                roads = fetched
                marks = []
                selectedMarkID = nil
                status = "Loaded \(fetched.count) roads. Choose a time, then click a road."
            } catch {
                status = "Road fetch failed: \(error.localizedDescription)"
            }
            isLoading = false
        }
    }

    func clickMap(at point: GeoPoint) {
        guard let projection = RouteEngine.projectToRoad(point, roads: roads) else { return }
        if let selectedMarkID, let index = marks.firstIndex(where: { $0.id == selectedMarkID }) {
            marks[index].roadID = projection.roadID
            marks[index].segmentIndex = projection.segmentIndex
            marks[index].segmentT = projection.segmentT
            marks[index].point = projection.point
            self.selectedMarkID = nil
            status = "Mark location updated."
        } else {
            marks.append(RouteMark(
                id: nextID, time: cursorTime, roadID: projection.roadID,
                segmentIndex: projection.segmentIndex, segmentT: projection.segmentT, point: projection.point
            ))
            nextID += 1
            status = "Added a road mark at \(cursorTime.formatted(date: .omitted, time: .standard))."
        }
    }

    func deleteMark(_ id: Int) {
        marks.removeAll { $0.id == id }
        if selectedMarkID == id { selectedMarkID = nil }
    }
    func clearMarks() { marks = []; selectedMarkID = nil }
    func undoMark() { _ = marks.popLast() }

    func updateTime(id: Int, time: Date) {
        guard let index = marks.firstIndex(where: { $0.id == id }) else { return }
        marks[index].time = time
    }

    func secondsForMark(_ id: Int) -> Double {
        guard let mark = marks.first(where: { $0.id == id }) else { return 0 }
        return mark.time.timeIntervalSince(Calendar.current.startOfDay(for: mark.time))
    }

    func updateMarkTime(_ id: Int, seconds: Double) {
        guard let mark = marks.first(where: { $0.id == id }) else { return }
        updateTime(id: id, time: Calendar.current.startOfDay(for: mark.time).addingTimeInterval(seconds))
    }

    func selectMarkForRelocation(_ id: Int) {
        selectedMarkID = id
        status = "Click a road to move the selected mark."
    }

    func export() {
        guard canExport else { return }
        do {
            try GeoJSONExporter.export(roads: roads, route: route, center: center, radiusM: radiusM)
        } catch {
            status = "Export failed: \(error.localizedDescription)"
        }
    }
}
