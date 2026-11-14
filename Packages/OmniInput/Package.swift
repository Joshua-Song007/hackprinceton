// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OmniInput",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "OmniInput", targets: ["OmniInput"]),
    ],
    dependencies: [
        .package(path: "../OmniCore"),
    ],
    targets: [
        .target(
            name: "OmniInput",
            dependencies: [
                .product(name: "OmniCore", package: "OmniCore"),
            ]
        ),
    ]
)
