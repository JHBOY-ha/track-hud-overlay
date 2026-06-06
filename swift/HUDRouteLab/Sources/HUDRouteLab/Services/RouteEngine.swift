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
        var wayID: Int
        var index: Int
        var a: GeoPoint
        var b: GeoPoint
    }

    private struct MatchCandidate {
        var projection: RoadProjection
        var wayID: Int
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
            let wayIDs = RouteEngine.mergedWayIDs(roads: roads)
            for (roadIndex, road) in roads.enumerated() {
                for index in 0..<(road.points.count - 1) {
                    let segment = RoadSegment(
                        roadID: road.id,
                        wayID: wayIDs[roadIndex],
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
            candidates(for: target, maximumDistanceM: maximumDistanceM, limit: 1).first?.projection
        }

        func candidates(for target: GeoPoint, maximumDistanceM: Double, limit: Int = 6) -> [MatchCandidate] {
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
            var bestByWay: [Int: RoadProjection] = [:]
            for segmentIndex in candidates {
                let segment = segments[segmentIndex]
                let projection = RouteEngine.project(target, onto: segment)
                guard projection.distanceM <= maximumDistanceM else { continue }
                if bestByWay[segment.wayID] == nil || projection.distanceM < bestByWay[segment.wayID]!.distanceM {
                    bestByWay[segment.wayID] = projection
                }
            }
            return bestByWay
                .map { MatchCandidate(projection: $0.value, wayID: $0.key) }
                .sorted { $0.projection.distanceM < $1.projection.distanceM }
                .prefix(limit)
                .map { $0 }
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
                    wayID: 0,
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
        let candidateSets = points.map { index.candidates(for: $0, maximumDistanceM: maximumDistanceM) }
        let matched = matchContinuousCandidates(
            points: points,
            candidateSets: candidateSets,
            maximumDistanceM: maximumDistanceM
        )
        var result: [GeoPoint] = []
        var offsets: [Double] = []
        result.reserveCapacity(points.count)
        offsets.reserveCapacity(points.count)
        for (point, projection) in zip(points, matched) {
            guard let candidate = projection else {
                result.append(point)
                continue
            }
            result.append(candidate.projection.point)
            offsets.append(candidate.projection.distanceM)
        }
        return SnapPreview(
            points: result,
            snappedCount: offsets.count,
            averageOffsetM: offsets.isEmpty ? 0 : offsets.reduce(0, +) / Double(offsets.count),
            maxOffsetM: offsets.max() ?? 0
        )
    }

    private static func matchContinuousCandidates(
        points: [GeoPoint],
        candidateSets: [[MatchCandidate]],
        maximumDistanceM: Double
    ) -> [MatchCandidate?] {
        var result = Array<MatchCandidate?>(repeating: nil, count: points.count)
        var start = 0
        while start < points.count {
            while start < points.count, candidateSets[start].isEmpty { start += 1 }
            guard start < points.count else { break }
            var end = start + 1
            while end < points.count, !candidateSets[end].isEmpty { end += 1 }
            let matched = matchCandidateRun(
                points: Array(points[start..<end]),
                candidateSets: Array(candidateSets[start..<end]),
                maximumDistanceM: maximumDistanceM
            )
            for (offset, projection) in matched.enumerated() {
                result[start + offset] = projection
            }
            start = end
        }
        return result
    }

    private static func matchCandidateRun(
        points: [GeoPoint],
        candidateSets: [[MatchCandidate]],
        maximumDistanceM: Double
    ) -> [MatchCandidate] {
        guard points.count > 1 else { return [candidateSets[0][0]] }
        let sigma = max(maximumDistanceM / 2.5, 2)
        let twoSigmaSquared = 2 * sigma * sigma
        var costs = candidateSets[0].map { emissionCost($0, twoSigmaSquared: twoSigmaSquared) }
        var previousChoices: [[Int]] = []
        previousChoices.reserveCapacity(points.count - 1)

        for index in 1..<points.count {
            var nextCosts = Array(repeating: Double.infinity, count: candidateSets[index].count)
            var choices = Array(repeating: 0, count: candidateSets[index].count)
            for currentIndex in candidateSets[index].indices {
                let current = candidateSets[index][currentIndex]
                for previousIndex in candidateSets[index - 1].indices {
                    let candidateCost = costs[previousIndex] + transitionCost(
                        sourceA: points[index - 1],
                        sourceB: points[index],
                        previous: candidateSets[index - 1][previousIndex],
                        current: current
                    )
                    if candidateCost < nextCosts[currentIndex] {
                        nextCosts[currentIndex] = candidateCost
                        choices[currentIndex] = previousIndex
                    }
                }
                nextCosts[currentIndex] += emissionCost(current, twoSigmaSquared: twoSigmaSquared)
            }
            costs = nextCosts
            previousChoices.append(choices)
        }

        var choice = costs.indices.min(by: { costs[$0] < costs[$1] }) ?? 0
        var matched = Array(repeating: candidateSets[0][0], count: points.count)
        matched[points.count - 1] = candidateSets[points.count - 1][choice]
        for index in stride(from: points.count - 2, through: 0, by: -1) {
            choice = previousChoices[index][choice]
            matched[index] = candidateSets[index][choice]
        }
        return matched
    }

    private static func emissionCost(_ candidate: MatchCandidate, twoSigmaSquared: Double) -> Double {
        candidate.projection.distanceM * candidate.projection.distanceM / twoSigmaSquared
    }

    private static func transitionCost(
        sourceA: GeoPoint,
        sourceB: GeoPoint,
        previous: MatchCandidate,
        current: MatchCandidate
    ) -> Double {
        let sourceStep = distanceM(sourceA, sourceB)
        let snappedStep = distanceM(previous.projection.point, current.projection.point)
        return abs(snappedStep - sourceStep) + (previous.wayID == current.wayID ? 0 : 30)
    }

    private static func mergedWayIDs(roads: [Road]) -> [Int] {
        var parent = Array(roads.indices)
        func find(_ value: Int) -> Int {
            var current = value
            while parent[current] != current { current = parent[current] }
            return current
        }
        func union(_ a: Int, _ b: Int) {
            let rootA = find(a)
            let rootB = find(b)
            if rootA != rootB { parent[rootA] = rootB }
        }
        for firstIndex in roads.indices {
            guard let first = roadEndpoints(roads[firstIndex]) else { continue }
            for secondIndex in roads.indices where secondIndex > firstIndex {
                guard let second = roadEndpoints(roads[secondIndex]) else { continue }
                let pairs = [
                    (first.start, first.startVector, second.start, second.startVector),
                    (first.start, first.startVector, second.end, second.endVector),
                    (first.end, first.endVector, second.start, second.startVector),
                    (first.end, first.endVector, second.end, second.endVector),
                ]
                if pairs.contains(where: {
                    distanceM($0.0, $0.2) <= 1.5
                        && $0.1.x * $0.3.x + $0.1.y * $0.3.y <= -0.85
                }) {
                    union(firstIndex, secondIndex)
                }
            }
        }
        return roads.indices.map(find)
    }

    private static func roadEndpoints(_ road: Road) -> (
        start: GeoPoint, startVector: (x: Double, y: Double),
        end: GeoPoint, endVector: (x: Double, y: Double)
    )? {
        guard road.points.count > 1 else { return nil }
        let start = road.points[0].geo
        let startNext = road.points[1].geo
        let end = road.points[road.points.count - 1].geo
        let endPrevious = road.points[road.points.count - 2].geo
        return (
            start, unitVector(from: start, to: startNext),
            end, unitVector(from: end, to: endPrevious)
        )
    }

    private static func unitVector(from: GeoPoint, to: GeoPoint) -> (x: Double, y: Double) {
        let latitude = (from.lat + to.lat) / 2 * .pi / 180
        let x = (to.lon - from.lon) * 111_320 * cos(latitude)
        let y = (to.lat - from.lat) * 110_540
        let length = max(0.001, hypot(x, y))
        return (x / length, y / length)
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
