import XCTest
@testable import HUD5Core

final class UnitsTests: XCTestCase {
    func testConvertSpeed() {
        XCTAssertEqual(convertSpeed(100, unit: .kmh), 100, accuracy: 1e-9)
        XCTAssertEqual(convertSpeed(100, unit: .mph), 62.1371, accuracy: 1e-9)
    }

    func testSpeedUnitLabel() {
        XCTAssertEqual(speedUnitLabel(.kmh), "km/h")
        XCTAssertEqual(speedUnitLabel(.mph), "MPH")
    }

    func testClamp() {
        XCTAssertEqual(clamp(5, 0, 10), 5)
        XCTAssertEqual(clamp(-1, 0, 10), 0)
        XCTAssertEqual(clamp(11, 0, 10), 10)
    }

    func testLerp() {
        XCTAssertEqual(lerp(0, 10, 0.5), 5, accuracy: 1e-9)
        XCTAssertEqual(lerp(10, 20, 0), 10, accuracy: 1e-9)
        XCTAssertEqual(lerp(10, 20, 1), 20, accuracy: 1e-9)
    }
}
