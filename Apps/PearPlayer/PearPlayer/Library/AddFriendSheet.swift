import PearCloud
import SwiftUI

/// Add a friend by code, see your own code, and answer or cancel requests.
struct AddFriendSheet: View {
    let model: PlayerModel
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @State private var result: String?
    @State private var sending = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: PearTheme.Space.s6) {
                    yourCode
                    addByCode
                    if !model.requests.incoming.isEmpty { incoming }
                    if !model.requests.outgoing.isEmpty { outgoing }
                }
                .padding(PearTheme.Space.s6)
                .frame(maxWidth: 520, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .background(PearTheme.bgField)
            .navigationTitle("Friends")
            #if !os(macOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 420)
        #endif
        .task { await model.refreshFriends() }
    }

    private var yourCode: some View {
        VStack(alignment: .leading, spacing: PearTheme.Space.s2) {
            heading("Your code")
            HStack {
                Text(model.friendCode.isEmpty ? "…" : model.friendCode)
                    .font(PearTheme.mono(28))
                    .tracking(2)
                    .foregroundStyle(PearTheme.text)
                    .textSelection(.enabled)
                Spacer()
                if !model.friendCode.isEmpty {
                    ShareLink(item: model.friendCode) { Label("Share", systemImage: "square.and.arrow.up") }
                        .buttonStyle(PearSecondaryButtonStyle())
                }
            }
            Text("Give this code to a friend so they can send you a request.")
                .font(PearTheme.small)
                .foregroundStyle(PearTheme.textSecondary)
        }
    }

    private var addByCode: some View {
        VStack(alignment: .leading, spacing: PearTheme.Space.s2) {
            heading("Add a friend")
            HStack(spacing: PearTheme.Space.s3) {
                TextField("Friend code", text: $code)
                    .textFieldStyle(.roundedBorder)
                    .font(PearTheme.mono(17))
                    #if !os(macOS)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    #endif
                    .onSubmit(send)
                Button("Send request", action: send)
                    .buttonStyle(PearPrimaryButtonStyle())
                    .disabled(sending || code.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            if let result {
                Text(result).font(PearTheme.small).foregroundStyle(PearTheme.textSecondary)
            }
        }
    }

    private var incoming: some View {
        VStack(alignment: .leading, spacing: PearTheme.Space.s2) {
            heading("Requests")
            ForEach(model.requests.incoming) { who in
                row(who) {
                    Button("Accept") { Task { await model.acceptFriend(who.id) } }
                        .buttonStyle(PearPrimaryButtonStyle())
                    Button("Decline") { Task { await model.removeFriend(who.id) } }
                        .buttonStyle(PearSecondaryButtonStyle())
                }
            }
        }
    }

    private var outgoing: some View {
        VStack(alignment: .leading, spacing: PearTheme.Space.s2) {
            heading("Sent")
            ForEach(model.requests.outgoing) { who in
                row(who) {
                    Text("Pending").font(PearTheme.small).foregroundStyle(PearTheme.textSecondary)
                    Button("Cancel") { Task { await model.removeFriend(who.id) } }
                        .buttonStyle(PearSecondaryButtonStyle())
                }
            }
        }
    }

    private func heading(_ text: String) -> some View {
        Text(text)
            .font(PearTheme.sans(17, .semibold, relativeTo: .headline))
            .foregroundStyle(PearTheme.text)
            .accessibilityAddTraits(.isHeader)
    }

    private func row<Actions: View>(_ who: FriendRef, @ViewBuilder actions: () -> Actions) -> some View {
        HStack(spacing: PearTheme.Space.s3) {
            AvatarView(name: who.name, size: 40, accountId: who.id)
            Text(who.name.isEmpty ? "Someone" : who.name)
                .font(PearTheme.sans(16, .medium))
                .foregroundStyle(PearTheme.text)
                .lineLimit(1)
            Spacer(minLength: PearTheme.Space.s2)
            actions()
        }
    }

    private func send() {
        let trimmed = code.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, !sending else { return }
        sending = true
        Task {
            result = await model.sendFriendRequest(code: trimmed)
            sending = false
            if result == "Request sent." || result == "You are now friends." { code = "" }
        }
    }
}
