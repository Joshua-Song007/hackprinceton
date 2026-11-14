// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OmniRuntime",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "OmniRuntime", targets: ["OmniRuntime"]),
    ],
    dependencies: [
        .package(path: "../OmniCore"),
        .package(path: "../OmniInput"),
    ],
    targets: [
        .target(
            name: "OmniRuntime",
            dependencies: [
                .product(name: "OmniCore", package: "OmniCore"),
                .product(name: "OmniInput", package: "OmniInput"),
            ]
        ),
    ]
)
