import OmniCore
import RealityKit

/// A volume that notices when a device probe enters or leaves it. `TriggerSystem` does the overlap test with its own math
/// (not RealityKit collision), so it resolves inside `SceneRunner.step` and runs without a live scene.
public struct TriggerComponent: Component {
    /// Local-space volume; the entity's world transform (position, rotation, scale) places it in the scene.
    public enum Shape: Equatable, Sendable {
        case sphere(radius: Float)
        case box(size: SIMD3<Float>)
    }

    public var shape: Shape
    /// Which device slots can enter this trigger. Defaults to the head only.
    public var probeSlots: Set<Slot>
    public var onEnter: (@MainActor (_ trigger: Entity, _ probe: Slot) -> Void)?
    public var onExit: (@MainActor (_ trigger: Entity, _ probe: Slot) -> Void)?
    /// Probes currently inside. Owned by `TriggerSystem`; read-only to everyone else.
    public internal(set) var occupants: Set<Slot> = []

    public init(
        shape: Shape,
        probeSlots: Set<Slot> = [.head],
        onEnter: (@MainActor (_ trigger: Entity, _ probe: Slot) -> Void)? = nil,
        onExit: (@MainActor (_ trigger: Entity, _ probe: Slot) -> Void)? = nil
    ) {
        self.shape = shape
        self.probeSlots = probeSlots
        self.onEnter = onEnter
        self.onExit = onExit
    }
}
