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
    static func parse(data: Data, fileName: String) throws -> ImportedRouteDocument {
        switch URL(fileURLWithPath: fileName).pathExtension.lowercased() {
        case "gpx":
            return ImportedRouteDocument(
                track: try GPXTrackParser.parse(data, name: fileName),
                referenceRoads: []
            )
        case "geojson", "json":
            return try parseGeoJSON(data, name: fileName)
        default:
            throw TrackImportError.unsupportedFormat
        }
    }

    static func parseGeoJSON(_ data: Data, name: String) throws -> ImportedRouteDocument {
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
        var track: ImportedTrack?
        let preferred = features.sorted { featurePriority($0) < featurePriority($1) }
        for feature in preferred {
            guard featureKind(feature) != "reference" else { continue }
            guard let geometry = feature["geometry"] as? [String: Any],
                  let coordinates = lineStrings(geometry).max(by: { $0.count < $1.count }),
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
                track = ImportedTrack(name: properties?["name"] as? String ?? name, points: points)
                break
            }
        }
        guard let track else { throw TrackImportError.invalidGeoJSON }
        return ImportedRouteDocument(track: track, referenceRoads: referenceRoads(from: features))
    }

    private static func featurePriority(_ feature: [String: Any]) -> Int {
        let kind = featureKind(feature)
        if kind == "driven" { return 0 }
        if kind == "planned" { return 1 }
        return 2
    }

    private static func featureKind(_ feature: [String: Any]) -> String {
        let properties = feature["properties"] as? [String: Any]
        return properties?["kind"] as? String ?? properties?["type"] as? String ?? ""
    }

    private static func lineStrings(_ geometry: [String: Any]) -> [[[Double]]] {
        switch geometry["type"] as? String {
        case "LineString":
            return (geometry["coordinates"] as? [[Double]]).map { [$0] } ?? []
        case "MultiLineString":
            return geometry["coordinates"] as? [[[Double]]] ?? []
        default:
            return []
        }
    }

    private static func referenceRoads(from features: [[String: Any]]) -> [Road] {
        var roads: [Road] = []
        for (featureIndex, feature) in features.enumerated() where featureKind(feature) == "reference" {
            guard let geometry = feature["geometry"] as? [String: Any] else { continue }
            let properties = feature["properties"] as? [String: Any]
            let baseID = stringProperty("osm_way_id", in: properties) ?? stringProperty("id", in: properties) ?? "reference-\(featureIndex)"
            let name = properties?["name"] as? String ?? "Reference road"
            let highway = properties?["highway"] as? String ?? "unclassified"
            for (lineIndex, coordinates) in lineStrings(geometry).enumerated() {
                let points = coordinates.compactMap { coordinate -> RoadPoint? in
                    guard coordinate.count >= 2 else { return nil }
                    let lon = coordinate[0]
                    let lat = coordinate[1]
                    return RoadPoint(nodeID: coordinateNodeID(lat: lat, lon: lon), lat: lat, lon: lon)
                }
                guard points.count > 1 else { continue }
                roads.append(Road(
                    id: lineIndex == 0 ? baseID : "\(baseID)-\(lineIndex)",
                    name: name,
                    highway: highway,
                    points: points
                ))
            }
        }
        return roads
    }

    private static func stringProperty(_ key: String, in properties: [String: Any]?) -> String? {
        if let value = properties?[key] as? String { return value }
        if let value = properties?[key] as? NSNumber { return value.stringValue }
        return nil
    }

    private static func coordinateNodeID(lat: Double, lon: Double) -> String {
        String(format: "geojson:%.7f:%.7f", lat, lon)
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
