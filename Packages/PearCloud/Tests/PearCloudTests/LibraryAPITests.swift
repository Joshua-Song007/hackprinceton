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
        let client = try await signedInClient { _ in (200, Self.catalogBody) }
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

    @Test func listCatalogEmptyArray() async throws {
        let client = try await signedInClient { _ in (200, Data("[]".utf8)) }
        #expect(try await client.listCatalog().isEmpty)
    }

    @Test func listCatalogUnauthorizedClearsSession() async throws {
        let client = try await signedInClient { _ in (401, Data()) }
        await #expect(throws: CloudError.unauthorized) { try await client.listCatalog() }
        #expect(await !client.isSignedIn)
        #expect(await client.account == nil)
    }

    @Test func listCatalogBadShapes() async throws {
        let missingTier = Data(#"[{"id":"g1","title":"T","author":"A","latestVersion":1,"runMode":"screen"}]"#.utf8)
        for body in [Data(#"{"games":[]}"#.utf8), missingTier] {
            let client = try await signedInClient { _ in (200, body) }
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
        let client = try await signedInClient { _ in (503, Data("down".utf8)) }
        await #expect(throws: CloudError.server(status: 503, message: "down")) { try await client.listCatalog() }
    }
}
