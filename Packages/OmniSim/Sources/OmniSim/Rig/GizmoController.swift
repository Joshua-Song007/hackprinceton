import Foundation
import OmniCore

/// Pure pose math behind the transform gizmos and sliders.
public enum GizmoMath {
    public enum Axis: Sendable { case x, y, z }

    /// Unit quaternion for a rotation of `radians` about a principal axis.
    public static func rotation(about axis: Axis, radians: Double) -> Quaternion {
        let h = radians / 2
        let s = sin(h)
        switch axis {
        case .x: return Quaternion(s, 0, 0, cos(h))
        case .y: return Quaternion(0, s, 0, cos(h))
        case .z: return Quaternion(0, 0, s, cos(h))
        }
    }

    /// Orientation from slider angles in radians: yaw about +Y, then pitch about X, then roll about Z (Ry·Rx·Rz).
    /// Non-finite angles count as 0.
    public static func orientation(yaw: Double, pitch: Double, roll: Double) -> Quaternion {
        let f: (Double) -> Double = { $0.isFinite ? $0 : 0 }
        return (rotation(about: .y, radians: f(yaw)) * rotation(about: .x, radians: f(pitch))
            * rotation(about: .z, radians: f(roll))).normalized
    }

    /// Applies a world-axis rotation to `current` (gizmo ring drag).
    public static func rotated(_ current: Quaternion, about axis: Axis, radians: Double) -> Quaternion {
        guard radians.isFinite else { return current }
        return (rotation(about: axis, radians: radians) * current).normalized
    }

    /// Moves `position` along one axis by `delta` meters (gizmo arrow drag). A non-finite delta changes nothing.
    public static func translated(_ position: Vector3, along axis: Axis, by delta: Double) -> Vector3 {
        guard delta.isFinite else { return position }
        switch axis {
        case .x: return Vector3(position.x + delta, position.y, position.z)
        case .y: return Vector3(position.x, position.y + delta, position.z)
        case .z: return Vector3(position.x, position.y, position.z + delta)
        }
    }
}

/// Drives one virtual device's target orientation and position from gizmo drags and sliders.
public final class GizmoController {
    public let device: VirtualDevice

    public init(device: VirtualDevice) {
        self.device = device
    }

    /// Slider input: sets the orientation from yaw / pitch / roll in radians.
    public func setAngles(yaw: Double, pitch: Double, roll: Double) {
        device.targetOrientation = GizmoMath.orientation(yaw: yaw, pitch: pitch, roll: roll)
    }

    /// Ring drag: rotates the current orientation about a world axis.
    public func rotate(about axis: GizmoMath.Axis, radians: Double) {
        device.targetOrientation = GizmoMath.rotated(device.targetOrientation, about: axis, radians: radians)
    }

    /// Arrow drag: moves the device along an axis. A device with no position starts from the origin.
    public func translate(along axis: GizmoMath.Axis, by delta: Double) {
        device.targetPosition = GizmoMath.translated(device.targetPosition ?? .zero, along: axis, by: delta)
    }

    /// Sets the position directly (slider).
    public func setPosition(_ position: Vector3) {
        device.targetPosition = position
    }
}
