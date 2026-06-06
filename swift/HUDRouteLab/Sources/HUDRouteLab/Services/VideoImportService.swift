import AVFoundation
import Foundation

enum VideoImportError: LocalizedError {
    case invalidDuration

    var errorDescription: String? {
        switch self {
        case .invalidDuration: "无法读取视频时长。"
        }
    }
}

enum VideoImportService {
    static func load(url: URL) async throws -> ImportedVideo {
        let asset = AVURLAsset(url: url)
        let duration = try await asset.load(.duration).seconds
        guard duration.isFinite, duration > 0 else { throw VideoImportError.invalidDuration }
        let timecode = try? MP4TimecodeParser.parse(url: url)
        return ImportedVideo(
            name: url.lastPathComponent,
            url: url,
            duration: duration,
            startSeconds: min(86_399, max(0, timecode?.seconds ?? 0)),
            embeddedTimecode: timecode
        )
    }
}

enum MP4TimecodeParser {
    private struct Box {
        var type: String
        var start: Int
        var headerSize: Int
        var size: Int
        var contentStart: Int { start + headerSize }
        var end: Int { start + size }
    }

    private static let containers: Set<String> = ["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf", "udta", "meta"]

    static func parse(url: URL) throws -> EmbeddedVideoTimecode? {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let fileSize = Int(try handle.seekToEnd())
        var offset = 0
        while offset + 8 <= fileSize {
            guard let box = try readFileBox(handle: handle, offset: offset, limit: fileSize) else { break }
            if box.type == "moov" {
                try handle.seek(toOffset: UInt64(box.start))
                guard let data = try handle.read(upToCount: box.size),
                      let moov = readBox(data, offset: 0, limit: data.count) else { return nil }
                return try parseMoov(data, moov: moov, handle: handle, fileSize: fileSize)
            }
            offset = box.end
        }
        return nil
    }

    static func parse(data: Data) -> EmbeddedVideoTimecode? {
        guard let moov = topLevelBoxes(data).first(where: { $0.type == "moov" }) else { return nil }
        return parseMoov(data, moov: moov) { offset in
            guard offset + 4 <= data.count else { return nil }
            return data.int32(at: offset)
        }
    }

    private static func parseMoov(_ data: Data, moov: Box, handle: FileHandle, fileSize: Int) throws -> EmbeddedVideoTimecode? {
        try parseMoov(data, moov: moov) { offset in
            guard offset + 4 <= fileSize else { return nil }
            try handle.seek(toOffset: UInt64(offset))
            return try handle.read(upToCount: 4)?.int32(at: 0)
        }
    }

    private static func parseMoov(
        _ data: Data,
        moov: Box,
        readFrameCount: (Int) throws -> Int32?
    ) rethrows -> EmbeddedVideoTimecode? {
        for track in descendants(data, parent: moov, type: "trak") where handlerType(data, track: track) == "tmcd" {
            guard let stsd = descendants(data, parent: track, type: "stsd").first,
                  let fps = parseTmcdEntry(data, stsd: stsd),
                  let sampleOffset = firstChunkOffset(data, track: track),
                  let frameCount = try readFrameCount(sampleOffset) else { continue }
            return EmbeddedVideoTimecode(seconds: Double(frameCount) / fps, fps: fps, frameCount: frameCount)
        }
        return nil
    }

    private static func parseTmcdEntry(_ data: Data, stsd: Box) -> Double? {
        var offset = stsd.contentStart + 8
        while offset + 8 <= stsd.end {
            guard let entry = readBox(data, offset: offset, limit: stsd.end) else { break }
            if entry.type == "tmcd" {
                for candidate in [(12, 16, 20), (16, 20, 24)] {
                    guard entry.contentStart + candidate.2 + 1 <= entry.end else { continue }
                    let timeScale = data.uint32(at: entry.contentStart + candidate.0)
                    let frameDuration = data.uint32(at: entry.contentStart + candidate.1)
                    let frameByte = Double(data[entry.contentStart + candidate.2])
                    let fps = frameByte > 0 ? frameByte : (frameDuration > 0 ? (Double(timeScale) / Double(frameDuration)).rounded() : 0)
                    if fps > 0, fps <= 240 { return fps }
                }
            }
            offset = entry.end
        }
        return nil
    }

    private static func firstChunkOffset(_ data: Data, track: Box) -> Int? {
        if let stco = descendants(data, parent: track, type: "stco").first,
           stco.contentStart + 12 <= stco.end,
           data.uint32(at: stco.contentStart + 4) > 0 {
            return Int(data.uint32(at: stco.contentStart + 8))
        }
        if let co64 = descendants(data, parent: track, type: "co64").first,
           co64.contentStart + 16 <= co64.end,
           data.uint32(at: co64.contentStart + 4) > 0 {
            return Int(data.uint64(at: co64.contentStart + 8))
        }
        return nil
    }

    private static func handlerType(_ data: Data, track: Box) -> String? {
        guard let mdia = child(data, parent: track, type: "mdia"),
              let hdlr = child(data, parent: mdia, type: "hdlr"),
              hdlr.contentStart + 12 <= hdlr.end else { return nil }
        return data.ascii(at: hdlr.contentStart + 8, length: 4)
    }

    private static func descendants(_ data: Data, parent: Box, type: String) -> [Box] {
        children(data, parent: parent).flatMap { childBox -> [Box] in
            var result = childBox.type == type ? [childBox] : []
            if containers.contains(childBox.type) {
                result.append(contentsOf: descendants(data, parent: childBox, type: type))
            }
            return result
        }
    }

    private static func child(_ data: Data, parent: Box, type: String) -> Box? {
        children(data, parent: parent).first { $0.type == type }
    }

    private static func children(_ data: Data, parent: Box) -> [Box] {
        var result: [Box] = []
        var offset = parent.contentStart + (parent.type == "meta" ? 4 : 0)
        while offset + 8 <= parent.end {
            guard let box = readBox(data, offset: offset, limit: parent.end) else { break }
            result.append(box)
            offset = box.end
        }
        return result
    }

    private static func topLevelBoxes(_ data: Data) -> [Box] {
        var result: [Box] = []
        var offset = 0
        while offset + 8 <= data.count {
            guard let box = readBox(data, offset: offset, limit: data.count) else { break }
            result.append(box)
            offset = box.end
        }
        return result
    }

    private static func readBox(_ data: Data, offset: Int, limit: Int) -> Box? {
        guard offset + 8 <= limit else { return nil }
        var size = Int(data.uint32(at: offset))
        let type = data.ascii(at: offset + 4, length: 4)
        var headerSize = 8
        if size == 1 {
            guard offset + 16 <= limit else { return nil }
            size = Int(data.uint64(at: offset + 8))
            headerSize = 16
        } else if size == 0 {
            size = limit - offset
        }
        guard size >= headerSize, offset + size <= limit else { return nil }
        return Box(type: type, start: offset, headerSize: headerSize, size: size)
    }

    private static func readFileBox(handle: FileHandle, offset: Int, limit: Int) throws -> Box? {
        guard offset + 8 <= limit else { return nil }
        try handle.seek(toOffset: UInt64(offset))
        guard let data = try handle.read(upToCount: min(16, limit - offset)), data.count >= 8 else { return nil }
        var size = Int(data.uint32(at: 0))
        let type = data.ascii(at: 4, length: 4)
        var headerSize = 8
        if size == 1 {
            guard data.count >= 16 else { return nil }
            size = Int(data.uint64(at: 8))
            headerSize = 16
        } else if size == 0 {
            size = limit - offset
        }
        guard size >= headerSize, offset + size <= limit else { return nil }
        return Box(type: type, start: offset, headerSize: headerSize, size: size)
    }
}

private extension Data {
    func uint32(at offset: Int) -> UInt32 {
        self[offset..<(offset + 4)].reduce(0) { ($0 << 8) | UInt32($1) }
    }

    func int32(at offset: Int) -> Int32 {
        Int32(bitPattern: uint32(at: offset))
    }

    func uint64(at offset: Int) -> UInt64 {
        self[offset..<(offset + 8)].reduce(0) { ($0 << 8) | UInt64($1) }
    }

    func ascii(at offset: Int, length: Int) -> String {
        String(bytes: self[offset..<(offset + length)], encoding: .ascii) ?? ""
    }
}
