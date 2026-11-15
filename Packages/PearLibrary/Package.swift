// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PearLibrary",
    platforms: [.macOS(.v15), .iOS(.v18)],
    products: [
        .library(name: "PearLibrary", targets: ["PearLibrary"]),
    ],
    dependencies: [
        .package(path: "../PearCloud"),
    ],
    targets: [
        .target(
            name: "PearLibrary",
            dependencies: [
                .product(name: "PearCloud", package: "PearCloud"),
            ]
        ),
        .testTarget(
            name: "PearLibraryTests",
            dependencies: [
                "PearLibrary",
                .product(name: "PearCloud", package: "PearCloud"),
            ]
        ),
    ]
)
