// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PearInput",
    platforms: [.macOS(.v15), .iOS(.v18)],
    products: [
        .library(name: "PearInput", targets: ["PearInput"]),
    ],
    dependencies: [
        .package(path: "../PearCore"),
    ],
    targets: [
        .target(
            name: "PearInput",
            dependencies: [
                .product(name: "PearCore", package: "PearCore"),
            ]
        ),
        .testTarget(
            name: "PearInputTests",
            dependencies: [
                "PearInput",
                .product(name: "PearCore", package: "PearCore"),
            ]
        ),
    ]
)
