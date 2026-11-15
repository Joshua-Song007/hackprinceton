import Foundation
import Testing
@testable import PearCloud

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
    let base = URL(string: "https://pear.test")!

    func makeClient(_ handler: @escaping StubProtocol.Handler) -> CloudClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        StubProtocol.handler = handler
        StubProtocol.seen = []
        return CloudClient(baseURL: base, session: URLSession(configuration: config))
    }

    // Shapes as Backend/src/db.rs serializes them.
    static let accountJSON = #"{"id":"a1","provider":"dev","subject":"Ada","display_name":"Ada","created_at":"t"}"#
    static let signInBody = Data(#"{"token":"s1","account":\#(accountJSON)}"#.utf8)
    static let signInPath = "/api/accounts/signin"
    let bundle = GameBundle(
        title: "T", runMode: "device", scene: .object(["entities": .array([.number(1), .null])]),
        clientScripts: [ScriptSource(name: "enemy", source: "x")],
        serverScripts: [ScriptSource(name: "game", source: "y")],
        assets: [AssetFile(name: "a.png", contentType: "image/png", data: Data([1, 2, 3]))])

    static func versionJSON(game: String, version: Int, metadata: String = #"{"title":"T"}"#) -> Data {
        Data(#"""
        {"id":"v","game_id":"\#(game)","version":\#(version),"scene":{"entities":[1,null]},
         "client_scripts":{"enemy":"x"},"server_scripts":{"game":"y"},
         "assets":{"a.png":{"contentType":"image/png","data":"AQID"}},
         "metadata":\#(metadata),"run_mode":"device","published_at":"t"}
        """#.utf8)
    }

    @Test func devSignInStoresSessionAndSendsNoToken() async throws {
        let client = makeClient { _ in (200, Self.signInBody) }
        let account = try await client.signInDev(name: "Ada")
        #expect(account == Account(id: "a1", displayName: "Ada"))
        #expect(await client.isSignedIn)
        let req = StubProtocol.seen[0]
        #expect(req.httpMethod == "POST")
        #expect(req.url?.path == Self.signInPath)
        #expect(req.value(forHTTPHeaderField: "Authorization") == nil)
        let sent = try JSONSerialization.jsonObject(with: req.httpBody ?? Data()) as? [String: String]
        #expect(sent == ["provider": "dev", "subject": "Ada", "display_name": "Ada"])
    }

    @Test func pastedTokenIsCheckedWithMe() async throws {
        let client = makeClient { _ in (200, Data(Self.accountJSON.utf8)) }
        let account = try await client.signIn(token: "tok")
        #expect(account == Account(id: "a1", displayName: "Ada"))
        #expect(StubProtocol.seen[0].url?.path == "/api/accounts/me")
        #expect(StubProtocol.seen[0].value(forHTTPHeaderField: "Authorization") == "Bearer tok")
        #expect(await client.isSignedIn)
    }

    @Test func publishRequiresSignIn() async {
        let client = makeClient { _ in (200, Data()) }
        await #expect(throws: CloudError.notSignedIn) { try await client.publish(bundle) }
        #expect(StubProtocol.seen.isEmpty)
    }

    @Test func publishEncodesBackendShapeAndDecodesVersion() async throws {
        let client = makeClient { req in
            req.url?.path == Self.signInPath ? (200, Self.signInBody) : (201, Self.versionJSON(game: "g1", version: 3))
        }
        try await client.signInDev(name: "Ada")
        let published = try await client.publish(bundle, gameId: "g1")
        #expect(published == PublishedVersion(gameId: "g1", version: 3))
        let req = StubProtocol.seen[1]
        #expect(req.httpMethod == "POST")
        #expect(req.url?.path == "/api/games/g1/versions")
        #expect(req.value(forHTTPHeaderField: "Authorization") == "Bearer s1")
        let sent = try #require(try JSONSerialization.jsonObject(with: req.httpBody ?? Data()) as? [String: Any])
        #expect(sent["run_mode"] as? String == "device")
        #expect(sent["client_scripts"] as? [String: String] == ["enemy": "x"])
        #expect(sent["server_scripts"] as? [String: String] == ["game": "y"])
        #expect(sent["metadata"] as? [String: String] == ["title": "T"])
        #expect(sent["scene"] is [String: Any])
        let asset = (sent["assets"] as? [String: Any])?["a.png"] as? [String: String]
        #expect(asset == ["contentType": "image/png", "data": "AQID"])
    }

    @Test func publishNewGameCreatesItFirst() async throws {
        let client = makeClient { req in
            switch req.url?.path {
            case Self.signInPath: return (200, Self.signInBody)
            case "/api/games": return (201, Data(#"{"id":"g9","owner_id":"a1","title":"T","created_at":"t","updated_at":"t"}"#.utf8))
            default: return (201, Self.versionJSON(game: "g9", version: 1))
            }
        }
        try await client.signInDev(name: "Ada")
        #expect(try await client.publish(bundle) == PublishedVersion(gameId: "g9", version: 1))
        #expect(StubProtocol.seen[1].url?.path == "/api/games")
        #expect(String(decoding: StubProtocol.seen[1].httpBody ?? Data(), as: UTF8.self) == #"{"title":"T"}"#)
        #expect(StubProtocol.seen[2].url?.path == "/api/games/g9/versions")
    }

    @Test func listAndFetch() async throws {
        let client = makeClient { req in
            switch req.url?.path {
            case Self.signInPath: return (200, Self.signInBody)
            case "/api/games": return (200, Data(#"""
                [{"id":"g1","owner_id":"a1","title":"T","created_at":"t","updated_at":"t"},
                 {"id":"g2","owner_id":"a1","title":"Draft","created_at":"t","updated_at":"t"}]
                """#.utf8))
            case "/api/library": return (200, Data(#"""
                [{"id":"g1","title":"T","author":"Ada","latestVersion":2,"runMode":"device","requiredTier":1}]
                """#.utf8))
            default: return (200, Self.versionJSON(game: "g1", version: 2))
            }
        }
        try await client.signInDev(name: "Ada")
        #expect(try await client.listGames() == [
            GameSummary(id: "g1", title: "T", latestVersion: 2), GameSummary(id: "g2", title: "Draft", latestVersion: 0),
        ])
        #expect(try await client.fetchGame(id: "g1") == FetchedGame(gameId: "g1", version: 2, bundle: bundle))
        #expect(StubProtocol.seen[3].url?.path == "/api/games/g1/versions/latest")
        _ = try await client.fetchGame(id: "g1", version: 2)
        #expect(StubProtocol.seen[4].url?.path == "/api/games/g1/versions/2")
    }

    @Test func webStudioVersionTakesTitleFromMetadataName() async throws {
        let client = makeClient { req in
            req.url?.path == Self.signInPath ? (200, Self.signInBody)
                : (200, Self.versionJSON(game: "g1", version: 1, metadata: #"{"name":"Web","source":"pear-studio"}"#))
        }
        try await client.signInDev(name: "Ada")
        #expect(try await client.fetchGame(id: "g1").bundle.title == "Web")
    }

    @Test func unauthorizedSurfacesAsErrorAndClearsSession() async throws {
        let client = makeClient { req in
            req.url?.path == Self.signInPath ? (200, Self.signInBody) : (401, Data())
        }
        try await client.signInDev(name: "Ada")
        await #expect(throws: CloudError.unauthorized) { try await client.listGames() }
        #expect(await !client.isSignedIn)
    }

    @Test func badTokenOnSignInIsUnauthorized() async {
        let client = makeClient { _ in (401, Data()) }
        await #expect(throws: CloudError.unauthorized) { try await client.signIn(token: "bad") }
        #expect(await !client.isSignedIn)
        await #expect(throws: CloudError.unauthorized) { try await client.signInDev(name: "Ada") }
        #expect(await !client.isSignedIn)
    }

    @Test func forbiddenNotFoundAndServerErrors() async throws {
        let status = StatusBox()
        let client = makeClient { req in
            req.url?.path == Self.signInPath ? (200, Self.signInBody) : (status.value, Data("boom".utf8))
        }
        try await client.signInDev(name: "Ada")
        status.value = 403
        await #expect(throws: CloudError.forbidden) { try await client.publish(bundle, gameId: "other") }
        status.value = 404
        await #expect(throws: CloudError.notFound) { try await client.fetchGame(id: "zz") }
        status.value = 500
        await #expect(throws: CloudError.server(status: 500, message: "boom")) { try await client.listGames() }
    }

    @Test func malformedBodyIsDecodingError() async throws {
        let client = makeClient { req in
            req.url?.path == Self.signInPath ? (200, Self.signInBody) : (200, Data("nope".utf8))
        }
        try await client.signInDev(name: "Ada")
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
