import PearCloud
import PearLibrary

/// Fetches the catalog entry's latest version and checks it is the one asked for. The view then builds a
/// `GameSession` from the result, so `started` is true: unlike `StubGameLauncher` this hands off to a runtime.
actor RuntimeGameLauncher: GameLauncher {
    private let source: any GameSource

    init(source: any GameSource) {
        self.source = source
    }

    func launch(_ entry: CatalogEntry) async throws -> LaunchResult {
        let game = try await source.fetchGame(id: entry.id, version: entry.latestVersion)
        guard game.gameId == entry.id, game.version == entry.latestVersion else { throw LaunchError.mismatch }
        return LaunchResult(game: game, started: true)
    }
}
