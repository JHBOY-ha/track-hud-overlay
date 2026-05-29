import XCTest
@testable import HUD5Core

/// Reference values generated from src/util/projection.ts via:
///   node --input-type=module -e '...projectLonLatLayers(...)'
/// Guards that the Swift port stays numerically identical to the TS source.
final class ProjectionTests: XCTestCase {
    func testProjectLonLatLayersMatchesTypeScriptReference() {
        let layers = [
            [LonLat(lon: -0.1, lat: 51.5), LonLat(lon: -0.099, lat: 51.501)],
            [LonLat(lon: -0.098, lat: 51.4995)]
        ]
        let out = projectLonLatLayers(layers)

        XCTAssertEqual(out.count, 2)
        XCTAssertEqual(out[0].count, 2)
        XCTAssertEqual(out[1].count, 1)

        XCTAssertEqual(out[0][0].x, 0, accuracy: 1e-9)
        XCTAssertEqual(out[0][0].y, 0, accuracy: 1e-9)
        XCTAssertEqual(out[0][1].x, 69.29775894109272, accuracy: 1e-6)
        XCTAssertEqual(out[0][1].y, -111.31949079301414, accuracy: 1e-6)
        XCTAssertEqual(out[1][0].x, 138.59551788218545, accuracy: 1e-6)
        XCTAssertEqual(out[1][0].y, 55.65974539690255, accuracy: 1e-6)
    }

    func testEmptyLayersReturnEmptyPerLayer() {
        let out = projectLonLatLayers([[], []])
        XCTAssertEqual(out.count, 2)
        XCTAssertTrue(out[0].isEmpty)
        XCTAssertTrue(out[1].isEmpty)
    }

    func testProjectLonLatSingleLayerConvenience() {
        let out = projectLonLat([LonLat(lon: -0.1, lat: 51.5)])
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0].x, 0, accuracy: 1e-9)
        XCTAssertEqual(out[0].y, 0, accuracy: 1e-9)
    }
}
