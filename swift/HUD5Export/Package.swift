// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "HUD5Export",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(name: "HUD5Render", targets: ["HUD5Render"]),
        .executable(name: "hud5-export", targets: ["hud5-export"])
    ],
    dependencies: [
        .package(path: "../HUD5Core")
    ],
    targets: [
        .target(
            name: "HUD5Render",
            dependencies: [.product(name: "HUD5Core", package: "HUD5Core")]
        ),
        .executableTarget(
            name: "hud5-export",
            dependencies: [
                "HUD5Render",
                .product(name: "HUD5Core", package: "HUD5Core")
            ]
        ),
        .testTarget(
            name: "HUD5RenderTests",
            dependencies: ["HUD5Render"]
        )
    ]
)
