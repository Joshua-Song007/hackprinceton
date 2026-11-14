import Foundation
import Network
import Synchronization
import Testing
import OmniCore
import OmniInput
@testable import OmniBridge

private final class RecordingBus: InputBus {
    struct Clock: Sendable, Equatable {
        let deviceId: String
        let tSend: Double
        let tHost: Double
        let tRecv: Double
    }
    private let jsons = Mutex<[Data]>([])
    private let clocks = Mutex<[Clock]>([])

    var lines: [Data] { jsons.withLock { $0 } }
    var clockSamples: [Clock] { clocks.withLock { $0 } }

    func ingest(_ packet: UsisPacket) {}
    func ingest(json: Data) { jsons.withLock { $0.append(json) } }
    func recordClockSample(deviceId: String, tSendDevice: Double, tHostReceived: Double, tRecvDevice: Double) {
        clocks.withLock { $0.append(Clock(deviceId: deviceId, tSend: tSendDevice, tHost: tHostReceived, tRecv: tRecvDevice)) }
    }
    func frame(at hostNowMs: Double) -> InputFrame { InputFrame(timestamp: hostNowMs, devices: []) }
}

private final class Events: Sendable {
    private let list = Mutex<[DeviceSession.Event]>([])
    func add(_ e: DeviceSession.Event) { list.withLock { $0.append(e) } }
    var all: [DeviceSession.Event] { list.withLock { $0 } }
    var closedCount: Int { all.filter { $0 == .closed }.count }
    var hello: Bool { all.contains { if case .hello = $0 { return true } else { return false } } }
}

/// Collects the client side's received bytes as framed lines.
private final class ClientInbox: Sendable {
    private let framing = Mutex(LineFraming())
    private let msgs = Mutex<[Data]>([])
    func feed(_ data: Data) {
        let lines = framing.withLock { $0.append(data) }
        msgs.withLock { $0.append(contentsOf: lines) }
    }
    var lines: [Data] { msgs.withLock { $0 } }
    var pings: [(id: Int, hostT: Double)] {
        lines.compactMap { try? JSONDecoder().decode(WireMessage.self, from: $0) }.compactMap {
            if case let .ping(id, hostT) = $0 { return (id, hostT) } else { return nil }
        }
    }
    var outputs: [OutputCommand] {
        lines.compactMap { try? JSONDecoder().decode(WireMessage.self, from: $0) }.compactMap {
            if case let .output(c) = $0 { return c } else { return nil }
        }
    }
}

private func waitUntil(timeout: Double = 5, _ condition: () -> Bool) async -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if condition() { return true }
        try? await Task.sleep(nanoseconds: 20_000_000)
    }
    return condition()
}

/// A loopback pair: a plain `NWListener` hands the accepted connection to a `DeviceSession`, and `client` plays the device.
private final class Loopback: Sendable {
    let bus = RecordingBus()
    let events = Events()
    let inbox = ClientInbox()
    let client: NWConnection
    let session: DeviceSession
    private let listener: NWListener

    static func make() async -> Loopback? {
        let queue = DispatchQueue(label: "omni.test.loopback")
        guard let listener = try? NWListener(using: .tcp, on: .any) else { return nil }
        let accepted = Mutex<NWConnection?>(nil)
        let port = Mutex<UInt16?>(nil)
        listener.newConnectionHandler = { c in accepted.withLock { $0 = c } }
        listener.stateUpdateHandler = { s in
            if case .ready = s { port.withLock { $0 = listener.port?.rawValue } }
        }
        listener.start(queue: queue)
        guard await waitUntil({ port.withLock { $0 } != nil }),
              let p = port.withLock({ $0 }), let nwPort = NWEndpoint.Port(rawValue: p) else {
            listener.cancel()
            return nil
        }
        let client = NWConnection(host: "127.0.0.1", port: nwPort, using: .tcp)
        client.start(queue: queue)
        guard await waitUntil({ accepted.withLock { $0 } != nil }), let server = accepted.withLock({ $0 }) else {
            client.cancel()
            listener.cancel()
            return nil
        }
        return Loopback(client: client, server: server, listener: listener)
    }

    private init(client: NWConnection, server: NWConnection, listener: NWListener) {
        self.client = client
        self.listener = listener
        let events = self.events
        self.session = DeviceSession(connection: server, bus: bus, pingInterval: 0.05, onEvent: { events.add($0) })
        session.start()
        receive()
    }

    private func receive() {
        client.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [inbox] data, _, done, error in
            if let data { inbox.feed(data) }
            if error == nil && !done { self.receive() }
        }
    }

    func send(_ message: WireMessage) {
        if let data = try? LineFraming.frame(message) { client.send(content: data, completion: .idempotent) }
    }

    func sendRaw(_ text: String) {
        client.send(content: Data((text + "\n").utf8), completion: .idempotent)
    }

    func teardown() {
        client.cancel()
        session.close()
        listener.cancel()
    }
}

@Suite struct DeviceSessionTests {
    private let packetLine = #"{"v":1,"deviceId":"phone-1","kind":"phone","slot":"hand","source":"live","t":1,"seq":1,"ch":{"heartRate":70}}"#

    @Test func helloPingPongRecordsClockSample() async {
        guard let lb = await Loopback.make() else { Issue.record("loopback failed"); return }
        defer { lb.teardown() }
        lb.send(.hello(deviceId: "phone-1", kind: .phone, name: "Test", protocolVersion: 1))
        #expect(await waitUntil { lb.events.hello })
        #expect(lb.session.deviceId == "phone-1")
        #expect(await waitUntil { !lb.inbox.pings.isEmpty })
        guard let ping = lb.inbox.pings.first else { return }
        lb.send(.pong(id: ping.id, deviceT: 1000))
        #expect(await waitUntil { !lb.bus.clockSamples.isEmpty })
        let sample = lb.bus.clockSamples.first
        #expect(sample?.deviceId == "phone-1")
        #expect(sample?.tSend == 1000)
        #expect((sample?.tRecv ?? 0) >= 1000)
    }

    @Test func packetsReachBusAndWireErrorsAreCounted() async {
        guard let lb = await Loopback.make() else { Issue.record("loopback failed"); return }
        defer { lb.teardown() }
        lb.sendRaw(packetLine)
        lb.sendRaw(#"{"msg":"pong","id":"bad"}"#)
        #expect(await waitUntil { lb.bus.lines.count == 1 && lb.session.wireErrorCount == 1 })
        #expect(lb.session.packetCount == 1)
    }

    @Test func outputCommandReachesDevice() async throws {
        guard let lb = await Loopback.make() else { Issue.record("loopback failed"); return }
        defer { lb.teardown() }
        let command = OutputCommand(target: "phone-1", type: .haptic, pattern: "thud", intensity: 0.5, durationMs: 100)
        try lb.session.send(command)
        #expect(await waitUntil { lb.inbox.outputs.contains(command) })
    }

    @Test func droppedDeviceClosesOnceAndSendFails() async {
        guard let lb = await Loopback.make() else { Issue.record("loopback failed"); return }
        defer { lb.teardown() }
        lb.sendRaw(packetLine)
        #expect(await waitUntil { lb.bus.lines.count == 1 })
        lb.client.cancel()
        #expect(await waitUntil { lb.session.isClosed })
        #expect(await waitUntil { lb.events.closedCount == 1 })
        let command = OutputCommand(target: "phone-1", type: .haptic, pattern: "thud", intensity: 0.5, durationMs: 100)
        #expect(throws: DeviceSession.SendError.closed) { try lb.session.send(command) }
        lb.session.close()
        #expect(lb.events.closedCount == 1)
    }
}
