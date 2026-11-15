import Observation
import PearCloud
import SwiftUI

/// Signed-in account state shared by `SignInView` and `PublishView`. Wraps `CloudClient`, which holds the session.
@MainActor
@Observable
final class AccountModel {
    let client: CloudClient
    private(set) var account: Account?
    private(set) var isWorking = false
    private(set) var errorMessage: String?

    init(client: CloudClient) {
        self.client = client
    }

    var isSignedIn: Bool { account != nil }

    func signIn(token: String) async {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            errorMessage = "Enter an account token."
            return
        }
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            account = try await client.signIn(token: trimmed)
        } catch {
            account = nil
            errorMessage = Self.describe(error)
        }
    }

    func signOut() async {
        await client.signOut()
        account = nil
        errorMessage = nil
    }

    /// Call after a cloud call fails, so an expired session returns the UI to signed-out.
    func noteFailure(_ error: Error) {
        if let cloud = error as? CloudError, cloud == .unauthorized || cloud == .notSignedIn {
            account = nil
        }
    }

    static func describe(_ error: Error) -> String {
        guard let cloud = error as? CloudError else { return "\(error.localizedDescription)" }
        switch cloud {
        case .notSignedIn: return "Not signed in."
        case .unauthorized: return "Sign-in rejected or expired."
        case .forbidden: return "This account may not do that."
        case .notFound: return "Not found."
        case .server(let status, let message): return "Server error \(status): \(message)"
        case .transport(let message): return "Network error: \(message)"
        case .decoding(let message): return "Bad response: \(message)"
        case .invalidResponse: return "Invalid response."
        }
    }
}

/// Sign-in and signed-in account state. [provisional: needs-tien-review] Sign-in method is undecided (Sign in with
/// Apple preferred); this takes a pasted account token, matching `CloudClient.signIn(token:)`. Swap the form for the
/// Apple button later; `AccountModel` does not change.
struct SignInView: View {
    @Bindable var model: AccountModel
    @State private var token = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let account = model.account {
                Text("Signed in as \(account.displayName)")
                Button("Sign Out") { Task { await model.signOut() } }
            } else {
                Image("PearMark").resizable().scaledToFit().frame(width: 40, height: 40).accessibilityHidden(true)
                Text("Sign in to publish games")
                SecureField("Account token", text: $token)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(submit)
                Button("Sign In", action: submit)
                    .disabled(model.isWorking || token.isEmpty)
                if model.isWorking { ProgressView().controlSize(.small) }
            }
            if let message = model.errorMessage {
                Text(message).foregroundStyle(.red)
            }
        }
        .padding()
        .frame(minWidth: 280)
    }

    private func submit() {
        guard !model.isWorking else { return }
        Task {
            await model.signIn(token: token)
            if model.isSignedIn { token = "" }
        }
    }
}
