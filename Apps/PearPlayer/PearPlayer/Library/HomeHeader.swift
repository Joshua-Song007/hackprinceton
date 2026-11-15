import PearCloud
import SwiftUI

/// A horizontal row of friends; the ones in a game come first, then an add tile.
struct FriendsPanel: View {
    let model: PlayerModel
    /// Opens the game page of the game this friend is in.
    let onJoin: (FriendEntry) -> Void
    @State private var showAdd = false

    private var sorted: [FriendEntry] {
        model.friends.filter { $0.playing != nil } + model.friends.filter { $0.playing == nil }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: PearTheme.Space.s4) {
            if model.friendsError != nil {
                Text("Friends didn't load. Pull down to refresh.").font(PearTheme.small).foregroundStyle(PearTheme.error)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 16)], spacing: 16) {
                ForEach(sorted) { friend in
                    FriendTile(
                        friend: friend,
                        onJoin: { onJoin(friend) },
                        onRemove: { Task { await model.removeFriend(friend.id) } })
                }
                AddFriendTile(pending: model.requests.incoming.count) { showAdd = true }
            }
        }
        .task { await model.refreshFriends() }
        .sheet(isPresented: $showAdd) { AddFriendSheet(model: model) }
    }
}

private struct FriendTile: View {
    let friend: FriendEntry
    let onJoin: () -> Void
    let onRemove: () -> Void
    @State private var confirmingRemove = false

    private var status: String {
        guard let playing = friend.playing else { return "Offline" }
        return playing.title.isEmpty ? "Playing" : "Playing \(playing.title)"
    }

    var body: some View {
        let here = friend.playing != nil
        VStack(spacing: PearTheme.Space.s2) {
            AvatarView(name: friend.name, size: 72, accountId: friend.id)
                .padding(4)
                .overlay(Circle().strokeBorder(here ? PearTheme.ok : PearTheme.line, lineWidth: here ? 3 : 1))
                .overlay(alignment: .bottomTrailing) {
                    // Status dot (the kit's only pill), always paired with the words below.
                    if here {
                        Circle()
                            .fill(PearTheme.ok)
                            .frame(width: 16, height: 16)
                            .overlay(Circle().strokeBorder(PearTheme.bgField, lineWidth: 3))
                    }
                }
            VStack(spacing: 2) {
                Text(friend.name.split(separator: " ").first.map(String.init) ?? friend.name)
                    .font(PearTheme.sans(14, .medium, relativeTo: .subheadline))
                    .foregroundStyle(PearTheme.text)
                Text(status)
                    .font(PearTheme.sans(12, relativeTo: .caption))
                    .foregroundStyle(PearTheme.textSecondary)
            }
            .lineLimit(1)
            if here {
                Button("Join", action: onJoin)
                    .buttonStyle(PearPrimaryButtonStyle())
                    .accessibilityLabel("Join \(friend.name)")
            }
        }
        .frame(width: 128)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(friend.name), \(status)")
        .contextMenu {
            Button("Remove friend", role: .destructive) { confirmingRemove = true }
        }
        .confirmationDialog("Remove \(friend.name) from your friends?", isPresented: $confirmingRemove, titleVisibility: .visible) {
            Button("Remove friend", role: .destructive, action: onRemove)
        }
    }
}

/// The last tile in the bar; a count shows requests waiting for an answer.
private struct AddFriendTile: View {
    let pending: Int
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: PearTheme.Space.s2) {
                Image(systemName: "plus")
                    .font(.title2)
                    .foregroundStyle(PearTheme.text)
                    .frame(width: 80, height: 80)
                    .overlay(Circle().strokeBorder(PearTheme.lineControl, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
                    .overlay(alignment: .topTrailing) {
                        if pending > 0 {
                            Text("\(pending)")
                                .font(PearTheme.sans(12, .semibold, relativeTo: .caption))
                                .monospacedDigit()
                                .foregroundStyle(PearTheme.ink)
                                .frame(minWidth: 20, minHeight: 20)
                                .background(PearTheme.sandy, in: Capsule())
                        }
                    }
                Text(pending > 0 ? "\(pending) waiting" : "Add friend")
                    .font(PearTheme.sans(14, .medium, relativeTo: .subheadline))
                    .foregroundStyle(PearTheme.text)
                    .lineLimit(1)
            }
            .frame(width: 128)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(pending > 0 ? "Add friend, \(pending) requests waiting" : "Add friend")
    }
}
