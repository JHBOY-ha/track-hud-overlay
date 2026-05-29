import XCTest
@testable import HUD5Core

/// Mirrors scripts/coordinate-systems.test.ts.
final class CoordinateSystemsTests: XCTestCase {
    func testGcj02NormalizedToWgs84InsideChina() {
        let pt = convertLonLatToWgs84(
            LonLat(lon: 116.41024449916938, lat: 39.91640428150164),
            source: .gcj02
        )
        XCTAssertLessThan(abs(pt.lon - 116.404), 0.00002)
        XCTAssertLessThan(abs(pt.lat - 39.915), 0.00002)
    }

    func testBd09NormalizedToWgs84InsideChina() {
        let pt = convertLonLatToWgs84(
            LonLat(lon: 116.416627243787, lat: 39.922699552216),
            source: .bd09
        )
        XCTAssertLessThan(abs(pt.lon - 116.404), 0.00002)
        XCTAssertLessThan(abs(pt.lat - 39.915), 0.00002)
    }

    func testGcj02LeavesOverseasCoordinatesUnchanged() {
        let pt = convertLonLatToWgs84(LonLat(lon: -122.4194, lat: 37.7749), source: .gcj02)
        XCTAssertEqual(pt, LonLat(lon: -122.4194, lat: 37.7749))
    }
}
