// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OmniOutput",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "OmniOutput", targets: ["OmniOutput"]),
    ],
    dependencies: [
        .package(path: "../OmniCore"),
    ],
    targets: [
        .target(
            name: "OmniOutput",
            dependencies: [
                .product(name: "OmniCore", package: "OmniCore"),
            ]
        ),
    ]
)
