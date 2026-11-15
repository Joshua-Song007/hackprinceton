import Foundation
import PearCore
import WatchConnectivity

/// Watch -> phone link. Stamps USIS envelopes for the Watch and sends each packet as JSON `Data`
/// through WatchConnectivity; the phone's `WatchConnectivityReceiver` forwards them over `BridgeClient`.
///
/// Live data is only useful fresh, so a packet is dropped when the phone is not reachable instead
/// of being queued.
///
/// `@unchecked Sendable`: `seq` and the encoder are touched only on `queue`; `WCSession` is thread-safe.
final class WatchRelay: NSObject, WCSessionDelegate, @unchecked Sendable {
    // Provisional: slot `leftWrist` (the player's wrist is not known); [provisional: needs-tien-review]
    static let slot: Slot = .leftWrist

    let deviceId: String
    private let queue = DispatchQueue(label: "pear.companion.watchrelay")
    private let onReachability: @Sendable (Bool) -> Void
    private let encoder = JSONEncoder()
    private var seq = 0

    init(deviceId: String = "watch-1", onReachability: @escaping @Sendable (Bool) -> Void = { _ in }) {
        self.deviceId = deviceId
        self.onReachability = onReachability
        super.init()
    }

    func start() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    /// Sends one packet carrying `channels`. `t` is device-clock milliseconds (Watch uptime).
    func send(_ channels: UsisChannels, at t: Int64) {
        queue.async { [self] in
            let session = WCSession.default
            guard session.activationState == .activated, session.isReachable else { return }
            seq += 1
            let packet = UsisPacket(
                deviceId: deviceId, kind: .watch, slot: Self.slot,
                source: .live, t: t, seq: seq, ch: channels
            )
            guard let data = try? encoder.encode(packet) else { return }
            session.sendMessageData(data, replyHandler: nil, errorHandler: nil)
        }
    }

    // MARK: WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        onReachability(activationState == .activated && session.isReachable)
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        onReachability(session.isReachable)
    }
}
