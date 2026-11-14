import Foundation
import OmniCore
import RealityKit

/// Turns the per-frame `InputFrame` into game events (look-at, gestures, heart rate, raycast hits).
/// Class-bound so a detector can keep state such as dwell timers. Register instances in `SceneRunner.derivers`.
@MainActor
public protocol EventDeriver: AnyObject {
    func derive(from frame: InputFrame, deltaTime: TimeInterval, root: Entity) -> [GameEvent]
}
