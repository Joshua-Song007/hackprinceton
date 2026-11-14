import Foundation
import JavaScriptCore

public enum ServerScriptError: Error, Equatable, Sendable {
    /// `prelude.js` is missing from the module bundle.
    case preludeMissing
    /// The script failed to compile or evaluate; the message is the JS exception text.
    case loadFailed(String)
    /// The script did not `export default serverScript({...})`.
    case noDefaultExport
}

/// Sandboxed `JSContext` running a game's server scripts. Scripts see only `ctx`
/// (`ctx.state`, `ctx.remote.fire` / `fireAll`); there is no input, file or network access.
/// Mirrors the backend's `script_host.rs` (same `serverScript` API).
///
/// Not thread-safe: call every method from one thread or actor (the owner serialises access).
public final class ServerScriptEngine {
    private let channel: any RemoteChannel
    private let context: JSContext
    private var dispatcher: JSValue?
    /// Errors thrown by script handlers, contained so one bad handler cannot stop the session.
    public private(set) var handlerErrors: [String] = []

    public init(channel: any RemoteChannel) throws {
        self.channel = channel
        guard let ctx = JSContext() else { throw ServerScriptError.loadFailed("no JSContext") }
        self.context = ctx
        try bootstrap()
    }

    /// Compiles and registers one server script. Several scripts may be loaded; every handler
    /// runs on each of them in load order, sharing one `ctx.state`.
    public func load(source: String) throws {
        context.exception = nil
        context.evaluateScript(Self.rewriteExportDefault(source))
        if let exception = context.exception {
            context.exception = nil
            throw ServerScriptError.loadFailed(exception.toString() ?? "unknown error")
        }
        let taken = context.objectForKeyedSubscript("__omniTakeDefault")?.call(withArguments: [])
        guard let definition = taken, definition.isObject else { throw ServerScriptError.noDefaultExport }
        dispatcher?.objectForKeyedSubscript("add")?.call(withArguments: [definition])
    }

    public func playerJoined(_ playerId: String) {
        dispatch("onPlayerJoin", playerId: playerId, extra: [])
    }

    public func playerLeft(_ playerId: String) {
        dispatch("onPlayerLeave", playerId: playerId, extra: [])
    }

    /// Delivers a client → server remote event to `onRemote(ctx, player, name, data)`.
    public func receive(_ event: RemoteEvent) {
        dispatch("onRemote", playerId: event.playerId, extra: [event.name, event.data])
    }

    /// `ctx.state` as JSON text, for tests and diagnostics.
    public func stateJSON() -> String {
        dispatcher?.objectForKeyedSubscript("stateJSON")?.call(withArguments: [])?.toString() ?? "{}"
    }

    private func dispatch(_ handler: String, playerId: String, extra: [Any]) {
        dispatcher?.objectForKeyedSubscript("dispatch")?.call(withArguments: [handler, playerId, extra])
    }

    private func bootstrap() throws {
        context.exceptionHandler = { [weak self] _, exception in
            self?.handlerErrors.append(exception?.toString() ?? "unknown error")
        }
        guard let url = Bundle.module.url(forResource: "prelude", withExtension: "js", subdirectory: "Resources")
            ?? Bundle.module.url(forResource: "prelude", withExtension: "js"),
            let prelude = try? String(contentsOf: url, encoding: .utf8)
        else { throw ServerScriptError.preludeMissing }
        context.evaluateScript(prelude)

        let channel = self.channel
        let fire: @convention(block) (String, String, String) -> Void = { player, name, data in
            channel.fire(to: player, name: name, data: data)
        }
        let fireAll: @convention(block) (String, String) -> Void = { name, data in
            channel.fireAll(name: name, data: data)
        }
        let report: @convention(block) (String) -> Void = { [weak self] message in
            self?.handlerErrors.append(message)
        }
        let native = JSValue(newObjectIn: context)
        native?.setObject(fire, forKeyedSubscript: "fire" as NSString)
        native?.setObject(fireAll, forKeyedSubscript: "fireAll" as NSString)
        native?.setObject(report, forKeyedSubscript: "report" as NSString)
        let glue = context.evaluateScript(Self.glue)
        dispatcher = glue?.call(withArguments: [native as Any])
        if dispatcher == nil || dispatcher?.isObject != true {
            throw ServerScriptError.loadFailed("server glue failed")
        }
    }

    /// JavaScriptCore has no ES module loader: turn a leading `export default X;` into
    /// `__omniExportDefault(X)` (see prelude.js).
    static func rewriteExportDefault(_ source: String) -> String {
        let trimmed = source.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("export default") else { return source }
        var body = String(trimmed.dropFirst("export default".count))
        while let last = body.last, last == ";" || last.isWhitespace { body.removeLast() }
        return "__omniExportDefault(" + body + "\n)"
    }

    private static let glue = """
    (function (native) {
      "use strict";
      var scripts = [];
      var state = {};
      function encode(value) {
        var text = JSON.stringify(value);
        return text === undefined ? "null" : text;
      }
      var remote = Object.freeze({
        fire: function (playerId, name, data) { native.fire(String(playerId), String(name), encode(data)); },
        fireAll: function (name, data) { native.fireAll(String(name), encode(data)); }
      });
      var ctx = Object.freeze({ state: state, remote: remote });
      return {
        add: function (definition) { scripts.push(definition); },
        stateJSON: function () { return encode(state); },
        dispatch: function (handler, playerId, extra) {
          var args = [ctx, Object.freeze({ id: playerId })];
          if (handler === "onRemote") {
            var data = null;
            try { data = JSON.parse(extra[1]); } catch (e) { data = null; }
            args.push(extra[0], data);
          }
          scripts.forEach(function (script) {
            if (typeof script[handler] !== "function") { return; }
            try { script[handler].apply(script, args); }
            catch (e) { native.report(handler + ": " + String(e)); }
          });
        }
      };
    })
    """
}
