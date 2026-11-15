import Foundation
import PearCore

/// Per-device health for the Studio debug overlay. This is the only place a packet's `source` is retained.
public struct DeviceStats: Sendable {
    public let deviceId: String
    public private(set) var kind: DeviceKind
    public private(set) var slot: Slot
    public private(set) var source: PacketSource
    public private(set) var lastPacket: UsisPacket?
    public private(set) var packetCount = 0
    /// Smoothed arrival-minus-converted-timestamp, ms. Only meaningful once `clockSynced`.
    public private(set) var latencyMs = 0.0
    /// Total packets missing according to `seq` gaps.
    public private(set) var seqGaps = 0
    public private(set) var outOfOrder = 0
    public private(set) var stale = false
    public private(set) var schemaErrors = 0
    public private(set) var clockSynced = false

    private var arrivals: [Double] = []
    private var lastSeq: Int?

    public init(deviceId: String, kind: DeviceKind, slot: Slot, source: PacketSource) {
        self.deviceId = deviceId
        self.kind = kind
        self.slot = slot
        self.source = source
    }

    /// Packets per second over the last second.
    public func rateHz(at nowMs: Double) -> Double {
        Double(arrivals.filter { $0 > nowMs - 1000 }.count)
    }

    public mutating func record(packet: UsisPacket, arrivalHostMs: Double, convertedHostMs: Double, clockSynced: Bool) {
        kind = packet.kind
        slot = packet.slot
        source = packet.source
        lastPacket = packet
        packetCount += 1
        self.clockSynced = clockSynced

        let latency = arrivalHostMs - convertedHostMs
        latencyMs = packetCount == 1 ? latency : latencyMs + 0.1 * (latency - latencyMs)

        arrivals.append(arrivalHostMs)
        if let firstKept = arrivals.firstIndex(where: { $0 > arrivalHostMs - 1000 }), firstKept > 0 {
            arrivals.removeFirst(firstKept)
        }

        if let last = lastSeq {
            if packet.seq == last + 1 {
                lastSeq = packet.seq
            } else if packet.seq > last + 1 {
                seqGaps += packet.seq - last - 1
                lastSeq = packet.seq
            } else if packet.seq == 0 {
                lastSeq = 0
            } else {
                outOfOrder += 1
            }
        } else {
            lastSeq = packet.seq
        }
    }

    public mutating func recordSchemaError() {
        schemaErrors += 1
    }

    public mutating func setStale(_ value: Bool) {
        stale = value
    }
}
