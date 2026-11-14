import Foundation
import Testing
@testable import OmniCloud

final class StubProtocol: URLProtocol {
    typealias Handler = @Sendable (URLRequest) -> (Int, Data)
    // Shared by URLProtocol instances the system creates; the suite is .serialized, so only one test touches it at a time.
    nonisolated(unsafe) static var handler: Handler?
    nonisolated(unsafe) static var seen: [URLRequest] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        var req = request
        if req.httpBody == nil, let stream = req.httpBodyStream {
            stream.open()
            var data = Data()
            var buf = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let n = stream.read(&buf, maxLength: buf.count)
                if n <= 0 { break }
                data.append(buf, count: n)
            }
            stream.close()
            req.httpBody = data
        }
        Self.seen.append(req)
        let (status, body) = Self.handler?(req) ?? (500, Data())
        let response = HTTPURLResponse(url: req.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@Suite(.serialized)
struct CloudClientTests {
    let base = URL(string: "https://omni.test")!

    func makeClient(_ handler: @escaping StubProtocol.Handler) -> CloudClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        StubProtocol.handler = handler
        StubProtocol.seen = []
        return CloudClient(baseURL: base, session: URLSession(configuration: config))
    }

    static let signInBody = Data(#"{"sessionToken":"s1","account":{"id":"a1","displayName":"Ada"}}"#.utf8)
    let bundle = GameBundle(
        title: "T", runMode: "device", scene: .object(["entities": .array([.number(1), .null])]),
        clientScripts: [ScriptSource(name: "enemy", source: "x")],
        serverScripts: [ScriptSource(name: "game", source: "y")],
        assets: [AssetFile(name: "a.png", contentType: "image/png", data: Data([1, 2, 3]))])

    @Test func signInStoresSessionAndSendsToken() async throws {
        let client = makeClient { _ in (200, Self.signInBody) }
        let account = try await client.signIn(token: "tok")
        #expect(account == Account(id: "a1", displayName: "Ada"))
        #expect(await client.isSignedIn)
        let req = StubProtocol.seen[0]
        #expect(req.url?.path == "/v1/session")
        #expect(req.value(forHTTPHeaderField: "Authorization") == nil)
        #expect(String(decoding: req.httpBody ?? Data(), as: UTF8.self) == #"{"token":"tok"}"#)
    }

    @Test func publishRequiresSignIn() async {
        let client = makeClient { _ in (200, Data()) }
        await #expect(throws: CloudError.notSignedIn) { try await client.publish(bundle) }
        #expect(StubProtocol.seen.isEmpty)
    }

    @Test func publishEncodesBundleAndDecodesVersion() async throws {
        let client = makeClient { req in
            req.url?.path == "/v1/session" ? (200, Self.signInBody)
                : (200, Data(#"{"gameId":"g1","version":3}"#.utf8))
        }
        try await client.signIn(token: "tok")
        let published = try await client.publish(bundle, gameId: "g1")
        #expect(published == PublishedVersion(gameId: "g1", version: 3))
        let req = StubProtocol.seen[1]
        #expect(req.httpMethod == "POST")
        #expect(req.url?.path == "/v1/games/g1/versions")
        #expect(req.value(forHTTPHeaderField: "Authorization") == "Bearer s1")
        let sent = try JSONDecoder().decode(GameBundle.self, from: req.httpBody ?? Data())
        #expect(sent == bundle)
    }

    @Test func publishNewGameUsesGamesRoute() async throws {
        let client = makeClient { req in
            req.url?.path == "/v1/session" ? (200, Self.signInBody)
                : (200, Data(#"{"gameId":"g9","version":1}"#.utf8))
        }
        try await client.signIn(token: "tok")
        _ = try await client.publish(bundle)
        #expect(StubProtocol.seen[1].url?.path == "/v1/games")
    }

    @Test func listAndFetch() async throws {
        let fetched = FetchedGame(gameId: "g1", version: 2, bundle: bundle)
        let fetchedData = try JSONEncoder().encode(fetched)
        let client = makeClient { req in
            switch req.url?.path {
            case "/v1/session": return (200, Self.signInBody)
            case "/v1/games": return (200, Data(#"{"games":[{"id":"g1","title":"T","latestVersion":2}]}"#.utf8))
            default: return (200, fetchedData)
            }
        }
        try await client.signIn(token: "tok")
        #expect(try await client.listGames() == [GameSummary(id: "g1", title: "T", latestVersion: 2)])
        #expect(try await client.fetchGame(id: "g1") == fetched)
        #expect(StubProtocol.seen[2].url?.path == "/v1/games/g1/versions/latest")
        _ = try await client.fetchGame(id: "g1", version: 2)
        #expect(StubProtocol.seen[3].url?.path == "/v1/games/g1/versions/2")
    }

    @Test func unauthorizedSurfacesAsErrorAndClearsSession() async throws {
        let client = makeClient { req in
            req.url?.path == "/v1/session" ? (200, Self.signInBody) : (401, Data())
        }
        try await client.signIn(token: "tok")
        await #expect(throws: CloudError.unauthorized) { try await client.listGames() }
        #expect(await !client.isSignedIn)
    }

    @Test func badTokenOnSignInIsUnauthorized() async {
        let client = makeClient { _ in (401, Data()) }
        await #expect(throws: CloudError.unauthorized) { try await client.signIn(token: "bad") }
        #expect(await !client.isSignedIn)
    }

    @Test func forbiddenNotFoundAndServerErrors() async throws {
        let status = StatusBox()
        let client = makeClient { req in
            req.url?.path == "/v1/session" ? (200, Self.signInBody) : (status.value, Data("boom".utf8))
        }
        try await client.signIn(token: "tok")
        status.value = 403
        await #expect(throws: CloudError.forbidden) { try await client.publish(bundle, gameId: "other") }
        status.value = 404
        await #expect(throws: CloudError.notFound) { try await client.fetchGame(id: "zz") }
        status.value = 500
        await #expect(throws: CloudError.server(status: 500, message: "boom")) { try await client.listGames() }
    }

    @Test func malformedBodyIsDecodingError() async throws {
        let client = makeClient { req in
            req.url?.path == "/v1/session" ? (200, Self.signInBody) : (200, Data("nope".utf8))
        }
        try await client.signIn(token: "tok")
        do {
            _ = try await client.listGames()
            Issue.record("expected decoding error")
        } catch let error as CloudError {
            guard case .decoding = error else { Issue.record("wrong error \(error)"); return }
        }
    }
}

final class StatusBox: @unchecked Sendable {
    // Only mutated between awaited calls on one test task, so no concurrent access.
    var value = 200
}
