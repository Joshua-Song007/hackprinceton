import AppKit
import Foundation
import Observation
import OmniCore
import OmniInput
import OmniOutput
import OmniRuntime
import OmniSim
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
    let sink = RecordingOutputSink()

    private(set) var headInsideTrigger = false
    private(set) var framesRun = 0
    private(set) var commandsSent = 0

    @ObservationIgnored private let triggerEntity = ModelEntity()
    @ObservationIgnored private var loopTask: Task<Void, Never>?
    @ObservationIgnored private var startMs = HostClock.nowMs()

    init() {
        headDevice = VirtualDevice(
            deviceId: "sim-head",
            kind: .headset,
            slot: .head,
            channels: [.orientation, .position],
            noise: .airpods,
            seed: 1
        )
        headDevice.targetPosition = Vector3(-2, 0, 0)
        buildScene()
    }

    /// Root entity the viewport hosts.
    var sceneRoot: Entity { runner.root }

    private func buildScene() {
        triggerEntity.model = ModelComponent(
            mesh: .generateSphere(radius: 0.5),
            materials: [SimpleMaterial(color: .gray, isMetallic: false)]
        )
        triggerEntity.components.set(
            TriggerComponent(
                shape: .sphere(radius: 0.5),
                onEnter: { [weak self] _, _ in self?.setInside(true) },
                onExit: { [weak self] _, _ in self?.setInside(false) }
            )
        )
        runner.root.addChild(triggerEntity)
    }

    private func setInside(_ inside: Bool) {
        headInsideTrigger = inside
        let color: NSColor = inside ? .systemGreen : .gray
        triggerEntity.model?.materials = [SimpleMaterial(color: color, isMetallic: false)]
        if inside {
            runner.outputQueue.enqueue(
                OutputCommand(target: "head", type: .haptic, pattern: "trigger-enter", intensity: 0.8, durationMs: 120)
            )
        }
    }

    func start() {
        guard loopTask == nil else { return }
        startMs = HostClock.nowMs()
        headDevice.start(bus: pipeline)
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
        headDevice.stop()
    }

    /// One frame: move the hard-coded head path, sample the pipeline, step the runtime, drain output to the sink.
    func tick() {
        let now = HostClock.nowMs()
        // Hard-coded path: the head sweeps along x from -2 m to 0 m (the trigger centre) and back every 6 s.
        let phase = ((now - startMs) / 1000).truncatingRemainder(dividingBy: 6) / 6
        let x = -2 + 2 * (1 - abs(2 * phase - 1))
        headDevice.targetPosition = Vector3(x, 0, 0)

        let frame = pipeline.frame(at: now)
        runner.step(frame: frame, deltaTime: 1.0 / 60.0)
        framesRun += 1

        if !runner.outputQueue.isEmpty {
            let commands = runner.outputQueue.drain()
            sink.send(commands)
            commandsSent = sink.count
        }
    }
}
