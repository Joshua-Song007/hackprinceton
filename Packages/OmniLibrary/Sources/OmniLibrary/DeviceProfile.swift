import Foundation

/// What this device is, so the library can flag which games it can play. Not an identity.
public struct DeviceProfile: Sendable, Equatable {
    /// Nested, so it never clashes with OmniCore's `DeviceKind`.
    public enum Kind: String, Sendable, CaseIterable {
        case iPhone, iPad, mac
    }

    public enum Sensor: String, Sendable, Hashable, CaseIterable {
        case display, touch, motion
    }

    public var kind: Kind
    public var model: String
    public var osVersion: String
    public var sensors: Set<Sensor>
    /// 1...3, like `SceneDescription.requiredTier`: the highest capability tier this device can meet.
    public var maxTier: Int

    public init(kind: Kind, model: String, osVersion: String, sensors: Set<Sensor>, maxTier: Int) {
        self.kind = kind
        self.model = model
        self.osVersion = osVersion
        self.sensors = sensors
        self.maxTier = min(max(maxTier, 1), 3)
    }

    /// Sensors and tier come from the kind's preset.
    public init(kind: Kind, model: String, osVersion: String) {
        self.init(
            kind: kind, model: model, osVersion: osVersion,
            sensors: Self.sensors(for: kind), maxTier: Self.maxTier(for: kind))
    }

    /// A phone or tablet has a screen, touch and motion. A Mac has only a screen: its motion input
    /// (AirPods, a phone over the bridge) is the next round.
    public static func sensors(for kind: Kind) -> Set<Sensor> {
        switch kind {
        case .iPhone, .iPad: [.display, .touch, .motion]
        case .mac: [.display]
        }
    }

    /// Tier 1 (orientation + touch) for every kind: Tier 2 needs LiDAR and Tier 3 a Watch, which this package
    /// cannot detect without ARKit. Callers with better knowledge pass their own `maxTier`.
    public static func maxTier(for kind: Kind) -> Int { 1 }

    /// Pure, so it is testable. On iOS the machine string is `iPhone16,1`, `iPad14,3` and so on.
    public static func kind(forMachine machine: String, isMac: Bool) -> Kind {
        if isMac { return .mac }
        return machine.hasPrefix("iPad") ? .iPad : .iPhone
    }

    public static func current() -> DeviceProfile {
        let osVersion = ProcessInfo.processInfo.operatingSystemVersionString
        #if os(macOS)
        let model = sysctlString("hw.model") ?? "Mac"
        let isMac = true
        #else
        let model = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"]
            ?? sysctlString("hw.machine") ?? "iPhone"
        let isMac = false
        #endif
        return DeviceProfile(
            kind: kind(forMachine: model, isMac: isMac), model: model, osVersion: osVersion)
    }

    private static func sysctlString(_ name: String) -> String? {
        var size = 0
        guard sysctlbyname(name, nil, &size, nil, 0) == 0, size > 0 else { return nil }
        var buffer = [UInt8](repeating: 0, count: size)
        guard sysctlbyname(name, &buffer, &size, nil, 0) == 0 else { return nil }
        return String(decoding: buffer.prefix(while: { $0 != 0 }), as: UTF8.self)
    }
}
