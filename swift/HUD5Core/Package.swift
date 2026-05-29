// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "HUD5Core",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(name: "HUD5Core", targets: ["HUD5Core"])
    ],
    targets: [
        .target(name: "HUD5Core"),
        .testTarget(
            name: "HUD5CoreTests",
            dependencies: ["HUD5Core"]
        )
    ]
)
