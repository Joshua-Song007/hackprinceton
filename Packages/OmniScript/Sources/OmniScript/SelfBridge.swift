import Foundation
import JavaScriptCore
import RealityKit
import OmniRuntime

/// The `self.audio` object scripts see.
@objc @MainActor protocol AudioBridgeExports: JSExport {
    func play(_ name: String)
    func stop()
}

/// Sets the entity's `AudioEmitterComponent`; the runtime owns actual playback.
@MainActor
final class AudioBridge: NSObject, AudioBridgeExports {
    private weak var entity: Entity?

    init(entity: Entity) {
        self.entity = entity
    }

    func play(_ name: String) {
        entity?.components.set(AudioEmitterComponent(soundName: name))
    }

    func stop() {
        entity?.components.remove(AudioEmitterComponent.self)
    }
}

/// The `self` object scripts see. Exposes only the owning entity's name, speed and audio.
@objc @MainActor protocol SelfBridgeExports: JSExport {
    var name: String { get }
    var speed: Double { get set }
    var audio: AudioBridge { get }
}

@MainActor
public final class SelfBridge: NSObject, SelfBridgeExports {
    private weak var entity: Entity?
    let audio: AudioBridge

    /// Script-visible movement speed multiplier; the runtime/game reads it back.
    public var speed: Double = 1

    public var name: String { entity?.name ?? "" }

    public init(entity: Entity) {
        self.entity = entity
        self.audio = AudioBridge(entity: entity)
    }
}
