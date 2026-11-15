// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PearOutput",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "PearOutput", targets: ["PearOutput"]),
    ],
    dependencies: [
        .package(path: "../PearCore"),
    ],
    targets: [
        .target(
            name: "PearOutput",
            dependencies: [
                .product(name: "PearCore", package: "PearCore"),
            ]
        ),
    ]
)
