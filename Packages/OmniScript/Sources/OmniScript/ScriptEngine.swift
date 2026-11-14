import Foundation
import JavaScriptCore
import RealityKit
import OmniCore
import OmniRuntime

public enum ScriptEngineError: Error, Equatable {
    case preludeMissing
    case noDefaultExport(script: String)
    case javaScript(script: String, message: String)
}

/// Runs client scripts, one sandboxed `JSContext` per script name, and delivers `GameEvent`s to them.
/// Scripts see only `self` (`SelfBridge`) and `ctx` (`ContextBridge`). A throwing handler is recorded in `errors`
/// and never reaches the runtime.
@MainActor
public final class ScriptEngine: EventDispatcher {
    private struct Loaded {
        let context: JSContext
        let definition: JSValue
    }

    private var scripts: [String: Loaded] = [:]
    private var selves: [Entity.ID: SelfBridge] = [:]
    private let prelude: String

    public let context: ContextBridge
    /// Messages of script errors caught since creation, oldest first.
    public private(set) var errors: [String] = []

    public init(outputQueue: OutputQueue, spawnRoot: Entity? = nil, channel: (any RemoteChannel)? = nil,
                playerId: String = "local") throws {
        guard let url = Bundle.module.url(forResource: "prelude", withExtension: "js"),
              let text = try? String(contentsOf: url, encoding: .utf8) else {
            throw ScriptEngineError.preludeMissing
        }
        self.prelude = text
        self.context = ContextBridge(outputQueue: outputQueue, spawnRoot: spawnRoot, channel: channel, playerId: playerId)
    }

    public var loadedScriptNames: [String] { scripts.keys.sorted() }

    /// Compiles `source` in a fresh context and (re)places the script `name`. On failure the previous version stays.
    public func loadScript(name: String, source: String) throws {
        guard let jsContext = JSContext() else { throw ScriptEngineError.javaScript(script: name, message: "no context") }
        jsContext.evaluateScript(prelude)
        jsContext.evaluateScript(Self.rewriteExportDefault(source))
        if let message = takeException(jsContext) {
            throw ScriptEngineError.javaScript(script: name, message: message)
        }
        guard let taken = jsContext.objectForKeyedSubscript("__omniTakeDefault")?.call(withArguments: []),
              taken.isObject else {
            throw ScriptEngineError.noDefaultExport(script: name)
        }
        scripts[name] = Loaded(context: jsContext, definition: taken)
    }

    public func unloadScript(name: String) {
        scripts[name] = nil
    }

    public func dispatch(_ event: GameEvent, to entity: Entity) {
        guard let name = entity.components[ScriptComponent.self]?.scriptName, let loaded = scripts[name] else { return }
        let bridge = selfBridge(for: entity)
        switch event {
        case .lookAt:
            call("onLookAt", name, loaded, bridge, [])
        case .gesture(let gesture, _):
            var payload: [String: Any] = ["type": gesture.type.rawValue]
            if let dir = gesture.dir { payload["dir"] = [dir.x, dir.y, dir.z] }
            call("onGesture", name, loaded, bridge, [payload])
        case .heartRate(let bpm, let intensity):
            context.intensity = intensity
            call("onHeartRate", name, loaded, bridge, [bpm])
        case .raycastHit:
            call("onRaycastHit", name, loaded, bridge, [])
        case .triggerEntered(_, let probe):
            call("onTriggerEnter", name, loaded, bridge, [probe.rawValue])
        case .triggerExited(_, let probe):
            call("onTriggerExit", name, loaded, bridge, [probe.rawValue])
        }
    }

    /// Delivers a server-to-client remote event to one scripted entity. The caller does this at the start of the frame.
    public func deliver(_ event: RemoteEvent, to entity: Entity) {
        guard let name = entity.components[ScriptComponent.self]?.scriptName, let loaded = scripts[name] else { return }
        let data: Any = loaded.context.objectForKeyedSubscript("JSON")?
            .invokeMethod("parse", withArguments: [event.data]) ?? NSNull()
        call("onRemote", name, loaded, selfBridge(for: entity), [event.name, data])
    }

    private func selfBridge(for entity: Entity) -> SelfBridge {
        if let existing = selves[entity.id] { return existing }
        let bridge = SelfBridge(entity: entity)
        selves[entity.id] = bridge
        return bridge
    }

    private func call(_ handler: String, _ script: String, _ loaded: Loaded, _ selfBridge: SelfBridge, _ args: [Any]) {
        guard let function = loaded.definition.objectForKeyedSubscript(handler), function.isObject else { return }
        function.call(withArguments: [selfBridge, context] + args)
        if let message = takeException(loaded.context) {
            errors.append("\(script).\(handler): \(message)")
        }
    }

    private func takeException(_ jsContext: JSContext) -> String? {
        guard let exception = jsContext.exception else { return nil }
        jsContext.exception = nil
        return exception.toString() ?? "unknown error"
    }

    /// JavaScriptCore has no module loader: `export default X` becomes `__omniExportDefault(X)`.
    nonisolated static func rewriteExportDefault(_ source: String) -> String {
        guard let range = source.range(of: #"(?m)^\s*export\s+default\s+"#, options: .regularExpression) else { return source }
        var body = String(source[range.upperBound...])
        while let last = body.last, last.isWhitespace || last == ";" { body.removeLast() }
        return String(source[..<range.lowerBound]) + "__omniExportDefault(" + body + ");"
    }
}
