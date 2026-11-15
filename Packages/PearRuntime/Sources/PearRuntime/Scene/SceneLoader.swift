import Foundation
import PearCore
import RealityKit

/// Builds RealityKit entities and components from a `SceneDescription`.
@MainActor
public enum SceneLoader {
    public enum LoadError: Error, Equatable {
        case invalidTier(Int)
        case invalidShape(String)
    }

    /// Decodes JSON into a `SceneDescription`; unknown component types surface as a `DecodingError`.
    public static func decode(_ data: Data) throws -> SceneDescription {
        try JSONDecoder().decode(SceneDescription.self, from: data)
    }

    /// Builds the entity tree under `root` (a new `Entity` by default) and returns it.
    @discardableResult
    public static func load(_ scene: SceneDescription, into root: Entity = Entity()) throws -> Entity {
        guard (1...3).contains(scene.requiredTier) else { throw LoadError.invalidTier(scene.requiredTier) }
        registerComponents()
        for description in scene.entities {
            root.addChild(try makeEntity(description))
        }
        return root
    }

    private static func registerComponents() {
        // Registering twice is harmless; SceneRunner does the same.
        TriggerComponent.registerComponent()
        AudioEmitterComponent.registerComponent()
        ScriptComponent.registerComponent()
    }

    private static func makeEntity(_ d: EntityDescription) throws -> Entity {
        let entity = Entity()
        entity.name = d.name
        entity.position = SIMD3<Float>(Float(d.position.x), Float(d.position.y), Float(d.position.z))
        entity.orientation = simd_quatf(
            ix: Float(d.rotation.x), iy: Float(d.rotation.y), iz: Float(d.rotation.z), r: Float(d.rotation.w))
        entity.scale = SIMD3<Float>(Float(d.scale.x), Float(d.scale.y), Float(d.scale.z))

        for component in d.components {
            switch component {
            case let .trigger(shape, probeSlots):
                let runtimeShape: TriggerComponent.Shape
                switch shape {
                case let .sphere(radius):
                    guard radius > 0 else { throw LoadError.invalidShape("sphere radius must be > 0") }
                    runtimeShape = .sphere(radius: Float(radius))
                case let .box(size):
                    guard size.x > 0, size.y > 0, size.z > 0 else {
                        throw LoadError.invalidShape("box size must be > 0")
                    }
                    runtimeShape = .box(size: SIMD3<Float>(Float(size.x), Float(size.y), Float(size.z)))
                }
                entity.components.set(TriggerComponent(shape: runtimeShape, probeSlots: Set(probeSlots)))
            case let .audioEmitter(soundName, gain, loops):
                entity.components.set(AudioEmitterComponent(soundName: soundName, gain: gain, loops: loops))
            case let .script(name):
                entity.components.set(ScriptComponent(scriptName: name))
            }
        }
        for child in d.children {
            entity.addChild(try makeEntity(child))
        }
        return entity
    }
}
