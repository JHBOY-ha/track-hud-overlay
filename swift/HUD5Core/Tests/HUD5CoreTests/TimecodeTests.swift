import XCTest
@testable import HUD5Core

/// Mirrors scripts/timecode.test.ts.
final class TimecodeTests: XCTestCase {
    func testFormatsSecondsAsNonDropFrameTimecode() {
        XCTAssertEqual(formatTimecode(64800, fps: 60), "18:00:00:00")
        XCTAssertEqual(formatTimecode(64800.5, fps: 60), "18:00:00:30")
        XCTAssertEqual(formatTimecode(64800 + 1.999, fps: 24), "18:00:02:00")
    }

    func testSupportsNegativeValuesAnd120fpsFrameFields() {
        XCTAssertEqual(formatTimecode(-4.619031471469498, fps: 60), "-00:00:04:37")
        XCTAssertEqual(formatTimecode(1 + 119.0 / 120.0, fps: 120), "00:00:01:119")
    }

    func testNonFiniteReturnsPlaceholder() {
        XCTAssertEqual(formatTimecode(.nan, fps: 60), "--:--:--:--")
        XCTAssertEqual(formatTimecode(.infinity, fps: 60), "--:--:--:--")
    }

    func testNormalizeProjectFpsFallsBackTo60() {
        XCTAssertEqual(normalizeProjectFps(30), 30)
        XCTAssertEqual(normalizeProjectFps(45), 60)
    }
}
