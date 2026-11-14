// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OmniScript",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "OmniScript", targets: ["OmniScript"]),
    ],
    dependencies: [
        .package(path: "../OmniRuntime"),
    ],
    targets: [
        .target(
            name: "OmniScript",
            dependencies: [
                .product(name: "OmniRuntime", package: "OmniRuntime"),
            ]
        ),
    ]
)
