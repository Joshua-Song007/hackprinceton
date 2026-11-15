import Foundation
import Observation
import PearCloud
import PearLibrary
import PearScript

/// The player's composition root: builds the cloud client, the session store, the device profile, the library
/// model and the launcher, and owns the signed-in / signed-out state. No SwiftUI in here.
@MainActor
@Observable
final class PlayerModel {
    enum Phase: Equatable {
        case launching
        case signedOut
        case signedIn(Account)
    }

    private(set) var phase: Phase = .launching
    /// The last thing the player should be told on the sign-in screen (or after a sign-in).
    private(set) var message: String?
    private(set) var isWorking = false
    /// A session is stored on this device but could not be confirmed (offline, server down): offer "Try again".
    private(set) var hasSavedSession = false

    /// Accepted friends and the game each is in now; refreshed on appear and on pull to refresh, never polled.
    private(set) var friends: [FriendEntry] = []
    private(set) var requests = FriendRequests()
    /// What a friend types to send this account a request.
    private(set) var friendCode = ""
    private(set) var friendsError: String?
    /// Bumped when this player uploads or removes their picture, so every avatar reloads.
    private(set) var avatarVersion = 0
    /// The game being played, if any; the library screen shows it full screen.
    private(set) var activeSession: GameSession?

    let library: LibraryModel
    private let client: CloudClient
    private let store: any SessionStore
    private let launcher: any GameLauncher

    nonisolated static let defaultBaseURL = URL(string: "http://localhost:8080")!

    init(client: CloudClient, store: any SessionStore, profile: DeviceProfile, launcher: any GameLauncher) {
        self.client = client
        self.store = store
        self.launcher = launcher
        self.library = LibraryModel(source: client, profile: profile)
    }

    convenience init() {
        let baseURL = Self.resolveBaseURL(
            environment: ProcessInfo.processInfo.environment,
            infoValue: Bundle.main.object(forInfoDictionaryKey: "PearCloudURL") as? String)
        let client = CloudClient(baseURL: baseURL)
        self.init(
            client: client, store: KeychainSessionStore(), profile: .current(),
            launcher: RuntimeGameLauncher(source: client))
    }

    /// First usable of: env `PEAR_CLOUD_URL`, the Info.plist `PearCloudURL`, then localhost. Usable = http or https
    /// with a host. A home-screen launch has no environment, so a device build sets the plist value at build time.
    nonisolated static func resolveBaseURL(environment: [String: String], infoValue: String?) -> URL {
        for raw in [environment["PEAR_CLOUD_URL"], infoValue] {
            guard let text = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty,
                  let url = URL(string: text),
                  let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
                  let host = url.host(), !host.isEmpty
            else { continue }
            return url
        }
        return defaultBaseURL
    }

    // MARK: Session

    /// Restores a stored session, or lands on the sign-in screen. Also the "Try again" action.
    func start() async {
        phase = .launching
        message = nil
        let saved: StoredSession?
        do { saved = try store.load() } catch { saved = nil }
        hasSavedSession = saved != nil
        guard let saved else {
            phase = .signedOut
            return
        }
        do {
            let account = try await client.signIn(token: saved.token)
            _ = remember(token: saved.token, account: account)
            phase = .signedIn(account)
        } catch let error as CloudError where error == .unauthorized || error == .notSignedIn {
            await forgetSession()
            message = "Your session expired. Sign in again."
            phase = .signedOut
        } catch {
            // Offline or server trouble: keep the stored session, so "Try again" can pick it up later.
            message = Self.describe(error)
            phase = .signedOut
        }
    }

    func signInWithApple(identityToken: String, displayName: String?) async {
        await signIn(notFoundMessage: nil) {
            try await self.client.signInWithApple(identityToken: identityToken, displayName: displayName)
        }
    }

    #if DEBUG
    func signInDev(name: String) async {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            message = "Enter a name."
            return
        }
        await signIn(notFoundMessage: "Dev sign-in is off on this server.") {
            try await self.client.signInDev(name: trimmed)
        }
    }
    #endif

    func signOut() async {
        await client.signOut()
        await forgetSession()
        message = nil
        phase = .signedOut
    }

    /// A request came back unauthorized while signed in: back to the sign-in screen.
    func sessionExpired() async {
        guard case .signedIn = phase else { return }
        await client.signOut()
        await forgetSession()
        message = "Your session expired. Sign in again."
        phase = .signedOut
    }

    func report(_ text: String) {
        message = text
    }

    // MARK: Library

    func playability(of entry: CatalogEntry) -> Playability {
        library.playability(of: entry)
    }

    func launch(_ entry: CatalogEntry) async throws -> LaunchResult {
        try await launcher.launch(entry)
    }

    /// Fetches the game, connects to its server session (`/play/{id}`, the same session a friend is in) and runs it.
    func play(_ entry: CatalogEntry) async throws {
        guard activeSession == nil else { return }
        guard case .signedIn(let account) = phase, let token = await client.sessionToken else {
            throw CloudError.notSignedIn
        }
        let result = try await launch(entry)
        guard let url = NetworkRemoteChannel.playURL(
            base: client.baseURL, gameId: result.game.gameId, token: token, version: result.game.version)
        else { throw CloudError.invalidResponse }
        let channel = NetworkRemoteChannel(transport: URLSessionWebSocketTransport(url: url), playerId: account.id)
        let session = try GameSession(game: result.game, playerId: account.id, channel: channel)
        session.start()
        activeSession = session
    }

    func leaveGame() {
        activeSession?.stop()
        activeSession = nil
    }

    // MARK: Friends

    func refreshFriends() async {
        do {
            async let list = client.listFriends()
            async let pending = client.listFriendRequests()
            async let me = client.refreshAccount()
            (friends, requests, friendCode) = try await (list, pending, me.friendCode)
            friendsError = nil
        } catch let error as CloudError where error == .unauthorized || error == .notSignedIn {
            await sessionExpired()
        } catch {
            friendsError = Self.describe(error)
        }
    }

    /// Sends a request by code; the returned text is what the add-friend sheet shows.
    func sendFriendRequest(code: String) async -> String {
        do {
            let status = try await client.sendFriendRequest(code: code)
            await refreshFriends()
            return status == .accepted ? "You are now friends." : "Request sent."
        } catch let error as CloudError {
            if error == .notFound { return "No one has that code." }
            if case .server(400, _) = error { return "That is your own code." }
            if error == .unauthorized { await sessionExpired() }
            return Self.describe(error)
        } catch {
            return Self.describe(error)
        }
    }

    func acceptFriend(_ id: String) async {
        await change { try await self.client.acceptFriend(id: id) }
    }

    /// Declines, cancels or removes, depending on where the link stands.
    func removeFriend(_ id: String) async {
        await change { try await self.client.removeFriend(id: id) }
    }

    private func change(_ action: () async throws -> Void) async {
        do {
            try await action()
        } catch let error as CloudError where error == .unauthorized || error == .notSignedIn {
            await sessionExpired()
            return
        } catch {
            friendsError = Self.describe(error)
        }
        await refreshFriends()
    }

    // MARK: Profile

    var avatarSource: AvatarSource {
        let client = client
        return AvatarSource(version: avatarVersion) { client.avatarURL(for: $0) }
    }

    /// Renames the account; returns text to show when it failed, nil on success.
    func updateDisplayName(_ name: String) async -> String? {
        do {
            let account = try await client.updateDisplayName(name)
            if let token = await client.sessionToken { _ = remember(token: token, account: account) }
            phase = .signedIn(account)
            return nil
        } catch {
            return await profileFailure(error, badInput: "That name is not allowed.")
        }
    }

    /// `data` is a JPEG already sized for upload; returns text to show when it failed, nil on success.
    func setAvatar(_ data: Data) async -> String? {
        do {
            try await client.uploadAvatar(data, contentType: "image/jpeg")
            avatarVersion += 1
            return nil
        } catch {
            return await profileFailure(error, badInput: "That photo could not be used.")
        }
    }

    func removeAvatar() async -> String? {
        do {
            try await client.removeAvatar()
            avatarVersion += 1
            return nil
        } catch {
            return await profileFailure(error, badInput: "Could not remove the photo.")
        }
    }

    private func profileFailure(_ error: Error, badInput: String) async -> String {
        if let cloud = error as? CloudError {
            if cloud == .unauthorized { await sessionExpired() }
            if case .server(let status, _) = cloud {
                if status == 413 { return "That photo is too large." }
                if status == 400 || status == 415 { return badInput }
            }
        }
        return Self.describe(error)
    }

    // MARK: Helpers

    private func signIn(notFoundMessage: String?, _ perform: () async throws -> Account) async {
        isWorking = true
        message = nil
        defer { isWorking = false }
        do {
            let account = try await perform()
            guard let token = await client.sessionToken else {
                message = "Sign-in did not return a session."
                phase = .signedOut
                return
            }
            let saved = remember(token: token, account: account)
            hasSavedSession = saved
            phase = .signedIn(account)
            if !saved { message = "Could not remember this sign-in." }
        } catch {
            if let notFoundMessage, let cloud = error as? CloudError, cloud == .notFound {
                message = notFoundMessage
            } else {
                message = Self.describe(error)
            }
            phase = .signedOut
        }
    }

    /// A failed save does not fail the sign-in: the player is signed in for this run.
    private func remember(token: String, account: Account) -> Bool {
        do {
            try store.save(StoredSession(token: token, account: account))
            hasSavedSession = true
            return true
        } catch {
            return false
        }
    }

    private func forgetSession() async {
        leaveGame()
        try? store.clear()
        hasSavedSession = false
        library.reset()
        friends = []
        requests = FriendRequests()
        friendCode = ""
        friendsError = nil
    }

    /// Plain wording for the player; never shows a server response body.
    nonisolated static func describe(_ error: Error) -> String {
        if let cloud = error as? CloudError {
            switch cloud {
            case .notSignedIn: return "Not signed in."
            case .unauthorized: return "Sign-in rejected or expired."
            case .forbidden: return "This account may not do that."
            case .notFound: return "Not found."
            case .server(let status, _): return "The server returned an error (\(status))."
            case .transport(let text): return "Network error: \(text)"
            case .decoding, .invalidResponse: return "The server sent a response this app does not understand."
            }
        }
        if error is LaunchError { return "The server returned a different game than the one requested." }
        if error is GameSession.LoadError || error is ScriptEngineError { return "This game could not be started." }
        return "Something went wrong."
    }
}
