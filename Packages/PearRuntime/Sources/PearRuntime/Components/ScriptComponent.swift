import RealityKit

/// Names the creator script attached to an entity. `EventDispatcher` implementations look the script up by name.
public struct ScriptComponent: Component {
    public var scriptName: String

    public init(scriptName: String) {
        self.scriptName = scriptName
    }
}
