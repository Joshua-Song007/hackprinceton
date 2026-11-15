import RealityKit

/// How the runtime delivers events to a script backend without depending on it (PearScript implements this).
/// `SceneRunner` resolves the target first, so `entity` always carries a `ScriptComponent`.
@MainActor
public protocol EventDispatcher: AnyObject {
    func dispatch(_ event: GameEvent, to entity: Entity)
}
