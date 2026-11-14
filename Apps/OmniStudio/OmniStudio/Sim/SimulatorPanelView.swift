import Foundation
import Observation
import OmniCore
import OmniInput
import OmniSim
import SwiftUI

/// Forwards everything to the real bus and copies each packet to the active recorder, so recording needs no change to
/// `InputPipeline`. Sources started by the panel are given this bus instead of the pipeline.
final class RecordingTeeBus: InputBus, Sendable {
    private let base: InputBus
    private let recorder: @Sendable () -> UsisRecorder?

    init(base: InputBus, recorder: @escaping @Sendable () -> UsisRecorder?) {
        self.base = base
        self.recorder = recorder
    }

    func ingest(_ packet: UsisPacket) {
        recorder()?.record(packet)
        base.ingest(packet)
    }

    func ingest(json: Data) { base.ingest(json: json) }

    func recordClockSample(deviceId: String, tSendDevice: Double, tHostReceived: Double, tRecvDevice: Double) {
        base.recordClockSample(
            deviceId: deviceId, tSendDevice: tSendDevice, tHostReceived: tHostReceived, tRecvDevice: tRecvDevice
        )
    }

    func frame(at hostNowMs: Double) -> InputFrame { base.frame(at: hostNowMs) }
}

/// State behind `SimulatorPanelView`: drives the head device's orientation, a simulated watch, presets and recording.
@MainActor
@Observable
final class SimulatorPanelModel {
    private let appModel: AppModel
    @ObservationIgnored private let gizmo: GizmoController
    @ObservationIgnored private let watch = VirtualWatch()
    @ObservationIgnored private var tee: RecordingTeeBus?
    @ObservationIgnored private var player: UsisPlayer?
    @ObservationIgnored private let recorderBox = RecorderBox()

    var yawDegrees = 0.0 { didSet { applyAngles() } }
    var pitchDegrees = 0.0 { didSet { applyAngles() } }
    var rollDegrees = 0.0 { didSet { applyAngles() } }
    var heartRate = 70.0 { didSet { watch.heartRate = heartRate } }
    var watchOn = false
    var activePreset: String?
    private(set) var isRecording = false
    private(set) var recordedCount = 0
    private(set) var lastRecording: URL?
    private(set) var status = ""

    /// Simulated players and the one the panel and viewport follow. UI state only until `LocalTestSession` (2.4) exists.
    var playerCount = 1
    var selectedPlayer = 1

    init(appModel: AppModel) {
        self.appModel = appModel
        gizmo = GizmoController(device: appModel.headDevice)
        let box = recorderBox
        tee = RecordingTeeBus(base: appModel.pipeline, recorder: { box.current })
    }

    private func applyAngles() {
        let rad = Double.pi / 180
        gizmo.setAngles(yaw: yawDegrees * rad, pitch: pitchDegrees * rad, roll: rollDegrees * rad)
    }

    func setWatch(_ on: Bool) {
        guard let tee else { return }
        watchOn = on
        if on {
            watch.heartRate = heartRate
            watch.start(bus: tee)
        } else {
            watch.stop()
        }
    }

    func spike() {
        guard watchOn else { status = "Enable the watch first"; return }
        watch.spike()
    }

    func playPreset(_ id: String) {
        guard let tee else { return }
        player?.stop()
        guard let p = PresetLibrary.player(for: id) else { status = "Preset \(id) unavailable"; return }
        player = p
        activePreset = id
        p.start(bus: tee)
        status = "Playing \(id)"
    }

    func stopPlayback() {
        player?.stop()
        player = nil
        activePreset = nil
    }

    func toggleRecording() {
        if isRecording {
            recorderBox.current?.stop()
            recordedCount = recorderBox.current?.packetCount ?? 0
            recorderBox.current = nil
            isRecording = false
            status = "Saved \(recordedCount) packets"
            return
        }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("omni-\(Int(Date().timeIntervalSince1970)).usis.jsonl")
        do {
            recorderBox.current = UsisRecorder(write: try UsisRecorder.fileWriter(url: url))
            lastRecording = url
            isRecording = true
            status = "Recording to \(url.lastPathComponent)"
        } catch {
            status = "Cannot record: \(error.localizedDescription)"
        }
    }

    func replayLastRecording() {
        guard let tee, let url = lastRecording, !isRecording,
              let text = try? String(contentsOf: url, encoding: .utf8) else { status = "Nothing to replay"; return }
        player?.stop()
        let p = UsisPlayer(jsonl: text)
        player = p
        activePreset = nil
        p.start(bus: tee)
        status = "Replaying \(p.packetCount) packets"
    }

    func shutdown() {
        watch.stop()
        player?.stop()
    }
}

/// Mutable recorder slot shared with the tee bus, which is `Sendable` and may be called off the main actor.
private final class RecorderBox: @unchecked Sendable {
    // @unchecked Sendable: `lock` guards `value`.
    private let lock = NSLock()
    private var value: UsisRecorder?
    var current: UsisRecorder? {
        get { lock.lock(); defer { lock.unlock() }; return value }
        set { lock.lock(); defer { lock.unlock() }; value = newValue }
    }
}

struct SimulatorPanelView: View {
    @State private var model: SimulatorPanelModel

    init(appModel: AppModel) {
        _model = State(initialValue: SimulatorPanelModel(appModel: appModel))
    }

    var body: some View {
        Form {
            Section("Players") {
                Stepper("Simulated players: \(model.playerCount)", value: $model.playerCount, in: 1...8)
                    .onChange(of: model.playerCount) { _, n in
                        model.selectedPlayer = min(model.selectedPlayer, n)
                    }
                Picker("Following", selection: $model.selectedPlayer) {
                    ForEach(1...model.playerCount, id: \.self) { Text("Player \($0)").tag($0) }
                }
            }
            Section("Device slots") {
                Toggle("Head (AirPods)", isOn: .constant(true)).disabled(true)
                Toggle("Left wrist (Watch)", isOn: Binding(get: { model.watchOn }, set: { model.setWatch($0) }))
            }
            Section("Head orientation") {
                angleSlider("Yaw", value: $model.yawDegrees)
                angleSlider("Pitch", value: $model.pitchDegrees)
                angleSlider("Roll", value: $model.rollDegrees)
            }
            Section("Heart rate") {
                Slider(value: $model.heartRate, in: 40...200) { Text("HR \(Int(model.heartRate)) bpm") }
                Button("Spike") { model.spike() }
            }
            Section("Presets") {
                ForEach(PresetLibrary.all) { preset in
                    Button(preset.title) { model.playPreset(preset.id) }
                }
                Button("Stop playback") { model.stopPlayback() }.disabled(model.activePreset == nil)
            }
            Section("Recording") {
                Button(model.isRecording ? "Stop recording" : "Record") { model.toggleRecording() }
                Button("Replay last recording") { model.replayLastRecording() }
                    .disabled(model.lastRecording == nil || model.isRecording)
            }
            if !model.status.isEmpty {
                Text(model.status).font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .onDisappear { model.shutdown() }
    }

    private func angleSlider(_ title: String, value: Binding<Double>) -> some View {
        Slider(value: value, in: -180...180) { Text("\(title) \(Int(value.wrappedValue))°") }
    }
}
