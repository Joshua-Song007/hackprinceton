// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PearCloud",
    platforms: [.macOS(.v15), .iOS(.v18)],
    products: [
        .library(name: "PearCloud", targets: ["PearCloud"]),
    ],
    targets: [
        .target(name: "PearCloud"),
        .testTarget(name: "PearCloudTests", dependencies: ["PearCloud"]),
    ]
)
