import XCTest
@testable import HUD5Core

final class TelemetryTests: XCTestCase {
    func testParseCsvBasicFields() {
        let csv = """
        t,speed_kmh,rpm,gear,abs
        0,0,1000,N,0
        1,50,3000,1,1
        2,100,6000,2,false
        """
        let track = parseTelemetryCsv(csv)
        XCTAssertEqual(track.samples.count, 3)
        XCTAssertEqual(track.duration, 2, accuracy: 1e-9)
        XCTAssertEqual(track.samples[0].speedKmh, 0)
        XCTAssertEqual(track.samples[0].gear, .neutral)
        XCTAssertEqual(track.samples[1].gear, .number(1))
        XCTAssertEqual(track.samples[1].abs, true)
        XCTAssertEqual(track.samples[2].abs, false)
    }

    func testParseCsvFallsBackToSpeedColumnAndSorts() {
        let csv = """
        t,speed
        2,80
        0,10
        1,40
        """
        let track = parseTelemetryCsv(csv)
        XCTAssertEqual(track.samples.map { $0.t }, [0, 1, 2])
        XCTAssertEqual(track.samples.map { $0.speedKmh }, [10, 40, 80])
    }

    func testParseCsvSkipsRowsMissingRequiredFields() {
        let csv = """
        t,speed_kmh
        0,10
        ,20
        2,
        3,30
        """
        let track = parseTelemetryCsv(csv)
        XCTAssertEqual(track.samples.map { $0.t }, [0, 3])
    }

    func testRpmMaxDefaultsTo8000() {
        let track = parseTelemetryCsv("t,speed_kmh\n0,10\n")
        XCTAssertEqual(track.rpmMax, 8000)
    }

    func testRpmMaxPicksUpColumn() {
        let track = parseTelemetryCsv("t,speed_kmh,rpm_max\n0,10,9500\n")
        XCTAssertEqual(track.rpmMax, 9500)
    }

    func testParseJsonArrayAndCamelSnakeKeys() {
        let json = """
        [
          {"t": 1, "speedKmh": 50, "rpm_max": 9000, "abs": true},
          {"t": 0, "speed": 10}
        ]
        """
        let track = parseTelemetryJson(json)
        XCTAssertEqual(track.samples.map { $0.t }, [0, 1])
        XCTAssertEqual(track.samples[1].speedKmh, 50)
        XCTAssertEqual(track.samples[1].abs, true)
        XCTAssertEqual(track.rpmMax, 9000)
    }

    func testParseJsonSamplesEnvelope() {
        let json = #"{"samples": [{"t": 0, "speed": 5}]}"#
        let track = parseTelemetryJson(json)
        XCTAssertEqual(track.samples.count, 1)
        XCTAssertEqual(track.samples[0].speedKmh, 5)
    }

    func testSampleAtInterpolatesLinearly() {
        let track = parseTelemetryCsv("t,speed_kmh\n0,0\n2,100\n")
        let s = sampleAt(track, 1)
        XCTAssertNotNil(s)
        XCTAssertEqual(s?.speedKmh ?? -1, 50, accuracy: 1e-9)
    }

    func testSampleAtRespectsTrim() {
        let track = parseTelemetryCsv("t,speed_kmh\n0,0\n10,100\n")
        XCTAssertNil(sampleAt(track, 0.5, trimStart: 1))
        XCTAssertNil(sampleAt(track, 9.5, trimEnd: 1))
        XCTAssertNotNil(sampleAt(track, 5, trimStart: 1, trimEnd: 1))
    }
}
