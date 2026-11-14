// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OmniSim",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "OmniSim", targets: ["OmniSim"]),
    ],
    dependencies: [
        .package(path: "../OmniCore"),
        .package(path: "../OmniInput"),
        .package(path: "../OmniOutput"),
    ],
    targets: [
        .target(
            name: "OmniSim",
            dependencies: [
                .product(name: "OmniCore", package: "OmniCore"),
                .product(name: "OmniInput", package: "OmniInput"),
                .product(name: "OmniOutput", package: "OmniOutput"),
            ],
            resources: [
                .copy("Presets/airpods-head-pitch.usis.jsonl"),
                .copy("Presets/watch-double-tap.usis.jsonl"),
                .copy("Presets/watch-flick.usis.jsonl"),
                .copy("Presets/pencil-barrel-roll.usis.jsonl"),
            ]
        ),
        .testTarget(
            name: "OmniSimTests",
            dependencies: [
                "OmniSim",
                .product(name: "OmniCore", package: "OmniCore"),
                .product(name: "OmniInput", package: "OmniInput"),
            ]
        ),
    ]
)
