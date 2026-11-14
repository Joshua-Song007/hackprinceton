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
            ],
            resources: [
                .copy("Resources/prelude.js"),
            ]
        ),
        .testTarget(name: "OmniScriptTests", dependencies: ["OmniScript", .product(name: "OmniRuntime", package: "OmniRuntime")]),
    ]
)
