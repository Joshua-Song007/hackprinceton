import CoreMotion
import Foundation
import Synchronization
import OmniCore
import OmniInput

/// Reads AirPods head motion directly on the Mac with `CMHeadphoneMotionManager` and emits USIS `head` packets.
/// The Mac app target needs `NSMotionUsageDescription`.
///
/// Behavior measured by `Tools/AirPodsProbe` (2026-11-14):
/// - 50 Hz, orientation + user acceleration (in g) only, no position.
/// - Apple frame is X right / Y forward / Z up; Omni is X right / Y up / -Z forward, so vectors and
///   quaternions map `(x, y, z) -> (x, z, -y)` and `[x, y, z, w] -> [x, z, -y, w]`.
/// - A bud handoff (`sensorLocation` change) leaves a ~1.4 s gap and jumps orientation by 55-90 degrees,
///   so the first sample after a change is re-anchored to the last orientation emitted before it.
/// - After a connect event updates are stopped and restarted rather than relying on resume.
public final class AirPodsMotionSource: InputSource {
    public static let deviceId = "airpods-mac"
    public static let sampleRateHz = 50.0
    /// CoreMotion reports user acceleration in g; USIS wants m/s^2.
    public static let gravityMS2 = 9.81

    public let descriptors: [DeviceDescriptor] = [
        DeviceDescriptor(
            deviceId: AirPodsMotionSource.deviceId,
            kind: .airpods,
            slot: .head,
            sampleRateHz: AirPodsMotionSource.sampleRateHz,
            channels: [.orientation, .accel]
        )
    ]

    /// Mutable per-stream state; guarded by `state`.
    struct State {
        var bus: InputBus?
        var seq = 0
        var lastBud: Int?
        /// Last orientation emitted (Omni frame, after re-anchoring).
        var lastOut: Quaternion?
        /// Left-multiplied correction applied to converted samples; identity until a bud handoff.
        var anchor = Quaternion.identity
    }

    // CMHeadphoneMotionManager is not Sendable. It is only touched from start/stop and the delegate
    // callbacks, which hop onto `queue`, so access to it is serialized.
    private final class Box: @unchecked Sendable {
        let manager = CMHeadphoneMotionManager()
        let delegate = Delegate()
    }

    private final class Delegate: NSObject, CMHeadphoneMotionManagerDelegate, @unchecked Sendable {
        var onConnect: (@Sendable () -> Void)?
        var onDisconnect: (@Sendable () -> Void)?
        func headphoneMotionManagerDidConnect(_ manager: CMHeadphoneMotionManager) { onConnect?() }
        func headphoneMotionManagerDidDisconnect(_ manager: CMHeadphoneMotionManager) { onDisconnect?() }
    }

    private let box = Box()
    private let queue = OperationQueue()
    private let state = Mutex(State())

    public init() {
        queue.maxConcurrentOperationCount = 1
        queue.name = "omni.airpods-motion"
    }

    public var isAvailable: Bool { box.manager.isDeviceMotionAvailable }

    public func start(bus: InputBus) {
        state.withLock { s in
            s = State()
            s.bus = bus
        }
        box.delegate.onConnect = { [weak self] in self?.restartUpdates() }
        box.delegate.onDisconnect = { [weak self] in
            // Samples after a reconnect may be re-anchored; drop only the bud so the next sample is checked.
            self?.state.withLock { $0.lastBud = nil }
        }
        box.manager.delegate = box.delegate
        beginUpdates()
    }

    public func stop() {
        box.manager.stopDeviceMotionUpdates()
        box.manager.delegate = nil
        state.withLock { $0.bus = nil }
    }

    private func beginUpdates() {
        guard box.manager.isDeviceMotionAvailable else { return }
        box.manager.startDeviceMotionUpdates(to: queue) { [weak self] motion, error in
            guard error == nil, let motion else { return }
            self?.handle(motion)
        }
    }

    private func restartUpdates() {
        box.manager.stopDeviceMotionUpdates()
        beginUpdates()
    }

    private func handle(_ m: CMDeviceMotion) {
        let q = m.attitude.quaternion
        let a = m.userAcceleration
        let bud: Int
        switch m.sensorLocation {
        case .headphoneLeft: bud = 1
        case .headphoneRight: bud = 2
        default: bud = 0
        }
        // `m.timestamp` is seconds since boot, the same base as `HostClock`, so it converts directly.
        let tMs = Int64((m.timestamp * 1000).rounded())
        let packet: (UsisPacket, InputBus)? = state.withLock { s in
            guard let bus = s.bus else { return nil }
            let converted = Self.omniQuaternion(x: q.x, y: q.y, z: q.z, w: q.w)
            let out = Self.reanchored(
                converted, budChanged: s.lastBud != nil && s.lastBud != bud, lastOut: s.lastOut, anchor: &s.anchor)
            s.lastBud = bud
            s.lastOut = out
            s.seq += 1
            let p = UsisPacket(
                deviceId: Self.deviceId,
                kind: .airpods,
                slot: .head,
                source: .live,
                t: tMs,
                seq: s.seq,
                ch: UsisChannels(
                    orientation: out,
                    accel: Self.omniAccel(x: a.x, y: a.y, z: a.z)
                )
            )
            return (p, bus)
        }
        if let (p, bus) = packet { bus.ingest(p) }
    }

    // MARK: - Pure conversions

    /// Apple headphone frame (X right, Y forward, Z up) -> Omni quaternion `[x, z, -y, w]`.
    public static func omniQuaternion(x: Double, y: Double, z: Double, w: Double) -> Quaternion {
        Quaternion(x, z, -y, w).normalized
    }

    /// Apple vector (X right, Y forward, Z up) -> Omni `(x, z, -y)`.
    public static func omniVector(x: Double, y: Double, z: Double) -> Vector3 {
        Vector3(x, z, -y)
    }

    /// User acceleration in g (Apple frame) -> m/s^2 in the Omni frame.
    public static func omniAccel(x: Double, y: Double, z: Double) -> Vector3 {
        omniVector(x: x, y: y, z: z) * gravityMS2
    }

    /// Applies the running anchor to a converted sample. When the bud changed, the anchor is recomputed so the
    /// sample lands on `lastOut` (the last orientation emitted before the handoff).
    public static func reanchored(
        _ converted: Quaternion, budChanged: Bool, lastOut: Quaternion?, anchor: inout Quaternion
    ) -> Quaternion {
        if budChanged, let lastOut {
            anchor = (lastOut * converted.inverse).normalized
        }
        return (anchor * converted).normalized
    }
}
