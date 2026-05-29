import XCTest
@testable import HUD5Core

/// Mirrors scripts/track-gpx-denoise.test.ts.
final class GpsDenoiseTests: XCTestCase {
    func testRemovesIsolatedSpikesAndSubMeterJitter() {
        let cleaned = denoiseGpsPoints([
            RawGpsPoint(lon: 121.000000, lat: 31.000000, t: 0),
            RawGpsPoint(lon: 121.000100, lat: 31.000000, t: 1),
            RawGpsPoint(lon: 121.000105, lat: 31.000900, t: 2),
            RawGpsPoint(lon: 121.000200, lat: 31.000000, t: 3),
            RawGpsPoint(lon: 121.000202, lat: 31.000003, t: 4),
            RawGpsPoint(lon: 121.000300, lat: 31.000000, t: 5),
        ])
        XCTAssertEqual(cleaned.map { $0.t }, [0, 1, 3, 5])
    }
}
