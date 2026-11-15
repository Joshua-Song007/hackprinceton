import Foundation
import Network
import Synchronization
import Testing
@testable import PearBridge

private final class Recorder: Sendable {
    private let states = Mutex<[BonjourListenerState]>([])
    private let connections = Mutex<[NWConnection]>([])

    func record(_ state: BonjourListenerState) { states.withLock { $0.append(state) } }
    func record(_ connection: NWConnection) { connections.withLock { $0.append(connection) } }

    var allStates: [BonjourListenerState] { states.withLock { $0 } }
    var connectionCount: Int { connections.withLock { $0.count } }

    var readyPort: UInt16? {
        for case .ready(let port) in allStates { if let port { return port } }
        return nil
    }
    var readyCount: Int { allStates.filter { if case .ready = $0 { return true } else { return false } }.count }
    var stopped: Bool { allStates.contains(.stopped) }
}

/// Polls `condition` until true or `timeout` seconds pass, so no test can hang.
private func waitUntil(timeout: Double = 5, _ condition: () -> Bool) async -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if condition() { return true }
        try? await Task.sleep(nanoseconds: 20_000_000)
    }
    return condition()
}

/// These tests run the real `NWListener` including its Bonjour service registration; they assert
/// on `ready` and TCP accept over loopback, which do not depend on the advertisement being visible.
@Suite struct BonjourListenerTests {
    private func makeListener(_ recorder: Recorder) -> BonjourListener {
        BonjourListener(
            serviceName: "PearTest-\(UUID().uuidString.prefix(8))",
            onConnection: { recorder.record($0) },
            onState: { recorder.record($0) }
        )
    }

    @Test func startReportsReadyWithPort() async {
        let recorder = Recorder()
        let listener = makeListener(recorder)
        listener.start()
        defer { listener.stop() }
        #expect(await waitUntil { recorder.readyPort != nil })
        #expect((recorder.readyPort ?? 0) > 0)
    }

    @Test func acceptsLoopbackConnection() async {
        let recorder = Recorder()
        let listener = makeListener(recorder)
        listener.start()
        defer { listener.stop() }
        guard await waitUntil({ recorder.readyPort != nil }), let port = recorder.readyPort,
              let nwPort = NWEndpoint.Port(rawValue: port) else {
            Issue.record("listener never became ready")
            return
        }
        let client = NWConnection(host: "127.0.0.1", port: nwPort, using: .tcp)
        client.start(queue: DispatchQueue(label: "pear.test.client"))
        defer { client.cancel() }
        #expect(await waitUntil { recorder.connectionCount == 1 })
    }

    @Test func secondStartDoesNotCreateSecondListener() async {
        let recorder = Recorder()
        let listener = makeListener(recorder)
        listener.start()
        defer { listener.stop() }
        #expect(await waitUntil { recorder.readyPort != nil })
        listener.start()
        // A second listener would report its own ready (or failure) shortly after.
        try? await Task.sleep(nanoseconds: 300_000_000)
        #expect(recorder.readyCount == 1)
        #expect(!recorder.allStates.contains { if case .failed = $0 { return true } else { return false } })
    }

    @Test func stopReportsStopped() async {
        let recorder = Recorder()
        let listener = makeListener(recorder)
        listener.start()
        #expect(await waitUntil { recorder.readyPort != nil })
        listener.stop()
        #expect(await waitUntil { recorder.stopped })
    }
}
