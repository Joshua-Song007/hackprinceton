import PearCloud

/// Where a game bundle comes from. `CloudClient` conforms; tests use a fake.
public protocol GameSource: Sendable {
    func fetchGame(id: String, version: Int?) async throws -> FetchedGame
}

extension CloudClient: GameSource {}

public struct LaunchResult: Sendable, Equatable {
    public var game: FetchedGame
    /// False while Play only fetches: nothing runs the game yet.
    public var started: Bool
    public init(game: FetchedGame, started: Bool) {
        self.game = game
        self.started = started
    }
}

/// The seam the runtime plugs into in the next round; today only `StubGameLauncher` implements it.
public protocol GameLauncher: Sendable {
    func launch(_ entry: CatalogEntry) async throws -> LaunchResult
}

public enum LaunchError: Error, Equatable {
    /// The server returned a different game or version than the one asked for.
    case mismatch
}

/// Fetches the catalog entry's latest version, records it, and stops: no runtime.
public actor StubGameLauncher: GameLauncher {
    public static let recentLimit = 10

    private let source: any GameSource
    public private(set) var lastLaunched: FetchedGame?
    /// Oldest first, capped at `recentLimit` (bundles carry base64 assets).
    public private(set) var recent: [FetchedGame] = []

    public init(source: any GameSource) {
        self.source = source
    }

    public func launch(_ entry: CatalogEntry) async throws -> LaunchResult {
        let game = try await source.fetchGame(id: entry.id, version: entry.latestVersion)
        guard game.gameId == entry.id, game.version == entry.latestVersion else {
            throw LaunchError.mismatch
        }
        lastLaunched = game
        recent.append(game)
        if recent.count > Self.recentLimit { recent.removeFirst(recent.count - Self.recentLimit) }
        return LaunchResult(game: game, started: false)
    }
}
