import Foundation

enum TrackImportError: LocalizedError {
    case unsupportedFormat
    case noCoordinates
    case invalidGeoJSON

    var errorDescription: String? {
        switch self {
        case .unsupportedFormat: "仅支持 GPX、GeoJSON 和 JSON 文件。"
        case .noCoordinates: "文件中没有可用的轨迹坐标。"
        case .invalidGeoJSON: "GeoJSON 结构无效或没有 LineString。"
        }
    }
}

enum TrackImportService {
    static func parse(data: Data, fileName: String) throws -> ImportedTrack {
        switch URL(fileURLWithPath: fileName).pathExtension.lowercased() {
        case "gpx":
            return try GPXTrackParser.parse(data, name: fileName)
        case "geojson", "json":
            return try parseGeoJSON(data, name: fileName)
        default:
            throw TrackImportError.unsupportedFormat
        }
    }

    static func parseGeoJSON(_ data: Data, name: String) throws -> ImportedTrack {
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw TrackImportError.invalidGeoJSON
        }
        let features: [[String: Any]]
        if root["type"] as? String == "FeatureCollection" {
            features = root["features"] as? [[String: Any]] ?? []
        } else if root["type"] as? String == "Feature" {
            features = [root]
        } else {
            features = [["type": "Feature", "geometry": root]]
        }
        let preferred = features.sorted { featurePriority($0) < featurePriority($1) }
        for feature in preferred {
            guard let geometry = feature["geometry"] as? [String: Any],
                  let coordinates = lineCoordinates(geometry),
                  coordinates.count > 1 else { continue }
            let properties = feature["properties"] as? [String: Any]
            let coordinateProperties = properties?["coordinateProperties"] as? [String: Any]
            let timeStrings = coordinateProperties?["times"] as? [String] ?? []
            let points = coordinates.enumerated().compactMap { index, coordinate -> ImportedTrackPoint? in
                guard coordinate.count >= 2 else { return nil }
                return ImportedTrackPoint(
                    point: GeoPoint(lat: coordinate[1], lon: coordinate[0]),
                    time: index < timeStrings.count ? parseISODate(timeStrings[index]) : nil
                )
            }
            if points.count > 1 {
                return ImportedTrack(name: properties?["name"] as? String ?? name, points: points)
            }
        }
        throw TrackImportError.invalidGeoJSON
    }

    private static func featurePriority(_ feature: [String: Any]) -> Int {
        let properties = feature["properties"] as? [String: Any]
        let kind = properties?["kind"] as? String ?? properties?["type"] as? String ?? ""
        if kind == "driven" { return 0 }
        if kind == "planned" { return 1 }
        return 2
    }

    private static func lineCoordinates(_ geometry: [String: Any]) -> [[Double]]? {
        switch geometry["type"] as? String {
        case "LineString":
            return geometry["coordinates"] as? [[Double]]
        case "MultiLineString":
            return (geometry["coordinates"] as? [[[Double]]])?.max { $0.count < $1.count }
        default:
            return nil
        }
    }

    fileprivate static func parseISODate(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        return standard.date(from: value)
    }
}

private final class GPXTrackParser: NSObject, XMLParserDelegate {
    private var points: [ImportedTrackPoint] = []
    private var currentPoint: GeoPoint?
    private var currentText = ""
    private var currentTime: Date?

    static func parse(_ data: Data, name: String) throws -> ImportedTrack {
        let delegate = GPXTrackParser()
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        guard parser.parse() else { throw parser.parserError ?? TrackImportError.noCoordinates }
        guard delegate.points.count > 1 else { throw TrackImportError.noCoordinates }
        return ImportedTrack(name: name, points: delegate.points)
    }

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String] = [:]) {
        currentText = ""
        if ["trkpt", "rtept"].contains(elementName),
           let lat = Double(attributes["lat"] ?? ""),
           let lon = Double(attributes["lon"] ?? "") {
            currentPoint = GeoPoint(lat: lat, lon: lon)
            currentTime = nil
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        currentText += string
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName: String?) {
        if elementName == "time", currentPoint != nil {
            currentTime = TrackImportService.parseISODate(currentText.trimmingCharacters(in: .whitespacesAndNewlines))
        } else if ["trkpt", "rtept"].contains(elementName), let currentPoint {
            points.append(ImportedTrackPoint(point: currentPoint, time: currentTime))
            self.currentPoint = nil
        }
    }
}
