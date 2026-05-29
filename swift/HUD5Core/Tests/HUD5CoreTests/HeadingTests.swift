import XCTest
@testable import HUD5Core

/// Mirrors scripts/heading-smoothing.test.ts to guard numeric parity.
final class HeadingTests: XCTestCase {
    func testShortestAngleDeltaCrosses360ByShortPath() {
        XCTAssertEqual(shortestAngleDeltaDeg(from: 350, to: 10), 20, accuracy: 1e-9)
        XCTAssertEqual(shortestAngleDeltaDeg(from: 10, to: 350), -20, accuracy: 1e-9)
    }

    func testSmoothAngleMovesTowardTargetWithoutOvershooting() {
        let next = smoothAngleDeg(current: 0, target: 90, deltaTime: 0.1, timeConstant: 0.2)
        XCTAssertGreaterThan(next, 0)
        XCTAssertLessThan(next, 90)
    }

    func testSmoothAngleKeepsCurrentWhenNoFrameTimeElapsed() {
        XCTAssertEqual(smoothAngleDeg(current: 10, target: 90, deltaTime: 0, timeConstant: 0.2), 10)
    }

    func testSmoothAngleSnapsWhenTimeJumpsAreTooLarge() {
        XCTAssertEqual(smoothAngleDeg(current: 0, target: 90, deltaTime: 2, timeConstant: 0.2), 90)
    }
}
