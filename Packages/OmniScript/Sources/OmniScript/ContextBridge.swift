import Foundation
import JavaScriptCore
import RealityKit
import OmniCore
import OmniRuntime

/// The `ctx.remote` object scripts see: the only network path a script has.
@objc @MainActor protocol RemoteBridgeExports: JSExport {
    func fire(_ name: String, _ data: JSValue?)
}

@MainActor
final class RemoteBridge: NSObject, RemoteBridgeExports {
    private let channel: (any RemoteChannel)?
    private let playerId: String

    init(channel: (any RemoteChannel)?, playerId: String) {
        self.channel = channel
        self.playerId = playerId
    }

    func fire(_ name: String, _ data: JSValue?) {
        channel?.fireToServer(RemoteEvent(playerId: playerId, name: name, data: ContextBridge.jsonText(of: data)))
    }
}

/// The `ctx` object scripts see: `intensity`, `spawn`, `haptic` and `remote`. No file, network or raw USIS access.
@objc @MainActor protocol ContextBridgeExports: JSExport {
    var intensity: Double { get }
    var remote: RemoteBridge { get }
    func spawn(_ name: String)
    func haptic(_ pattern: String, _ intensity: Double)
}

@MainActor
public final class ContextBridge: NSObject, ContextBridgeExports {
    private let outputQueue: OutputQueue
    private weak var spawnRoot: Entity?
    let remote: RemoteBridge

    /// Device or slot that script haptics address. [provisional: needs-tien-review]
    public var hapticTarget = "hand"
    /// Duration of a script haptic in ms. [provisional: needs-tien-review]
    public var hapticDurationMs = 120

    /// Normalized heart-rate intensity 0...1, updated by the engine before `onHeartRate`.
    public internal(set) var intensity: Double = 0

    public init(outputQueue: OutputQueue, spawnRoot: Entity?, channel: (any RemoteChannel)?, playerId: String) {
        self.outputQueue = outputQueue
        self.spawnRoot = spawnRoot
        self.remote = RemoteBridge(channel: channel, playerId: playerId)
    }

    /// Adds an empty entity with this name under the spawn root.
    func spawn(_ name: String) {
        let entity = Entity()
        entity.name = name
        spawnRoot?.addChild(entity)
    }

    func haptic(_ pattern: String, _ intensity: Double) {
        outputQueue.enqueue(OutputCommand(
            target: hapticTarget, type: .haptic, pattern: pattern,
            intensity: intensity.isFinite ? intensity : 0, durationMs: hapticDurationMs))
    }

    /// JSON text of a script value; `"null"` for undefined, null or unserializable values.
    static func jsonText(of value: JSValue?) -> String {
        guard let value, !value.isUndefined, !value.isNull,
              let json = value.context.objectForKeyedSubscript("JSON"),
              let text = json.invokeMethod("stringify", withArguments: [value]),
              text.isString else { return "null" }
        return text.toString() ?? "null"
    }
}
