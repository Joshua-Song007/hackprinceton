import Foundation

/// A remote event travelling between a client script and a server script.
/// `data` is JSON text so the channel stays agnostic of the transport.
public struct RemoteEvent: Sendable, Equatable {
    /// Player the event comes from (client → server) or is addressed to (server → client).
    public let playerId: String
    public let name: String
    public let data: String

    public init(playerId: String, name: String, data: String = "null") {
        self.playerId = playerId
        self.name = name
        self.data = data
    }
}

/// Carries remote events between client scripts and server scripts. Studio's local test session
/// implements it in memory; a player's game-server connection implements it over the network.
/// Scripts cannot tell which.
public protocol RemoteChannel: AnyObject, Sendable {
    /// Client → server: a player's client script fires an event.
    func fireToServer(_ event: RemoteEvent)
    /// Server → one player.
    func fire(to playerId: String, name: String, data: String)
    /// Server → every player.
    func fireAll(name: String, data: String)
}
