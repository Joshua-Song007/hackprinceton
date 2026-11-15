import Foundation
import Observation
import PearCloud
import PearCore
import PearInput
import PearRuntime
import PearScript
import RealityKit

/// One running game on the player: the scene, the client scripts, a touch controller and the connection to the
/// game server. Mirrors PearStudio's `AppModel.load` / `tick`, except that server scripts run on the backend:
/// this side only sends and receives events over `NetworkRemoteChannel`.
@MainActor
@Observable
final class GameSession: Identifiable {
    enum LoadError: Error, Equatable { case badScene(String) }

    let id = UUID()
    let gameId: String
    let gameName: String
    let playerOrigin: Vector3
    let runner = SceneRunner()

    private(set) var framesRun = 0
    private(set) var scriptErrors: [String] = []
    private(set) var isConnected = false
    private(set) var connectionLost = false
    /// The server restarted the session on a newly published version; leave and play again to get it.
    private(set) var reloaded = false
    /// Look direction in radians, changed by drags; the view turns the camera with it.
    private(set) var yaw = 0.0
    private(set) var pitch = 0.0

    @ObservationIgnored private let pipeline = InputPipeline()
    @ObservationIgnored private let input: TouchInput
    @ObservationIgnored private let channel: NetworkRemoteChannel
    /// Strong ref: `runner.dispatcher` is weak.
    @ObservationIgnored private let scripts: ScriptEngine
    @ObservationIgnored private var loopTask: Task<Void, Never>?

    static let maxPitch = 1.2

    init(game: FetchedGame, playerId: String, channel: NetworkRemoteChannel) throws {
        let scene: SceneDescription
        do {
            scene = try SceneLoader.decode(JSONEncoder().encode(game.bundle.scene))
        } catch {
            throw LoadError.badScene("\(error)")
        }
        self.gameId = game.gameId
        self.gameName = scene.name.isEmpty ? game.bundle.title : scene.name
        self.playerOrigin = scene.playerOrigin
        self.channel = channel
        self.input = TouchInput(origin: scene.playerOrigin)

        try SceneLoader.load(scene, into: runner.root)
        Self.addPlaceholderVisuals(runner.root, root: runner.root)
        let origin = SIMD3<Float>(Float(scene.playerOrigin.x), Float(scene.playerOrigin.y), Float(scene.playerOrigin.z))
        runner.derivers = [
            LookAtDetector(playerOrigin: scene.playerOrigin),
            GestureEventMapper(),
            HeartRateIntensity(),
            RaycastHitDetector(playerOrigin: origin),
        ]
        let engine = try ScriptEngine(
            outputQueue: runner.outputQueue, spawnRoot: runner.root, channel: channel, playerId: playerId)
        for script in game.bundle.clientScripts { try engine.loadScript(name: script.name, source: script.source) }
        scripts = engine
        runner.dispatcher = engine
    }

    // ponytail: SceneDescription has no mesh component, so every leaf entity is a gray unit box sized by its scale (same as Studio).
    private static func addPlaceholderVisuals(_ entity: Entity, root: Entity) {
        if entity.children.isEmpty, entity !== root {
            entity.components.set(ModelComponent(
                mesh: .generateBox(size: 1), materials: [SimpleMaterial(color: .gray, isMetallic: false)]))
        }
        for child in entity.children { addPlaceholderVisuals(child, root: root) }
    }

    // MARK: Lifecycle

    func start() {
        guard loopTask == nil else { return }
        channel.start()
        input.start(bus: pipeline)
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
        input.stop()
        channel.stop()
        isConnected = false
    }

    // MARK: Controls

    /// A drag of `dx`, `dy` points turns the view: right looks right, up looks up.
    func look(dx: Double, dy: Double, radiansPerPoint: Double = 0.005) {
        yaw -= dx * radiansPerPoint
        pitch = min(max(pitch - dy * radiansPerPoint, -Self.maxPitch), Self.maxPitch)
        input.setOrientation(TouchInput.orientation(yaw: yaw, pitch: pitch))
    }

    func gesture(_ type: GestureType) {
        input.gesture(type)
    }

    // MARK: Frame

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

    /// One frame: server events reach the scripts first, then the runtime steps on the latest input.
    func tick() {
        let incoming = channel.drainIncoming()
        if !incoming.isEmpty {
            let entities = scriptedEntities()
            for event in incoming {
                for entity in entities { scripts.deliver(event, to: entity) }
            }
        }
        runner.step(frame: pipeline.frame(at: HostClock.nowMs()), deltaTime: 1.0 / 60.0)
        framesRun += 1
        // The player has no wearable to drive, so the runtime's output commands are dropped.
        _ = runner.outputQueue.drain()

        let errors = Array(scripts.errors.suffix(3))
        if errors != scriptErrors { scriptErrors = errors }
        let connected = channel.isConnected
        if connected != isConnected { isConnected = connected }
        if channel.connectionLost != connectionLost { connectionLost = channel.connectionLost }
        if channel.reloaded != reloaded { reloaded = channel.reloaded }
    }
}
