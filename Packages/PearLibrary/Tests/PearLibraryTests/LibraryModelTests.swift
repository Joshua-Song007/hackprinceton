import Foundation
import PearCloud
import Security
import Testing
@testable import PearLibrary

// MARK: Fakes

/// Returns queued results in order (an empty catalog once the queue runs out). With `gated`, a call waits
/// inside `listCatalog()` until `open()`, so a test can look at the model mid-request.
actor FakeCatalog: CatalogSource {
    private var queue: [Result<[CatalogEntry], any Error>]
    private let gated: Bool
    private(set) var calls = 0
    private var waiters: [CheckedContinuation<Void, Never>] = []
    private var isOpen = false

    init(_ queue: [Result<[CatalogEntry], any Error>] = [], gated: Bool = false) {
        self.queue = queue
        self.gated = gated
    }

    func listCatalog() async throws -> [CatalogEntry] {
        calls += 1
        if gated {
            await withCheckedContinuation { continuation in
                if isOpen { continuation.resume() } else { waiters.append(continuation) }
            }
        }
        let next: Result<[CatalogEntry], any Error> = queue.isEmpty ? .success([]) : queue.removeFirst()
        return try next.get()
    }

    func open() {
        isOpen = true
        for waiter in waiters { waiter.resume() }
        waiters = []
    }
}

actor FakeGameSource: GameSource {
    struct Request: Equatable, Sendable {
        let id: String
        let version: Int?
    }
    private(set) var requests: [Request] = []
    private let respond: @Sendable (String, Int?) throws -> FetchedGame

    init(_ respond: @escaping @Sendable (String, Int?) throws -> FetchedGame) {
        self.respond = respond
    }

    func fetchGame(id: String, version: Int?) async throws -> FetchedGame {
        requests.append(Request(id: id, version: version))
        return try respond(id, version)
    }
}

func entry(
    _ id: String, title: String = "Game", author: String = "Ada", version: Int = 1,
    mode: String = "screen", tier: Int = 1
) -> CatalogEntry {
    CatalogEntry(id: id, title: title, author: author, latestVersion: version, runMode: mode, requiredTier: tier)
}

func fetched(_ id: String, _ version: Int) -> FetchedGame {
    FetchedGame(gameId: id, version: version, bundle: GameBundle(title: "T", scene: .object([:])))
}

let phone = DeviceProfile(kind: .iPhone, model: "iPhone16,1", osVersion: "1")
let mac = DeviceProfile(kind: .mac, model: "Mac14,2", osVersion: "1")

/// Waits (bounded) until the fake has been called `count` times.
func waitForCalls(_ fake: FakeCatalog, _ count: Int) async {
    for _ in 0..<400 {
        if await fake.calls >= count { return }
        try? await Task.sleep(for: .milliseconds(5))
    }
    Issue.record("fake catalog was not called \(count) time(s)")
}

// MARK: Library model

@MainActor
struct LibraryModelTests {
    @Test func loadMovesThroughLoadingToLoaded() async {
        let catalog = FakeCatalog([.success([entry("a"), entry("b")])], gated: true)
        let model = LibraryModel(source: catalog, profile: phone)
        #expect(model.state == .idle)
        let task = Task { await model.load() }
        await waitForCalls(catalog, 1)
        #expect(model.state == .loading)
        #expect(model.isLoading)
        await catalog.open()
        await task.value
        #expect(model.state == .loaded)
        #expect(model.entries.map(\.id) == ["a", "b"])
        #expect(!model.isEmpty)
    }

    @Test func loadRunsOnceRefreshRefetches() async {
        let catalog = FakeCatalog([.success([entry("a")]), .success([entry("a"), entry("b")])])
        let model = LibraryModel(source: catalog, profile: phone)
        await model.load()
        await model.load()
        #expect(await catalog.calls == 1)
        await model.refresh()
        #expect(await catalog.calls == 2)
        #expect(model.entries.map(\.id) == ["a", "b"])
    }

    @Test func callsDuringLoadingAreIgnored() async {
        let catalog = FakeCatalog([.success([entry("a")])], gated: true)
        let model = LibraryModel(source: catalog, profile: phone)
        let task = Task { await model.load() }
        await waitForCalls(catalog, 1)
        // Safety valve: if the guard were missing, `refresh()` would wait on the gate forever. Opening it
        // after a second turns that hang into the failed `calls == 1` check below.
        let valve = Task {
            try? await Task.sleep(for: .seconds(1))
            await catalog.open()
        }
        defer { valve.cancel() }
        await model.refresh()
        await model.load()
        #expect(await catalog.calls == 1)
        await catalog.open()
        await task.value
        #expect(model.entries.map(\.id) == ["a"])
    }

    @Test func emptyCatalogIsLoadedAndEmpty() async {
        let model = LibraryModel(source: FakeCatalog([.success([])]), profile: phone)
        await model.load()
        #expect(model.state == .loaded)
        #expect(model.isEmpty)
        #expect(model.filtered.isEmpty)
    }

    // MARK: search

    @Test func searchMatchesTitleAndAuthorIgnoringCaseAndSpaces() async {
        let list = [
            entry("1", title: "Haunted House", author: "Ada"),
            entry("2", title: "Arena", author: "Grace Hopper"),
            entry("3", title: "Café", author: "Zed"),
        ]
        let model = LibraryModel(source: FakeCatalog([.success(list)]), profile: phone)
        await model.load()
        #expect(model.filtered.map(\.id) == ["1", "2", "3"])
        model.query = "haunt"
        #expect(model.filtered.map(\.id) == ["1"])
        model.query = "  HOPPER  "
        #expect(model.filtered.map(\.id) == ["2"])
        model.query = "ada"
        #expect(model.filtered.map(\.id) == ["1"])
        model.query = "cafe"
        #expect(model.filtered.map(\.id) == ["3"])
        model.query = "   "
        #expect(model.filtered.map(\.id) == ["1", "2", "3"])
        model.query = "zzz"
        #expect(model.filtered.isEmpty)
    }

    @Test func searchKeepsServerOrder() async {
        let list = [entry("3", title: "Box"), entry("1", title: "Box"), entry("2", title: "Box")]
        let model = LibraryModel(source: FakeCatalog([.success(list)]), profile: phone)
        await model.load()
        model.query = "box"
        #expect(model.filtered.map(\.id) == ["3", "1", "2"])
    }

    // MARK: errors

    @Test func signedOutErrors() async {
        for error in [CloudError.unauthorized, .notSignedIn] {
            let model = LibraryModel(source: FakeCatalog([.failure(error)]), profile: phone)
            await model.load()
            #expect(model.state == .failed(.signedOut), "\(error)")
        }
    }

    @Test func otherErrorsBecomeMessages() async {
        let cases: [(any Error, String)] = [
            (CloudError.transport("offline"), "offline"),
            (CloudError.server(status: 503, message: "secret body"), "The server returned an error (503)."),
            (CloudError.decoding("x"), "The server sent a response this app does not understand."),
            (CloudError.invalidResponse, "The server sent a response this app does not understand."),
            (CloudError.forbidden, "You do not have access to the library."),
            (CloudError.notFound, "The library was not found."),
        ]
        for (error, text) in cases {
            let model = LibraryModel(source: FakeCatalog([.failure(error)]), profile: phone)
            await model.load()
            #expect(model.state == .failed(.message(text)), "\(error)")
        }
    }

    @Test func failedRefreshKeepsEntriesAndLaterSuccessClearsFailure() async {
        let catalog = FakeCatalog([.success([entry("a")]), .failure(CloudError.transport("down")), .success([entry("b")])])
        let model = LibraryModel(source: catalog, profile: phone)
        await model.load()
        await model.refresh()
        #expect(model.state == .failed(.message("down")))
        #expect(model.entries.map(\.id) == ["a"])
        await model.refresh()
        #expect(model.state == .loaded)
        #expect(model.entries.map(\.id) == ["b"])
    }

    @Test func cancellationIsNotAFailure() async {
        let model = LibraryModel(source: FakeCatalog([.failure(CancellationError())]), profile: phone)
        await model.load()
        #expect(model.state == .idle)
        #expect(model.entries.isEmpty)
    }

    @Test func cancelledTaskWithTransportErrorIsNotAFailure() async {
        // `CloudClient` reports URLError.cancelled as `.transport`, so the model also checks the task.
        let catalog = FakeCatalog([.failure(CloudError.transport("cancelled"))], gated: true)
        let model = LibraryModel(source: catalog, profile: phone)
        let task = Task { await model.load() }
        await waitForCalls(catalog, 1)
        task.cancel()
        await catalog.open()
        await task.value
        #expect(model.state == .idle)
    }

    @Test func cancelledRefreshRestoresThePreviousState() async {
        let catalog = FakeCatalog([.success([entry("a")]), .failure(CancellationError())])
        let model = LibraryModel(source: catalog, profile: phone)
        await model.load()
        await model.refresh()
        #expect(model.state == .loaded)
        #expect(model.entries.map(\.id) == ["a"])
    }

    @Test func resetClearsEverything() async {
        let model = LibraryModel(source: FakeCatalog([.success([entry("a")])]), profile: phone)
        await model.load()
        model.query = "a"
        model.reset()
        #expect(model.entries.isEmpty)
        #expect(model.query.isEmpty)
        #expect(model.state == .idle)
    }

    @Test func resetWhileFetchingDropsTheLateResult() async {
        let catalog = FakeCatalog([.success([entry("old-user-game")])], gated: true)
        let model = LibraryModel(source: catalog, profile: phone)
        let task = Task { await model.load() }
        await waitForCalls(catalog, 1)
        model.reset()
        await catalog.open()
        await task.value
        #expect(model.entries.isEmpty)
        #expect(model.state == .idle)
    }

    @Test func resetWhileFetchingDropsALateFailureToo() async {
        let catalog = FakeCatalog([.failure(CloudError.unauthorized)], gated: true)
        let model = LibraryModel(source: catalog, profile: phone)
        let task = Task { await model.load() }
        await waitForCalls(catalog, 1)
        model.reset()
        await catalog.open()
        await task.value
        #expect(model.state == .idle)
    }

    // MARK: playability

    @Test func playabilityGoesThroughTheProfile() {
        let deviceGame = entry("d", mode: "device")
        let screenGame = entry("s", mode: "screen")
        let onPhone = LibraryModel(source: FakeCatalog(), profile: phone)
        #expect(onPhone.playability(of: deviceGame) == .playable)
        #expect(onPhone.playability(of: screenGame) == .playable)
        #expect(onPhone.playability(of: entry("t", tier: 3)) == .needsTier(3))
        let onMac = LibraryModel(source: FakeCatalog(), profile: mac)
        #expect(onMac.playability(of: deviceGame) == .needsPhone)
        #expect(onMac.playability(of: screenGame) == .needsController)
    }
}

// MARK: Launcher

struct StubGameLauncherTests {
    @Test func fetchesTheLatestVersionAndRecords() async throws {
        let source = FakeGameSource { id, version in fetched(id, version ?? 0) }
        let launcher = StubGameLauncher(source: source)
        let result = try await launcher.launch(entry("g1", version: 4))
        #expect(result.game == fetched("g1", 4))
        #expect(!result.started)
        #expect(await source.requests == [.init(id: "g1", version: 4)])
        #expect(await launcher.lastLaunched == fetched("g1", 4))
        #expect(await launcher.recent == [fetched("g1", 4)])
    }

    @Test func wrongGameOrVersionIsRejectedAndNotRecorded() async {
        let wrongGame = StubGameLauncher(source: FakeGameSource { _, version in fetched("other", version ?? 0) })
        await #expect(throws: LaunchError.mismatch) { try await wrongGame.launch(entry("g1", version: 2)) }
        #expect(await wrongGame.lastLaunched == nil)
        #expect(await wrongGame.recent.isEmpty)
        let wrongVersion = StubGameLauncher(source: FakeGameSource { id, _ in fetched(id, 99) })
        await #expect(throws: LaunchError.mismatch) { try await wrongVersion.launch(entry("g1", version: 2)) }
        #expect(await wrongVersion.lastLaunched == nil)
    }

    @Test func fetchErrorsPropagateUnchanged() async {
        let launcher = StubGameLauncher(source: FakeGameSource { _, _ in throw CloudError.notFound })
        await #expect(throws: CloudError.notFound) { try await launcher.launch(entry("g1")) }
        #expect(await launcher.lastLaunched == nil)
    }

    @Test func recentIsCappedAtTheLimit() async throws {
        let launcher = StubGameLauncher(source: FakeGameSource { id, version in fetched(id, version ?? 0) })
        for index in 1...(StubGameLauncher.recentLimit + 3) {
            _ = try await launcher.launch(entry("g\(index)", version: index))
        }
        let recent = await launcher.recent
        #expect(recent.count == StubGameLauncher.recentLimit)
        #expect(recent.first?.gameId == "g4")
        #expect(recent.last?.gameId == "g13")
        #expect(await launcher.lastLaunched?.gameId == "g13")
    }
}

// MARK: Session stores

struct SessionStoreTests {
    let session = StoredSession(token: "s1", account: Account(id: "a1", displayName: "Ada"))

    func exercise(_ store: any SessionStore) throws {
        #expect(try store.load() == nil)
        try store.save(session)
        #expect(try store.load() == session)
        let other = StoredSession(token: "s2", account: Account(id: "a2", displayName: "Grace"))
        try store.save(other)
        #expect(try store.load() == other)
        try store.clear()
        #expect(try store.load() == nil)
        try store.clear()
    }

    @Test func inMemoryStore() throws {
        try exercise(InMemorySessionStore())
    }

    @Test func keychainStoreRoundTrip() throws {
        let store = KeychainSessionStore(service: "pear.test.\(UUID().uuidString)")
        defer { try? store.clear() }
        try exercise(store)
    }

    @Test func keychainStoresAreIsolatedByService() throws {
        let one = KeychainSessionStore(service: "pear.test.\(UUID().uuidString)")
        let two = KeychainSessionStore(service: "pear.test.\(UUID().uuidString)")
        defer { try? one.clear(); try? two.clear() }
        try one.save(session)
        #expect(try two.load() == nil)
    }

    @Test func undecodableKeychainDataIsClearedAndReadAsSignedOut() throws {
        let service = "pear.test.\(UUID().uuidString)"
        let store = KeychainSessionStore(service: service)
        defer { try? store.clear() }
        var add = KeychainSessionStore.baseQuery(service: service, account: "session")
        add[kSecValueData as String] = Data("not json".utf8)
        #expect(SecItemAdd(add as CFDictionary, nil) == errSecSuccess)
        #expect(try store.load() == nil)
        // The item itself is gone, not just ignored.
        let lookup = KeychainSessionStore.baseQuery(service: service, account: "session")
        #expect(SecItemCopyMatching(lookup as CFDictionary, nil) == errSecItemNotFound)
        try store.save(session)
        #expect(try store.load() == session)
    }
}
