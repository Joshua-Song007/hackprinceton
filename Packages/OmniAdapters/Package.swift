// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OmniAdapters",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "OmniAdapters", targets: ["OmniAdapters"]),
    ],
    dependencies: [
        .package(path: "../OmniCore"),
        .package(path: "../OmniInput"),
    ],
    targets: [
        .target(
            name: "OmniAdapters",
            dependencies: [
                .product(name: "OmniCore", package: "OmniCore"),
                .product(name: "OmniInput", package: "OmniInput"),
            ]
        ),
    ]
)
