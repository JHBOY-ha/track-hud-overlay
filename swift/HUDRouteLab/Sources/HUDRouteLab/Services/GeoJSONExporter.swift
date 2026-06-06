import AppKit
import Foundation
import UniformTypeIdentifiers

enum GeoJSONExporter {
    @MainActor
    static func export(roads: [Road], route: RouteResult, center: GeoPoint, radiusM: Double, sampleHz: Double = 10) throws {
        let encoder = ISO8601DateFormatter()
        encoder.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let driven: [String: Any] = [
            "type": "Feature",
            "properties": [
                "kind": "driven",
                "type": "driven",
                "name": "Generated HUD route",
                "coordinateProperties": [
                    "times": route.samples.map { encoder.string(from: $0.time) },
                    "progresses": route.samples.map(\.progress)
                ]
            ],
            "geometry": [
                "type": "LineString",
                "coordinates": route.samples.map { [$0.point.lon, $0.point.lat, 0] }
            ]
        ]
        let references: [[String: Any]] = roads.map { road in
            [
                "type": "Feature",
                "properties": [
                    "kind": "reference",
                    "type": "reference",
                    "name": road.name,
                    "osm_way_id": road.id,
                    "highway": road.highway
                ],
                "geometry": [
                    "type": "LineString",
                    "coordinates": road.points.map { [$0.lon, $0.lat] }
                ]
            ]
        }
        let root: [String: Any] = [
            "type": "FeatureCollection",
            "properties": [
                "center": ["lat": center.lat, "lon": center.lon],
                "radius_m": radiusM,
                "sample_hz": sampleHz,
                "source_license": "OpenStreetMap contributors, ODbL"
            ],
            "features": [driven] + references
        ]
        let data = try JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys])
        let panel = NSSavePanel()
        panel.allowedContentTypes = [UTType(filenameExtension: "geojson") ?? .json]
        let filenameFormatter = DateFormatter()
        filenameFormatter.dateFormat = "yyyy-MM-dd"
        panel.nameFieldStringValue = "hud-route-\(filenameFormatter.string(from: .now)).geojson"
        if panel.runModal() == .OK, let url = panel.url {
            try data.write(to: url, options: .atomic)
        }
    }
}
