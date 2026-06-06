import Foundation

enum RouteEngine {
    private struct Edge {
        var to: String
        var distance: Double
    }

    private struct QueueItem {
        var key: String
        var distance: Double
    }

    private struct MinHeap {
        private var items: [QueueItem] = []

        var isEmpty: Bool { items.isEmpty }

        mutating func push(_ item: QueueItem) {
            items.append(item)
            var index = items.count - 1
            while index > 0 {
                let parent = (index - 1) / 2
                guard items[index].distance < items[parent].distance else { break }
                items.swapAt(index, parent)
                index = parent
            }
        }

        mutating func pop() -> QueueItem? {
            guard !items.isEmpty else { return nil }
            if items.count == 1 { return items.removeLast() }
            let result = items[0]
            items[0] = items.removeLast()
            var index = 0
            while true {
                let left = index * 2 + 1
                let right = left + 1
                var smallest = index
                if left < items.count, items[left].distance < items[smallest].distance { smallest = left }
                if right < items.count, items[right].distance < items[smallest].distance { smallest = right }
                guard smallest != index else { break }
                items.swapAt(index, smallest)
                index = smallest
            }
            return result
        }
    }

    static func distanceM(_ a: GeoPoint, _ b: GeoPoint) -> Double {
        let lat = (a.lat + b.lat) / 2 * .pi / 180
        let dx = (b.lon - a.lon) * 111_320 * cos(lat)
        let dy = (b.lat - a.lat) * 110_540
        return hypot(dx, dy)
    }

    static func pathLength(_ points: [GeoPoint]) -> Double {
        guard points.count > 1 else { return 0 }
        return zip(points, points.dropFirst()).reduce(0) { $0 + distanceM($1.0, $1.1) }
    }

    static func projectToRoad(_ target: GeoPoint, roads: [Road]) -> RoadProjection? {
        var best: (RoadProjection, Double)?
        for road in roads {
            for index in 0..<(road.points.count - 1) {
                let a = road.points[index].geo
                let b = road.points[index + 1].geo
                let lat = (a.lat + b.lat + target.lat) / 3 * .pi / 180
                let sx = (b.lon - a.lon) * 111_320 * cos(lat)
                let sy = (b.lat - a.lat) * 110_540
                let px = (target.lon - a.lon) * 111_320 * cos(lat)
                let py = (target.lat - a.lat) * 110_540
                let len2 = sx * sx + sy * sy
                let t = max(0, min(1, len2 > 0 ? (px * sx + py * sy) / len2 : 0))
                let point = GeoPoint(lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t)
                let distance = distanceM(target, point)
                if best == nil || distance < best!.1 {
                    best = (RoadProjection(
                        roadID: road.id,
                        segmentIndex: index,
                        segmentT: t,
                        point: point,
                        distanceM: distance
                    ), distance)
                }
            }
        }
        return best?.0
    }

    static func buildSnapPreview(points: [GeoPoint], roads: [Road], maximumDistanceM: Double) -> SnapPreview {
        guard !points.isEmpty, !roads.isEmpty else { return .empty }
        var result: [GeoPoint] = []
        var offsets: [Double] = []
        for point in points {
            guard let projection = projectToRoad(point, roads: roads),
                  projection.distanceM <= maximumDistanceM else {
                result.append(point)
                continue
            }
            result.append(projection.point)
            offsets.append(projection.distanceM)
        }
        return SnapPreview(
            points: result,
            snappedCount: offsets.count,
            averageOffsetM: offsets.isEmpty ? 0 : offsets.reduce(0, +) / Double(offsets.count),
            maxOffsetM: offsets.max() ?? 0
        )
    }

    static func buildTimedRoute(roads: [Road], marks input: [RouteMark], sampleHz: Double = 10) -> RouteResult {
        let marks = input.sorted { $0.time < $1.time }
        guard marks.count >= 2 else { return .empty }
        let built = buildGraph(roads: roads, marks: marks)
        var segments: [(points: [GeoPoint], start: Date, end: Date, length: Double)] = []
        var path: [GeoPoint] = []
        for index in 1..<marks.count {
            let segment = shortestPath(
                graph: built.graph, points: built.points,
                start: markKey(marks[index - 1]), end: markKey(marks[index])
            )
            guard !segment.isEmpty else {
                return RouteResult(path: [], samples: [], lengthM: 0, disconnectedPair: index - 1)
            }
            let length = pathLength(segment)
            segments.append((segment, marks[index - 1].time, marks[index].time, length))
            path.append(contentsOf: path.isEmpty ? segment : Array(segment.dropFirst()))
        }
        let totalLength = segments.reduce(0) { $0 + $1.length }
        var distanceBefore = 0.0
        var samples: [TimedRoutePoint] = []
        for segment in segments {
            let duration = segment.end.timeIntervalSince(segment.start)
            let count = max(1, Int((duration * sampleHz).rounded()))
            for index in 0...count {
                if !samples.isEmpty && index == 0 { continue }
                let fraction = Double(index) / Double(count)
                samples.append(TimedRoutePoint(
                    point: point(at: segment.length * fraction, on: segment.points),
                    time: segment.start.addingTimeInterval(duration * fraction),
                    progress: totalLength > 0 ? (distanceBefore + segment.length * fraction) / totalLength : 0
                ))
            }
            distanceBefore += segment.length
        }
        if let lastIndex = samples.indices.last { samples[lastIndex].progress = 1 }
        return RouteResult(path: path, samples: samples, lengthM: totalLength, disconnectedPair: nil)
    }

    private static func markKey(_ mark: RouteMark) -> String { "mark:\(mark.id)" }

    private static func buildGraph(roads: [Road], marks: [RouteMark]) -> (graph: [String: [Edge]], points: [String: GeoPoint]) {
        var graph: [String: [Edge]] = [:]
        var points: [String: GeoPoint] = [:]
        func add(_ from: String, _ to: String, _ a: GeoPoint, _ b: GeoPoint) {
            points[from] = a; points[to] = b
            let distance = distanceM(a, b)
            graph[from, default: []].append(Edge(to: to, distance: distance))
            graph[to, default: []].append(Edge(to: from, distance: distance))
        }
        for road in roads {
            for index in 0..<(road.points.count - 1) {
                let a = road.points[index], b = road.points[index + 1]
                let segmentMarks = marks
                    .filter { $0.roadID == road.id && $0.segmentIndex == index }
                    .sorted { $0.segmentT < $1.segmentT }
                var chain = [("node:\(a.nodeID)", a.geo)]
                chain.append(contentsOf: segmentMarks.map { (markKey($0), $0.point) })
                chain.append(("node:\(b.nodeID)", b.geo))
                for item in zip(chain, chain.dropFirst()) { add(item.0.0, item.1.0, item.0.1, item.1.1) }
            }
        }
        return (graph, points)
    }

    private static func shortestPath(graph: [String: [Edge]], points: [String: GeoPoint], start: String, end: String) -> [GeoPoint] {
        if start == end, let point = points[start] { return [point] }
        var distances = [start: 0.0]
        var previous: [String: String] = [:]
        var visited: Set<String> = []
        var queue = MinHeap()
        queue.push(QueueItem(key: start, distance: 0))
        while let item = queue.pop() {
            if visited.contains(item.key) { continue }
            visited.insert(item.key)
            if item.key == end { break }
            for edge in graph[item.key] ?? [] {
                let next = item.distance + edge.distance
                if next < (distances[edge.to] ?? .infinity) {
                    distances[edge.to] = next
                    previous[edge.to] = item.key
                    queue.push(QueueItem(key: edge.to, distance: next))
                }
            }
        }
        guard previous[end] != nil else { return [] }
        var keys = [end]
        while keys[0] != start {
            guard let prior = previous[keys[0]] else { return [] }
            keys.insert(prior, at: 0)
        }
        return keys.compactMap { points[$0] }
    }

    private static func point(at target: Double, on points: [GeoPoint]) -> GeoPoint {
        var passed = 0.0
        for index in 1..<points.count {
            let length = distanceM(points[index - 1], points[index])
            if passed + length >= target {
                let t = length > 0 ? (target - passed) / length : 0
                return GeoPoint(
                    lat: points[index - 1].lat + (points[index].lat - points[index - 1].lat) * t,
                    lon: points[index - 1].lon + (points[index].lon - points[index - 1].lon) * t
                )
            }
            passed += length
        }
        return points.last!
    }
}
