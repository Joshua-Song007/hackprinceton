import Foundation
import Network
import Synchronization
import PearCore
import PearInput

/// One companion device's link to the Mac: an `NWConnection` carrying newline-delimited JSON.
/// Lines with a `msg` key are `WireMessage`s (hello, pong); every other line is a USIS packet handed to the
/// `InputBus` untouched. After `hello` the session pings the device and reports each exchange through
/// `InputBus.recordClockSample`. When the link drops the session closes itself and stops feeding the bus; the
/// bus then flags the device stale on its own, so a lost device never stops the loop.
public final class DeviceSession: Sendable {
    public enum Event: Sendable, Equatable {
        case hello(deviceId: String, kind: DeviceKind, name: String, protocolVersion: Int)
        case closed
    }

    /// Why the session can't send: closed, or the message could not be encoded.
    public enum SendError: Error, Equatable { case closed, encoding }

    /// TCP parameters for the listener and for companions: no-delay so small motion packets are not batched.
    /// (Over Wi-Fi TCP still delivers stalled samples late in a burst; no discard policy is applied here.)
    public static func tcpParameters() -> NWParameters {
        let tcp = NWProtocolTCP.Options()
        tcp.noDelay = true
        return NWParameters(tls: nil, tcp: tcp)
    }

    private struct State {
        var framing: LineFraming
        var deviceId: String?
        var closed = false
        var started = false
        var nextPingId = 0
        var outstanding: [Int: Double] = [:]
        var timer: DispatchSourceTimer?
        var packetCount = 0
        var wireErrorCount = 0
    }

    private static let maxOutstandingPings = 16

    private let connection: NWConnection
    private let bus: any InputBus
    private let queue: DispatchQueue
    private let pingInterval: TimeInterval
    private let clock: @Sendable () -> Double
    private let onEvent: @Sendable (Event) -> Void
    private let state: Mutex<State>

    /// - Parameters:
    ///   - connection: an accepted (or outgoing) connection; the session starts it.
    ///   - pingInterval: seconds between clock-sync pings after `hello`; the first ping goes out right after `hello`.
    ///   - clock: host time in ms; injectable for tests.
    ///   - onEvent: called on the session's queue for `hello` and (once) `closed`.
    public init(
        connection: NWConnection,
        bus: any InputBus,
        queue: DispatchQueue = DispatchQueue(label: "pear.bridge.session"),
        pingInterval: TimeInterval = 2,
        clock: @escaping @Sendable () -> Double = HostClock.nowMs,
        onEvent: @escaping @Sendable (Event) -> Void = { _ in }
    ) {
        self.connection = connection
        self.bus = bus
        self.queue = queue
        self.pingInterval = max(0.01, pingInterval)
        self.clock = clock
        self.onEvent = onEvent
        self.state = Mutex(State(framing: LineFraming()))
    }

    /// Device id from `hello`, nil until it arrives.
    public var deviceId: String? { state.withLock { $0.deviceId } }
    public var isClosed: Bool { state.withLock { $0.closed } }
    /// Non-wire lines forwarded to the bus.
    public var packetCount: Int { state.withLock { $0.packetCount } }
    /// Lines that carried a `msg` key but did not decode as a `WireMessage`.
    public var wireErrorCount: Int { state.withLock { $0.wireErrorCount } }
    public var oversizedLineCount: Int { state.withLock { $0.framing.oversizedCount } }

    public func start() {
        let shouldStart = state.withLock { s -> Bool in
            guard !s.started, !s.closed else { return false }
            s.started = true
            return true
        }
        guard shouldStart else { return }
        connection.stateUpdateHandler = { [weak self] newState in
            switch newState {
            case .failed, .cancelled, .waiting:
                self?.close()
            default:
                break
            }
        }
        connection.start(queue: queue)
        receiveLoop()
    }

    /// Cancels the connection and the ping timer; reports `closed` once.
    public func close() {
        let (firstClose, timer) = state.withLock { s -> (Bool, DispatchSourceTimer?) in
            guard !s.closed else { return (false, nil) }
            s.closed = true
            let t = s.timer
            s.timer = nil
            return (true, t)
        }
        guard firstClose else { return }
        timer?.cancel()
        connection.cancel()
        onEvent(.closed)
    }

    /// Sends an output command to the device.
    public func send(_ command: OutputCommand) throws {
        try send(.output(command))
    }

    func send(_ message: WireMessage) throws {
        guard !isClosed else { throw SendError.closed }
        guard let data = try? LineFraming.frame(message) else { throw SendError.encoding }
        connection.send(content: data, completion: .contentProcessed { [weak self] error in
            if error != nil { self?.close() }
        })
    }

    // MARK: Receive

    private func receiveLoop() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            if let data, !data.isEmpty { self.handle(data) }
            if error != nil || isComplete {
                self.close()
            } else if !self.isClosed {
                self.receiveLoop()
            }
        }
    }

    private func handle(_ bytes: Data) {
        let lines = state.withLock { $0.framing.append(bytes) }
        for line in lines {
            if let message = Self.wireMessage(in: line) {
                handle(message)
            } else if Self.hasMsgKey(line) {
                state.withLock { $0.wireErrorCount += 1 }
            } else {
                state.withLock { $0.packetCount += 1 }
                bus.ingest(json: line)
            }
        }
    }

    private static func hasMsgKey(_ line: Data) -> Bool {
        guard let object = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else { return false }
        return object["msg"] != nil
    }

    private static func wireMessage(in line: Data) -> WireMessage? {
        guard hasMsgKey(line) else { return nil }
        return try? JSONDecoder().decode(WireMessage.self, from: line)
    }

    private func handle(_ message: WireMessage) {
        switch message {
        case let .hello(deviceId, kind, name, protocolVersion):
            let first = state.withLock { s -> Bool in
                guard s.deviceId == nil else { return false }
                s.deviceId = deviceId
                return true
            }
            guard first else { return }
            onEvent(.hello(deviceId: deviceId, kind: kind, name: name, protocolVersion: protocolVersion))
            startPinging()
        case let .pong(id, deviceT):
            let now = clock()
            let (sent, deviceId) = state.withLock { s in (s.outstanding.removeValue(forKey: id), s.deviceId) }
            guard let sent, let deviceId else { return }
            // The device stamped `deviceT` when the ping arrived, so the exchange maps onto the bus's
            // (tSend, tHostReceived, tRecv) form as: tSend = deviceT, tRecv = deviceT + rtt, tHost = now.
            // That gives offset = now − (deviceT + rtt/2), which is the host-minus-device offset at the midpoint.
            let rtt = max(0, now - sent)
            bus.recordClockSample(deviceId: deviceId, tSendDevice: deviceT, tHostReceived: now, tRecvDevice: deviceT + rtt)
        case .ping, .output:
            break  // host-to-device messages; a device sending them is ignored
        }
    }

    // MARK: Ping

    private func startPinging() {
        let timer = DispatchSource.makeTimerSource(queue: queue)
        let installed = state.withLock { s -> Bool in
            guard !s.closed else { return false }
            s.timer = timer
            return true
        }
        guard installed else { return }
        timer.schedule(deadline: .now(), repeating: pingInterval)
        timer.setEventHandler { [weak self] in self?.sendPing() }
        timer.resume()
    }

    private func sendPing() {
        let hostT = clock()
        let id: Int? = state.withLock { s in
            guard !s.closed else { return nil }
            if s.outstanding.count >= Self.maxOutstandingPings { s.outstanding.removeAll() }
            s.nextPingId += 1
            s.outstanding[s.nextPingId] = hostT
            return s.nextPingId
        }
        guard let id else { return }
        try? send(.ping(id: id, hostT: hostT))
    }
}
