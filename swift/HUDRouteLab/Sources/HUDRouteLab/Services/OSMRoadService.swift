import Foundation

actor OSMRoadService {
    func fetchRoads(center: GeoPoint, radiusM: Double) async throws -> [Road] {
        let bounds = MapBounds(center: center, radiusM: radiusM)
        let bbox = "\(bounds.minLon),\(bounds.minLat),\(bounds.maxLon),\(bounds.maxLat)"
        guard let url = URL(string: "https://www.openstreetmap.org/api/0.6/map?bbox=\(bbox)") else {
            throw URLError(.badURL)
        }
        var request = URLRequest(url: url)
        request.setValue("HUDRouteLab/0.1", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        return try OSMXMLParser.parse(data)
    }
}

final class OSMXMLParser: NSObject, XMLParserDelegate {
    private var nodes: [String: RoadPoint] = [:]
    private var roads: [Road] = []
    private var currentWayID: String?
    private var currentNodeRefs: [String] = []
    private var currentTags: [String: String] = [:]

    static func parse(_ data: Data) throws -> [Road] {
        let delegate = OSMXMLParser()
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        guard parser.parse() else { throw parser.parserError ?? URLError(.cannotParseResponse) }
        return delegate.roads
    }

    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String] = [:]) {
        switch name {
        case "node":
            if let id = attributes["id"], let lat = Double(attributes["lat"] ?? ""), let lon = Double(attributes["lon"] ?? "") {
                nodes[id] = RoadPoint(nodeID: id, lat: lat, lon: lon)
            }
        case "way":
            currentWayID = attributes["id"]
            currentNodeRefs = []
            currentTags = [:]
        case "nd":
            if let ref = attributes["ref"] { currentNodeRefs.append(ref) }
        case "tag":
            if let key = attributes["k"] { currentTags[key] = attributes["v"] ?? "" }
        default: break
        }
    }

    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
        guard name == "way", let id = currentWayID, let highway = currentTags["highway"] else { return }
        let points = currentNodeRefs.compactMap { nodes[$0] }
        if points.count > 1 {
            roads.append(Road(id: id, name: currentTags["name"] ?? currentTags["name:zh"] ?? currentTags["ref"] ?? "Unnamed road", highway: highway, points: points))
        }
        currentWayID = nil
    }
}
