// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "HUDRouteLab",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "HUDRouteLab", targets: ["HUDRouteLab"])],
    targets: [
        .executableTarget(name: "HUDRouteLab"),
        .testTarget(name: "HUDRouteLabTests", dependencies: ["HUDRouteLab"])
    ]
)
