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

    private struct SegmentKey: Hashable {
        var roadID: String
        var segmentIndex: Int
    }

    private struct RoadSegment {
        var roadID: String
        var index: Int
        var a: GeoPoint
        var b: GeoPoint
    }

    private struct GridKey: Hashable {
        var x: Int
        var y: Int
    }

    private struct RoadProjectionIndex {
        var segments: [RoadSegment] = []
        var buckets: [GridKey: [Int]] = [:]
        var cellSizeM: Double
        var lonScale: Double

        init(roads: [Road], cellSizeM: Double) {
            self.cellSizeM = cellSizeM
            let latitude = roads.first?.points.first?.lat ?? 0
            lonScale = 111_320 * cos(latitude * .pi / 180)
            for road in roads {
                for index in 0..<(road.points.count - 1) {
                    let segment = RoadSegment(
                        roadID: road.id,
                        index: index,
                        a: road.points[index].geo,
                        b: road.points[index + 1].geo
                    )
                    let segmentIndex = segments.count
                    segments.append(segment)
                    let a = gridCoordinates(segment.a)
                    let b = gridCoordinates(segment.b)
                    let minX = Int(floor(min(a.x, b.x) / cellSizeM))
                    let maxX = Int(floor(max(a.x, b.x) / cellSizeM))
                    let minY = Int(floor(min(a.y, b.y) / cellSizeM))
                    let maxY = Int(floor(max(a.y, b.y) / cellSizeM))
                    for x in minX...maxX {
                        for y in minY...maxY {
                            buckets[GridKey(x: x, y: y), default: []].append(segmentIndex)
                        }
                    }
                }
            }
        }

        func project(_ target: GeoPoint, maximumDistanceM: Double) -> RoadProjection? {
            let point = gridCoordinates(target)
            let centerX = Int(floor(point.x / cellSizeM))
            let centerY = Int(floor(point.y / cellSizeM))
            let radius = max(1, Int(ceil(maximumDistanceM / cellSizeM)))
            var candidates: Set<Int> = []
            for x in (centerX - radius)...(centerX + radius) {
                for y in (centerY - radius)...(centerY + radius) {
                    candidates.formUnion(buckets[GridKey(x: x, y: y)] ?? [])
                }
            }
            var best: RoadProjection?
            for index in candidates {
                let projection = RouteEngine.project(target, onto: segments[index])
                if projection.distanceM <= maximumDistanceM,
                   best == nil || projection.distanceM < best!.distanceM {
                    best = projection
                }
            }
            return best
        }

        private func gridCoordinates(_ point: GeoPoint) -> (x: Double, y: Double) {
            (point.lon * lonScale, point.lat * 110_540)
        }
    }

    private struct PathSampler {
        var points: [GeoPoint]
        var cumulativeDistances: [Double]

        init(_ points: [GeoPoint]) {
            self.points = points
            cumulativeDistances = [0]
            cumulativeDistances.reserveCapacity(points.count)
            for index in 1..<points.count {
                cumulativeDistances.append(
                    cumulativeDistances[index - 1] + RouteEngine.distanceM(points[index - 1], points[index])
                )
            }
        }

        var length: Double { cumulativeDistances.last ?? 0 }

        func point(at target: Double) -> GeoPoint {
            guard points.count > 1 else { return points[0] }
            let bounded = min(length, max(0, target))
            var low = 1
            var high = cumulativeDistances.count - 1
            while low < high {
                let middle = (low + high) / 2
                if cumulativeDistances[middle] < bounded {
                    low = middle + 1
                } else {
                    high = middle
                }
            }
            let segmentStart = cumulativeDistances[low - 1]
            let segmentLength = cumulativeDistances[low] - segmentStart
            let fraction = segmentLength > 0 ? (bounded - segmentStart) / segmentLength : 0
            return GeoPoint(
                lat: points[low - 1].lat + (points[low].lat - points[low - 1].lat) * fraction,
                lon: points[low - 1].lon + (points[low].lon - points[low - 1].lon) * fraction
            )
        }
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
        var best: RoadProjection?
        for road in roads {
            for index in 0..<(road.points.count - 1) {
                let projection = project(target, onto: RoadSegment(
                    roadID: road.id,
                    index: index,
                    a: road.points[index].geo,
                    b: road.points[index + 1].geo
                ))
                if best == nil || projection.distanceM < best!.distanceM {
                    best = projection
                }
            }
        }
        return best
    }

    static func buildSnapPreview(points: [GeoPoint], roads: [Road], maximumDistanceM: Double) -> SnapPreview {
        guard !points.isEmpty, !roads.isEmpty else { return .empty }
        let index = RoadProjectionIndex(roads: roads, cellSizeM: max(10, maximumDistanceM))
        var result: [GeoPoint] = []
        var offsets: [Double] = []
        result.reserveCapacity(points.count)
        offsets.reserveCapacity(points.count)
        for point in points {
            guard let projection = index.project(point, maximumDistanceM: maximumDistanceM) else {
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

    private static func project(_ target: GeoPoint, onto segment: RoadSegment) -> RoadProjection {
        let lat = (segment.a.lat + segment.b.lat + target.lat) / 3 * .pi / 180
        let sx = (segment.b.lon - segment.a.lon) * 111_320 * cos(lat)
        let sy = (segment.b.lat - segment.a.lat) * 110_540
        let px = (target.lon - segment.a.lon) * 111_320 * cos(lat)
        let py = (target.lat - segment.a.lat) * 110_540
        let len2 = sx * sx + sy * sy
        let t = max(0, min(1, len2 > 0 ? (px * sx + py * sy) / len2 : 0))
        let point = GeoPoint(
            lat: segment.a.lat + (segment.b.lat - segment.a.lat) * t,
            lon: segment.a.lon + (segment.b.lon - segment.a.lon) * t
        )
        return RoadProjection(
            roadID: segment.roadID,
            segmentIndex: segment.index,
            segmentT: t,
            point: point,
            distanceM: distanceM(target, point)
        )
    }

    static func buildTimedRoute(roads: [Road], marks input: [RouteMark], sampleHz: Double = 10) -> RouteResult {
        let marks = input.sorted { $0.time < $1.time }
        guard marks.count >= 2 else { return .empty }
        let built = buildGraph(roads: roads, marks: marks)
        var segments: [(sampler: PathSampler, start: Date, end: Date)] = []
        var path: [GeoPoint] = []
        for index in 1..<marks.count {
            let segment = shortestPath(
                graph: built.graph, points: built.points,
                start: markKey(marks[index - 1]), end: markKey(marks[index])
            )
            guard !segment.isEmpty else {
                return RouteResult(path: [], samples: [], lengthM: 0, disconnectedPair: index - 1)
            }
            segments.append((PathSampler(segment), marks[index - 1].time, marks[index].time))
            path.append(contentsOf: path.isEmpty ? segment : Array(segment.dropFirst()))
        }
        let totalLength = segments.reduce(0) { $0 + $1.sampler.length }
        var distanceBefore = 0.0
        var samples: [TimedRoutePoint] = []
        for segment in segments {
            let duration = segment.end.timeIntervalSince(segment.start)
            let count = max(1, Int((duration * sampleHz).rounded()))
            for index in 0...count {
                if !samples.isEmpty && index == 0 { continue }
                let fraction = Double(index) / Double(count)
                samples.append(TimedRoutePoint(
                    point: segment.sampler.point(at: segment.sampler.length * fraction),
                    time: segment.start.addingTimeInterval(duration * fraction),
                    progress: totalLength > 0 ? (distanceBefore + segment.sampler.length * fraction) / totalLength : 0
                ))
            }
            distanceBefore += segment.sampler.length
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
        let marksBySegment = Dictionary(grouping: marks) {
            SegmentKey(roadID: $0.roadID, segmentIndex: $0.segmentIndex)
        }
        for road in roads {
            for index in 0..<(road.points.count - 1) {
                let a = road.points[index], b = road.points[index + 1]
                let segmentMarks = (marksBySegment[SegmentKey(roadID: road.id, segmentIndex: index)] ?? [])
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
        var current = end
        while current != start {
            guard let prior = previous[current] else { return [] }
            keys.append(prior)
            current = prior
        }
        return keys.reversed().compactMap { points[$0] }
    }
}
