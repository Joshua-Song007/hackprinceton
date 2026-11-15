import PearCloud
import SwiftUI

/// Packs the open game and publishes it through `CloudClient`; shows the published version or the error.
/// The open game's bundle comes from the caller (`makeBundle`), so this view does not depend on project loading.
/// [provisional: needs-tien-review] `gameId == nil` publishes as a new game; the caller passes it to publish a new
/// version of an existing one.
struct PublishView: View {
    let account: AccountModel
    let gameId: String?
    let makeBundle: @MainActor () -> GameBundle?

    @State private var isPublishing = false
    @State private var published: PublishedVersion?
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if account.isSignedIn {
                Button("Publish", action: publish)
                    .disabled(isPublishing)
                if isPublishing { ProgressView().controlSize(.small) }
                if let published {
                    Text("Published game \(published.gameId), version \(published.version)")
                }
            } else {
                Text("Sign in to publish.")
            }
            if let errorMessage {
                Text(errorMessage).foregroundStyle(.red)
            }
        }
        .padding()
        .frame(minWidth: 280)
    }

    private func publish() {
        guard !isPublishing else { return }
        guard let bundle = makeBundle() else {
            errorMessage = "No game is open."
            return
        }
        isPublishing = true
        errorMessage = nil
        published = nil
        Task {
            defer { isPublishing = false }
            do {
                published = try await account.client.publish(bundle, gameId: gameId)
            } catch {
                account.noteFailure(error)
                errorMessage = AccountModel.describe(error)
            }
        }
    }
}
