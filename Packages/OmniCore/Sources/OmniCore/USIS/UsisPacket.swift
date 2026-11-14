import Foundation

/// Mirrors `Schema/usis.schema.json`. Decoding does not reject `v != 1`; version policy belongs to the validator.
public struct UsisPacket: Equatable, Codable, Sendable {
    public static let currentVersion = 1

    public var v: Int
    public var deviceId: String
    public var kind: DeviceKind
    public var slot: Slot
    public var source: PacketSource
    /// Device timestamp, milliseconds.
    public var t: Int64
    public var seq: Int
    public var ch: UsisChannels

    public init(
        v: Int = UsisPacket.currentVersion,
        deviceId: String,
        kind: DeviceKind,
        slot: Slot,
        source: PacketSource,
        t: Int64,
        seq: Int,
        ch: UsisChannels
    ) {
        self.v = v
        self.deviceId = deviceId
        self.kind = kind
        self.slot = slot
        self.source = source
        self.t = t
        self.seq = seq
        self.ch = ch
    }
}
