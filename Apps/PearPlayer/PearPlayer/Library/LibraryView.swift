import PearCloud
import PearLibrary
import SwiftUI

struct LibraryView: View {
    let model: PlayerModel

    private enum LibraryFilter: Hashable { case all, playable }

    @State private var filter: LibraryFilter? = .all
    #if os(macOS)
    @State private var path = NavigationPath()
    #endif

    private var playableOnly: Bool { filter == .playable }

    var body: some View {
        screen
            .task { await model.library.load() }
            .onChange(of: model.library.state) { _, state in
                if state == .failed(.signedOut) { Task { await model.sessionExpired() } }
            }
    }

    #if os(macOS)
    @ViewBuilder private var screen: some View {
        NavigationSplitView {
            sidebar
        } detail: {
            NavigationStack(path: $path) {
                content
                    .background(PearTheme.bgField)
                    .navigationTitle(playableOnly ? "Playable on this device" : "All games")
                    .navigationDestination(for: CatalogEntry.self) { GameDetailView(entry: $0, model: model) }
                    .toolbarBackground(PearTheme.bgWindow, for: .windowToolbar)
                    .toolbarBackground(.visible, for: .windowToolbar)
                    .toolbar {
                        ToolbarItem(placement: .primaryAction) {
                            Button {
                                Task { await model.library.refresh() }
                            } label: {
                                Label("Refresh", systemImage: "arrow.clockwise")
                            }
                            .disabled(model.library.isLoading)
                            .help("Refresh library")
                            .keyboardShortcut("r")
                        }
                    }
            }
        }
        .frame(minWidth: 760, minHeight: 520)
        .onChange(of: filter) { path = NavigationPath() }
        .onChange(of: model.library.query) { path = NavigationPath() }
    }

    @ViewBuilder private var sidebar: some View {
        @Bindable var library = model.library
        ScrollView {
            VStack(alignment: .leading, spacing: PearTheme.Space.s1) {
                Text("Library")
                    .font(.headline)
                    .foregroundStyle(PearTheme.text)
                    .padding(.horizontal, PearTheme.Space.s2)
                    .padding(.vertical, PearTheme.Space.s2)
                    .accessibilityAddTraits(.isHeader)
                SidebarRow(
                    title: "All games", symbol: "square.grid.2x2", count: library.entries.count,
                    selected: filter != .playable
                ) { filter = .all }
                SidebarRow(
                    title: "Playable here", symbol: "checkmark.circle", count: playableCount,
                    selected: playableOnly
                ) { filter = .playable }
                .help("Playable on this device")
            }
            .padding(PearTheme.Space.s2)
            .accessibilityElement(children: .contain)
        }
        .background(PearTheme.bgPanel)
        .searchable(text: $library.query, placement: .sidebar, prompt: "Search games")
        .navigationSplitViewColumnWidth(min: 220, ideal: 240, max: 300)
        .safeAreaInset(edge: .bottom, spacing: 0) { accountRow }
    }

    private var playableCount: Int {
        let library = model.library
        return library.entries.filter { library.playability(of: $0).isPlayable }.count
    }

    private var accountName: String {
        if case .signedIn(let account) = model.phase, !account.displayName.isEmpty { return account.displayName }
        return "Signed in"
    }

    private var accountRow: some View {
        VStack(spacing: 0) {
            Rectangle().fill(PearTheme.line).frame(height: 1)
            Menu {
                Text(accountName)
                Button("Sign out", role: .destructive) { Task { await model.signOut() } }
            } label: {
                HStack(spacing: 10) {
                    Text(String(accountName.prefix(1)).uppercased())
                        .font(.caption.bold())
                        .foregroundStyle(PearTheme.onAccent)
                        .frame(width: 24, height: 24)
                        .background(PearTheme.accent, in: RoundedRectangle(cornerRadius: PearTheme.radiusControl))
                        .accessibilityHidden(true)
                    Text(accountName).foregroundStyle(PearTheme.text).lineLimit(1)
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.caption2)
                        .foregroundStyle(PearTheme.textSecondary)
                        .accessibilityHidden(true)
                }
                .contentShape(Rectangle())
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .accessibilityLabel("Account, \(accountName)")
        }
        .background(PearTheme.bgPanel)
    }
    #else
    @ViewBuilder private var screen: some View {
        @Bindable var library = model.library
        NavigationStack {
            content
                .background(PearTheme.bgField)
                .navigationTitle("Library")
                .navigationDestination(for: CatalogEntry.self) { GameDetailView(entry: $0, model: model) }
                .searchable(text: $library.query, prompt: "Search games")
                .toolbarBackground(PearTheme.bgWindow, for: .navigationBar)
                .toolbarBackground(.visible, for: .navigationBar)
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            Task { await model.library.refresh() }
                        } label: {
                            Label("Refresh", systemImage: "arrow.clockwise")
                        }
                        .disabled(model.library.isLoading)
                        .help("Refresh library")
                    }
                    ToolbarItem(placement: .automatic) {
                        Toggle(
                            "Playable only",
                            systemImage: playableOnly
                                ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle",
                            isOn: Binding(get: { playableOnly }, set: { filter = $0 ? .playable : .all })
                        )
                        .toggleStyle(PearFilterToggleStyle())
                        .labelStyle(.titleAndIcon)
                        .help("Playable on this device")
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
                        .help("Account")
                    }
                }
        }
    }
    #endif

    /// Search matches, playable games first; server order is kept inside each group.
    private var visible: [CatalogEntry] {
        let library = model.library
        let matches = library.filtered
        let playable = matches.filter { library.playability(of: $0).isPlayable }
        if playableOnly { return playable }
        return playable + matches.filter { !library.playability(of: $0).isPlayable }
    }

    @ViewBuilder private var content: some View {
        let library = model.library
        if library.entries.isEmpty {
            switch library.state {
            case .idle, .loading:
                ProgressView("Loading games…").frame(maxWidth: .infinity, maxHeight: .infinity)
            case .failed(.message(let text)):
                VStack(spacing: 12) {
                    Text(text).foregroundStyle(PearTheme.error).multilineTextAlignment(.center)
                    Button("Retry") { Task { await library.refresh() } }
                        .buttonStyle(PearSecondaryButtonStyle())
                }
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .failed(.signedOut):
                // `onChange` above sends the player back to sign in.
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case .loaded:
                ContentUnavailableView(
                    "No games yet", systemImage: "gamecontroller",
                    description: Text("Games published to Pear show up here."))
            }
        } else if library.filtered.isEmpty {
            ContentUnavailableView.search(text: library.query)
        } else if visible.isEmpty {
            let query = library.query.trimmingCharacters(in: .whitespacesAndNewlines)
            ContentUnavailableView {
                Label("Nothing playable on this device yet", systemImage: "gamecontroller")
            } description: {
                Text(query.isEmpty
                    ? "Games that need a controller or an iPhone are hidden."
                    : "No playable game matches “\(query)”.")
            } actions: {
                Button("Show all games") { filter = .all }
                    .buttonStyle(PearSecondaryButtonStyle())
            }
        } else {
            ScrollView {
                if case .failed(.message(let text)) = library.state {
                    HStack {
                        Text(text).font(.callout).foregroundStyle(PearTheme.error)
                        Spacer()
                        Button("Retry") { Task { await library.refresh() } }
                            .buttonStyle(PearSecondaryButtonStyle())
                    }
                    .padding(.horizontal)
                    .padding(.top, 8)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 280), spacing: 12)], spacing: 12) {
                    ForEach(visible) { entry in
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

#if os(macOS)
/// A sidebar row drawn from the theme tokens: the system selection fill is the tint, which puts white text on
/// light-green in dark mode.
private struct SidebarRow: View {
    let title: String
    let symbol: String
    let count: Int
    let selected: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: PearTheme.Space.s2) {
                Image(systemName: symbol)
                    .foregroundStyle(selected ? PearTheme.text : PearTheme.textSecondary)
                    .frame(width: 20)
                Text(title).foregroundStyle(PearTheme.text)
                Spacer()
                Text("\(count)")
                    .monospacedDigit()
                    .foregroundStyle(selected ? PearTheme.text : PearTheme.textSecondary)
            }
            .padding(.horizontal, PearTheme.Space.s2)
            .frame(minHeight: PearTheme.rowHeight)
            .background(
                selected ? PearTheme.bgSelected : (hovering ? PearTheme.bgHover : Color.clear),
                in: RoundedRectangle(cornerRadius: PearTheme.radiusControl)
            )
            .contentShape(RoundedRectangle(cornerRadius: PearTheme.radiusControl))
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
#endif

private struct GameCard: View {
    let entry: CatalogEntry
    let playability: Playability
    @State private var hovering = false

    /// The sensor the game requires; hidden when the status line already names it as the blocker.
    private var tierBadge: String? {
        if case .needsTier = playability { return nil }
        return entry.tierLabel.map { "Requires \($0.lowercased())" }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(entry.title.isEmpty ? "Untitled game" : entry.title)
                    .font(.headline)
                    .foregroundStyle(PearTheme.text)
                    .lineLimit(2)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.bold())
                    .foregroundStyle(PearTheme.textSecondary)
                    .accessibilityHidden(true)
            }
            Text(entry.author.isEmpty ? "Unknown author" : entry.author)
                .font(PearTheme.small)
                .foregroundStyle(PearTheme.textSecondary)
                .lineLimit(1)
                .help(entry.author)
            HStack {
                Label {
                    Text(entry.runModeLabel).foregroundStyle(PearTheme.text)
                } icon: {
                    Image(systemName: entry.runMode == "device" ? "iphone" : "tv")
                        .foregroundStyle(PearTheme.textSecondary)
                }
                Spacer()
                if let tier = tierBadge {
                    Text(tier)
                        .font(PearTheme.small.bold())
                        .foregroundStyle(PearTheme.text)
                        .padding(.horizontal, PearTheme.Space.s2)
                        .padding(.vertical, 2)
                        .background(PearTheme.warnSoft, in: RoundedRectangle(cornerRadius: PearTheme.radiusControl))
                }
            }
            .font(PearTheme.small)
            .frame(minHeight: 22)
            Label {
                Text(playability.summary)
                    .fontWeight(.medium)
                    .foregroundStyle(playability.isPlayable ? PearTheme.ok : PearTheme.text)
            } icon: {
                Image(systemName: playability.symbol)
                    .foregroundStyle(playability.isPlayable ? PearTheme.ok : PearTheme.textSecondary)
            }
            .font(PearTheme.small)
        }
        .padding(PearTheme.Space.s3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            hovering ? PearTheme.bgHover : PearTheme.bgPanel,
            in: RoundedRectangle(cornerRadius: PearTheme.radiusWindow)
        )
        .overlay {
            RoundedRectangle(cornerRadius: PearTheme.radiusWindow)
                .strokeBorder(hovering ? PearTheme.lineControl : PearTheme.line, lineWidth: 1)
        }
        .contentShape(RoundedRectangle(cornerRadius: PearTheme.radiusWindow))
        .onHover { hovering = $0 }
        #if os(macOS)
        .pointerStyle(.link)
        #endif
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
        case .needsTier(let tier): "Needs \(CatalogEntry.tierName(tier)?.lowercased() ?? "tier \(tier)")"
        }
    }

    var symbol: String {
        switch self {
        case .playable: "checkmark.circle.fill"
        case .needsController: "gamecontroller"
        case .needsPhone: "iphone"
        case .needsDisplay: "display"
        case .needsTier: "dot.radiowaves.left.and.right"
        }
    }

    /// Why the game cannot be played here; nil when it can.
    var explanation: String? {
        switch self {
        case .playable: nil
        case .needsPhone: "This game is made to run on an iPhone."
        case .needsController: "Controller input isn't in this app yet."
        case .needsDisplay: "This game needs a screen to show it."
        case .needsTier(let tier):
            "This game needs \(CatalogEntry.tierName(tier)?.lowercased() ?? "tier \(tier)"), which this device can't provide."
        }
    }
}

extension CatalogEntry {
    /// What a tier asks of the player's devices (`CapabilityTier`: tier 2 = position, tier 3 = heart rate); nil for tier 1.
    static func tierName(_ tier: Int) -> String? {
        switch min(max(tier, 1), 3) {
        case 2: "Position tracking"
        case 3: "Heart rate"
        default: nil
        }
    }

    var tierLabel: String? { Self.tierName(requiredTier) }

    /// overview.md Module 1, Capability Tiers.
    var tierDetail: String {
        switch min(max(requiredTier, 1), 3) {
        case 2: "Tier 2, position tracking"
        case 3: "Tier 3, heart rate"
        default: "Tier 1, orientation and touch"
        }
    }

    var runModeLabel: String { runMode == "device" ? "On your phone" : "On a screen" }

    /// overview.md Module 7, Run Mode.
    var runModeExplanation: String {
        runMode == "device"
            ? "The game runs on your own phone, with no separate screen."
            : "A separate screen shows the game, and your devices are the controllers."
    }
}
