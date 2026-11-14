// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OmniCore",
    platforms: [.macOS(.v15), .iOS(.v18), .watchOS(.v11)],
    products: [
        .library(name: "OmniCore", targets: ["OmniCore"]),
    ],
    targets: [
        .target(name: "OmniCore"),
    ]
)
