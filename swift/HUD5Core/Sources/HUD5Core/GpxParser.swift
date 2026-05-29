import Foundation

/// Parses GPX 1.1 into the intermediate `GeoFeature` model, replacing the
/// @tmcw/togeojson + DOMParser path used in the web app.
///
/// Mapping (matches togeojson semantics the track pipeline relies on):
///   - <trk> → one feature, gpxType "trk"; each <trkseg> becomes a segment
///     (one segment → LineString, many → MultiLineString downstream).
///   - <rte> → one feature, gpxType "rte"; <rtept>s form a single segment.
///   - <ele> and <time> children are collected per point; times are flattened
///     across segments into the feature's `times` array.
final class GpxParser: NSObject, XMLParserDelegate {
    static func parse(_ text: String) -> [GeoFeature] {
        guard let data = text.data(using: .utf8) else { return [] }
        let parser = XMLParser(data: data)
        let delegate = GpxParser()
        parser.delegate = delegate
        parser.parse()
        return delegate.features
    }

    private struct Point {
        var lon: Double
        var lat: Double
        var ele: Double?
        var time: String?
    }

    private var features: [GeoFeature] = []

    // Current feature being assembled.
    private var curGpxType: String?
    private var curName: String?
    private var curSegments: [[Point]] = []
    private var curSegment: [Point] = []

    // Current point being assembled.
    private var curPoint: Point?
    private var curEle: String?
    private var curTimeText: String?

    private var text = ""
    private var inName = false
    private var nameDepth = 0  // track/route name vs point-level names

    func parser(_ parser: XMLParser, didStartElement elementName: String,
                namespaceURI: String?, qualifiedName qName: String?,
                attributes attributeDict: [String: String]) {
        switch elementName {
        case "trk":
            beginFeature(gpxType: "trk")
        case "rte":
            beginFeature(gpxType: "rte")
            // Route points accumulate directly into a single segment.
            curSegment = []
        case "trkseg":
            curSegment = []
        case "trkpt", "rtept":
            if let latS = attributeDict["lat"], let lonS = attributeDict["lon"],
               let lat = Double(latS), let lon = Double(lonS) {
                curPoint = Point(lon: lon, lat: lat, ele: nil, time: nil)
            } else {
                curPoint = nil
            }
        case "name":
            inName = true
            text = ""
        case "ele", "time":
            text = ""
        default:
            break
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        text += string
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String,
                namespaceURI: String?, qualifiedName qName: String?) {
        switch elementName {
        case "name":
            // Only the first name encountered within a trk/rte (before any
            // point) is treated as the layer name; point-level names ignored.
            if inName && curName == nil && curPoint == nil {
                curName = text.trimmingCharacters(in: .whitespacesAndNewlines)
            }
            inName = false
        case "ele":
            if curPoint != nil {
                curPoint!.ele = Double(text.trimmingCharacters(in: .whitespacesAndNewlines))
            }
        case "time":
            if curPoint != nil {
                curPoint!.time = text.trimmingCharacters(in: .whitespacesAndNewlines)
            }
        case "trkpt", "rtept":
            if let p = curPoint { curSegment.append(p) }
            curPoint = nil
        case "trkseg":
            if !curSegment.isEmpty { curSegments.append(curSegment) }
            curSegment = []
        case "trk", "rte":
            if elementName == "rte" && !curSegment.isEmpty {
                curSegments.append(curSegment)
                curSegment = []
            }
            endFeature()
        default:
            break
        }
        text = ""
    }

    private func beginFeature(gpxType: String) {
        curGpxType = gpxType
        curName = nil
        curSegments = []
        curSegment = []
    }

    private func endFeature() {
        guard let gpxType = curGpxType, !curSegments.isEmpty else {
            curGpxType = nil
            return
        }
        var segments: [[[Double]]] = []
        var times: [String] = []
        var anyTime = false
        for seg in curSegments {
            var coords: [[Double]] = []
            for p in seg {
                if let ele = p.ele {
                    coords.append([p.lon, p.lat, ele])
                } else {
                    coords.append([p.lon, p.lat])
                }
                if let t = p.time, !t.isEmpty {
                    times.append(t)
                    anyTime = true
                } else {
                    times.append("")
                }
            }
            segments.append(coords)
        }
        features.append(GeoFeature(
            segments: segments,
            gpxType: gpxType,
            name: curName,
            explicitKind: nil,
            times: anyTime ? times : nil
        ))
        curGpxType = nil
    }
}
