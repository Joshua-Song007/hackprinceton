// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PearAdapters",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "PearAdapters", targets: ["PearAdapters"]),
    ],
    dependencies: [
        .package(path: "../PearCore"),
        .package(path: "../PearInput"),
    ],
    targets: [
        .target(
            name: "PearAdapters",
            dependencies: [
                .product(name: "PearCore", package: "PearCore"),
                .product(name: "PearInput", package: "PearInput"),
            ]
        ),
    ]
)
