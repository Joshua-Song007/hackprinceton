// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PearCollab",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "PearCollab", targets: ["PearCollab"]),
    ],
    dependencies: [
        .package(path: "../PearCore"),
    ],
    targets: [
        .target(
            name: "PearCollab",
            dependencies: [
                .product(name: "PearCore", package: "PearCore"),
            ]
        ),
    ]
)
