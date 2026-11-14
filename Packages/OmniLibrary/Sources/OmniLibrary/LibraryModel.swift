import Foundation
import Observation
import OmniCloud

/// Where the library reads the catalog from. `CloudClient` conforms; tests use a fake.
public protocol CatalogSource: Sendable {
    func listCatalog() async throws -> [CatalogEntry]
}

extension CloudClient: CatalogSource {}

public enum LibraryFailure: Sendable, Equatable {
    /// The session is missing or was rejected: the app should send the player to sign in.
    case signedOut
    case message(String)
}

/// Browse state for the game library: the catalog, a search query and per-entry playability.
@MainActor
@Observable
public final class LibraryModel {
    public enum State: Sendable, Equatable {
        case idle
        case loading
        case loaded
        case failed(LibraryFailure)
    }

    /// Server order: most recently published first.
    public private(set) var entries: [CatalogEntry] = []
    public var query = ""
    public private(set) var state: State = .idle
    public let profile: DeviceProfile

    private let source: any CatalogSource
    // Bumped by `reset()`; a fetch that started before the bump drops its result.
    @ObservationIgnored private var generation = 0

    public init(source: any CatalogSource, profile: DeviceProfile) {
        self.source = source
        self.profile = profile
    }

    public var isEmpty: Bool { entries.isEmpty }
    public var isLoading: Bool { state == .loading }

    /// Entries matching `query` in title or author (case and diacritic insensitive); order is never changed.
    public var filtered: [CatalogEntry] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return entries }
        return entries.filter {
            $0.title.localizedStandardContains(trimmed) || $0.author.localizedStandardContains(trimmed)
        }
    }

    public func playability(of entry: CatalogEntry) -> Playability {
        Playability.evaluate(entry, on: profile)
    }

    /// First load only; later reloads go through `refresh()`.
    public func load() async {
        guard state == .idle else { return }
        await fetch()
    }

    public func refresh() async {
        guard state != .loading else { return }
        await fetch()
    }

    /// Sign-out: forget everything, including any request still in flight.
    public func reset() {
        generation += 1
        entries = []
        query = ""
        state = .idle
    }

    private func fetch() async {
        let previous = state
        let started = generation
        state = .loading
        do {
            let result = try await source.listCatalog()
            guard started == generation else { return }
            entries = result
            state = .loaded
        } catch {
            guard started == generation else { return }
            // A cancelled view task is not a failure; `CloudClient` reports URLError.cancelled as `.transport`.
            if error is CancellationError || Task.isCancelled {
                state = previous
                return
            }
            state = .failed(Self.failure(for: error))
        }
    }

    private static func failure(for error: Error) -> LibraryFailure {
        guard let cloud = error as? CloudError else { return .message(error.localizedDescription) }
        switch cloud {
        case .unauthorized, .notSignedIn: return .signedOut
        case .transport(let text): return .message(text)
        case .server(let status, _): return .message("The server returned an error (\(status)).")
        case .decoding, .invalidResponse: return .message("The server sent a response this app does not understand.")
        case .forbidden: return .message("You do not have access to the library.")
        case .notFound: return .message("The library was not found.")
        }
    }
}
