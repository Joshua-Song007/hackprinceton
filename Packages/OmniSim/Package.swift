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
            ]
        ),
    ]
)
