import PearCloud

/// Whether a library game can be played on a device (overview.md Module 7 Run Mode).
public enum Playability: Sendable, Equatable {
    case playable
    case needsController
    /// A `device` game runs on the player's own iPhone, so a Mac or iPad cannot play it.
    case needsPhone
    case needsDisplay
    case needsTier(Int)

    public var isPlayable: Bool { self == .playable }

    /// Pure. The first failing check wins, in this order:
    /// 1. `device` games need an iPhone.
    /// 2. `screen` games (and any run mode this app does not know) need a display and a controller
    ///    (motion or touch).
    /// 3. The game's required tier must not exceed the device's `maxTier`.
    public static func evaluate(_ entry: CatalogEntry, on profile: DeviceProfile) -> Playability {
        if entry.runMode == "device" {
            if profile.kind != .iPhone { return .needsPhone }
        } else {
            if !profile.sensors.contains(.display) { return .needsDisplay }
            if !profile.sensors.contains(.motion) && !profile.sensors.contains(.touch) {
                return .needsController
            }
        }
        let tier = max(entry.requiredTier, 1)
        if tier > profile.maxTier { return .needsTier(tier) }
        return .playable
    }
}
