import Foundation

// Game content only: scene, scripts, assets, metadata. Never USIS packets or output commands
// (overview.md Module 11). Routes and JSON are provisional; see docs/agents/cloud-api.md.

/// Arbitrary JSON, so the scene description travels without PearCloud depending on PearRuntime.
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

/// One game in the public library, as `GET /api/library` returns it. No scene or scripts: those come from a fetch.
public struct CatalogEntry: Codable, Sendable, Equatable, Hashable, Identifiable {
    public var id: String
    public var title: String
    public var author: String
    public var latestVersion: Int
    /// `screen` or `device` (overview.md Module 7).
    public var runMode: String
    /// 1...3, the capability tier the game needs.
    public var requiredTier: Int
    public init(
        id: String, title: String, author: String, latestVersion: Int, runMode: String, requiredTier: Int
    ) {
        self.id = id
        self.title = title
        self.author = author
        self.latestVersion = latestVersion
        self.runMode = runMode
        self.requiredTier = requiredTier
    }
}

// Backend wire shapes (Backend/src/db.rs, snake_case). The public types above stay as Studio and the player use them.

/// `db::Account`; only id and display name are kept.
struct AccountWire: Decodable {
    let id: String
    let display_name: String
    var account: Account { Account(id: id, displayName: display_name) }
}

/// Dev and Apple sign-in response: `{token, account}`.
struct SignInWire: Decodable {
    let token: String
    let account: AccountWire
}

/// `db::Game`.
struct GameWire: Decodable {
    let id: String
    let title: String
}

/// `db::NewGameVersion` going out, `db::GameVersion` coming back. Scripts are `{name: source}` objects, as the
/// web Studio and the game server read them; assets are `{name: {contentType, data}}` with data in base64.
struct VersionWire: Codable {
    struct Asset: Codable { let contentType: String; let data: Data }
    var game_id: String?
    var version: Int?
    let scene: JSONValue
    let client_scripts: [String: String]
    let server_scripts: [String: String]
    let assets: [String: Asset]
    let metadata: [String: JSONValue]
    let run_mode: String

    init(_ b: GameBundle) {
        scene = b.scene
        client_scripts = Dictionary(b.clientScripts.map { ($0.name, $0.source) }, uniquingKeysWith: { _, last in last })
        server_scripts = Dictionary(b.serverScripts.map { ($0.name, $0.source) }, uniquingKeysWith: { _, last in last })
        assets = Dictionary(
            b.assets.map { ($0.name, Asset(contentType: $0.contentType, data: $0.data)) }, uniquingKeysWith: { _, last in last })
        metadata = ["title": .string(b.title)]
        run_mode = b.runMode
    }

    /// Versions carry no title column: `metadata.title` (Swift publish), else `metadata.name` (web Studio), else "".
    var bundle: GameBundle {
        var title = ""
        if case .string(let t)? = metadata["title"] ?? metadata["name"] { title = t }
        func scripts(_ d: [String: String]) -> [ScriptSource] {
            d.keys.sorted().map { ScriptSource(name: $0, source: d[$0]!) }
        }
        return GameBundle(
            title: title, runMode: run_mode, scene: scene,
            clientScripts: scripts(client_scripts), serverScripts: scripts(server_scripts),
            assets: assets.keys.sorted().map { AssetFile(name: $0, contentType: assets[$0]!.contentType, data: assets[$0]!.data) })
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

/// Studio's client for the Pear backend. Injectable session and base URL so tests use a stub.
public actor CloudClient {
    private let baseURL: URL
    private let session: URLSession
    /// Readable so an app can persist the session (the player keeps it in the Keychain); restore it with `signIn(token:)`.
    public private(set) var sessionToken: String?
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
        // ponytail: the backend has no token exchange; a pasted session token is adopted and checked with `/me`.
        sessionToken = token
        do {
            let wire: AccountWire = try await send("GET", ["api", "accounts", "me"], body: Optional<GameBundle>.none)
            account = wire.account
            return wire.account
        } catch {
            signOut()
            throw error
        }
    }

    /// Dev sign-in (`POST /api/accounts/signin`, provider `dev`, subject = name), same as the web Studio.
    /// The server answers 404 unless it runs with `PEAR_DEV_SIGNIN=1`.
    @discardableResult
    public func signInDev(name: String) async throws -> Account {
        struct Request: Encodable {
            let provider = "dev"
            let subject: String
            let display_name: String
        }
        let response: SignInWire = try await send(
            "POST", ["api", "accounts", "signin"], body: Request(subject: name, display_name: name), authorized: false)
        sessionToken = response.token
        account = response.account.account
        return response.account.account
    }

    /// Sign in with Apple: exchanges Apple's identity token for a session (`POST /api/accounts/apple`).
    /// Apple sends the name only at first authorization, so pass it when you have it; the backend keeps the
    /// stored name when this is nil or blank. Uses the backend's real routes, not the provisional `/v1` ones.
    @discardableResult
    public func signInWithApple(identityToken: String, displayName: String? = nil) async throws -> Account {
        struct Request: Encodable { let identityToken: String; let displayName: String? }
        let response: SignInWire = try await send(
            "POST", ["api", "accounts", "apple"],
            body: Request(identityToken: identityToken, displayName: displayName), authorized: false)
        let signedIn = response.account.account
        sessionToken = response.token
        account = signedIn
        return signedIn
    }

    /// The public library: every published game, newest publish first (`GET /api/library`).
    public func listCatalog() async throws -> [CatalogEntry] {
        try await send("GET", ["api", "library"], body: Optional<GameBundle>.none)
    }

    /// Publishes a new version. With `gameId == nil` a new game is created first.
    public func publish(_ bundle: GameBundle, gameId: String? = nil) async throws -> PublishedVersion {
        var id = gameId
        if id == nil {
            struct Create: Encodable { let title: String }
            let game: GameWire = try await send("POST", ["api", "games"], body: Create(title: bundle.title))
            id = game.id
        }
        let v: VersionWire = try await send("POST", ["api", "games", id!, "versions"], body: VersionWire(bundle))
        return PublishedVersion(gameId: v.game_id ?? id!, version: v.version ?? 0)
    }

    /// The signed-in account's games. `GET /api/games` carries no version, so the latest comes from the library
    /// (0 for a game with no published version).
    public func listGames() async throws -> [GameSummary] {
        let games: [GameWire] = try await send("GET", ["api", "games"], body: Optional<GameBundle>.none)
        let latest = Dictionary(try await listCatalog().map { ($0.id, $0.latestVersion) }, uniquingKeysWith: max)
        return games.map { GameSummary(id: $0.id, title: $0.title, latestVersion: latest[$0.id] ?? 0) }
    }

    /// Fetches a version; `nil` fetches the latest.
    public func fetchGame(id: String, version: Int? = nil) async throws -> FetchedGame {
        let v = version.map(String.init) ?? "latest"
        let wire: VersionWire = try await send(
            "GET", ["api", "games", id, "versions", v], body: Optional<GameBundle>.none)
        return FetchedGame(gameId: wire.game_id ?? id, version: wire.version ?? 0, bundle: wire.bundle)
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
