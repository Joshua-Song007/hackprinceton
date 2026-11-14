import Foundation
import Synchronization
import OmniCore
import OmniInput

/// Simulated Apple Watch: wrist orientation, heart rate and gestures, slot `leftWrist` by default, ~5 Hz.
/// Heart rate is held between packets (noisy, never negative); `spike` adds a bump that decays packet by packet.
/// Gestures are queued and each is sent in exactly one packet, oldest first.
public final class VirtualWatch: VirtualDevice, @unchecked Sendable {
    private struct WatchState {
        var baseBpm: Double
        var spikeBpm = 0.0
        var gestures: [GestureEvent] = []
    }

    /// Fraction of a spike still left after each packet.
    static let spikeRetention = 0.93
    static let maxQueuedGestures = 32

    private let watch: Mutex<WatchState>

    public init(
        deviceId: String = "sim-watch", slot: Slot = .leftWrist, restingBpm: Double = 70,
        noise: NoiseModel = .watch, seed: UInt64 = 2
    ) {
        watch = Mutex(WatchState(baseBpm: Self.sanitize(restingBpm)))
        super.init(
            deviceId: deviceId, kind: .watch, slot: slot, channels: [.orientation, .heartRate, .gesture],
            noise: noise, seed: seed
        )
    }

    private static func sanitize(_ bpm: Double) -> Double {
        bpm.isFinite ? max(0, bpm) : 0
    }

    /// Baseline heart rate in bpm (negative or non-finite values are clamped to 0).
    public var heartRate: Double {
        get { watch.withLock { $0.baseBpm } }
        set { watch.withLock { $0.baseBpm = Self.sanitize(newValue) } }
    }

    /// Adds `bpm` on top of the baseline; it fades away over the next packets. Non-finite or non-positive values are ignored.
    public func spike(by bpm: Double = 40) {
        guard bpm.isFinite, bpm > 0 else { return }
        watch.withLock { $0.spikeBpm += bpm }
    }

    /// Queues a gesture for the next free packet. The oldest one is dropped when the queue is full.
    public func queueGesture(_ type: GestureType, dir: Vector3? = nil) {
        watch.withLock { s in
            if s.gestures.count >= Self.maxQueuedGestures { s.gestures.removeFirst() }
            s.gestures.append(GestureEvent(type: type, dir: dir))
        }
    }

    public override func sampleChannels(
        orientation: Quaternion, position: Vector3?, rng: inout SeededGenerator
    ) -> UsisChannels {
        let (bpm, gesture) = watch.withLock { s -> (Double, GestureEvent?) in
            let value = s.baseBpm + s.spikeBpm
            s.spikeBpm = s.spikeBpm < 0.01 ? 0 : s.spikeBpm * Self.spikeRetention
            return (value, s.gestures.isEmpty ? nil : s.gestures.removeFirst())
        }
        return UsisChannels(
            orientation: noise.perturb(orientation, using: &rng),
            position: position,
            gesture: gesture,
            heartRate: noise.perturbHeartRate(bpm, using: &rng)
        )
    }
}
