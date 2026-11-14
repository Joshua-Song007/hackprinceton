// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OmniBridge",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "OmniBridge", targets: ["OmniBridge"]),
    ],
    dependencies: [
        .package(path: "../OmniCore"),
        .package(path: "../OmniInput"),
        .package(path: "../OmniOutput"),
    ],
    targets: [
        .target(
            name: "OmniBridge",
            dependencies: [
                .product(name: "OmniCore", package: "OmniCore"),
                .product(name: "OmniInput", package: "OmniInput"),
                .product(name: "OmniOutput", package: "OmniOutput"),
            ]
        ),
        .testTarget(
            name: "OmniBridgeTests",
            dependencies: [
                "OmniBridge",
                .product(name: "OmniCore", package: "OmniCore"),
                .product(name: "OmniInput", package: "OmniInput"),
            ]
        ),
    ]
)
