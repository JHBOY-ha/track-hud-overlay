import XCTest
import CoreGraphics
@testable import HUD5Render
import HUD5Core

final class HudRendererTests: XCTestCase {
    private func makeContext(_ w: Int, _ h: Int) -> CGContext {
        let cs = CGColorSpace(name: CGColorSpace.sRGB)!
        let info = CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
        return CGContext(data: nil, width: w, height: h, bitsPerComponent: 8,
                         bytesPerRow: 0, space: cs, bitmapInfo: info)!
    }

    private func sampleState() -> FrameState {
        let track = parseGeoJson("""
        {"type":"FeatureCollection","features":[
          {"type":"Feature","properties":{"kind":"driven"},
           "geometry":{"type":"LineString","coordinates":[[0,0],[0.001,0.0005],[0.002,0]]}}
        ]}
        """)
        let builder = FrameStateBuilder(
            telemetry: parseTelemetryCsv("t,speed_kmh,rpm,rpm_max,gear,throttle,brake,position_current,position_total\n0,120,4000,8000,3,0.8,0,2,12\n"),
            track: track,
            unit: .kmh
        )
        return builder.state(at: 0)
    }

    func testRendersNonTransparentPixels() {
        let w = 1920, h = 1080
        let ctx = makeContext(w, h)
        HudRenderer.draw(sampleState(), in: ctx, width: CGFloat(w), height: CGFloat(h))

        guard let data = ctx.data else { return XCTFail("no context data") }
        let ptr = data.bindMemory(to: UInt8.self, capacity: w * h * 4)
        var nonTransparent = 0
        // Sample every 37th pixel's alpha (ARGB → byte 0).
        var i = 0
        while i < w * h * 4 {
            if ptr[i] != 0 { nonTransparent += 1 }
            i += 37 * 4
        }
        XCTAssertGreaterThan(nonTransparent, 0, "expected some opaque HUD pixels on the transparent stage")
    }

    func testFrameStateComputesSpeedAndPose() {
        let state = sampleState()
        XCTAssertEqual(state.sample?.speedKmh ?? 0, 120, accuracy: 1e-9)
        XCTAssertNotNil(state.pose)
        XCTAssertFalse(state.trackPoints.isEmpty)
    }
}
