import Foundation

/// Recompiles scripts on source change without restarting the scene. Entities keep their `ScriptComponent` and their
/// `SelfBridge`; only the script definition behind the name is swapped, so the next event runs the new code.
/// A source that fails to compile leaves the previous version running and is recorded in `failures`.
@MainActor
public final class ScriptReloader {
    public enum Outcome: Equatable {
        case loaded
        case reloaded
        case unchanged
        case failed(String)
    }

    private let engine: ScriptEngine
    private var sources: [String: String] = [:]

    /// Latest compile error per script name; cleared when that script next compiles.
    public private(set) var failures: [String: String] = [:]

    public init(engine: ScriptEngine) {
        self.engine = engine
    }

    /// Source text last compiled successfully for `name`.
    public func source(of name: String) -> String? { sources[name] }

    /// Compiles `source` for `name` via `ScriptEngine.loadScript`. Identical source is a no-op.
    @discardableResult
    public func update(name: String, source: String) -> Outcome {
        if sources[name] == source, failures[name] == nil { return .unchanged }
        let existed = sources[name] != nil
        do {
            try engine.loadScript(name: name, source: source)
        } catch {
            let message = Self.describe(error)
            failures[name] = message
            return .failed(message)
        }
        sources[name] = source
        failures[name] = nil
        return existed ? .reloaded : .loaded
    }

    /// Applies a batch (for example every file in a project after a save); returns the outcome per name.
    @discardableResult
    public func update(_ scripts: [String: String]) -> [String: Outcome] {
        var result: [String: Outcome] = [:]
        for (name, source) in scripts { result[name] = update(name: name, source: source) }
        return result
    }

    /// Unloads a script and forgets its source and failure.
    public func remove(name: String) {
        engine.unloadScript(name: name)
        sources[name] = nil
        failures[name] = nil
    }

    private static func describe(_ error: Error) -> String {
        switch error as? ScriptEngineError {
        case .javaScript(_, let message): return message
        case .noDefaultExport: return "no default export"
        case .preludeMissing: return "prelude missing"
        case nil: return String(describing: error)
        }
    }
}
