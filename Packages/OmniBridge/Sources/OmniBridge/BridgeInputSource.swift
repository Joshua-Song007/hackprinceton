import Foundation
import Network
import Synchronization
import OmniCore
import OmniInput

/// `InputSource` merging every companion `DeviceSession` onto one `InputBus`. Every packet is stamped
/// `source: live` before it reaches the bus, whatever the companion wrote. Packets that do not decode are passed
/// on untouched so the bus counts them as schema errors. The source accepts connections (for example from
/// `BonjourListener.onConnection`) only while started; a lost device's session is dropped and the bus flags the
/// device stale by itself.
public final class BridgeInputSource: InputSource {
    private struct Entry {
        var session: DeviceSession
        var deviceId: String?
        var kind: DeviceKind?
        var slot: Slot?
    }

    private struct State {
        var bus: (any InputBus)?
        var entries: [UUID: Entry] = [:]
    }

    private let state = Mutex(State())
    private let pingInterval: TimeInterval
    private let queue = DispatchQueue(label: "omni.bridge.input-source")

    public init(pingInterval: TimeInterval = 2) {
        self.pingInterval = pingInterval
    }

    /// One descriptor per device that has said `hello`. The slot is the one its packets use, once seen, else a
    /// default for its kind. [provisional: needs-tien-review] sample rate and channels are per-kind defaults:
    /// `hello` carries neither.
    public var descriptors: [DeviceDescriptor] {
        state.withLock { s in
            s.entries.values.compactMap { entry in
                guard let id = entry.deviceId, let kind = entry.kind else { return nil }
                return DeviceDescriptor(
                    deviceId: id, kind: kind, slot: entry.slot ?? Self.defaultSlot(for: kind),
                    sampleRateHz: Self.defaultRate(for: kind), channels: Self.defaultChannels(for: kind))
            }
            .sorted { $0.deviceId < $1.deviceId }
        }
    }

    public var sessionCount: Int { state.withLock { $0.entries.count } }

    public func start(bus: InputBus) {
        state.withLock { $0.bus = bus }
    }

    /// Closes every session and stops accepting connections.
    public func stop() {
        let sessions = state.withLock { s -> [DeviceSession] in
            s.bus = nil
            let all = s.entries.values.map(\.session)
            s.entries.removeAll()
            return all
        }
        sessions.forEach { $0.close() }
    }

    /// Takes over an accepted connection. Returns false (and cancels it) when the source is not started.
    @discardableResult
    public func accept(_ connection: NWConnection) -> Bool {
        let id = UUID()
        let created: DeviceSession? = state.withLock { s in
            guard let bus = s.bus else { return nil }
            let stamping = LiveStampingBus(target: bus) { [weak self] deviceId, slot in
                self?.noteSlot(id: id, deviceId: deviceId, slot: slot)
            }
            let session = DeviceSession(
                connection: connection, bus: stamping, queue: queue, pingInterval: pingInterval,
                onEvent: { [weak self] event in self?.handle(event, id: id) })
            s.entries[id] = Entry(session: session)
            return session
        }
        guard let session = created else {
            connection.cancel()
            return false
        }
        session.start()
        return true
    }

    /// Sessions a command target addresses: a deviceId, or a slot name (every device in that slot).
    /// Unknown targets give an empty list.
    func sessions(forTarget target: String) -> [DeviceSession] {
        state.withLock { s in
            let byId = s.entries.values.filter { $0.deviceId == target }
            if !byId.isEmpty { return byId.map(\.session) }
            return s.entries.values
                .filter { entry in
                    guard entry.deviceId != nil, let kind = entry.kind else { return false }
                    return (entry.slot ?? Self.defaultSlot(for: kind)).rawValue == target
                }
                .map(\.session)
        }
    }

    private func handle(_ event: DeviceSession.Event, id: UUID) {
        switch event {
        case let .hello(deviceId, kind, _, _):
            state.withLock { s in
                s.entries[id]?.deviceId = deviceId
                s.entries[id]?.kind = kind
            }
        case .closed:
            state.withLock { _ = $0.entries.removeValue(forKey: id) }
        }
    }

    private func noteSlot(id: UUID, deviceId: String, slot: Slot) {
        state.withLock { s in
            guard s.entries[id] != nil else { return }
            s.entries[id]?.slot = slot
            if s.entries[id]?.deviceId == nil { s.entries[id]?.deviceId = deviceId }
        }
    }

    static func defaultSlot(for kind: DeviceKind) -> Slot {
        switch kind {
        case .airpods, .headset: .head
        case .watch: .leftWrist
        case .pencil: .stylus
        case .phone: .pocket
        case .tablet, .custom: .hand
        }
    }

    static func defaultRate(for kind: DeviceKind) -> Double {
        switch kind {
        case .airpods: 50
        case .watch: 10
        case .pencil: 240
        case .phone, .tablet, .headset, .custom: 100
        }
    }

    static func defaultChannels(for kind: DeviceKind) -> Set<ChannelKind> {
        switch kind {
        case .airpods, .headset: [.orientation, .accel]
        case .watch: [.orientation, .accel, .heartRate, .gesture]
        case .pencil: [.pencil, .gesture]
        case .phone, .tablet: [.orientation, .accel, .touch]
        case .custom: [.orientation]
        }
    }
}

/// Forwards to the real bus after setting `source` to `live`; undecodable lines go through unchanged.
private final class LiveStampingBus: InputBus {
    private let target: any InputBus
    private let onPacket: @Sendable (String, Slot) -> Void

    init(target: any InputBus, onPacket: @escaping @Sendable (String, Slot) -> Void) {
        self.target = target
        self.onPacket = onPacket
    }

    func ingest(_ packet: UsisPacket) {
        var stamped = packet
        stamped.source = .live
        onPacket(stamped.deviceId, stamped.slot)
        target.ingest(stamped)
    }

    func ingest(json: Data) {
        if let packet = try? JSONDecoder().decode(UsisPacket.self, from: json) {
            ingest(packet)
        } else {
            target.ingest(json: json)
        }
    }

    func recordClockSample(deviceId: String, tSendDevice: Double, tHostReceived: Double, tRecvDevice: Double) {
        target.recordClockSample(
            deviceId: deviceId, tSendDevice: tSendDevice, tHostReceived: tHostReceived, tRecvDevice: tRecvDevice)
    }

    func frame(at hostNowMs: Double) -> InputFrame { target.frame(at: hostNowMs) }
}
