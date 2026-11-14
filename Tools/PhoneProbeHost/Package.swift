// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PhoneProbeHost",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "PhoneProbeHost"),
    ],
    // ponytail: v5 mode because Network callbacks aren't Sendable; this is a throwaway probe.
    swiftLanguageModes: [.v5]
)
