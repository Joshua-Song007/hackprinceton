// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PearSim",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "PearSim", targets: ["PearSim"]),
    ],
    dependencies: [
        .package(path: "../PearCore"),
        .package(path: "../PearInput"),
        .package(path: "../PearOutput"),
    ],
    targets: [
        .target(
            name: "PearSim",
            dependencies: [
                .product(name: "PearCore", package: "PearCore"),
                .product(name: "PearInput", package: "PearInput"),
                .product(name: "PearOutput", package: "PearOutput"),
            ],
            resources: [
                .copy("Presets/airpods-head-pitch.usis.jsonl"),
                .copy("Presets/watch-double-tap.usis.jsonl"),
                .copy("Presets/watch-flick.usis.jsonl"),
                .copy("Presets/pencil-barrel-roll.usis.jsonl"),
            ]
        ),
        .testTarget(
            name: "PearSimTests",
            dependencies: [
                "PearSim",
                .product(name: "PearCore", package: "PearCore"),
                .product(name: "PearInput", package: "PearInput"),
            ]
        ),
    ]
)
