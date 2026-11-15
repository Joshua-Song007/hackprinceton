import Foundation
import PearCloud
import Security
import Synchronization

/// What survives an app restart: the backend session token and the account it belongs to.
public struct StoredSession: Codable, Sendable, Equatable {
    public var token: String
    public var account: Account
    public init(token: String, account: Account) {
        self.token = token
        self.account = account
    }
}

public enum SessionStoreError: Error, Equatable {
    case keychain(OSStatus)
    case encoding
}

public protocol SessionStore: Sendable {
    func load() throws -> StoredSession?
    func save(_ session: StoredSession) throws
    func clear() throws
}

/// Tests, and previews.
public final class InMemorySessionStore: SessionStore {
    private let box = Mutex<StoredSession?>(nil)

    public init() {}

    public func load() throws -> StoredSession? { box.withLock { $0 } }
    public func save(_ session: StoredSession) throws { box.withLock { $0 = session } }
    public func clear() throws { box.withLock { $0 = nil } }
}

/// One generic-password item holding the session as JSON. Never logs the token. Does not set
/// `kSecUseDataProtectionKeychain`: on macOS that needs a signing entitlement a SwiftPM test binary lacks.
public final class KeychainSessionStore: SessionStore {
    private let service: String
    private let account: String

    public init(service: String = "com.pear.PearPlayer", account: String = "session") {
        self.service = service
        self.account = account
    }

    static func baseQuery(service: String, account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    public func save(_ session: StoredSession) throws {
        let data: Data
        do { data = try JSONEncoder().encode(session) }
        catch { throw SessionStoreError.encoding }
        // Add, then update on a duplicate: never delete first, so a failed add cannot lose the stored session.
        var add = Self.baseQuery(service: service, account: account)
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        var status = SecItemAdd(add as CFDictionary, nil)
        if status == errSecDuplicateItem {
            status = SecItemUpdate(
                Self.baseQuery(service: service, account: account) as CFDictionary,
                [kSecValueData as String: data] as CFDictionary)
        }
        guard status == errSecSuccess else { throw SessionStoreError.keychain(status) }
    }

    /// Data that no longer decodes is deleted and read as signed out.
    public func load() throws -> StoredSession? {
        var query = Self.baseQuery(service: service, account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw SessionStoreError.keychain(status)
        }
        if let session = try? JSONDecoder().decode(StoredSession.self, from: data) { return session }
        try clear()
        return nil
    }

    public func clear() throws {
        let status = SecItemDelete(Self.baseQuery(service: service, account: account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw SessionStoreError.keychain(status)
        }
    }
}
