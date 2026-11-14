import CoreMotion
import Foundation
import OmniCore

/// Wrist gestures from Watch device motion.
///
/// `flick`: a sharp acceleration spike (|userAcceleration| above `flickThreshold` g) reported with its
/// direction in Omni axes, then a cooldown. `doubleTap` / `pinch` / `squeeze` have no motion signature
/// here: the app reports them with `report(_:)` from the system double-tap action (`handGestureShortcut`).
///
/// Watch frame: not yet measured. Provisional: assumed to match the phone (X right, Y top, Z out of the
/// screen), so vectors map `(x, y, z) -> (x, z, -y)`. [provisional: needs-tien-review]
///
/// `@unchecked Sendable`: `start` / `stop` are called from the main actor; the motion handler runs on
/// the serial `operations` queue and touches only `lastFlick`, which nothing else reads.
final class WristGestureDetector: @unchecked Sendable {
    static let flickThreshold = 2.0 // g; provisional, untested on hardware
    static let cooldown = 0.6 // seconds between flicks

    private let manager = CMMotionManager()
    private let operations = OperationQueue()
    private let onGesture: @Sendable (GestureEvent, Int64) -> Void
    private var lastFlick = -Double.infinity

    init(onGesture: @escaping @Sendable (GestureEvent, Int64) -> Void) {
        self.onGesture = onGesture
        operations.name = "omni.companion.wristgesture"
        operations.maxConcurrentOperationCount = 1
    }

    /// Pure flick test: acceleration in g (device frame), `time` in seconds, `lastFlick` the previous
    /// flick's time. Returns the event with its Omni-axes direction, or nil.
    static func flick(acceleration a: Vector3, time: Double, lastFlick: Double) -> GestureEvent? {
        guard a.length > flickThreshold, time - lastFlick >= cooldown else { return nil }
        return GestureEvent(type: .flick, dir: Vector3(a.x, a.z, -a.y).normalized)
    }

    /// Returns false when the device has no motion hardware (e.g. the simulator).
    @discardableResult
    func start() -> Bool {
        guard manager.isDeviceMotionAvailable else { return false }
        guard !manager.isDeviceMotionActive else { return true }
        manager.deviceMotionUpdateInterval = 0.02 // 50 Hz is enough to catch a flick spike
        manager.startDeviceMotionUpdates(to: operations) { [self] motion, _ in
            guard let motion else { return }
            let a = Vector3(motion.userAcceleration.x, motion.userAcceleration.y, motion.userAcceleration.z)
            if let event = Self.flick(acceleration: a, time: motion.timestamp, lastFlick: lastFlick) {
                lastFlick = motion.timestamp
                onGesture(event, Int64(motion.timestamp * 1000))
            }
        }
        return true
    }

    func stop() {
        manager.stopDeviceMotionUpdates()
    }

    /// Gestures the system reports (double-tap action) rather than motion.
    func report(_ type: GestureType) {
        onGesture(GestureEvent(type: type), Int64(ProcessInfo.processInfo.systemUptime * 1000))
    }
}
