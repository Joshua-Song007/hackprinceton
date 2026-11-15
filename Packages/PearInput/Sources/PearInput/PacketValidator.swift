import Foundation
import PearCore

public enum PacketValidationError: Error, Equatable, Sendable {
    case malformedJSON
    case unsupportedVersion(Int)
    case emptyDeviceId
    case deviceIdTooLong
    case negativeTimestamp
    case negativeSequence
    case nonFiniteValue(ChannelKind)
    case nonUnitQuaternion
    case touchOutOfRange
    case pressureOutOfRange
    case negativeHeartRate
}

/// Hand-written mirror of `Schema/usis.schema.json`. Stateless: dropping and counting invalid packets is `InputPipeline`'s job.
public struct PacketValidator: Sendable {
    public static let maxDeviceIdLength = 128
    public static let quaternionTolerance = 0.01

    public init() {}

    public func decode(_ data: Data) -> Result<UsisPacket, PacketValidationError> {
        let packet: UsisPacket
        do {
            packet = try JSONDecoder().decode(UsisPacket.self, from: data)
        } catch {
            return .failure(.malformedJSON)
        }
        if let error = validate(packet) {
            return .failure(error)
        }
        return .success(packet)
    }

    public func validate(_ packet: UsisPacket) -> PacketValidationError? {
        guard packet.v == UsisPacket.currentVersion else { return .unsupportedVersion(packet.v) }
        guard !packet.deviceId.isEmpty else { return .emptyDeviceId }
        guard packet.deviceId.count <= Self.maxDeviceIdLength else { return .deviceIdTooLong }
        guard packet.t >= 0 else { return .negativeTimestamp }
        guard packet.seq >= 0 else { return .negativeSequence }
        return validate(packet.ch)
    }

    private func validate(_ ch: UsisChannels) -> PacketValidationError? {
        if let q = ch.orientation {
            guard Self.isFinite(q) else { return .nonFiniteValue(.orientation) }
            guard abs(q.norm - 1) <= Self.quaternionTolerance else { return .nonUnitQuaternion }
        }
        if let p = ch.position, !Self.isFinite(p) { return .nonFiniteValue(.position) }
        if let a = ch.accel, !Self.isFinite(a) { return .nonFiniteValue(.accel) }
        if let touches = ch.touch {
            for t in touches {
                guard t.x.isFinite, t.y.isFinite else { return .nonFiniteValue(.touch) }
                guard (0...1).contains(t.x), (0...1).contains(t.y) else { return .touchOutOfRange }
            }
        }
        if let dir = ch.gesture?.dir, !Self.isFinite(dir) { return .nonFiniteValue(.gesture) }
        if let hr = ch.heartRate {
            guard hr.isFinite else { return .nonFiniteValue(.heartRate) }
            guard hr >= 0 else { return .negativeHeartRate }
        }
        if let pencil = ch.pencil {
            guard Self.isFinite(pencil.tip), pencil.pressure.isFinite, pencil.roll.isFinite, pencil.hover.isFinite else {
                return .nonFiniteValue(.pencil)
            }
            guard (0...1).contains(pencil.pressure) else { return .pressureOutOfRange }
        }
        return nil
    }

    private static func isFinite(_ v: Vector3) -> Bool {
        v.x.isFinite && v.y.isFinite && v.z.isFinite
    }

    private static func isFinite(_ q: Quaternion) -> Bool {
        q.x.isFinite && q.y.isFinite && q.z.isFinite && q.w.isFinite
    }
}
