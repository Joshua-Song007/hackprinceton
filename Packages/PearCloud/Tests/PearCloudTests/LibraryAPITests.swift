import Foundation
import Testing
@testable import PearCloud

// Its own stub, not `StubProtocol`: that one's statics are shared, and Swift Testing runs separate suites in
// parallel (`.serialized` only orders the tests inside one suite).
final class LibraryStub: URLProtocol {
    typealias Handler = @Sendable (URLRequest) -> (Int, Data)
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
struct LibraryAPITests {
    let base = URL(string: "https://pear.test")!

    func makeClient(_ handler: @escaping LibraryStub.Handler) -> CloudClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [LibraryStub.self]
        LibraryStub.handler = handler
        LibraryStub.seen = []
        return CloudClient(baseURL: base, session: URLSession(configuration: config))
    }

    // The backend's real sign-in response: `token`, and an account with snake_case `display_name` plus extra fields.
    static let appleBody = Data(
        #"{"token":"s1","account":{"id":"a1","provider":"apple","subject":"sub","display_name":"Ada","created_at":"t"}}"#
            .utf8)

    static let catalogBody = Data(
        #"""
        [
          {"id":"g1","title":"Haunt","author":"Ada","latestVersion":3,"runMode":"device","requiredTier":1,"extra":true},
          {"id":"g2","title":"Arena","author":"","latestVersion":1,"runMode":"screen","requiredTier":3}
        ]
        """#.utf8)

    /// A client that already signed in with Apple; later requests get `handler`.
    func signedInClient(_ handler: @escaping LibraryStub.Handler) async throws -> CloudClient {
        let client = makeClient { req in
            req.url?.path == "/api/accounts/apple" ? (200, Self.appleBody) : handler(req)
        }
        try await client.signInWithApple(identityToken: "jwt", displayName: "Ada")
        return client
    }

    func jsonBody(_ req: URLRequest) throws -> [String: String] {
        let object = try JSONSerialization.jsonObject(with: req.httpBody ?? Data())
        return try #require(object as? [String: String])
    }

    // MARK: Sign in with Apple

    @Test func appleSignInSendsTokenAndName() async throws {
        let client = makeClient { _ in (200, Self.appleBody) }
        let account = try await client.signInWithApple(identityToken: "jwt", displayName: "Ada Lovelace")
        #expect(account == Account(id: "a1", displayName: "Ada"))
        #expect(await client.account == account)
        #expect(await client.isSignedIn)
        let req = LibraryStub.seen[0]
        #expect(req.httpMethod == "POST")
        #expect(req.url?.path == "/api/accounts/apple")
        #expect(req.value(forHTTPHeaderField: "Authorization") == nil)
        #expect(req.value(forHTTPHeaderField: "Content-Type") == "application/json")
        #expect(try jsonBody(req) == ["identityToken": "jwt", "displayName": "Ada Lovelace"])
    }

    @Test func appleSignInOmitsNilName() async throws {
        let client = makeClient { _ in (200, Self.appleBody) }
        try await client.signInWithApple(identityToken: "jwt", displayName: nil)
        #expect(try jsonBody(LibraryStub.seen[0]) == ["identityToken": "jwt"])
    }

    @Test func appleSignInBadTokenIsUnauthorized() async {
        let client = makeClient { _ in (401, Data()) }
        await #expect(throws: CloudError.unauthorized) { try await client.signInWithApple(identityToken: "bad") }
        #expect(await !client.isSignedIn)
        #expect(await client.account == nil)
    }

    @Test func appleSignInServerStatuses() async {
        for status in [400, 502, 503] {
            let client = makeClient { _ in (status, Data("why".utf8)) }
            await #expect(throws: CloudError.server(status: status, message: "why")) {
                try await client.signInWithApple(identityToken: "jwt")
            }
            #expect(await !client.isSignedIn)
        }
    }

    @Test func appleSignInMalformedBodyIsDecodingError() async {
        let noToken = Data(#"{"account":{"id":"a1","display_name":"Ada"}}"#.utf8)
        for body in [Data("nope".utf8), noToken] {
            let client = makeClient { _ in (200, body) }
            do {
                try await client.signInWithApple(identityToken: "jwt")
                Issue.record("expected decoding error")
            } catch let error as CloudError {
                guard case .decoding = error else { Issue.record("wrong error \(error)"); continue }
            } catch {
                Issue.record("wrong error \(error)")
            }
            #expect(await !client.isSignedIn)
        }
    }

    @Test func sessionTokenIsReadableAfterSignIn() async throws {
        let client = makeClient { req in req.url?.path == "/api/library" ? (401, Data()) : (200, Self.appleBody) }
        #expect(await client.sessionToken == nil)
        try await client.signInWithApple(identityToken: "jwt")
        #expect(await client.sessionToken == "s1")
        await client.signOut()
        #expect(await client.sessionToken == nil)
        try await client.signInWithApple(identityToken: "jwt")
        await #expect(throws: CloudError.unauthorized) { try await client.listCatalog() }
        #expect(await client.sessionToken == nil)
    }

    // MARK: Catalog

    @Test func listCatalogRequiresSignIn() async {
        let client = makeClient { _ in (200, Self.catalogBody) }
        await #expect(throws: CloudError.notSignedIn) { try await client.listCatalog() }
        #expect(LibraryStub.seen.isEmpty)
    }

    @Test func listCatalogDecodesEntries() async throws {
        let client = try try await signedInClient { _ in (200, Self.catalogBody) }
        let entries = try await client.listCatalog()
        #expect(entries == [
            CatalogEntry(id: "g1", title: "Haunt", author: "Ada", latestVersion: 3, runMode: "device", requiredTier: 1),
            CatalogEntry(id: "g2", title: "Arena", author: "", latestVersion: 1, runMode: "screen", requiredTier: 3),
        ])
        let req = LibraryStub.seen[1]
        #expect(req.httpMethod == "GET")
        #expect(req.url?.path == "/api/library")
        #expect(req.value(forHTTPHeaderField: "Authorization") == "Bearer s1")
        #expect(req.httpBody == nil)
    }

    @Test func listCatalogDescriptionAndCover() async throws {
        let body = Data(#"""
        [{"id":"g1","title":"T","author":"A","latestVersion":1,"runMode":"screen","requiredTier":1,
          "description":"Run!","coverUrl":"/api/games/g1/cover?v=1731650000"},
         {"id":"g2","title":"U","author":"A","latestVersion":1,"runMode":"screen","requiredTier":1,"coverUrl":null}]
        """#.utf8)
        let client = try await signedInClient { _ in (200, body) }
        let entries = try await client.listCatalog()
        #expect(entries[0].description == "Run!")
        #expect(entries[0].coverURL?.absoluteString.hasSuffix("/api/games/g1/cover?v=1731650000") == true)
        #expect(entries[0].coverURL?.host == client.baseURL.host)
        #expect(entries[1].description == "")
        #expect(entries[1].coverURL == nil)
    }

    @Test func listCatalogEmptyArray() async throws {
        let client = try try await signedInClient { _ in (200, Data("[]".utf8)) }
        #expect(try await client.listCatalog().isEmpty)
    }

    @Test func listCatalogUnauthorizedClearsSession() async throws {
        let client = try try await signedInClient { _ in (401, Data()) }
        await #expect(throws: CloudError.unauthorized) { try await client.listCatalog() }
        #expect(await !client.isSignedIn)
        #expect(await client.account == nil)
    }

    @Test func listCatalogBadShapes() async throws {
        let missingTier = Data(#"[{"id":"g1","title":"T","author":"A","latestVersion":1,"runMode":"screen"}]"#.utf8)
        for body in [Data(#"{"games":[]}"#.utf8), missingTier] {
            let client = try try await signedInClient { _ in (200, body) }
            do {
                _ = try await client.listCatalog()
                Issue.record("expected decoding error")
            } catch let error as CloudError {
                guard case .decoding = error else { Issue.record("wrong error \(error)"); continue }
            } catch {
                Issue.record("wrong error \(error)")
            }
        }
    }

    @Test func listCatalogServerError() async throws {
        let client = try try await signedInClient { _ in (503, Data("down".utf8)) }
        await #expect(throws: CloudError.server(status: 503, message: "down")) { try await client.listCatalog() }
    }
}

// An extension of LibraryAPITests, not its own suite: both share LibraryStub's statics, and only tests inside one suite run serially.
extension LibraryAPITests {
    @Test func friendsDecodeWithAndWithoutPlaying() async throws {
        let body = Data(
            #"[{"id":"a","name":"Ann","playing":{"gameId":"g1","title":"Neon"}},{"id":"b","name":"Bo","playing":null}]"#.utf8)
        let client = try await signedInClient { req in
            req.url!.path == "/api/accounts/me"
                ? (200, Data(#"{"id":"me","display_name":"Me","friend_code":"AB12CD"}"#.utf8)) : (200, body)
        }
        let friends = try await client.listFriends()
        #expect(friends[0].playing == PlayingGame(gameId: "g1", title: "Neon"))
        #expect(friends[1].playing == nil)
        #expect(LibraryStub.seen[1].url?.path == "/api/friends")
    }

    @Test func friendsDecodeLobbyWhenPresent() async throws {
        let body = Data(#"[{"id":"a","name":"Ann","playing":{"gameId":"g1","title":"QD","lobby":"K7QM2"}}]"#.utf8)
        let client = try await signedInClient { _ in (200, body) }
        let friends = try await client.listFriends()
        #expect(friends[0].playing == PlayingGame(gameId: "g1", title: "QD", lobby: "K7QM2"))
    }

    @Test func lobbiesDecode() async throws {
        let body = Data(#"[{"code":"K7QM2","players":[{"id":"a","name":"Ann"}]},{"code":"OPEN","players":[]}]"#.utf8)
        let client = try await signedInClient { _ in (200, body) }
        let lobbies = try await client.listLobbies(gameId: "g1")
        #expect(lobbies == [
            LobbyInfo(code: "K7QM2", players: [.init(id: "a", name: "Ann")]), LobbyInfo(code: "OPEN", players: []),
        ])
        #expect(LibraryStub.seen.last?.url?.path == "/api/games/g1/lobbies")
    }

    @Test func requestsDecodeAndMeCarriesTheCode() async throws {
        let client = try await signedInClient { req in
            switch req.url!.path {
            case "/api/accounts/me": return (200, Data(#"{"id":"me","display_name":"Me","friend_code":"AB12CD"}"#.utf8))
            default: return (200, Data(#"{"incoming":[{"id":"a","name":"Ann"}],"outgoing":[]}"#.utf8))
            }
        }
        let r = try await client.listFriendRequests()
        #expect(r.incoming == [FriendRef(id: "a", name: "Ann")] && r.outgoing.isEmpty)
        #expect(try await client.refreshAccount().friendCode == "AB12CD")
    }

    @Test func sendAcceptRemoveUseTheRightRoutes() async throws {
        let client = try await signedInClient { req in
            switch (req.httpMethod!, req.url!.path) {
            case ("GET", "/api/accounts/me"): return (200, Data(#"{"id":"me","display_name":"Me"}"#.utf8))
            case ("POST", "/api/friends"): return (200, Data(#"{"status":"accepted"}"#.utf8))
            default: return (204, Data())
            }
        }
        #expect(try await client.sendFriendRequest(code: "AB12CD") == .accepted)
        try await client.acceptFriend(id: "a")
        try await client.removeFriend(id: "a")
        let seen = LibraryStub.seen.dropFirst().map { "\($0.httpMethod!) \($0.url!.path)" }
        #expect(seen == ["POST /api/friends", "POST /api/friends/a/accept", "DELETE /api/friends/a"])
        #expect(String(decoding: LibraryStub.seen[1].httpBody ?? Data(), as: UTF8.self).contains("AB12CD"))
    }

    @Test func unknownCodeIsNotFound() async throws {
        let client = try await signedInClient { req in
            req.url!.path == "/api/accounts/me" ? (200, Data(#"{"id":"me","display_name":"Me"}"#.utf8)) : (404, Data())
        }
        await #expect(throws: CloudError.notFound) { try await client.sendFriendRequest(code: "000000") }
    }

    @Test func renameAndAvatarRoutes() async throws {
        let client = try await signedInClient { req in
            req.httpMethod == "PUT" && req.url!.path == "/api/accounts/me"
                ? (200, Data(#"{"id":"a1","display_name":"New","friend_code":"AB12CD"}"#.utf8)) : (204, Data())
        }
        let renamed = try await client.updateDisplayName("New")
        #expect(renamed == Account(id: "a1", displayName: "New", friendCode: "AB12CD"))
        try await client.uploadAvatar(Data([0xFF, 0xD8, 0xFF, 1]), contentType: "image/jpeg")
        try await client.removeAvatar()
        let seen = LibraryStub.seen.dropFirst()
        #expect(seen.map { "\($0.httpMethod!) \($0.url!.path)" } == [
            "PUT /api/accounts/me", "PUT /api/accounts/me/avatar", "DELETE /api/accounts/me/avatar",
        ])
        #expect(try JSONDecoder().decode([String: String].self, from: seen.first!.httpBody!) == ["display_name": "New"])
        let upload = Array(seen)[1]
        #expect(upload.httpBody == Data([0xFF, 0xD8, 0xFF, 1]))
        #expect(upload.value(forHTTPHeaderField: "Content-Type") == "image/jpeg")
        #expect(client.avatarURL(for: "a1").absoluteString == "https://pear.test/api/avatars/a1")
    }
}
