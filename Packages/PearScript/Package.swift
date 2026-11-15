// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PearScript",
    platforms: [.macOS(.v15), .iOS(.v18)],
    products: [
        .library(name: "PearScript", targets: ["PearScript"]),
    ],
    dependencies: [
        .package(path: "../PearRuntime"),
    ],
    targets: [
        .target(
            name: "PearScript",
            dependencies: [
                .product(name: "PearRuntime", package: "PearRuntime"),
            ],
            resources: [
                .copy("Resources/prelude.js"),
            ]
        ),
        .testTarget(
            name: "PearScriptTests",
            dependencies: [
                "PearScript",
                .product(name: "PearRuntime", package: "PearRuntime"),
            ]
        ),
    ]
)
