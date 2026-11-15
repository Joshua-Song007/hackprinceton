import Foundation
import PearCore

public enum CalibrationMode: Sendable {
    case full
    /// AirPods: gravity already fixes pitch and roll, so only heading is calibrated.
    case yawOnly

    public static func `default`(for kind: DeviceKind) -> CalibrationMode {
        kind == .airpods ? .yawOnly : .full
    }
}

/// `q_world = q_cal⁻¹ · q_raw`, where `q_cal` is the device orientation captured while the player faces forward.
/// Position and accel are not rotated. A device that was never calibrated passes through unchanged.
public struct Calibration: Sendable {
    private var reference: [String: Quaternion] = [:]

    public init() {}

    public mutating func capture(
        deviceId: String,
        kind: DeviceKind,
        rawOrientation: Quaternion,
        mode: CalibrationMode? = nil
    ) {
        let chosen = mode ?? CalibrationMode.default(for: kind)
        switch chosen {
        case .full: reference[deviceId] = rawOrientation.normalized
        case .yawOnly: reference[deviceId] = rawOrientation.yawOnly
        }
    }

    public func apply(deviceId: String, to raw: Quaternion) -> Quaternion {
        guard let cal = reference[deviceId] else { return raw }
        return (cal.inverse * raw).normalized
    }

    public mutating func reset(deviceId: String) {
        reference.removeValue(forKey: deviceId)
    }

    public func isCalibrated(deviceId: String) -> Bool {
        reference[deviceId] != nil
    }
}
