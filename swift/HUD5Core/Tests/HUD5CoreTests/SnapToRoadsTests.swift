import XCTest
@testable import HUD5Core

/// Mirrors scripts/snap-to-roads.test.ts.
final class SnapToRoadsTests: XCTestCase {
    private func pt(_ x: Double, _ y: Double) -> Pt2D { Pt2D(x: x, y: y) }

    func testSnapsNoisyPointsOntoStraightRoadWithinThreshold() {
        let segments = buildSegments([[pt(0, 0), pt(100, 0)]])
        let snapped = snapPointsToSegments([pt(10, 2), pt(50, -3), pt(90, 1)], segments, 5)
        for p in snapped { XCTAssertEqual(p.y, 0, accuracy: 1e-9) }
        XCTAssertEqual(snapped[0].x, 10, accuracy: 1e-9)
        XCTAssertEqual(snapped[1].x, 50, accuracy: 1e-9)
    }

    func testKeepsOriginalWhenNearestSegmentFartherThanThreshold() {
        let segments = buildSegments([[pt(0, 0), pt(100, 0)]])
        let snapped = snapPointsToSegments([pt(50, 20)], segments, 5)
        XCTAssertEqual(snapped[0], pt(50, 20))
    }

    func testClampsProjectionToSegmentEndpoints() {
        let segments = buildSegments([[pt(0, 0), pt(100, 0)]])
        let snapped = snapPointsToSegments([pt(120, 1)], segments, 30)
        XCTAssertEqual(snapped[0].x, 100, accuracy: 1e-9)
        XCTAssertEqual(snapped[0].y, 0, accuracy: 1e-9)
    }

    func testPicksNearestOfParallelRoads() {
        let segments = buildSegments([
            [pt(0, 0), pt(100, 0)],
            [pt(0, 10), pt(100, 10)],
        ])
        let snapped = snapPointsToSegments([pt(50, 8.5)], segments, 5)
        XCTAssertEqual(snapped[0].y, 10, accuracy: 1e-9)
    }

    func testDoesNotFlickerOntoShortSideBranchAtJunction() {
        let segments = buildSegments([
            [pt(0, 0), pt(100, 0)],
            [pt(50, 0), pt(50, 20)],
        ])
        let noisy = [pt(46, 0.4), pt(48, 0.3), pt(49.7, 0.2), pt(50.2, 0.3), pt(52, 0.2), pt(54, 0.4)]
        let snapped = snapPointsToSegments(noisy, segments, 5)
        for p in snapped { XCTAssertEqual(p.y, 0, accuracy: 1e-9) }
    }

    func testSmoothsShortWrongWayIslandBack() {
        let segments = buildSegments([
            [pt(0, 0), pt(30, 0)],
            [pt(10, 1), pt(20, 1)],
        ])
        let noisy = [
            pt(8, 0.2), pt(9, 0.2), pt(10, 0.8), pt(10.5, 0.8), pt(11, 0.8), pt(11.5, 0.8),
            pt(12, 0.8), pt(12.5, 0.8), pt(13, 0.8), pt(13.5, 0.8), pt(14, 0.2), pt(15, 0.2),
            pt(16, 0.2), pt(17, 0.2),
        ]
        let snapped = snapPointsToSegments(noisy, segments, 5)
        for p in snapped { XCTAssertEqual(p.y, 0, accuracy: 1e-9) }
    }

    func testSmoothsLongerLowDistanceWrongWayIslandBack() {
        let segments = buildSegments([
            [pt(0, 0), pt(40, 0)],
            [pt(10, 1), pt(30, 1)],
        ])
        let noisy = [
            pt(7, 0.2), pt(8, 0.2), pt(9, 0.2), pt(10, 0.8), pt(11, 0.8), pt(12, 0.8),
            pt(13, 0.8), pt(14, 0.8), pt(15, 0.8), pt(16, 0.8), pt(17, 0.8), pt(18, 0.8),
            pt(19, 0.2), pt(20, 0.2), pt(21, 0.2), pt(22, 0.2),
        ]
        let snapped = snapPointsToSegments(noisy, segments, 5)
        for p in snapped { XCTAssertEqual(p.y, 0, accuracy: 1e-9) }
    }

    func testReturnsOriginalWhenNoSegments() {
        let pts = [pt(1, 2)]
        XCTAssertEqual(snapPointsToSegments(pts, [], 5), pts)
    }
}
