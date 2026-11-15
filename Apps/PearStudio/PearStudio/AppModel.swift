import AppKit
import Foundation
import Observation
import PearCloud
import PearCore
import PearInput
import PearOutput
import PearRuntime
import PearScript
import PearSim
import RealityKit
import Synchronization

/// Placeholder sink until `SimOutputSink` (plan 2.2) lands: keeps the commands it receives so the shell can show that
/// the runtime's `OutputQueue` reaches the active sink. Thread-safe, as the `OutputSink` contract requires.
final class RecordingOutputSink: OutputSink {
    private let received = Mutex<[OutputCommand]>([])

    func send(_ commands: [OutputCommand]) {
        guard !commands.isEmpty else { return }
        received.withLock { $0.append(contentsOf: commands) }
    }

    var count: Int { received.withLock { $0.count } }
}

/// Composition root: builds the pipeline, the scene runner and the sim source/sink pair, runs the per-frame loop and
/// drains the runtime's `OutputQueue` into the active sink. `ModeController` (plan 3.5) takes over source/sink choice.
@MainActor
@Observable
final class AppModel {
    let pipeline = InputPipeline()
    let runner = SceneRunner()
    /// Simulated head that carries a position, so it can enter the trigger volume.
    let headDevice: VirtualDevice
    /// Simulated Watch: the gesture (pinch / flick) and heart-rate source in Sim mode.
    let watchDevice = VirtualWatch()
    let sink = RecordingOutputSink()
    /// Chooses the active source/sink pair (Sim / Live).
    let modeController: ModeController
    /// Offline fallback replay, built on `modeController`. [provisional: needs-tien-review] wiring is not a plan.md item.
    let demoMode: DemoMode
    /// Backend client for Open from cloud; base URL from env `PEAR_CLOUD_URL`, else localhost.
    let account: AccountModel

    private(set) var gameName: String?
    private(set) var loadError: String?
    private(set) var playerOrigin = Vector3(0, 0, 0)
    private(set) var framesRun = 0
    private(set) var commandsSent = 0

    let playerId = "player-1"
    @ObservationIgnored private let channel = InMemoryRemoteChannel()
    /// Strong refs: `runner.dispatcher` is weak.
    @ObservationIgnored private var scripts: ScriptEngine?
    @ObservationIgnored private var server: ServerScriptEngine?
    @ObservationIgnored private var loopTask: Task<Void, Never>?

    init() {
        headDevice = VirtualDevice(
            deviceId: "sim-head",
            kind: .headset,
            slot: .head,
            channels: [.orientation, .position],
            noise: .airpods,
            seed: 1
        )
        modeController = ModeController(bus: pipeline, simSources: [headDevice, watchDevice], simSink: sink)
        demoMode = DemoMode(modeController: modeController)
        account = AccountModel(client: CloudClient(baseURL: Self.cloudURL()))
        loadFlagship()
    }

    /// Root entity the viewport hosts.
    var sceneRoot: Entity { runner.root }

    var scriptErrors: [String] { (scripts?.errors ?? []) + (server?.handlerErrors ?? []) }

    /// First usable of env `PEAR_CLOUD_URL` (http / https with a host), then localhost; same rule as `PlayerModel`.
    private static func cloudURL() -> URL {
        if let raw = ProcessInfo.processInfo.environment["PEAR_CLOUD_URL"]?.trimmingCharacters(in: .whitespaces),
           let url = URL(string: raw), ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil {
            return url
        }
        return URL(string: "http://localhost:8080")!
    }

    func loadFlagship() {
        guard let dir = GameLoader.defaultFlagshipURL() else {
            loadError = "Games/Flagship not found; set PEAR_GAME_DIR"
            return
        }
        loadFolder(dir)
    }

    func loadFolder(_ dir: URL) {
        do { try load(GameLoader.fromDirectory(dir)) } catch { fail(error) }
    }

    func openFromCloud(id: String, version: Int?) async {
        do {
            let fetched = try await account.client.fetchGame(id: id, version: version)
            try load(GameLoader.fromBundle(fetched.bundle))
        } catch { fail(error) }
    }

    private func fail(_ error: Error) {
        unload()
        gameName = nil
        loadError = "\(error)"
    }

    private func unload() {
        server?.playerLeft(playerId)
        server = nil
        scripts = nil
        runner.dispatcher = nil
        runner.derivers = []
        for child in Array(runner.root.children) { child.removeFromParent() }
        _ = channel.drainToServer()
        _ = channel.drainToPlayers()
    }

    /// Replaces the running game: scene, event detectors, client scripts and (if any) server scripts.
    func load(_ game: LoadedGame) throws {
        unload()
        let scene = game.scene
        try SceneLoader.load(scene, into: runner.root)
        addPlaceholderVisuals(runner.root)
        playerOrigin = scene.playerOrigin
        let origin = SIMD3<Float>(Float(scene.playerOrigin.x), Float(scene.playerOrigin.y), Float(scene.playerOrigin.z))
        runner.derivers = [
            LookAtDetector(playerOrigin: scene.playerOrigin),
            GestureEventMapper(),
            HeartRateIntensity(),
            RaycastHitDetector(playerOrigin: origin),
        ]
        let engine = try ScriptEngine(
            outputQueue: runner.outputQueue, spawnRoot: runner.root, channel: channel, playerId: playerId)
        for (name, source) in game.clientScripts { try engine.loadScript(name: name, source: source) }
        if !game.serverScripts.isEmpty {
            let serverEngine = try ServerScriptEngine(channel: channel)
            for script in game.serverScripts { try serverEngine.load(source: script.source) }
            serverEngine.playerJoined(playerId)
            server = serverEngine
        }
        scripts = engine
        runner.dispatcher = engine
        headDevice.targetPosition = scene.playerOrigin
        gameName = scene.name
        loadError = nil
    }

    // ponytail: SceneDescription has no mesh component, so every leaf entity is a gray unit box sized by its scale.
    private func addPlaceholderVisuals(_ entity: Entity) {
        if entity.children.isEmpty, entity !== runner.root {
            entity.components.set(ModelComponent(
                mesh: .generateBox(size: 1), materials: [SimpleMaterial(color: .gray, isMetallic: false)]))
        }
        for child in entity.children { addPlaceholderVisuals(child) }
    }

    /// Sim mode only: queues a gesture on the simulated Watch.
    func simGesture(_ type: GestureType) {
        watchDevice.queueGesture(type)
    }

    func start() {
        guard loopTask == nil else { return }
        modeController.start()
        loopTask = Task { [weak self] in
            while !Task.isCancelled {
                self?.tick()
                try? await Task.sleep(nanoseconds: 16_000_000)
            }
        }
    }

    func stop() {
        loopTask?.cancel()
        loopTask = nil
        modeController.stop()
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

    /// One frame: move the hard-coded head path, sample the pipeline, step the runtime, drain output to the sink.
    func tick() {
        // Same order as LocalTestSession.tick: server handles client events, replies reach scripts before the step.
        if let server {
            for event in channel.drainToServer() { server.receive(event) }
        } else {
            _ = channel.drainToServer()
        }
        let outgoing = channel.drainToPlayers()
        if let scripts {
            let entities = scriptedEntities()
            for event in outgoing.addressed where event.playerId == playerId {
                for entity in entities { scripts.deliver(event, to: entity) }
            }
            for event in outgoing.broadcast {
                for entity in entities { scripts.deliver(event, to: entity) }
            }
        }

        let now = HostClock.nowMs()
        let frame = pipeline.frame(at: now)
        runner.step(frame: frame, deltaTime: 1.0 / 60.0)
        framesRun += 1

        if !runner.outputQueue.isEmpty {
            let commands = runner.outputQueue.drain()
            modeController.activeSink.send(commands)
            commandsSent = sink.count
        }
    }
}
