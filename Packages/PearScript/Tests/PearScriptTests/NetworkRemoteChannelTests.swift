import Foundation
import Synchronization
import Testing
@testable import PearScript

private final class FakeTransport: WebSocketTransport {
    private let sentFrames = Mutex<[String]>([])
    private let inbox: AsyncStream<String>
    private let feed: AsyncStream<String>.Continuation
    private let closed = Mutex(false)

    init() { (inbox, feed) = AsyncStream.makeStream() }

    var sent: [String] { sentFrames.withLock { $0 } }
    var isClosed: Bool { closed.withLock { $0 } }

    func push(_ text: String) { feed.yield(text) }
    /// The server drops the connection.
    func drop() { feed.finish() }

    func send(_ text: String) async throws { sentFrames.withLock { $0.append(text) } }

    func receive() async throws -> String {
        for await text in inbox { return text }
        throw CancellationError()
    }

    func close() {
        closed.withLock { $0 = true }
        feed.finish()
    }
}

private func eventually(_ condition: () -> Bool) async -> Bool {
    for _ in 0..<200 {
        if condition() { return true }
        try? await Task.sleep(nanoseconds: 10_000_000)
    }
    return condition()
}

@Suite struct NetworkRemoteChannelTests {
    @Test func playURLUsesWsSchemeAndTheToken() {
        let plain = NetworkRemoteChannel.playURL(base: URL(string: "http://localhost:8080")!, gameId: "g1", token: "tok")
        #expect(plain?.absoluteString == "ws://localhost:8080/play/g1?token=tok")
        let secure = NetworkRemoteChannel.playURL(base: URL(string: "https://pear.example/")!, gameId: "g1", token: "t", version: 3)
        #expect(secure?.absoluteString == "wss://pear.example/play/g1?token=t&version=3")
    }

    @Test func fireToServerSendsANameDataFrame() async throws {
        let transport = FakeTransport()
        let channel = NetworkRemoteChannel(transport: transport, playerId: "me")
        channel.start()
        channel.fireToServer(RemoteEvent(playerId: "me", name: "score", data: #"{"points":3}"#))
        channel.fireToServer(RemoteEvent(playerId: "me", name: "ping", data: "null"))
        #expect(await eventually { transport.sent.count == 2 })
        let first = try JSONSerialization.jsonObject(with: Data(transport.sent[0].utf8)) as? [String: Any]
        #expect(first?["name"] as? String == "score")
        #expect((first?["data"] as? [String: Any])?["points"] as? Int == 3)
        let second = try JSONSerialization.jsonObject(with: Data(transport.sent[1].utf8)) as? [String: Any]
        #expect(second?["name"] as? String == "ping")
        #expect(second?["data"] is NSNull)
        channel.stop()
    }

    @Test func incomingFramesDrainInOrderAddressedToMe() async {
        let transport = FakeTransport()
        let channel = NetworkRemoteChannel(transport: transport, playerId: "me")
        channel.start()
        transport.push(#"{"name":"_welcome","data":{"id":"me","name":"Ann"}}"#)
        transport.push(#"{"name":"hit","data":{"n":1}}"#)
        transport.push(#"{"name":"win","data":"red"}"#)
        transport.push(#"{"name":"noData"}"#)
        transport.push("not json")
        #expect(await eventually { channel.isConnected && !channel.drainIncomingPeek().isEmpty })
        #expect(await eventually { channel.drainIncomingPeek().count == 3 })
        let events = channel.drainIncoming()
        #expect(events.map(\.name) == ["hit", "win", "noData"], "welcome and garbage are not script events")
        #expect(events.allSatisfy { $0.playerId == "me" })
        #expect(events[0].data == #"{"n":1}"#)
        #expect(events[1].data == #""red""#)
        #expect(events[2].data == "null")
        #expect(channel.drainIncoming().isEmpty, "drained")
        channel.stop()
    }

    @Test func reloadFrameSetsTheFlag() async {
        let transport = FakeTransport()
        let channel = NetworkRemoteChannel(transport: transport, playerId: "me")
        channel.start()
        transport.push(#"{"name":"_reload","data":{"version":2}}"#)
        #expect(await eventually { channel.reloaded })
        #expect(channel.drainIncoming().isEmpty)
        channel.stop()
    }

    @Test func aDroppedSocketIsConnectionLostButStopIsNot() async {
        let dropped = FakeTransport()
        let a = NetworkRemoteChannel(transport: dropped, playerId: "me")
        #expect(!a.isConnected)
        a.start()
        #expect(a.isConnected)
        dropped.drop()
        #expect(await eventually { a.connectionLost })
        #expect(!a.isConnected)

        let clean = FakeTransport()
        let b = NetworkRemoteChannel(transport: clean, playerId: "me")
        b.start()
        b.stop()
        #expect(clean.isClosed)
        try? await Task.sleep(nanoseconds: 50_000_000)
        #expect(!b.connectionLost)
        #expect(!b.isConnected)
    }
}

extension NetworkRemoteChannel {
    /// Test-only look at the queue without consuming the arrival order for the real assertion below.
    fileprivate func drainIncomingPeek() -> [RemoteEvent] { peekIncoming() }
}
