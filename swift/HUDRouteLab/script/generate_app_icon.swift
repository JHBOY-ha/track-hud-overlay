#!/usr/bin/env swift

import AppKit
import Foundation

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let resources = root.appendingPathComponent("Sources/HUDRouteLab/Resources")
let iconset = resources.appendingPathComponent("HUDRouteLab.iconset")

try FileManager.default.createDirectory(at: resources, withIntermediateDirectories: true)
try? FileManager.default.removeItem(at: iconset)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)

func color(_ hex: UInt32) -> NSColor {
    NSColor(
        red: CGFloat((hex >> 16) & 0xff) / 255,
        green: CGFloat((hex >> 8) & 0xff) / 255,
        blue: CGFloat(hex & 0xff) / 255,
        alpha: 1
    )
}

func makeIcon(size: Int) throws -> Data {
    let scale = CGFloat(size) / 1024
    guard
        let bitmap = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: size,
            pixelsHigh: size,
            bitsPerSample: 8,
            samplesPerPixel: 4,
            hasAlpha: true,
            isPlanar: false,
            colorSpaceName: .deviceRGB,
            bytesPerRow: 0,
            bitsPerPixel: 0
        ),
        let graphicsContext = NSGraphicsContext(bitmapImageRep: bitmap)
    else {
        throw NSError(domain: "HUDRouteLabIcon", code: 1)
    }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = graphicsContext
    defer { NSGraphicsContext.restoreGraphicsState() }

    let context = graphicsContext.cgContext
    context.clear(CGRect(x: 0, y: 0, width: size, height: size))
    context.scaleBy(x: scale, y: scale)
    context.setShouldAntialias(true)

    let visualScale: CGFloat = 824 / 928
    context.translateBy(x: 512, y: 512)
    context.scaleBy(x: visualScale, y: visualScale)
    context.translateBy(x: -512, y: -512)

    let tile = NSBezierPath(roundedRect: NSRect(x: 48, y: 48, width: 928, height: 928), xRadius: 210, yRadius: 210)
    color(0x081A34).setFill()
    tile.fill()

    let route = NSBezierPath()
    route.move(to: NSPoint(x: 270, y: 275))
    route.line(to: NSPoint(x: 480, y: 470))
    route.curve(
        to: NSPoint(x: 690, y: 745),
        controlPoint1: NSPoint(x: 500, y: 595),
        controlPoint2: NSPoint(x: 655, y: 565)
    )
    route.move(to: NSPoint(x: 480, y: 470))
    route.curve(
        to: NSPoint(x: 760, y: 275),
        controlPoint1: NSPoint(x: 570, y: 355),
        controlPoint2: NSPoint(x: 695, y: 390)
    )
    route.lineWidth = 76
    route.lineCapStyle = .round
    route.lineJoinStyle = .round
    color(0x27D7E8).setStroke()
    route.stroke()

    for point in [NSPoint(x: 270, y: 275), NSPoint(x: 480, y: 470), NSPoint(x: 760, y: 275)] {
        color(0x27D7E8).setFill()
        NSBezierPath(ovalIn: NSRect(x: point.x - 78, y: point.y - 78, width: 156, height: 156)).fill()
        color(0x081A34).setFill()
        NSBezierPath(ovalIn: NSRect(x: point.x - 35, y: point.y - 35, width: 70, height: 70)).fill()
    }

    let pin = NSBezierPath()
    pin.move(to: NSPoint(x: 690, y: 625))
    pin.curve(to: NSPoint(x: 580, y: 790), controlPoint1: NSPoint(x: 650, y: 680), controlPoint2: NSPoint(x: 580, y: 730))
    pin.curve(to: NSPoint(x: 690, y: 900), controlPoint1: NSPoint(x: 580, y: 850), controlPoint2: NSPoint(x: 630, y: 900))
    pin.curve(to: NSPoint(x: 800, y: 790), controlPoint1: NSPoint(x: 750, y: 900), controlPoint2: NSPoint(x: 800, y: 850))
    pin.curve(to: NSPoint(x: 690, y: 625), controlPoint1: NSPoint(x: 800, y: 730), controlPoint2: NSPoint(x: 730, y: 680))
    pin.close()
    color(0xFF9F1C).setFill()
    pin.fill()

    color(0x081A34).setFill()
    NSBezierPath(ovalIn: NSRect(x: 650, y: 750, width: 80, height: 80)).fill()

    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "HUDRouteLabIcon", code: 1)
    }
    return png
}

let outputs = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
]

for (name, size) in outputs {
    try makeIcon(size: size).write(to: iconset.appendingPathComponent(name))
}
try makeIcon(size: 1024).write(to: resources.appendingPathComponent("HUDRouteLab-1024.png"))

let iconutil = Process()
iconutil.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
iconutil.arguments = [
    "-c", "icns",
    iconset.path,
    "-o", resources.appendingPathComponent("HUDRouteLab.icns").path,
]
try iconutil.run()
iconutil.waitUntilExit()
guard iconutil.terminationStatus == 0 else {
    throw NSError(domain: "HUDRouteLabIcon", code: Int(iconutil.terminationStatus))
}

try FileManager.default.removeItem(at: iconset)
