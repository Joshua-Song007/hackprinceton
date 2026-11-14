import OmniCloud
import OmniLibrary
import SwiftUI

struct LibraryView: View {
    let model: PlayerModel

    var body: some View {
        @Bindable var library = model.library
        NavigationStack {
            content
                .navigationTitle("Library")
                .navigationDestination(for: CatalogEntry.self) { GameDetailView(entry: $0, model: model) }
                .searchable(text: $library.query, prompt: "Search games")
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            Task { await model.library.refresh() }
                        } label: {
                            Label("Refresh", systemImage: "arrow.clockwise")
                        }
                        .disabled(model.library.isLoading)
                    }
                    ToolbarItem(placement: .automatic) {
                        Menu {
                            if case .signedIn(let account) = model.phase {
                                Text(account.displayName.isEmpty ? "Signed in" : account.displayName)
                            }
                            Button("Sign out", role: .destructive) { Task { await model.signOut() } }
                        } label: {
                            Label("Account", systemImage: "person.crop.circle")
                        }
                    }
                }
        }
        .task { await model.library.load() }
        .onChange(of: model.library.state) { _, state in
            if state == .failed(.signedOut) { Task { await model.sessionExpired() } }
        }
    }

    @ViewBuilder private var content: some View {
        let library = model.library
        if library.entries.isEmpty {
            switch library.state {
            case .idle, .loading:
                ProgressView("Loading games…").frame(maxWidth: .infinity, maxHeight: .infinity)
            case .failed(.message(let text)):
                VStack(spacing: 12) {
                    Text(text).multilineTextAlignment(.center)
                    Button("Retry") { Task { await library.refresh() } }
                }
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .failed(.signedOut):
                // `onChange` above sends the player back to sign in.
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case .loaded:
                ContentUnavailableView(
                    "No games yet", systemImage: "gamecontroller",
                    description: Text("Games published to Omni show up here."))
            }
        } else if library.filtered.isEmpty {
            ContentUnavailableView.search(text: library.query)
        } else {
            ScrollView {
                if case .failed(.message(let text)) = library.state {
                    HStack {
                        Text(text).font(.callout)
                        Spacer()
                        Button("Retry") { Task { await library.refresh() } }
                    }
                    .padding(.horizontal)
                    .padding(.top, 8)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 280), spacing: 12)], spacing: 12) {
                    ForEach(library.filtered) { entry in
                        NavigationLink(value: entry) {
                            GameCard(entry: entry, playability: library.playability(of: entry))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding()
            }
            .refreshable { await library.refresh() }
        }
    }
}

private struct GameCard: View {
    let entry: CatalogEntry
    let playability: Playability

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(entry.title.isEmpty ? "Untitled game" : entry.title).font(.headline)
            Text(entry.author.isEmpty ? "Unknown author" : entry.author)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            HStack {
                Label(entry.runModeLabel, systemImage: entry.runMode == "device" ? "iphone" : "tv")
                Spacer()
                Text("Tier \(entry.requiredTier)")
                    .font(.caption.bold())
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(Color.secondary.opacity(0.2), in: Capsule())
            }
            .font(.caption)
            Label(playability.summary, systemImage: playability.isPlayable ? "checkmark.circle.fill" : "exclamationmark.circle")
                .font(.caption)
                .foregroundStyle(playability.isPlayable ? Color.green : Color.orange)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
    }
}

extension Playability {
    /// Symbol plus words, never colour alone.
    var summary: String {
        switch self {
        case .playable: "Playable on this device"
        case .needsPhone: "Needs an iPhone"
        case .needsController: "Needs a controller"
        case .needsDisplay: "Needs a display"
        case .needsTier(let tier): "Needs tier \(tier)"
        }
    }
}

extension CatalogEntry {
    var runModeLabel: String { runMode == "device" ? "On your phone" : "On a screen" }

    /// overview.md Module 7, Run Mode.
    var runModeExplanation: String {
        runMode == "device"
            ? "The game runs on your own phone, with no separate screen."
            : "A separate screen shows the game, and your devices are the controllers."
    }
}
