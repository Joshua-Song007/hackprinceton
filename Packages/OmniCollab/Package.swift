// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OmniCollab",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "OmniCollab", targets: ["OmniCollab"]),
    ],
    dependencies: [
        .package(path: "../OmniCore"),
    ],
    targets: [
        .target(
            name: "OmniCollab",
            dependencies: [
                .product(name: "OmniCore", package: "OmniCore"),
            ]
        ),
    ]
)
