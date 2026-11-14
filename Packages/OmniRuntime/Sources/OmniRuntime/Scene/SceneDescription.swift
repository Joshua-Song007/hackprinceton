import Foundation
import OmniCore

/// Declarative, Codable description of a game scene: entities, transforms, components and script names.
/// Pure data; `SceneLoader` turns it into RealityKit entities.
public struct SceneDescription: Codable, Equatable, Sendable {
    /// How the game is played (overview.md Module 7 Run Mode).
    public enum RunMode: String, Codable, Equatable, Sendable {
        case screen
        case device
    }

    public var name: String
    /// Capability tier the game needs, 1...3. A plain Int so OmniRuntime stays off `CapabilityTier`.
    public var requiredTier: Int
    /// Head position used when the head sample carries no `position`.
    public var playerOrigin: Vector3
    public var runMode: RunMode
    public var clientScripts: [String]
    public var serverScripts: [String]
    public var entities: [EntityDescription]

    public init(
        name: String = "",
        requiredTier: Int = 1,
        playerOrigin: Vector3 = .zero,
        runMode: RunMode = .screen,
        clientScripts: [String] = [],
        serverScripts: [String] = [],
        entities: [EntityDescription] = []
    ) {
        self.name = name
        self.requiredTier = requiredTier
        self.playerOrigin = playerOrigin
        self.runMode = runMode
        self.clientScripts = clientScripts
        self.serverScripts = serverScripts
        self.entities = entities
    }

    private enum CodingKeys: String, CodingKey {
        case name, requiredTier, playerOrigin, runMode, clientScripts, serverScripts, entities
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        let tier = try c.decodeIfPresent(Int.self, forKey: .requiredTier) ?? 1
        guard (1...3).contains(tier) else {
            throw DecodingError.dataCorruptedError(
                forKey: .requiredTier, in: c, debugDescription: "requiredTier must be 1...3, got \(tier)")
        }
        requiredTier = tier
        playerOrigin = try c.decodeIfPresent(Vector3.self, forKey: .playerOrigin) ?? .zero
        runMode = try c.decodeIfPresent(RunMode.self, forKey: .runMode) ?? .screen
        clientScripts = try c.decodeIfPresent([String].self, forKey: .clientScripts) ?? []
        serverScripts = try c.decodeIfPresent([String].self, forKey: .serverScripts) ?? []
        entities = try c.decodeIfPresent([EntityDescription].self, forKey: .entities) ?? []
    }
}

/// One entity: local transform, components and children.
public struct EntityDescription: Codable, Equatable, Sendable {
    public var name: String
    public var position: Vector3
    /// Local rotation as `[x, y, z, w]`.
    public var rotation: Quaternion
    public var scale: Vector3
    public var components: [ComponentDescription]
    public var children: [EntityDescription]

    public init(
        name: String = "",
        position: Vector3 = .zero,
        rotation: Quaternion = .identity,
        scale: Vector3 = Vector3(1, 1, 1),
        components: [ComponentDescription] = [],
        children: [EntityDescription] = []
    ) {
        self.name = name
        self.position = position
        self.rotation = rotation
        self.scale = scale
        self.components = components
        self.children = children
    }

    private enum CodingKeys: String, CodingKey {
        case name, position, rotation, scale, components, children
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        position = try c.decodeIfPresent(Vector3.self, forKey: .position) ?? .zero
        rotation = try c.decodeIfPresent(Quaternion.self, forKey: .rotation) ?? .identity
        scale = try c.decodeIfPresent(Vector3.self, forKey: .scale) ?? Vector3(1, 1, 1)
        components = try c.decodeIfPresent([ComponentDescription].self, forKey: .components) ?? []
        children = try c.decodeIfPresent([EntityDescription].self, forKey: .children) ?? []
    }
}

/// A component, discriminated by `type` in JSON. An unknown `type` fails decoding with a `DecodingError`.
public enum ComponentDescription: Codable, Equatable, Sendable {
    public enum TriggerShape: Codable, Equatable, Sendable {
        case sphere(radius: Double)
        case box(size: Vector3)
    }

    case trigger(shape: TriggerShape, probeSlots: [Slot])
    case audioEmitter(soundName: String, gain: Double, loops: Bool)
    case script(name: String)

    private enum CodingKeys: String, CodingKey {
        case type, shape, radius, size, probeSlots, soundName, gain, loops, name
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let type = try c.decode(String.self, forKey: .type)
        switch type {
        case "trigger":
            let shapeName = try c.decode(String.self, forKey: .shape)
            let shape: TriggerShape
            switch shapeName {
            case "sphere":
                shape = .sphere(radius: try c.decode(Double.self, forKey: .radius))
            case "box":
                shape = .box(size: try c.decode(Vector3.self, forKey: .size))
            default:
                throw DecodingError.dataCorruptedError(
                    forKey: .shape, in: c, debugDescription: "unknown trigger shape '\(shapeName)'")
            }
            let slots = try c.decodeIfPresent([Slot].self, forKey: .probeSlots) ?? [.head]
            self = .trigger(shape: shape, probeSlots: slots)
        case "audioEmitter":
            self = .audioEmitter(
                soundName: try c.decode(String.self, forKey: .soundName),
                gain: try c.decodeIfPresent(Double.self, forKey: .gain) ?? 0,
                loops: try c.decodeIfPresent(Bool.self, forKey: .loops) ?? false)
        case "script":
            self = .script(name: try c.decode(String.self, forKey: .name))
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type, in: c, debugDescription: "unknown component type '\(type)'")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .trigger(shape, probeSlots):
            try c.encode("trigger", forKey: .type)
            switch shape {
            case let .sphere(radius):
                try c.encode("sphere", forKey: .shape)
                try c.encode(radius, forKey: .radius)
            case let .box(size):
                try c.encode("box", forKey: .shape)
                try c.encode(size, forKey: .size)
            }
            try c.encode(probeSlots, forKey: .probeSlots)
        case let .audioEmitter(soundName, gain, loops):
            try c.encode("audioEmitter", forKey: .type)
            try c.encode(soundName, forKey: .soundName)
            try c.encode(gain, forKey: .gain)
            try c.encode(loops, forKey: .loops)
        case let .script(name):
            try c.encode("script", forKey: .type)
            try c.encode(name, forKey: .name)
        }
    }
}
