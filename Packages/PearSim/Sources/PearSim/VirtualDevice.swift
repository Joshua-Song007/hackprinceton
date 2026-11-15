import Foundation
import Synchronization
import PearCore
import PearInput

/// Base class for simulated devices. Emits USIS packets stamped `source: "sim"` at the rate of its `NoiseModel`.
/// Subclasses (VirtualAirPods and so on) override `sampleChannels` to choose which channels they send.
/// `@unchecked Sendable` because the compiler rejects `Sendable` on a non-final class; it is safe because every stored
/// property is an immutable `let` and all mutable state lives behind a `Mutex`. It is not `final` so devices can subclass it
/// (subclasses must add no unguarded mutable state).
/// It does not conform to `OutputSink`: only `SimOutputSink` does, and it reaches a device through `deliverFeedback`.
open class VirtualDevice: InputSource, @unchecked Sendable {
    private struct State {
        var seq = 0
        var rng: SeededGenerator
        var orientation = Quaternion.identity
        var position: Vector3?
        var feedback: (@Sendable (OutputCommand) -> Void)?
        var task: Task<Void, Never>?
    }

    public let noise: NoiseModel
    private let descriptor: DeviceDescriptor
    private let state: Mutex<State>

    /// `seed` drives every random draw this device makes, so a run is reproducible.
    public init(
        deviceId: String,
        kind: DeviceKind,
        slot: Slot,
        channels: Set<ChannelKind>,
        noise: NoiseModel,
        seed: UInt64
    ) {
        self.noise = noise
        self.descriptor = DeviceDescriptor(
            deviceId: deviceId, kind: kind, slot: slot, sampleRateHz: noise.sampleRateHz, channels: channels
        )
        self.state = Mutex(State(rng: SeededGenerator(seed: seed)))
    }

    public var descriptors: [DeviceDescriptor] { [descriptor] }

    /// Orientation the gizmo or slider wants the device to report (noise is added on emit).
    public var targetOrientation: Quaternion {
        get { state.withLock { $0.orientation } }
        set { state.withLock { $0.orientation = newValue.normalized } }
    }

    /// World position; nil means the device sends no `position` channel.
    public var targetPosition: Vector3? {
        get { state.withLock { $0.position } }
        set { state.withLock { $0.position = newValue } }
    }

    /// Channels for one packet. The base class sends the noisy orientation only; subclasses add their own.
    /// `rng` is the device's seeded generator. Quaternions must stay unit length.
    open func sampleChannels(orientation: Quaternion, position: Vector3?, rng: inout SeededGenerator) -> UsisChannels {
        UsisChannels(orientation: noise.perturb(orientation, using: &rng), position: position)
    }

    /// Builds the next packet for host time `hostNowMs`. `t` is that time rounded to ms (the sim's device clock is the
    /// host clock) and `seq` advances by one per packet. Time is an argument so tests need no real clock.
    public func makePacket(hostNowMs: Double) -> UsisPacket {
        state.withLock { s in
            let ch = sampleChannels(orientation: s.orientation, position: s.position, rng: &s.rng)
            let packet = UsisPacket(
                deviceId: descriptor.deviceId,
                kind: descriptor.kind,
                slot: descriptor.slot,
                source: .sim,
                t: Int64(hostNowMs.rounded()),
                seq: s.seq,
                ch: ch
            )
            s.seq += 1
            return packet
        }
    }

    /// Gap in ms before the next packet is due.
    public func nextIntervalMs() -> Double {
        state.withLock { noise.nextIntervalMs(using: &$0.rng) }
    }

    /// Set by `SimOutputSink`; called when a haptic or audio command reaches this device.
    public func setFeedbackHandler(_ handler: (@Sendable (OutputCommand) -> Void)?) {
        state.withLock { $0.feedback = handler }
    }

    public func deliverFeedback(_ command: OutputCommand) {
        let handler = state.withLock { $0.feedback }
        handler?(command)
    }

    public func start(bus: InputBus) {
        let new = Task { [self] in
            while !Task.isCancelled {
                bus.ingest(makePacket(hostNowMs: HostClock.nowMs()))
                let ms = nextIntervalMs()
                guard ms.isFinite else { return }
                try? await Task.sleep(nanoseconds: UInt64(ms * 1_000_000))
            }
        }
        let old = state.withLock { s -> Task<Void, Never>? in
            let previous = s.task
            s.task = new
            return previous
        }
        old?.cancel()
    }

    public func stop() {
        let old = state.withLock { s -> Task<Void, Never>? in
            let previous = s.task
            s.task = nil
            return previous
        }
        old?.cancel()
    }
}
