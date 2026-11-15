import Foundation
import Synchronization

/// One text-frame WebSocket. The real one is `URLSessionWebSocketTransport`; tests use a fake.
public protocol WebSocketTransport: AnyObject, Sendable {
    func send(_ text: String) async throws
    /// The next text frame; throws once the socket is closed.
    func receive() async throws -> String
    func close()
}

/// `URLSessionWebSocketTask` as a `WebSocketTransport`.
public final class URLSessionWebSocketTransport: WebSocketTransport, @unchecked Sendable {
    private let task: URLSessionWebSocketTask

    public init(url: URL, session: URLSession = .shared) {
        task = session.webSocketTask(with: url)
        task.resume()
    }

    public func send(_ text: String) async throws {
        try await task.send(.string(text))
    }

    public func receive() async throws -> String {
        while true {
            switch try await task.receive() {
            case .string(let text): return text
            case .data(let data): if let text = String(data: data, encoding: .utf8) { return text }
            @unknown default: continue
            }
        }
    }

    public func close() {
        task.cancel(with: .normalClosure, reason: nil)
    }
}

/// A player's game-server connection (`GET /play/{gameId}`): client scripts fire events up, server scripts' events
/// come back. Scripts cannot tell it from Studio's in-memory channel. Incoming events queue until the game loop
/// drains them at a fixed point in the frame, never from inside a running script handler.
public final class NetworkRemoteChannel: RemoteChannel, @unchecked Sendable {
    private struct State {
        var incoming: [RemoteEvent] = []
        var connected = false
        var lost = false
        var reloaded = false
    }

    private let transport: any WebSocketTransport
    private let playerId: String
    private let state = Mutex(State())
    private let outbox: AsyncStream<String>
    private let outboxContinuation: AsyncStream<String>.Continuation
    private let tasks = Mutex<[Task<Void, Never>]>([])

    /// - Parameter playerId: who incoming events are addressed to (the server uses the account id as player id).
    public init(transport: any WebSocketTransport, playerId: String) {
        self.transport = transport
        self.playerId = playerId
        (outbox, outboxContinuation) = AsyncStream.makeStream()
    }

    /// `ws(s)://host/play/<gameId>?token=...` for a backend base URL; `version` pins a published version.
    public static func playURL(base: URL, gameId: String, token: String, version: Int? = nil) -> URL? {
        guard var parts = URLComponents(url: base, resolvingAgainstBaseURL: false) else { return nil }
        parts.scheme = parts.scheme == "https" ? "wss" : "ws"
        parts.path = (parts.path.hasSuffix("/") ? String(parts.path.dropLast()) : parts.path) + "/play/\(gameId)"
        var items = [URLQueryItem(name: "token", value: token)]
        if let version { items.append(URLQueryItem(name: "version", value: String(version))) }
        parts.queryItems = items
        return parts.url
    }

    /// Starts sending and receiving. Calling it twice does nothing.
    public func start() {
        let already = tasks.withLock { !$0.isEmpty }
        if already { return }
        state.withLock { $0.connected = true }
        let transport = transport
        let outbox = outbox
        let sender = Task { [weak self] in
            for await text in outbox {
                do { try await transport.send(text) } catch { self?.markLost(); return }
            }
        }
        let receiver = Task { [weak self] in
            while !Task.isCancelled {
                do {
                    let text = try await transport.receive()
                    self?.handle(text)
                } catch {
                    self?.markLost()
                    return
                }
            }
        }
        tasks.withLock { $0 = [sender, receiver] }
    }

    public func stop() {
        outboxContinuation.finish()
        tasks.withLock { list in
            list.forEach { $0.cancel() }
            list = []
        }
        transport.close()
        state.withLock { $0.connected = false }
    }

    /// False before `start`, after `stop`, and once the socket closed or a send failed.
    public var isConnected: Bool { state.withLock { $0.connected && !$0.lost } }
    /// True once the socket dropped without `stop` being called.
    public var connectionLost: Bool { state.withLock { $0.lost } }
    /// True after the server reloaded the session onto a newly published version.
    public var reloaded: Bool { state.withLock { $0.reloaded } }

    /// Everything the server sent since the last drain, in arrival order.
    public func drainIncoming() -> [RemoteEvent] {
        state.withLock { s in
            defer { s.incoming = [] }
            return s.incoming
        }
    }

    /// The queued events without removing them (tests wait on this before draining).
    func peekIncoming() -> [RemoteEvent] { state.withLock { $0.incoming } }

    // MARK: RemoteChannel

    public func fireToServer(_ event: RemoteEvent) {
        let data = (try? JSONSerialization.jsonObject(with: Data(event.data.utf8), options: .fragmentsAllowed)) ?? NSNull()
        guard let bytes = try? JSONSerialization.data(withJSONObject: ["name": event.name, "data": data]),
              let text = String(data: bytes, encoding: .utf8)
        else { return }
        outboxContinuation.yield(text)
    }

    /// Server-side only: a player's channel never routes events to other players.
    public func fire(to playerId: String, name: String, data: String) {}
    public func fireAll(name: String, data: String) {}

    // MARK: Frames

    private func markLost() {
        state.withLock { s in
            if s.connected { s.lost = true }
        }
    }

    private func handle(_ text: String) {
        guard let object = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
              let name = object["name"] as? String
        else { return }
        switch name {
        case "_welcome":
            return
        case "_reload":
            state.withLock { $0.reloaded = true }
        default:
            let payload = object["data"] ?? NSNull()
            let json = (try? JSONSerialization.data(withJSONObject: payload, options: .fragmentsAllowed))
                .flatMap { String(data: $0, encoding: .utf8) } ?? "null"
            state.withLock { $0.incoming.append(RemoteEvent(playerId: playerId, name: name, data: json)) }
        }
    }
}
