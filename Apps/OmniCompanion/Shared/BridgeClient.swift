import Foundation
import Network
import OmniCore

/// Device clock for USIS `t` and `pong.deviceT`: milliseconds of system uptime, the same basis as
/// CoreMotion / UIKit event timestamps (seconds since boot).
enum DeviceClock {
    static var nowMs: Int64 { Int64(ProcessInfo.processInfo.systemUptime * 1000) }
}

/// Bonjour browse + `NWConnection` to the Mac, newline-delimited JSON (`LineFraming`).
/// Sends USIS packets, answers `ping`, delivers `output` commands. Auto-reconnects with backoff.
///
/// `@unchecked Sendable`: every mutable property is read and written only on `queue`; the public
/// methods just hop onto it, so the instance can be shared with CoreMotion / UIKit callbacks.
final class BridgeClient: @unchecked Sendable {
    /// Must match `BonjourListener`'s service type (`_omni._tcp`, OmniBridge, merged).
    static let serviceType = "_omni._tcp"
    static let protocolVersion = 1

    struct Identity: Sendable {
        var deviceId: String
        var kind: DeviceKind
        var slot: Slot
        var name: String
    }

    let identity: Identity

    private let queue = DispatchQueue(label: "omni.companion.bridge")
    private let onStatus: @Sendable (String) -> Void
    private let onOutput: @Sendable (OutputCommand) -> Void
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    private var browser: NWBrowser?
    private var connection: NWConnection?
    private var framing = LineFraming()
    private var running = false
    private var seq = 0
    private var inFlight = 0
    private var backoff = BridgeClient.minBackoff

    private static let minBackoff = 0.5
    private static let maxBackoff = 5.0
    /// Drop new packets while this many sends are unacknowledged: TCP never drops, so a stalled
    /// Wi-Fi link would otherwise release a burst of stale samples later (phone probe, 2026-11-14).
    private static let maxInFlight = 64

    init(
        identity: Identity,
        onStatus: @escaping @Sendable (String) -> Void,
        onOutput: @escaping @Sendable (OutputCommand) -> Void
    ) {
        self.identity = identity
        self.onStatus = onStatus
        self.onOutput = onOutput
    }

    func start() {
        queue.async { [self] in
            guard !running else { return }
            running = true
            backoff = Self.minBackoff
            startBrowser()
        }
    }

    func stop() {
        queue.async { [self] in
            running = false
            teardown()
            onStatus("stopped")
        }
    }

    /// Returning to the foreground: iOS suspended us and the old connection is dead or about to be.
    /// Cancel it and open a fresh one instead of waiting for it to fail.
    func reconnect() {
        queue.async { [self] in
            guard running else { return }
            teardown()
            backoff = Self.minBackoff
            startBrowser()
        }
    }

    /// Stamps the envelope (live source, per-device `seq`) and sends one packet carrying `channels`.
    /// `t` is device-clock milliseconds. Silently dropped while not connected.
    func send(_ channels: UsisChannels, at t: Int64) {
        queue.async { [self] in
            guard let c = connection, c.state == .ready, inFlight < Self.maxInFlight else { return }
            seq += 1
            let packet = UsisPacket(
                deviceId: identity.deviceId, kind: identity.kind, slot: identity.slot,
                source: .live, t: t, seq: seq, ch: channels
            )
            guard let data = try? encoder.encode(packet) else { return }
            write(LineFraming.frame(data), on: c)
        }
    }

    /// Sends a packet stamped by another device (the Watch, relayed through this phone) as-is.
    /// Silently dropped while not connected.
    func forward(_ packet: UsisPacket) {
        queue.async { [self] in
            guard let c = connection, c.state == .ready, inFlight < Self.maxInFlight else { return }
            guard let data = try? encoder.encode(packet) else { return }
            write(LineFraming.frame(data), on: c)
        }
    }

    // MARK: Link (queue-confined)

    private func teardown() {
        browser?.cancel()
        browser = nil
        connection?.cancel()
        connection = nil
        inFlight = 0
    }

    private func tcpParameters() -> NWParameters {
        let tcp = NWProtocolTCP.Options()
        tcp.noDelay = true // small JSON lines; don't let Nagle batch them
        return NWParameters(tls: nil, tcp: tcp)
    }

    private func startBrowser() {
        onStatus("searching")
        let b = NWBrowser(for: .bonjour(type: Self.serviceType, domain: nil), using: tcpParameters())
        b.stateUpdateHandler = { [weak self, weak b] state in
            guard let self, let b else { return }
            queue.async { [self] in
                guard browser === b else { return }
                switch state {
                case .failed, .cancelled:
                    // rediscover after a delay (e.g. local network permission pending)
                    browser = nil
                    queue.asyncAfter(deadline: .now() + backoff) { [self] in
                        if running, browser == nil { startBrowser() }
                    }
                default:
                    break
                }
            }
        }
        b.browseResultsChangedHandler = { [weak self] _, _ in
            guard let self else { return }
            queue.async { [self] in connectIfIdle() }
        }
        browser = b
        b.start(queue: queue)
    }

    private func connectIfIdle() {
        guard running, connection == nil, let result = browser?.browseResults.first else { return }
        let c = NWConnection(to: result.endpoint, using: tcpParameters())
        connection = c
        framing = LineFraming()
        inFlight = 0
        onStatus("connecting")
        c.stateUpdateHandler = { [weak self, weak c] state in
            guard let self, let c else { return }
            queue.async { [self] in
                guard connection === c else { return }
                switch state {
                case .ready:
                    backoff = Self.minBackoff
                    onStatus("connected")
                    sendWire(
                        .hello(deviceId: identity.deviceId, kind: identity.kind, name: identity.name,
                               protocolVersion: Self.protocolVersion),
                        on: c
                    )
                    receive(on: c)
                case .waiting, .failed, .cancelled:
                    drop(c) // don't sit in .waiting; rediscover instead
                default:
                    break
                }
            }
        }
        c.start(queue: queue)
    }

    private func drop(_ c: NWConnection) {
        guard connection === c else { return }
        c.cancel()
        connection = nil
        inFlight = 0
        onStatus("searching")
        let delay = backoff
        backoff = min(backoff * 2, Self.maxBackoff)
        queue.asyncAfter(deadline: .now() + delay) { [self] in connectIfIdle() }
    }

    private func receive(on c: NWConnection) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self, weak c] data, _, isComplete, error in
            guard let self, let c else { return }
            queue.async { [self] in
                guard connection === c else { return }
                if let data {
                    for line in framing.append(data) { handle(line, on: c) }
                }
                if isComplete || error != nil {
                    drop(c)
                    return
                }
                receive(on: c)
            }
        }
    }

    private func handle(_ line: Data, on c: NWConnection) {
        guard let message = try? decoder.decode(WireMessage.self, from: line) else { return } // packets / unknown: ignored
        switch message {
        case let .ping(id, _):
            sendWire(.pong(id: id, deviceT: Double(DeviceClock.nowMs)), on: c)
        case let .output(command):
            onOutput(command)
        case .hello, .pong:
            break
        }
    }

    private func sendWire(_ message: WireMessage, on c: NWConnection) {
        guard let data = try? LineFraming.frame(message) else { return }
        write(data, on: c)
    }

    private func write(_ data: Data, on c: NWConnection) {
        inFlight += 1
        c.send(content: data, completion: .contentProcessed { [weak self] _ in
            guard let self else { return }
            queue.async { [self] in inFlight = max(0, inFlight - 1) }
        })
    }
}
