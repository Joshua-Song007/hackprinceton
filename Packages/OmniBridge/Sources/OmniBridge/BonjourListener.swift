import Foundation
import Network
import Synchronization

/// Lifecycle of a `BonjourListener`, reported through its state callback.
public enum BonjourListenerState: Sendable, Equatable {
    case stopped
    case starting
    case ready(port: UInt16?)
    case failed(String)
}

/// Advertises the Omni Bonjour service on the local network and hands each accepted
/// connection to a callback. It owns no session logic: `DeviceSession` takes over the connection.
public final class BonjourListener: Sendable {
    /// Production service type. [provisional: needs-tien-review] (the probe used `_omniprobe._tcp`).
    public static let serviceType = "_omni._tcp"

    private struct Inner {
        var listener: NWListener?
    }

    private let inner = Mutex(Inner())
    private let queue = DispatchQueue(label: "omni.bridge.bonjour-listener")
    private let serviceName: String?
    private let onConnection: @Sendable (NWConnection) -> Void
    private let onState: @Sendable (BonjourListenerState) -> Void

    /// - Parameters:
    ///   - serviceName: Bonjour instance name; nil uses the Mac's name.
    ///   - onConnection: receives every accepted connection, not yet started.
    ///   - onState: lifecycle and failure reports; called on an internal queue.
    public init(
        serviceName: String? = nil,
        onConnection: @escaping @Sendable (NWConnection) -> Void,
        onState: @escaping @Sendable (BonjourListenerState) -> Void = { _ in }
    ) {
        self.serviceName = serviceName
        self.onConnection = onConnection
        self.onState = onState
    }

    /// Starts advertising. Does nothing if already started.
    public func start() {
        let created: NWListener? = inner.withLock { state in
            if state.listener != nil { return nil }
            let tcp = NWProtocolTCP.Options()
            tcp.noDelay = true
            let parameters = NWParameters(tls: nil, tcp: tcp)
            parameters.includePeerToPeer = false
            parameters.prohibitedInterfaceTypes = [.cellular]
            guard let listener = try? NWListener(using: parameters) else { return nil }
            state.listener = listener
            return listener
        }
        guard let listener = created else {
            let alreadyRunning = inner.withLock { $0.listener != nil }
            if !alreadyRunning { onState(.failed("could not create listener")) }
            return
        }
        listener.service = NWListener.Service(name: serviceName, type: Self.serviceType)
        let onConnection = self.onConnection
        let onState = self.onState
        listener.newConnectionHandler = { connection in onConnection(connection) }
        listener.stateUpdateHandler = { [weak self, weak listener] newState in
            switch newState {
            case .setup, .waiting:
                onState(.starting)
            case .ready:
                onState(.ready(port: listener?.port?.rawValue))
            case .failed(let error):
                onState(.failed(String(describing: error)))
                self?.discard(listener)
            case .cancelled:
                onState(.stopped)
            @unknown default:
                break
            }
        }
        onState(.starting)
        listener.start(queue: queue)
    }

    /// Stops advertising and stops accepting. Does nothing if not started.
    public func stop() {
        let existing = inner.withLock { state -> NWListener? in
            let current = state.listener
            state.listener = nil
            return current
        }
        existing?.cancel()
    }

    /// Forgets a failed listener so `start()` can create a fresh one.
    private func discard(_ failed: NWListener?) {
        guard let failed else { return }
        inner.withLock { state in
            if state.listener === failed { state.listener = nil }
        }
        failed.cancel()
    }
}
