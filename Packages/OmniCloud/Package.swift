// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OmniCloud",
    platforms: [.macOS(.v15), .iOS(.v18)],
    products: [
        .library(name: "OmniCloud", targets: ["OmniCloud"]),
    ],
    targets: [
        .target(name: "OmniCloud"),
        .testTarget(name: "OmniCloudTests", dependencies: ["OmniCloud"]),
    ]
)
