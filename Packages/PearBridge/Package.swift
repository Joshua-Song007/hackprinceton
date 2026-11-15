// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PearBridge",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "PearBridge", targets: ["PearBridge"]),
    ],
    dependencies: [
        .package(path: "../PearCore"),
        .package(path: "../PearInput"),
        .package(path: "../PearOutput"),
    ],
    targets: [
        .target(
            name: "PearBridge",
            dependencies: [
                .product(name: "PearCore", package: "PearCore"),
                .product(name: "PearInput", package: "PearInput"),
                .product(name: "PearOutput", package: "PearOutput"),
            ]
        ),
        .testTarget(
            name: "PearBridgeTests",
            dependencies: [
                "PearBridge",
                .product(name: "PearCore", package: "PearCore"),
                .product(name: "PearInput", package: "PearInput"),
            ]
        ),
    ]
)
