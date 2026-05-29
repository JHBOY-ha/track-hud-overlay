import Foundation
import AVFoundation
import CoreGraphics
import CoreVideo

/// Encodes a sequence of CoreGraphics frames to a ProRes 4444 .mov with a
/// preserved alpha channel via AVAssetWriter — the native replacement for the
/// Puppeteer screenshot + FFmpeg ProRes step in scripts/export-frames.mjs.
final class ProResWriter {
    enum WriterError: Error, CustomStringConvertible {
        case cannotCreate(String)
        case noPixelBufferPool
        case appendFailed(String)
        case sessionFailed(String)

        var description: String {
            switch self {
            case .cannotCreate(let s): return "cannot create writer: \(s)"
            case .noPixelBufferPool: return "pixel buffer pool unavailable"
            case .appendFailed(let s): return "frame append failed: \(s)"
            case .sessionFailed(let s): return "writer session failed: \(s)"
            }
        }
    }

    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private let adaptor: AVAssetWriterInputPixelBufferAdaptor
    private let width: Int
    private let height: Int
    private let timescale: Int32
    private let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!

    init(url: URL, width: Int, height: Int, fps: Int) throws {
        self.width = width
        self.height = height
        self.timescale = Int32(fps)

        if FileManager.default.fileExists(atPath: url.path) {
            try? FileManager.default.removeItem(at: url)
        }

        do {
            writer = try AVAssetWriter(outputURL: url, fileType: .mov)
        } catch {
            throw WriterError.cannotCreate(error.localizedDescription)
        }

        let settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.proRes4444,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
        ]
        input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        input.expectsMediaDataInRealTime = false

        let attrs: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferCGImageCompatibilityKey as String: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
        ]
        adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: input,
            sourcePixelBufferAttributes: attrs
        )

        guard writer.canAdd(input) else {
            throw WriterError.cannotCreate("writer cannot add video input")
        }
        writer.add(input)

        guard writer.startWriting() else {
            throw WriterError.sessionFailed(writer.error?.localizedDescription ?? "startWriting returned false")
        }
        writer.startSession(atSourceTime: .zero)
    }

    /// Append one frame at the given frame index, drawing into a context whose
    /// origin is bottom-left (matching HudRenderer's expectations).
    func append(frameIndex: Int, draw: (CGContext) -> Void) throws {
        guard let pool = adaptor.pixelBufferPool else {
            throw WriterError.noPixelBufferPool
        }

        var maybeBuffer: CVPixelBuffer?
        let status = CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &maybeBuffer)
        guard status == kCVReturnSuccess, let buffer = maybeBuffer else {
            throw WriterError.appendFailed("CVPixelBufferPoolCreatePixelBuffer status \(status)")
        }

        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }

        guard let base = CVPixelBufferGetBaseAddress(buffer) else {
            throw WriterError.appendFailed("no base address")
        }
        let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
        // 32ARGB premultiplied, big-endian byte order.
        let bitmapInfo = CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
        guard let ctx = CGContext(
            data: base,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: bytesPerRow,
            space: colorSpace,
            bitmapInfo: bitmapInfo
        ) else {
            throw WriterError.appendFailed("could not create CGContext over pixel buffer")
        }

        draw(ctx)

        // Backpressure: wait until the input can accept more data.
        while !input.isReadyForMoreMediaData {
            Thread.sleep(forTimeInterval: 0.002)
        }
        let pts = CMTime(value: CMTimeValue(frameIndex), timescale: timescale)
        if !adaptor.append(buffer, withPresentationTime: pts) {
            throw WriterError.appendFailed(writer.error?.localizedDescription ?? "adaptor.append returned false")
        }
    }

    /// Finish writing and block until the file is fully flushed.
    func finish() throws {
        input.markAsFinished()
        let sem = DispatchSemaphore(value: 0)
        writer.finishWriting { sem.signal() }
        sem.wait()
        if writer.status == .failed {
            throw WriterError.sessionFailed(writer.error?.localizedDescription ?? "unknown")
        }
    }
}
