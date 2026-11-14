import OmniCore
import RealityKit

/// Game-level events the runtime hands to scripts. The first four are derived from input; the trigger pair comes from
/// `TriggerSystem` so data-only games can react to zones.
public enum GameEvent: Equatable, Sendable {
    case lookAt(entity: Entity.ID)
    case gesture(GestureEvent, slot: Slot)
    case heartRate(bpm: Double, intensity: Double)
    case raycastHit(entity: Entity.ID, slot: Slot)
    case triggerEntered(trigger: Entity.ID, probe: Slot)
    case triggerExited(trigger: Entity.ID, probe: Slot)

    /// The entity whose script should receive the event; `nil` means every scripted entity.
    public var targetEntityID: Entity.ID? {
        switch self {
        case .lookAt(let entity): entity
        case .raycastHit(let entity, _): entity
        case .triggerEntered(let trigger, _): trigger
        case .triggerExited(let trigger, _): trigger
        case .gesture, .heartRate: nil
        }
    }
}
