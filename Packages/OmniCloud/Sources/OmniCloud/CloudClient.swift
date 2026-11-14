import Foundation

// Game content only: scene, scripts, assets, metadata. Never USIS packets or output commands
// (overview.md Module 11). Routes and JSON are provisional; see docs/agents/cloud-api.md.

/// Arbitrary JSON, so the scene description travels without OmniCloud depending on OmniRuntime.
public enum JSONValue: Codable, Sendable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        }
    }
}

public struct ScriptSource: Codable, Sendable, Equatable {
    public var name: String
    public var source: String
    public init(name: String, source: String) {
        self.name = name
        self.source = source
    }
}

public struct AssetFile: Codable, Sendable, Equatable {
    public var name: String
    public var contentType: String
    /// File bytes; encoded as base64 in JSON.
    public var data: Data
    public init(name: String, contentType: String, data: Data) {
        self.name = name
        self.contentType = contentType
        self.data = data
    }
}

/// One game version as stored in and served from the cloud.
public struct GameBundle: Codable, Sendable, Equatable {
    public var title: String
    /// `screen` or `device` (overview.md Module 7).
    public var runMode: String
    public var scene: JSONValue
    public var clientScripts: [ScriptSource]
    public var serverScripts: [ScriptSource]
    public var assets: [AssetFile]

    public init(
        title: String,
        runMode: String = "screen",
        scene: JSONValue,
        clientScripts: [ScriptSource] = [],
        serverScripts: [ScriptSource] = [],
        assets: [AssetFile] = []
    ) {
        self.title = title
        self.runMode = runMode
        self.scene = scene
        self.clientScripts = clientScripts
        self.serverScripts = serverScripts
        self.assets = assets
    }
}

public struct Account: Codable, Sendable, Equatable {
    public var id: String
    public var displayName: String
    public init(id: String, displayName: String) {
        self.id = id
        self.displayName = displayName
    }
}

public struct PublishedVersion: Codable, Sendable, Equatable {
    public var gameId: String
    public var version: Int
    public init(gameId: String, version: Int) {
        self.gameId = gameId
        self.version = version
    }
}

public struct GameSummary: Codable, Sendable, Equatable {
    public var id: String
    public var title: String
    public var latestVersion: Int
    public init(id: String, title: String, latestVersion: Int) {
        self.id = id
        self.title = title
        self.latestVersion = latestVersion
    }
}

public struct FetchedGame: Codable, Sendable, Equatable {
    public var gameId: String
    public var version: Int
    public var bundle: GameBundle
    public init(gameId: String, version: Int, bundle: GameBundle) {
        self.gameId = gameId
        self.version = version
        self.bundle = bundle
    }
}

public enum CloudError: Error, Sendable, Equatable {
    case notSignedIn
    /// HTTP 401: token missing, expired or rejected. The stored session is cleared.
    case unauthorized
    /// HTTP 403, for example publishing to a game the account does not own.
    case forbidden
    case notFound
    case server(status: Int, message: String)
    case transport(String)
    case decoding(String)
    case invalidResponse
}

/// Studio's client for the Omni backend. Injectable session and base URL so tests use a stub.
public actor CloudClient {
    private let baseURL: URL
    private let session: URLSession
    private var sessionToken: String?
    public private(set) var account: Account?

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public var isSignedIn: Bool { sessionToken != nil }

    public func signOut() {
        sessionToken = nil
        account = nil
    }

    /// Provisional sign-in: exchange an account token for a session. (Sign in with Apple is
    /// preferred but not decided.)
    @discardableResult
    public func signIn(token: String) async throws -> Account {
        struct Request: Encodable { let token: String }
        struct Response: Decodable { let sessionToken: String; let account: Account }
        let response: Response = try await send(
            "POST", ["v1", "session"], body: Request(token: token), authorized: false)
        sessionToken = response.sessionToken
        account = response.account
        return response.account
    }

    /// Publishes a new version. With `gameId == nil` a new game is created first.
    public func publish(_ bundle: GameBundle, gameId: String? = nil) async throws -> PublishedVersion {
        if let gameId {
            return try await send("POST", ["v1", "games", gameId, "versions"], body: bundle)
        }
        return try await send("POST", ["v1", "games"], body: bundle)
    }

    public func listGames() async throws -> [GameSummary] {
        struct Response: Decodable { let games: [GameSummary] }
        let response: Response = try await send("GET", ["v1", "games"], body: Optional<GameBundle>.none)
        return response.games
    }

    /// Fetches a version; `nil` fetches the latest.
    public func fetchGame(id: String, version: Int? = nil) async throws -> FetchedGame {
        let v = version.map(String.init) ?? "latest"
        return try await send("GET", ["v1", "games", id, "versions", v], body: Optional<GameBundle>.none)
    }

    private func send<Body: Encodable, Response: Decodable>(
        _ method: String, _ path: [String], body: Body?, authorized: Bool = true
    ) async throws -> Response {
        var url = baseURL
        for part in path { url.append(path: part) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if authorized {
            guard let sessionToken else { throw CloudError.notSignedIn }
            request.setValue("Bearer \(sessionToken)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            do { request.httpBody = try JSONEncoder().encode(body) }
            catch { throw CloudError.decoding("encode: \(error)") }
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let data: Data
        let response: URLResponse
        do { (data, response) = try await session.data(for: request) }
        catch { throw CloudError.transport(error.localizedDescription) }
        guard let http = response as? HTTPURLResponse else { throw CloudError.invalidResponse }

        switch http.statusCode {
        case 200..<300:
            do { return try JSONDecoder().decode(Response.self, from: data) }
            catch { throw CloudError.decoding("\(error)") }
        case 401:
            if authorized {
                sessionToken = nil
                account = nil
            }
            throw CloudError.unauthorized
        case 403: throw CloudError.forbidden
        case 404: throw CloudError.notFound
        default:
            throw CloudError.server(
                status: http.statusCode, message: String(decoding: data.prefix(512), as: UTF8.self))
        }
    }
}
