import Foundation
import Synchronization
import Testing
@testable import OmniScript

/// Recording `RemoteChannel` for tests.
private final class RecordingChannel: RemoteChannel {
    struct Sent: Equatable {
        let to: String?
        let name: String
        let data: String
    }
    private let log = Mutex<[Sent]>([])
    var sent: [Sent] { log.withLock { $0 } }

    func fireToServer(_ event: RemoteEvent) {}
    func fire(to playerId: String, name: String, data: String) {
        log.withLock { $0.append(Sent(to: playerId, name: name, data: data)) }
    }
    func fireAll(name: String, data: String) {
        log.withLock { $0.append(Sent(to: nil, name: name, data: data)) }
    }
}

/// Shared server-script fixture. Backend/tests/script_host.rs copies this string verbatim so the
/// Swift and Rust hosts run the same script and must give the same results.
/// [provisional: needs-tien-review]
private let sharedFixture = """
export default serverScript({
  onPlayerJoin(ctx, player) {
    ctx.state.health = ctx.state.health || {};
    ctx.state.health[player.id] = 100;
  },
  onPlayerLeave(ctx, player) {
    delete ctx.state.health[player.id];
  },
  onRemote(ctx, player, name, data) {
    if (name === "punch") {
      ctx.remote.fireAll("hit", { from: player.id, dir: data.dir });
    }
  },
});
"""

@Suite struct ServerScriptEngineTests {
    private func makeEngine(_ source: String = sharedFixture) throws -> (ServerScriptEngine, RecordingChannel) {
        let channel = RecordingChannel()
        let engine = try ServerScriptEngine(channel: channel)
        try engine.load(source: source)
        return (engine, channel)
    }

    @Test func joinAndLeaveUpdateState() throws {
        let (engine, _) = try makeEngine()
        engine.playerJoined("p1")
        engine.playerJoined("p2")
        #expect(engine.stateJSON().contains("\"p1\":100"))
        #expect(engine.stateJSON().contains("\"p2\":100"))
        engine.playerLeft("p1")
        #expect(!engine.stateJSON().contains("p1"))
        #expect(engine.stateJSON().contains("\"p2\":100"))
    }

    @Test func remoteEventInFireAllOut() throws {
        let (engine, channel) = try makeEngine()
        engine.receive(RemoteEvent(playerId: "p1", name: "punch", data: "{\"dir\":[1,0,0]}"))
        #expect(channel.sent == [.init(to: nil, name: "hit", data: "{\"from\":\"p1\",\"dir\":[1,0,0]}")])
    }

    @Test func unknownRemoteEventSendsNothing() throws {
        let (engine, channel) = try makeEngine()
        engine.receive(RemoteEvent(playerId: "p1", name: "other"))
        #expect(channel.sent.isEmpty)
    }

    @Test func fireTargetsOnePlayer() throws {
        let (engine, channel) = try makeEngine("""
        export default serverScript({
          onRemote(ctx, player, name, data) { ctx.remote.fire(player.id, "pong", { n: 1 }); },
        });
        """)
        engine.receive(RemoteEvent(playerId: "p9", name: "ping"))
        #expect(channel.sent == [.init(to: "p9", name: "pong", data: "{\"n\":1}")])
    }

    @Test func sandboxHasNoHostAccess() throws {
        let (engine, _) = try makeEngine("""
        export default serverScript({
          onPlayerJoin(ctx, player) {
            ctx.state.types = [typeof self, typeof require, typeof fetch, typeof XMLHttpRequest,
                               typeof process, typeof input, typeof ctx.input, typeof ctx.usis];
          },
        });
        """)
        engine.playerJoined("p1")
        let expected = Array(repeating: "undefined", count: 8)
        let data = Data(engine.stateJSON().utf8)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: [String]]
        #expect(object?["types"] == expected)
        #expect(engine.handlerErrors.isEmpty)
    }

    @Test func handlerErrorIsContained() throws {
        let (engine, channel) = try makeEngine("""
        export default serverScript({
          onPlayerJoin(ctx, player) { throw new Error("boom"); },
          onRemote(ctx, player, name, data) { ctx.remote.fireAll("ok", null); },
        });
        """)
        engine.playerJoined("p1")
        #expect(engine.handlerErrors.count == 1)
        #expect(engine.handlerErrors[0].contains("boom"))
        engine.receive(RemoteEvent(playerId: "p1", name: "x"))
        #expect(channel.sent == [.init(to: nil, name: "ok", data: "null")])
    }

    @Test func badSourceFailsToLoad() throws {
        let channel = RecordingChannel()
        let engine = try ServerScriptEngine(channel: channel)
        #expect(throws: ServerScriptError.self) { try engine.load(source: "export default serverScript({") }
        #expect(throws: ServerScriptError.noDefaultExport) { try engine.load(source: "var x = 1;") }
        #expect(throws: ServerScriptError.self) {
            try engine.load(source: "export default serverScript({ onBogus() {} });")
        }
    }

    @Test func multipleScriptsShareState() throws {
        let (engine, _) = try makeEngine("""
        export default serverScript({ onPlayerJoin(ctx, p) { ctx.state.a = 1; } });
        """)
        try engine.load(source: """
        export default serverScript({ onPlayerJoin(ctx, p) { ctx.state.b = ctx.state.a + 1; } });
        """)
        engine.playerJoined("p1")
        #expect(engine.stateJSON() == "{\"a\":1,\"b\":2}")
    }
}
