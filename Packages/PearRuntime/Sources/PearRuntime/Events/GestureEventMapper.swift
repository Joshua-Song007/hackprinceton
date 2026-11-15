import Foundation
import PearCore
import RealityKit

/// Maps the gesture channel of every device to `onGesture` events. Gestures are already delivered once per frame by the
/// input layer, so this is a stateless pass-through; stale devices emit nothing.
@MainActor
public final class GestureEventMapper: EventDeriver {
    public init() {}

    public func derive(from frame: InputFrame, deltaTime: TimeInterval, root: Entity) -> [GameEvent] {
        var events: [GameEvent] = []
        for device in frame.devices where !device.stale {
            for gesture in device.gestures {
                events.append(.gesture(gesture, slot: device.slot))
            }
        }
        return events
    }
}
