import Foundation
import Observation
import OmniCore
import OmniInput
import OmniRuntime
import OmniScript
import OmniSim
import RealityKit
import Synchronization

/// In-memory `RemoteChannel` for a local test: queues events so delivery happens on the main actor at a fixed point
/// in the frame, never re-entrantly from inside a running script handler. Thread-safe, as the protocol requires.
final class InMemoryRemoteChannel: RemoteChannel {
    private struct Queues {
        var toServer: [RemoteEvent] = []
        var toPlayers: [RemoteEvent] = []
        var broadcast: [RemoteEvent] = []
    }

    private let queues = Mutex(Queues())

    func fireToServer(_ event: RemoteEvent) {
        queues.withLock { $0.toServer.append(event) }
    }

    func fire(to playerId: String, name: String, data: String) {
        queues.withLock { $0.toPlayers.append(RemoteEvent(playerId: playerId, name: name, data: data)) }
    }

    func fireAll(name: String, data: String) {
        queues.withLock { $0.broadcast.append(RemoteEvent(playerId: "*", name: name, data: data)) }
    }

    func drainToServer() -> [RemoteEvent] {
        queues.withLock { state in
            defer { state.toServer = [] }
            return state.toServer
        }
    }

    /// Server → client events: addressed ones and broadcasts (`playerId == "*"`), in firing order per kind.
    func drainToPlayers() -> (addressed: [RemoteEvent], broadcast: [RemoteEvent]) {
        queues.withLock { state in
            defer {
                state.toPlayers = []
                state.broadcast = []
            }
            return (state.toPlayers, state.broadcast)
        }
    }
}

/// One simulated player in a test session: own input pipeline, scene runner and client script engine.
@MainActor
final class TestPlayer {
    let id: String
    let pipeline = InputPipeline()
    let runner = SceneRunner()
    let scripts: ScriptEngine
    /// Simulated head so each player produces input.
    let headDevice: VirtualDevice

    init(id: String, index: Int, channel: any RemoteChannel) throws {
        self.id = id
        let runner = self.runner
        scripts = try ScriptEngine(outputQueue: runner.outputQueue, spawnRoot: runner.root, channel: channel, playerId: id)
        headDevice = VirtualDevice(
            deviceId: "sim-head-\(id)",
            kind: .headset,
            slot: .head,
            channels: [.orientation],
            noise: .airpods,
            seed: UInt64(index + 1)
        )
        runner.dispatcher = scripts
    }

    /// Every entity under the scene root that carries a script.
    private func scriptedEntities() -> [Entity] {
        var found: [Entity] = []
        var stack: [Entity] = [runner.root]
        while let entity = stack.popLast() {
            if entity.components[ScriptComponent.self] != nil { found.append(entity) }
            stack.append(contentsOf: entity.children)
        }
        return found
    }

    func deliver(_ event: RemoteEvent) {
        for entity in scriptedEntities() { scripts.deliver(event, to: entity) }
    }
}

/// Local multiplayer test (overview.md Module 7): one `ServerScriptEngine` plus N simulated players joined by an
/// in-memory `RemoteChannel`. With no server scripts the session is a single player and has no server.
/// The viewport follows `selectedPlayer` only.
@MainActor
@Observable
final class LocalTestSession {
    let channel = InMemoryRemoteChannel()
    /// nil when the game has no server scripts.
    @ObservationIgnored let server: ServerScriptEngine?
    let players: [TestPlayer]
    var selectedIndex = 0 {
        didSet { selectedIndex = min(max(selectedIndex, 0), players.count - 1) }
    }
    private(set) var framesRun = 0

    @ObservationIgnored private var loopTask: Task<Void, Never>?

    /// - Parameters:
    ///   - playerCount: simulated players; forced to 1 when `serverScripts` is empty.
    ///   - serverScripts: server script sources, loaded in order.
    ///   - clientScripts: client script sources by name, loaded into every player.
    init(playerCount: Int, serverScripts: [String] = [], clientScripts: [String: String] = [:]) throws {
        let count = serverScripts.isEmpty ? 1 : max(1, playerCount)
        let channel = self.channel
        if serverScripts.isEmpty {
            server = nil
        } else {
            let engine = try ServerScriptEngine(channel: channel)
            for source in serverScripts { try engine.load(source: source) }
            server = engine
        }
        var built: [TestPlayer] = []
        for index in 0..<count {
            let player = try TestPlayer(id: "player-\(index + 1)", index: index, channel: channel)
            for (name, source) in clientScripts { try player.scripts.loadScript(name: name, source: source) }
            built.append(player)
        }
        players = built
    }

    var hasServer: Bool { server != nil }
    var selectedPlayer: TestPlayer { players[selectedIndex] }

    func start() {
        guard loopTask == nil else { return }
        for player in players {
            player.headDevice.start(bus: player.pipeline)
            server?.playerJoined(player.id)
        }
        loopTask = Task { [weak self] in
            while !Task.isCancelled {
                self?.tick()
                try? await Task.sleep(nanoseconds: 16_000_000)
            }
        }
    }

    func stop() {
        guard loopTask != nil else { return }
        loopTask?.cancel()
        loopTask = nil
        for player in players {
            player.headDevice.stop()
            server?.playerLeft(player.id)
        }
    }

    /// One frame: server handles client events, its replies reach clients at the start of their frame, then every
    /// player samples its pipeline and steps its runner.
    func tick() {
        if let server {
            for event in channel.drainToServer() { server.receive(event) }
        } else {
            _ = channel.drainToServer()
        }
        let outgoing = channel.drainToPlayers()
        for event in outgoing.addressed {
            players.first { $0.id == event.playerId }?.deliver(event)
        }
        for event in outgoing.broadcast {
            for player in players { player.deliver(event) }
        }
        let now = HostClock.nowMs()
        for player in players {
            player.runner.step(frame: player.pipeline.frame(at: now), deltaTime: 1.0 / 60.0)
        }
        framesRun += 1
    }
}
