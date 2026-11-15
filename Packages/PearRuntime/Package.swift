// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PearRuntime",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "PearRuntime", targets: ["PearRuntime"]),
    ],
    dependencies: [
        .package(path: "../PearCore"),
        .package(path: "../PearInput"),
    ],
    targets: [
        .target(
            name: "PearRuntime",
            dependencies: [
                .product(name: "PearCore", package: "PearCore"),
                .product(name: "PearInput", package: "PearInput"),
            ]
        ),
        .testTarget(
            name: "PearRuntimeTests",
            dependencies: [
                "PearRuntime",
                .product(name: "PearCore", package: "PearCore"),
                .product(name: "PearInput", package: "PearInput"),
            ]
        ),
    ]
)
