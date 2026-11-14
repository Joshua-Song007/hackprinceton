import Foundation
import OmniInput
import SwiftUI

/// Warns when the connected or simulated devices cannot satisfy the game's declared tier.
/// `requiredTier` is `SceneDescription.requiredTier` (a plain Int, so OmniRuntime stays off `CapabilityTier`);
/// Studio maps it here.
struct CapabilityWarningView: View {
    let requiredTier: Int
    let devices: [DeviceDescriptor]

    /// Out-of-range values clamp to tier 1...3.
    static func tier(for requiredTier: Int) -> CapabilityTier {
        CapabilityTier(rawValue: min(max(requiredTier, 1), 3)) ?? .tier1
    }

    /// Missing channel names, sorted; empty when the tier is satisfied.
    static func missing(requiredTier: Int, devices: [DeviceDescriptor]) -> [String] {
        tier(for: requiredTier).missingChannels(for: devices).map(\.rawValue).sorted()
    }

    var body: some View {
        let tier = Self.tier(for: requiredTier)
        let missing = Self.missing(requiredTier: requiredTier, devices: devices)
        if !missing.isEmpty {
            Label(
                "Game needs tier \(tier.rawValue); missing: \(missing.joined(separator: ", "))",
                systemImage: "exclamationmark.triangle.fill"
            )
            .font(.caption)
            .foregroundStyle(.orange)
            .padding(6)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 6))
        }
    }
}
