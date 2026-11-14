import Foundation
import OmniCore
import WatchConnectivity

/// Receives Watch USIS packets (JSON `Data`, sent by `WatchRelay`) and forwards them over `BridgeClient`.
/// Undecodable messages are dropped; the Mac-side `PacketValidator` still validates what is forwarded.
///
/// `@unchecked Sendable`: immutable after init; `WCSession` delivers delegate calls on its own serial queue.
final class WatchConnectivityReceiver: NSObject, WCSessionDelegate, @unchecked Sendable {
    private let client: BridgeClient
    private let decoder = JSONDecoder()

    init(client: BridgeClient) {
        self.client = client
        super.init()
    }

    func start() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    // MARK: WCSessionDelegate

    func session(_ session: WCSession, didReceiveMessageData messageData: Data) {
        guard let packet = try? decoder.decode(UsisPacket.self, from: messageData) else { return }
        client.forward(packet)
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}

    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        session.activate() // required after a Watch switch
    }
}
