import Foundation
import Synchronization
import Testing
import RealityKit
import OmniCore
import OmniRuntime
@testable import OmniScript

private final class RecordingChannel: RemoteChannel {
    private let sent = Mutex<[RemoteEvent]>([])
    var events: [RemoteEvent] { sent.withLock { $0 } }
    func fireToServer(_ event: RemoteEvent) { sent.withLock { $0.append(event) } }
    func fire(to playerId: String, name: String, data: String) {}
    func fireAll(name: String, data: String) {}
}

@MainActor
private func makeEntity(_ script: String, name: String = "e") -> Entity {
    let entity = Entity()
    entity.name = name
    entity.components.set(ScriptComponent(scriptName: script))
    return entity
}

@MainActor
@Suite struct ScriptEngineTests {
    let queue = OutputQueue()
    private let channel = RecordingChannel()

    private func engine(root: Entity? = nil) throws -> ScriptEngine {
        try ScriptEngine(outputQueue: queue, spawnRoot: root, channel: channel, playerId: "p1")
    }

    @Test func lookAtHandlerReceivesSelfAndCtx() throws {
        let engine = try engine()
        try engine.loadScript(name: "a", source: """
        export default script({ onLookAt(self, ctx) { self.speed = 3; globalThis.seen = self.name; } });
        """)
        let entity = makeEntity("a", name: "enemy")
        engine.dispatch(.lookAt(entity: entity.id), to: entity)
        #expect(engine.errors.isEmpty)
    }

    @Test func gestureCarriesTypeAndDirection() throws {
        let engine = try engine()
        try engine.loadScript(name: "a", source: """
        export default script({ onGesture(self, ctx, g) {
          if (g.type === "flick") ctx.remote.fire("punch", { dir: g.dir });
        } });
        """)
        let entity = makeEntity("a")
        engine.dispatch(.gesture(GestureEvent(type: .flick, dir: Vector3(1, 0, 0)), slot: .hand), to: entity)
        #expect(engine.errors.isEmpty)
        #expect(channel.events == [RemoteEvent(playerId: "p1", name: "punch", data: #"{"dir":[1,0,0]}"#)])
    }

    @Test func heartRateSetsIntensityAndHapticQueuesOutput() throws {
        let engine = try engine()
        try engine.loadScript(name: "a", source: """
        export default script({ onHeartRate(self, ctx, bpm) { ctx.haptic("thud", ctx.intensity); } });
        """)
        let entity = makeEntity("a")
        engine.dispatch(.heartRate(bpm: 150, intensity: 0.5), to: entity)
        let commands = queue.drain()
        #expect(commands.count == 1)
        #expect(commands.first?.pattern == "thud")
        #expect(commands.first?.intensity == 0.5)
        #expect(commands.first?.type == .haptic)
    }

    @Test func triggerHandlersGetTheProbeSlot() throws {
        let engine = try engine()
        try engine.loadScript(name: "a", source: """
        export default script({
          onTriggerEnter(self, ctx, slot) { ctx.remote.fire("in", slot); },
          onTriggerExit(self, ctx, slot) { ctx.remote.fire("out", slot); },
        });
        """)
        let entity = makeEntity("a")
        engine.dispatch(.triggerEntered(trigger: entity.id, probe: .head), to: entity)
        engine.dispatch(.triggerExited(trigger: entity.id, probe: .head), to: entity)
        #expect(channel.events.map(\.name) == ["in", "out"])
        #expect(channel.events.map(\.data) == [#""head""#, #""head""#])
    }

    @Test func remoteEventReachesOnRemote() throws {
        let engine = try engine()
        try engine.loadScript(name: "a", source: """
        export default script({ onRemote(self, ctx, name, data) { if (name === "hit") ctx.haptic("thud", data.power); } });
        """)
        let entity = makeEntity("a")
        engine.deliver(RemoteEvent(playerId: "p1", name: "hit", data: #"{"power":0.8}"#), to: entity)
        #expect(queue.drain().first?.intensity == 0.8)
    }

    @Test func spawnAddsAnEntityUnderTheRoot() throws {
        let root = Entity()
        let engine = try engine(root: root)
        try engine.loadScript(name: "a", source: """
        export default script({ onRaycastHit(self, ctx) { ctx.spawn("spark"); } });
        """)
        let entity = makeEntity("a")
        engine.dispatch(.raycastHit(entity: entity.id, slot: .hand), to: entity)
        #expect(root.children.map(\.name) == ["spark"])
    }

    @Test func throwingHandlerIsContainedAndLaterEventsStillRun() throws {
        let engine = try engine()
        try engine.loadScript(name: "a", source: """
        export default script({
          onLookAt(self, ctx) { throw new Error("boom"); },
          onRaycastHit(self, ctx) { ctx.haptic("ok", 1); },
        });
        """)
        let entity = makeEntity("a")
        engine.dispatch(.lookAt(entity: entity.id), to: entity)
        engine.dispatch(.raycastHit(entity: entity.id, slot: .hand), to: entity)
        #expect(engine.errors.count == 1)
        #expect(engine.errors.first?.contains("boom") == true)
        #expect(queue.drain().count == 1)
    }

    @Test func sandboxExposesNoFileNetworkOrRawInput() throws {
        let engine = try engine()
        try engine.loadScript(name: "a", source: """
        export default script({ onLookAt(self, ctx) {
          var leaks = [typeof require, typeof fetch, typeof XMLHttpRequest, typeof process, typeof WebSocket,
                       typeof ctx.input, typeof ctx.frame, typeof self.entity];
          ctx.remote.fire("leaks", leaks);
        } });
        """)
        let entity = makeEntity("a")
        engine.dispatch(.lookAt(entity: entity.id), to: entity)
        #expect(channel.events.first?.data == #"["undefined","undefined","undefined","undefined","undefined","undefined","undefined","undefined"]"#)
    }

    @Test func scriptsDoNotShareGlobals() throws {
        let engine = try engine()
        try engine.loadScript(name: "a", source: "globalThis.secret = 1;\nexport default script({});")
        try engine.loadScript(name: "b", source: """
        export default script({ onLookAt(self, ctx) { ctx.remote.fire("t", typeof secret); } });
        """)
        let entity = makeEntity("b")
        engine.dispatch(.lookAt(entity: entity.id), to: entity)
        #expect(channel.events.first?.data == #""undefined""#)
    }

    @Test func hotReloadReplacesHandlersAndBadSourceKeepsTheOldOne() throws {
        let engine = try engine()
        let entity = makeEntity("a")
        try engine.loadScript(name: "a", source: #"export default script({ onLookAt() { globalThis.v = 1; } });"#)
        try engine.loadScript(name: "a", source: """
        export default script({ onLookAt(self, ctx) { ctx.remote.fire("v2", null); } });
        """)
        #expect(throws: ScriptEngineError.self) {
            try engine.loadScript(name: "a", source: "export default script({ onLookAt: 5 });")
        }
        engine.dispatch(.lookAt(entity: entity.id), to: entity)
        #expect(channel.events.map(\.name) == ["v2"])
    }

    @Test func syntaxErrorAndMissingExportThrow() throws {
        let engine = try engine()
        #expect(throws: ScriptEngineError.self) { try engine.loadScript(name: "x", source: "export default script({") }
        #expect(throws: ScriptEngineError.noDefaultExport(script: "y")) {
            try engine.loadScript(name: "y", source: "var a = 1;")
        }
    }

    @Test func entityWithoutLoadedScriptIsIgnored() throws {
        let engine = try engine()
        let entity = makeEntity("missing")
        engine.dispatch(.lookAt(entity: entity.id), to: entity)
        #expect(engine.errors.isEmpty)
    }
}
