import Foundation
import Observation
import PearCloud
import PearLibrary

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
            launcher: StubGameLauncher(source: client))
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
        try? store.clear()
        hasSavedSession = false
        library.reset()
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
        return "Something went wrong."
    }
}
