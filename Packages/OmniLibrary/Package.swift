// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OmniLibrary",
    platforms: [.macOS(.v15), .iOS(.v18)],
    products: [
        .library(name: "OmniLibrary", targets: ["OmniLibrary"]),
    ],
    dependencies: [
        .package(path: "../OmniCloud"),
    ],
    targets: [
        .target(
            name: "OmniLibrary",
            dependencies: [
                .product(name: "OmniCloud", package: "OmniCloud"),
            ]
        ),
        .testTarget(
            name: "OmniLibraryTests",
            dependencies: [
                "OmniLibrary",
                .product(name: "OmniCloud", package: "OmniCloud"),
            ]
        ),
    ]
)
