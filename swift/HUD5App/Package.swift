// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "HUD5App",
    platforms: [
        .macOS(.v14)
    ],
    dependencies: [
        .package(path: "../HUD5Core"),
        .package(path: "../HUD5Export")
    ],
    targets: [
        .executableTarget(
            name: "HUD5App",
            dependencies: [
                .product(name: "HUD5Core", package: "HUD5Core"),
                .product(name: "HUD5Render", package: "HUD5Export")
            ]
        )
    ]
)
