import Foundation
import PearCore
import PearInput
import PearSim

/// The screen as a controller for a device with no headset or watch: a simulated head that follows drags
/// (look) and a simulated watch that sends the five gestures. Both feed the session's `InputPipeline` as
/// ordinary USIS sources, so scripts and detectors cannot tell them from real devices.
@MainActor
final class TouchInput {
    private let head = VirtualDevice(
        deviceId: "touch-head", kind: .headset, slot: .head, channels: [.orientation, .position],
        noise: .airpods, seed: 1)
    private let watch = VirtualWatch(deviceId: "touch-watch")

    init(origin: Vector3) {
        head.targetPosition = origin
    }

    func start(bus: InputBus) {
        head.start(bus: bus)
        watch.start(bus: bus)
    }

    func stop() {
        head.stop()
        watch.stop()
    }

    func setOrientation(_ q: Quaternion) {
        head.targetOrientation = q
    }

    func gesture(_ type: GestureType) {
        watch.queueGesture(type)
    }

    /// Head orientation for a look direction. Forward is −Z, so a positive yaw (about +Y) turns left.
    nonisolated static func orientation(yaw: Double, pitch: Double) -> Quaternion {
        let y = Quaternion(0, sin(yaw / 2), 0, cos(yaw / 2))
        let p = Quaternion(sin(pitch / 2), 0, 0, cos(pitch / 2))
        return (y * p).normalized
    }
}
