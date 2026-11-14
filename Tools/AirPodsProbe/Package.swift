// swift-tools-version: 6.0
import Foundation
import PackageDescription

// Embedded so NSMotionUsageDescription exists without an app bundle; absolute so the linker's cwd doesn't matter.
let plistPath = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Info.plist").path

let package = Package(
    name: "AirPodsProbe",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "AirPodsProbe",
            linkerSettings: [
                .unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", plistPath]),
            ]
        ),
    ],
    // ponytail: v5 mode because CoreMotion types aren't Sendable; this is a throwaway probe.
    swiftLanguageModes: [.v5]
)
