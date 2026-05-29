import Foundation

/// 2D point alias matching projection output. Mirrors `Pt2D` in
/// src/util/snapToRoads.ts.
public typealias Pt2D = NormalizedPoint

/// A road segment with its source way ID. Mirrors `Segment2D`.
public struct Segment2D: Equatable, Sendable {
    public var ax: Double
    public var ay: Double
    public var dx: Double
    public var dy: Double
    public var len2: Double
    /// Index of the source polyline (one ID per OSM way / reference layer).
    public var wayId: Int
}

/// Union polylines that meet end-to-end and run roughly collinear into a
/// single wayId, then emit per-edge segments. Port of `buildSegments`.
public func buildSegments(_ polylines: [[Pt2D]]) -> [Segment2D] {
    let n = polylines.count
    var parent = Array(0..<n)
    func find(_ i: Int) -> Int {
        var i = i
        while parent[i] != i {
            parent[i] = parent[parent[i]]
            i = parent[i]
        }
        return i
    }
    func union(_ a: Int, _ b: Int) {
        let ra = find(a), rb = find(b)
        if ra != rb { parent[ra] = rb }
    }

    struct EndInfo {
        var sx: Double; var sy: Double; var sdx: Double; var sdy: Double
        var ex: Double; var ey: Double; var edx: Double; var edy: Double
    }
    let ends: [EndInfo?] = polylines.map { line in
        if line.count < 2 { return nil }
        let s0 = line[0], s1 = line[1]
        let e1 = line[line.count - 2], e0 = line[line.count - 1]
        let sLenRaw = (s1.x - s0.x).magnitudeHypot(s1.y - s0.y)
        let eLenRaw = (e1.x - e0.x).magnitudeHypot(e1.y - e0.y)
        let sLen = sLenRaw == 0 ? 1 : sLenRaw
        let eLen = eLenRaw == 0 ? 1 : eLenRaw
        return EndInfo(
            sx: s0.x, sy: s0.y, sdx: (s1.x - s0.x) / sLen, sdy: (s1.y - s0.y) / sLen,
            ex: e0.x, ey: e0.y, edx: (e1.x - e0.x) / eLen, edy: (e1.y - e0.y) / eLen
        )
    }

    let jointEps = 1.5       // metres
    let collinearDot = -0.85 // inward dot inward; ~31 degree tolerance

    for i in 0..<n {
        guard let a = ends[i] else { continue }
        for j in (i + 1)..<n {
            guard let b = ends[j] else { continue }
            let tries: [(Double, Double, Double, Double, Double, Double, Double, Double)] = [
                (a.sx, a.sy, a.sdx, a.sdy, b.sx, b.sy, b.sdx, b.sdy),
                (a.sx, a.sy, a.sdx, a.sdy, b.ex, b.ey, b.edx, b.edy),
                (a.ex, a.ey, a.edx, a.edy, b.sx, b.sy, b.sdx, b.sdy),
                (a.ex, a.ey, a.edx, a.edy, b.ex, b.ey, b.edx, b.edy),
            ]
            for (ax, ay, adx, ady, bx, by, bdx, bdy) in tries {
                if (ax - bx).magnitudeHypot(ay - by) > jointEps { continue }
                if adx * bdx + ady * bdy <= collinearDot {
                    union(i, j)
                    break
                }
            }
        }
    }

    var out: [Segment2D] = []
    for (i, line) in polylines.enumerated() {
        let wayId = find(i)
        guard line.count >= 2 else { continue }
        for k in 1..<line.count {
            let a = line[k - 1]
            let b = line[k]
            let dx = b.x - a.x
            let dy = b.y - a.y
            out.append(Segment2D(ax: a.x, ay: a.y, dx: dx, dy: dy, len2: dx * dx + dy * dy, wayId: wayId))
        }
    }
    return out
}

private struct Projection {
    var sx: Double
    var sy: Double
    var d2: Double
}

private func projectOnto(_ s: Segment2D, _ px: Double, _ py: Double) -> Projection {
    var t = s.len2 > 0 ? ((px - s.ax) * s.dx + (py - s.ay) * s.dy) / s.len2 : 0
    if t < 0 { t = 0 } else if t > 1 { t = 1 }
    let sx = s.ax + t * s.dx
    let sy = s.ay + t * s.dy
    let ddx = px - sx
    let ddy = py - sy
    return Projection(sx: sx, sy: sy, d2: ddx * ddx + ddy * ddy)
}

/// Snap each point onto the nearest reference segment within maxDistM, with
/// sticky-way hysteresis and short-island smoothing. Port of
/// `snapPointsToSegments` from src/util/snapToRoads.ts.
public func snapPointsToSegments(_ points: [Pt2D], _ segments: [Segment2D], _ maxDistM: Double) -> [Pt2D] {
    if segments.isEmpty || points.isEmpty || maxDistM <= 0 {
        return points.map { Pt2D(x: $0.x, y: $0.y) }
    }
    let maxD2 = maxDistM * maxDistM
    let stickyRatio = 0.4
    let stickyMargin2 = 0.5
    let switchHold = 4
    let shortIslandMaxPoints = 200
    let shortIslandMaxDistM = 10.0

    var byWay: [Int: [Segment2D]] = [:]
    for s in segments {
        byWay[s.wayId, default: []].append(s)
    }

    func bestOnWay(_ wayId: Int, _ p: Pt2D) -> Projection? {
        guard let waySegs = byWay[wayId] else { return nil }
        var best: Projection? = nil
        for s in waySegs {
            let pr = projectOnto(s, p.x, p.y)
            if best == nil || pr.d2 < best!.d2 { best = pr }
        }
        return best
    }

    struct Snap {
        var x: Double
        var y: Double
        var wayId: Int  // -1 == unsnapped
        var d2: Double
    }

    let first: [Snap] = points.map { p in
        var bestD2 = Double.infinity
        var bestSx = p.x
        var bestSy = p.y
        var bestWay = -1
        for s in segments {
            let pr = projectOnto(s, p.x, p.y)
            if pr.d2 < bestD2 {
                bestD2 = pr.d2
                bestSx = pr.sx
                bestSy = pr.sy
                bestWay = s.wayId
            }
        }
        if bestD2 > maxD2 { return Snap(x: p.x, y: p.y, wayId: -1, d2: bestD2) }
        return Snap(x: bestSx, y: bestSy, wayId: bestWay, d2: bestD2)
    }

    // Sticky-way pass with temporal hysteresis.
    var curWay = -1
    var pendingWay = -1
    var pendingCount = 0
    var sticky: [Snap] = []
    sticky.reserveCapacity(points.count)
    for (i, p) in points.enumerated() {
        let ownBest = curWay >= 0 ? bestOnWay(curWay, p) : nil
        let fb = first[i]
        if fb.wayId < 0 {
            curWay = -1; pendingWay = -1; pendingCount = 0
            sticky.append(fb)
            continue
        }
        if curWay < 0 {
            curWay = fb.wayId; pendingWay = -1; pendingCount = 0
            sticky.append(fb)
            continue
        }
        if fb.wayId == curWay {
            pendingWay = -1; pendingCount = 0
            sticky.append(fb)
            continue
        }
        let ownReachable = ownBest != nil && ownBest!.d2 <= maxD2
        let winsRatio = ownBest != nil ? fb.d2 < stickyRatio * ownBest!.d2 : true
        let winsMargin = ownBest != nil ? ownBest!.d2 - fb.d2 >= stickyMargin2 : true
        let candidateBeatsOwn = !ownReachable || (winsRatio && winsMargin)

        if !ownReachable {
            curWay = fb.wayId; pendingWay = -1; pendingCount = 0
            sticky.append(fb)
            continue
        }
        if candidateBeatsOwn {
            if pendingWay == fb.wayId { pendingCount += 1 }
            else { pendingWay = fb.wayId; pendingCount = 1 }
            if pendingCount >= switchHold {
                curWay = fb.wayId; pendingWay = -1; pendingCount = 0
                sticky.append(fb)
                continue
            }
        } else {
            pendingWay = -1; pendingCount = 0
        }
        // Hold on the current way until hysteresis is satisfied.
        sticky.append(Snap(x: ownBest!.sx, y: ownBest!.sy, wayId: curWay, d2: ownBest!.d2))
    }

    // Smoothing pass: short wrong-way island surrounded by the same way.
    var ways = sticky.map { $0.wayId }
    var start = 0
    while start < sticky.count {
        var end = start + 1
        while end < sticky.count && ways[end] == ways[start] { end += 1 }

        let islandWay = ways[start]
        let surroundingWay = (start > 0 && end < sticky.count && ways[start - 1] == ways[end])
            ? ways[start - 1] : -1

        if islandWay >= 0 && surroundingWay >= 0 && islandWay != surroundingWay {
            let pointCount = end - start
            var islandDist = 0.0
            if start + 1 < end {
                for i in (start + 1)..<end {
                    islandDist += (points[i].x - points[i - 1].x).magnitudeHypot(points[i].y - points[i - 1].y)
                }
            }
            if pointCount <= shortIslandMaxPoints && islandDist <= shortIslandMaxDistM {
                var replacements: [Snap] = []
                for i in start..<end {
                    guard let best = bestOnWay(surroundingWay, points[i]), best.d2 <= maxD2 else {
                        replacements.removeAll()
                        break
                    }
                    replacements.append(Snap(x: best.sx, y: best.sy, wayId: surroundingWay, d2: best.d2))
                }
                if replacements.count == pointCount {
                    for i in start..<end {
                        sticky[i] = replacements[i - start]
                        ways[i] = surroundingWay
                    }
                }
            }
        }

        start = end
    }

    return sticky.map { Pt2D(x: $0.x, y: $0.y) }
}

extension Double {
    /// hypot(self, other) — named to read like Math.hypot at call sites.
    func magnitudeHypot(_ other: Double) -> Double {
        (self * self + other * other).squareRoot()
    }
}
