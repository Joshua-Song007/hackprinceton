import Foundation
import Network
import Synchronization
import Testing
import OmniCore
import OmniInput
@testable import OmniBridge

private final class CaptureBus: InputBus {
    private let packets = Mutex<[UsisPacket]>([])
    private let jsons = Mutex<[Data]>([])
    var received: [UsisPacket] { packets.withLock { $0 } }
    var rawLines: [Data] { jsons.withLock { $0 } }
    func ingest(_ packet: UsisPacket) { packets.withLock { $0.append(packet) } }
    func ingest(json: Data) { jsons.withLock { $0.append(json) } }
    func recordClockSample(deviceId: String, tSendDevice: Double, tHostReceived: Double, tRecvDevice: Double) {}
    func frame(at hostNowMs: Double) -> InputFrame { InputFrame(timestamp: hostNowMs, devices: []) }
}

private func waitUntil(timeout: Double = 5, _ condition: () -> Bool) async -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if condition() { return true }
        try? await Task.sleep(nanoseconds: 20_000_000)
    }
    return condition()
}

/// A device client connected to a plain listener whose accepted connection goes to `BridgeInputSource.accept`.
private final class FakeDevice: Sendable {
    let client: NWConnection
    private let inbox = Mutex(LineFraming())
    private let lines = Mutex<[Data]>([])

    var outputs: [OutputCommand] {
        lines.withLock { $0 }.compactMap { try? JSONDecoder().decode(WireMessage.self, from: $0) }.compactMap {
            if case let .output(c) = $0 { return c } else { return nil }
        }
    }

    init(client: NWConnection) {
        self.client = client
        receive()
    }

    private func receive() {
        client.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, done, error in
            guard let self else { return }
            if let data {
                let split = self.inbox.withLock { $0.append(data) }
                self.lines.withLock { $0.append(contentsOf: split) }
            }
            if error == nil && !done { self.receive() }
        }
    }

    func send(_ message: WireMessage) {
        if let data = try? LineFraming.frame(message) { client.send(content: data, completion: .idempotent) }
    }

    func sendRaw(_ text: String) {
        client.send(content: Data((text + "\n").utf8), completion: .idempotent)
    }
}

private final class Harness: Sendable {
    let source = BridgeInputSource(pingInterval: 0.05)
    let bus = CaptureBus()
    private let listener: NWListener
    private let queue = DispatchQueue(label: "omni.test.source-sink")

    static func make(start: Bool = true) async -> Harness? {
        guard let listener = try? NWListener(using: .tcp, on: .any) else { return nil }
        let harness = Harness(listener: listener)
        if start { harness.source.start(bus: harness.bus) }
        let source = harness.source
        listener.newConnectionHandler = { source.accept($0) }
        let port = Mutex<UInt16?>(nil)
        listener.stateUpdateHandler = { s in
            if case .ready = s { port.withLock { $0 = listener.port?.rawValue } }
        }
        listener.start(queue: harness.queue)
        guard await waitUntil({ port.withLock { $0 } != nil }), let p = port.withLock({ $0 }),
              let nwPort = NWEndpoint.Port(rawValue: p) else {
            listener.cancel()
            return nil
        }
        harness.port = nwPort
        return harness
    }

    private let portBox = Mutex<NWEndpoint.Port?>(nil)
    var port: NWEndpoint.Port? {
        get { portBox.withLock { $0 } }
        set { portBox.withLock { $0 = newValue } }
    }

    private init(listener: NWListener) { self.listener = listener }

    func connectDevice() -> FakeDevice? {
        guard let port else { return nil }
        let client = NWConnection(host: "127.0.0.1", port: port, using: .tcp)
        client.start(queue: queue)
        return FakeDevice(client: client)
    }

    func teardown(_ devices: [FakeDevice]) {
        devices.forEach { $0.client.cancel() }
        source.stop()
        listener.cancel()
    }
}

private func packetLine(deviceId: String, slot: String, source: String) -> String {
    #"{"v":1,"deviceId":"\#(deviceId)","kind":"phone","slot":"\#(slot)","source":"\#(source)","t":1,"seq":1,"ch":{"heartRate":70}}"#
}

@Suite struct BridgeSourceSinkTests {
    @Test func stampsLiveAndPassesInvalidLinesThrough() async {
        guard let h = await Harness.make(), let d = h.connectDevice() else { Issue.record("harness failed"); return }
        defer { h.teardown([d]) }
        d.sendRaw(packetLine(deviceId: "phone-1", slot: "hand", source: "sim"))
        d.sendRaw(#"{"not":"a packet"}"#)
        #expect(await waitUntil { h.bus.received.count == 1 && h.bus.rawLines.count == 1 })
        #expect(h.bus.received.first?.source == .live)
        #expect(h.bus.received.first?.deviceId == "phone-1")
    }

    @Test func helloYieldsDescriptorWithObservedSlot() async {
        guard let h = await Harness.make(), let d = h.connectDevice() else { Issue.record("harness failed"); return }
        defer { h.teardown([d]) }
        d.send(.hello(deviceId: "phone-1", kind: .phone, name: "P", protocolVersion: 1))
        #expect(await waitUntil { h.source.descriptors.count == 1 })
        #expect(h.source.descriptors.first?.slot == .pocket)
        d.sendRaw(packetLine(deviceId: "phone-1", slot: "hand", source: "live"))
        #expect(await waitUntil { h.source.descriptors.first?.slot == .hand })
    }

    @Test func sinkRoutesByDeviceIdAndSlotAndDropsUnknown() async {
        guard let h = await Harness.make(), let a = h.connectDevice(), let b = h.connectDevice() else {
            Issue.record("harness failed"); return
        }
        defer { h.teardown([a, b]) }
        a.send(.hello(deviceId: "a", kind: .phone, name: "A", protocolVersion: 1))
        b.send(.hello(deviceId: "b", kind: .watch, name: "B", protocolVersion: 1))
        #expect(await waitUntil { h.source.descriptors.count == 2 })
        let sink = BridgeOutputSink(source: h.source)
        sink.send(OutputCommand(target: "a", type: .haptic, pattern: "thud", intensity: 0.5, durationMs: 100))
        sink.send(OutputCommand(target: "leftWrist", type: .haptic, pattern: "tick", intensity: 1, durationMs: 50))
        sink.send(OutputCommand(target: "nobody", type: .haptic, pattern: "x", intensity: 1, durationMs: 10))
        #expect(await waitUntil { a.outputs.count == 1 && b.outputs.count == 1 })
        #expect(a.outputs.first?.pattern == "thud")
        #expect(b.outputs.first?.pattern == "tick")
        #expect(sink.droppedCount == 1)
    }

    @Test func closedDeviceIsRemovedAndStoppedSourceRejectsConnections() async {
        guard let h = await Harness.make(), let d = h.connectDevice() else { Issue.record("harness failed"); return }
        d.send(.hello(deviceId: "a", kind: .phone, name: "A", protocolVersion: 1))
        #expect(await waitUntil { h.source.descriptors.count == 1 })
        d.client.cancel()
        #expect(await waitUntil { h.source.sessionCount == 0 })
        h.source.stop()
        let late = h.connectDevice()
        #expect(await waitUntil { h.source.sessionCount == 0 })
        h.teardown([late].compactMap { $0 })
    }
}
