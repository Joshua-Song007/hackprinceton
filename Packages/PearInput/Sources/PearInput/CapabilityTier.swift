import Foundation

public enum ChannelKind: String, CaseIterable, Sendable {
    case orientation, position, accel, touch, gesture, heartRate, pencil
}

/// Orientation is the baseline for every tier and touch is required by none (AirPods are Tier 1 and have no touch).
/// Hand tracking (Tier 2) and gaze (Tier 3) have no USIS v1 channel, so they cannot be checked here.
public enum CapabilityTier: Int, Comparable, CaseIterable, Sendable {
    case tier1 = 1
    case tier2
    case tier3

    public static func < (lhs: CapabilityTier, rhs: CapabilityTier) -> Bool {
        lhs.rawValue < rhs.rawValue
    }

    public var requiredChannels: Set<ChannelKind> {
        switch self {
        case .tier1: [.orientation]
        case .tier2: [.orientation, .position]
        case .tier3: [.orientation, .heartRate]
        }
    }

    /// Channels are pooled across all devices; a single device need not provide every one.
    public func missingChannels(for devices: [DeviceDescriptor]) -> Set<ChannelKind> {
        let available = devices.reduce(into: Set<ChannelKind>()) { $0.formUnion($1.channels) }
        return requiredChannels.subtracting(available)
    }

    public func isSatisfied(by devices: [DeviceDescriptor]) -> Bool {
        missingChannels(for: devices).isEmpty
    }
}
