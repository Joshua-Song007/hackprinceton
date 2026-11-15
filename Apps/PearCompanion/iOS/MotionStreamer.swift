import CoreMotion
import Foundation
import PearCore

/// CoreMotion device motion at 100 Hz -> USIS `orientation` + `accel` packets.
///
/// Phone frame (measured 2026-11-14): X right edge, Y top edge, Z out of the screen, with Z-up
/// reference frames. Pear is +X right, +Y up, -Z forward, so `[x, y, z, w] -> [x, z, -y, w]` and
/// vectors `(x, y, z) -> (x, z, -y)`; the top edge then points along Pear -Z forward.
///
/// `@unchecked Sendable`: `start` / `stop` are called from the main actor only; the CoreMotion
/// handler touches nothing but the thread-safe `BridgeClient`.
final class MotionStreamer: @unchecked Sendable {
    /// CoreMotion reports `userAcceleration` in g; USIS wants m/s^2.
    static let gravity = 9.81

    private let manager = CMMotionManager()
    private let operations = OperationQueue()

    init() {
        operations.name = "pear.companion.motion"
        operations.maxConcurrentOperationCount = 1
    }

    var isAvailable: Bool { manager.isDeviceMotionAvailable }

    static func pearOrientation(x: Double, y: Double, z: Double, w: Double) -> Quaternion {
        Quaternion(x, z, -y, w)
    }

    static func pearVector(x: Double, y: Double, z: Double, scale: Double = 1) -> Vector3 {
        Vector3(x * scale, z * scale, -y * scale)
    }

    /// Returns false when the device has no motion hardware (e.g. the simulator).
    @discardableResult
    func start(client: BridgeClient) -> Bool {
        guard manager.isDeviceMotionAvailable else { return false }
        guard !manager.isDeviceMotionActive else { return true }
        manager.deviceMotionUpdateInterval = 0.01 // request 100 Hz; the probe measured a steady 100.5 Hz
        manager.startDeviceMotionUpdates(using: .xArbitraryZVertical, to: operations) { motion, _ in
            guard let motion else { return }
            let q = motion.attitude.quaternion
            let a = motion.userAcceleration
            let channels = UsisChannels(
                orientation: MotionStreamer.pearOrientation(x: q.x, y: q.y, z: q.z, w: q.w),
                accel: MotionStreamer.pearVector(x: a.x, y: a.y, z: a.z, scale: MotionStreamer.gravity)
            )
            client.send(channels, at: Int64(motion.timestamp * 1000))
        }
        return true
    }

    func stop() {
        manager.stopDeviceMotionUpdates()
    }
}
