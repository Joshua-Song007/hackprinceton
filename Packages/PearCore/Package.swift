// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PearCore",
    platforms: [.macOS(.v15), .iOS(.v18), .watchOS(.v11)],
    products: [
        .library(name: "PearCore", targets: ["PearCore"]),
    ],
    targets: [
        .target(name: "PearCore"),
        .testTarget(name: "PearCoreTests", dependencies: ["PearCore"]),
    ]
)
