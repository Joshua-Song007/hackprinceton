import PearCloud
import SwiftUI

/// The top of the home screen: avatar, a display greeting and a one-line summary.
struct ProfileHeader: View {
    let name: String
    var accountId: String?
    let summary: String
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var compact: Bool { sizeClass == .compact }
    #else
    private let compact = false
    #endif

    private var firstName: String {
        name.split(separator: " ").first.map(String.init) ?? name
    }

    var body: some View {
        HStack(spacing: compact ? PearTheme.Space.s4 : PearTheme.Space.s6) {
            AvatarView(name: name, size: compact ? 48 : 64, accountId: accountId)
                .padding(4)
                .overlay(Circle().strokeBorder(PearTheme.accent, lineWidth: 2))
            VStack(alignment: .leading, spacing: PearTheme.Space.s1) {
                // Brand voice: no exclamation marks.
                Text("Hello, \(firstName)")
                    .font(PearTheme.display(compact ? 30 : 40))
                    .tracking(-0.4)
                    .foregroundStyle(PearTheme.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text(summary)
                    .font(PearTheme.sans(compact ? 15 : 18, relativeTo: .title3))
                    .foregroundStyle(PearTheme.textSecondary)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// A horizontal row of friends; the ones in a game come first, then an add tile.
struct FriendsBar: View {
    let model: PlayerModel
    /// Opens the game page of the game this friend is in.
    let onJoin: (FriendEntry) -> Void
    @State private var showAdd = false

    private var sorted: [FriendEntry] {
        model.friends.filter { $0.playing != nil } + model.friends.filter { $0.playing == nil }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: PearTheme.Space.s4) {
            HStack(alignment: .firstTextBaseline, spacing: PearTheme.Space.s3) {
                Text("FRIENDS")
                    .font(PearTheme.header(15))
                    .tracking(PearTheme.headerTracking)
                    .foregroundStyle(PearTheme.textSecondary)
                    .foregroundStyle(PearTheme.text)
                Text("\(model.friends.filter { $0.playing != nil }.count) playing now · \(model.friends.count) friends")
                    .font(PearTheme.small)
                    .monospacedDigit()
                    .foregroundStyle(PearTheme.textSecondary)
                if model.friendsError != nil {
                    Text("Friends didn't load. Pull down to refresh.").font(PearTheme.small).foregroundStyle(PearTheme.error)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: PearTheme.Space.s4) {
                    ForEach(sorted) { friend in
                        FriendTile(
                            friend: friend,
                            onJoin: { onJoin(friend) },
                            onRemove: { Task { await model.removeFriend(friend.id) } })
                    }
                    AddFriendTile(pending: model.requests.incoming.count) { showAdd = true }
                }
                .padding(.vertical, PearTheme.Space.s1)
            }
            .scrollClipDisabled()
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
