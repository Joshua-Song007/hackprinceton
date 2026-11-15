import PearCloud
import PearLibrary
import SwiftUI

struct LibraryView: View {
    let model: PlayerModel

    private enum LibraryFilter: Hashable { case all, playable }

    @State private var filter: LibraryFilter? = .all
    @State private var path = NavigationPath()
    @State private var showProfile = false

    private var playableOnly: Bool { filter == .playable }

    var body: some View {
        screen
            .task {
                await model.library.load()
                #if DEBUG
                // Screenshots: `PEAR_DEV_OPEN=<title>` opens that game's page after the library loads.
                if let title = ProcessInfo.processInfo.environment["PEAR_DEV_OPEN"],
                   let entry = model.library.entries.first(where: { $0.title == title }) { path.append(entry) }
                // Smoke test: `PEAR_DEV_PLAY=<title>` runs Play on that game (same path as the Play button).
                if let title = ProcessInfo.processInfo.environment["PEAR_DEV_PLAY"],
                   let entry = model.library.entries.first(where: { $0.title == title }) {
                    do { try await model.play(entry); print("PEAR_DEV_PLAY ok: \(title)") }
                    catch { print("PEAR_DEV_PLAY failed: \(error)") }
                }
                #endif
            }
            .onChange(of: model.library.state) { _, state in
                if state == .failed(.signedOut) { Task { await model.sessionExpired() } }
            }
            .sheet(isPresented: $showProfile) { ProfileSettingsSheet(model: model) }
            .modifier(PlaySurface(model: model))
    }

    #if os(macOS)
    @ViewBuilder private var screen: some View {
        NavigationSplitView {
            sidebar
        } detail: {
            NavigationStack(path: $path) {
                content
                    .background { PearBackdrop(seed: featured?.id) }
                    .navigationTitle(playableOnly ? "Playable on this device" : "All games")
                    .navigationDestination(for: CatalogEntry.self) { GameDetailView(entry: $0, model: model) }
                    .navigationDestination(for: PlayRequest.self) { GameDetailView(entry: $0.entry, model: model, autoplay: true) }
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

    private var accountRow: some View {
        VStack(spacing: 0) {
            Rectangle().fill(PearTheme.line).frame(height: 1)
            Menu {
                Text(accountName)
                Button("Profile settings…") { showProfile = true }
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
    @Environment(\.horizontalSizeClass) private var sizeClass
    @ViewBuilder private var screen: some View {
        @Bindable var library = model.library
        NavigationStack(path: $path) {
            content
                .background { PearBackdrop(seed: featured?.id) }
                .navigationTitle("Home")
                .navigationBarTitleDisplayMode(.inline)
                .navigationDestination(for: CatalogEntry.self) { GameDetailView(entry: $0, model: model) }
                .navigationDestination(for: PlayRequest.self) { GameDetailView(entry: $0.entry, model: model, autoplay: true) }
                .searchable(text: $library.query, prompt: "Search games")
                .toolbar {
                    ToolbarItem(placement: .principal) {
                        Image("PearMark").resizable().scaledToFit().frame(height: 28).accessibilityLabel("Pear")
                    }
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
                        Menu {
                            if case .signedIn(let account) = model.phase {
                                Text(account.displayName.isEmpty ? "Signed in" : account.displayName)
                            }
                            Button("Profile settings…") { showProfile = true }
                            Button("Sign out", role: .destructive) { Task { await model.signOut() } }
                        } label: {
                            AvatarView(name: accountName, size: 32, accountId: accountId)
                        }
                        .accessibilityLabel("Account, \(accountName)")
                        .help("Account")
                    }
                }
        }
    }
    #endif

    private var playableCount: Int {
        let library = model.library
        return library.entries.filter { library.playability(of: $0).isPlayable }.count
    }

    private var accountId: String? {
        if case .signedIn(let account) = model.phase { return account.id }
        return nil
    }

    private var accountName: String {
        if case .signedIn(let account) = model.phase, !account.displayName.isEmpty { return account.displayName }
        return "Signed in"
    }

    private var deviceName: String {
        switch model.library.profile.kind {
        case .iPhone: "iPhone"
        case .iPad: "iPad"
        case .mac: "Mac"
        }
    }

    private var greetingSummary: String {
        switch model.library.state {
        case .idle, .loading where model.library.entries.isEmpty: "Finding games for you…"
        default:
            playableCount == 1
                ? "1 game is ready to play on this \(deviceName)."
                : "\(playableCount) games are ready to play on this \(deviceName)."
        }
    }

    /// Search matches, playable games first; server order is kept inside each group.
    private var visible: [CatalogEntry] {
        let library = model.library
        let matches = library.filtered
        let playable = matches.filter { library.playability(of: $0).isPlayable }
        if playableOnly { return playable }
        return playable + matches.filter { !library.playability(of: $0).isPlayable }
    }

    #if os(iOS)
    private var compact: Bool { sizeClass == .compact }
    #else
    private let compact = false
    #endif

    private var searching: Bool { !model.library.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// The hero: the first playable game in server order, hidden while searching.
    private var featured: CatalogEntry? {
        searching ? nil : visible.first { model.library.playability(of: $0).isPlayable }
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 40) {
                VStack(alignment: .leading, spacing: PearTheme.Space.s6) {
                    ProfileHeader(name: accountName, accountId: accountId, summary: greetingSummary)
                    if let featured {
                        FeaturedHero(entry: featured, compact: compact) {
                            path.append(PlayRequest(entry: featured))
                        } onOpen: {
                            path.append(featured)
                        }
                    }
                }
                FriendsBar(model: model) { friend in
                    if let id = friend.playing?.gameId,
                       let entry = model.library.entries.first(where: { $0.id == id }) {
                        path.append(PlayRequest(entry: entry))
                    }
                }
                gamesSection
            }
            .padding(.horizontal, compact ? 20 : 28)
            .padding(.vertical, PearTheme.Space.s6)
            .frame(maxWidth: 1400)
            .frame(maxWidth: .infinity)
        }
        .refreshable {
            await model.library.refresh()
            await model.refreshFriends()
        }
    }

    private func shelfTitle(_ title: String) -> some View {
        Text(title.uppercased())
            .font(PearTheme.header(compact ? 13 : 15))
            .tracking(PearTheme.headerTracking)
            .foregroundStyle(PearTheme.textSecondary)
            .accessibilityLabel(title)
            .accessibilityAddTraits(.isHeader)
    }

    /// A horizontal row of posters that snaps to each game.
    @ViewBuilder private func shelf(_ title: String, _ entries: [CatalogEntry]) -> some View {
        if !entries.isEmpty {
            VStack(alignment: .leading, spacing: PearTheme.Space.s4) {
                shelfTitle(title)
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: compact ? 14 : 20) {
                        ForEach(entries) { entry in
                            poster(entry).frame(width: compact ? 150 : 200)
                        }
                    }
                    .scrollTargetLayout()
                }
                .scrollTargetBehavior(.viewAligned)
                .scrollClipDisabled()
            }
        }
    }

    private func poster(_ entry: CatalogEntry) -> some View {
        NavigationLink(value: entry) {
            GameCard(entry: entry, playability: model.library.playability(of: entry))
        }
        .buttonStyle(PearPressStyle())
    }

    @ViewBuilder private var gamesSection: some View {
        let library = model.library
        VStack(alignment: .leading, spacing: 40) {
            if case .failed(.message(let text)) = library.state, !library.entries.isEmpty {
                HStack {
                    Text(text).font(.callout).foregroundStyle(PearTheme.error)
                    Spacer()
                    Button("Retry") { Task { await library.refresh() } }
                        .buttonStyle(PearSecondaryButtonStyle())
                }
            }
            if library.entries.isEmpty {
                switch library.state {
                case .idle, .loading:
                    ProgressView("Loading games…").frame(maxWidth: .infinity, minHeight: 240)
                case .failed(.message(let text)):
                    VStack(spacing: 12) {
                        Text(text).foregroundStyle(PearTheme.error).multilineTextAlignment(.center)
                        Button("Retry") { Task { await library.refresh() } }
                            .buttonStyle(PearSecondaryButtonStyle())
                    }
                    .padding()
                    .frame(maxWidth: .infinity, minHeight: 240)
                case .failed(.signedOut):
                    // `onChange` above sends the player back to sign in.
                    ProgressView().frame(maxWidth: .infinity, minHeight: 240)
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
            } else if searching {
                VStack(alignment: .leading, spacing: PearTheme.Space.s4) {
                    shelfTitle("Results")
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: compact ? 140 : 180), spacing: 20)], spacing: 24) {
                        ForEach(visible) { poster($0) }
                    }
                }
            } else {
                let ready = visible.filter { library.playability(of: $0).isPlayable && $0.id != featured?.id }
                shelf("Ready to play on this \(deviceName)", ready)
                shelf("Needs another device", visible.filter { !library.playability(of: $0).isPlayable })
            }
        }
        .animation(PearTheme.motion, value: filter)
    }
}

/// A shelf route that opens the game page and starts Play at once.
struct PlayRequest: Hashable {
    let entry: CatalogEntry
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
        return entry.tierLabel
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Color.clear
                .aspectRatio(3 / 4, contentMode: .fit)
                .overlay { CoverArt(seed: entry.id) }
                .overlay(alignment: .bottomLeading) {
                    Text(entry.title.isEmpty ? "Untitled game" : entry.title)
                        .font(PearTheme.sans(18, .semibold, relativeTo: .headline))
                        .foregroundStyle(PearTheme.paper)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                        .padding(14)
                        .padding(.top, 36)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(PearTheme.scrim)
                }
                .overlay(alignment: .topLeading) {
                    if let tier = tierBadge {
                        CoverBadge(text: tier, symbol: "dot.radiowaves.left.and.right", fill: PearTheme.sandy)
                            .padding(10)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: PearTheme.radiusPoster))
                .overlay {
                    RoundedRectangle(cornerRadius: PearTheme.radiusPoster)
                        .strokeBorder(PearTheme.accent, lineWidth: hovering ? 3 : 0)
                }
                .shadow(color: PearTheme.ink.opacity(0.35), radius: 14, y: 8)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.author.isEmpty ? "Unknown author" : "by \(entry.author)")
                    .font(PearTheme.small)
                    .foregroundStyle(PearTheme.textSecondary)
                    .lineLimit(1)
                    .help(entry.author)
                if !playability.isPlayable {
                    Label {
                        // Tea text on Clay only from 24 pt: the word stays Paper, the icon carries the colour.
                        Text(playability.summary)
                            .foregroundStyle(playability.isPlayable ? PearTheme.text : PearTheme.textSecondary)
                    } icon: {
                        Image(systemName: playability.symbol)
                            .foregroundStyle(playability.isPlayable ? PearTheme.ok : PearTheme.textSecondary)
                    }
                    .font(PearTheme.sans(13, .medium, relativeTo: .subheadline))
                    .lineLimit(1)
                }
            }
            .padding(.horizontal, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        #if os(macOS)
        .pointerStyle(.link)
        #endif
        .animation(PearTheme.motionFast, value: hovering)
        .accessibilityElement(children: .combine)
    }
}

/// The featured game: full-width art, display title on a scrim, and Play as the biggest button on the screen.
private struct FeaturedHero: View {
    let entry: CatalogEntry
    let compact: Bool
    let onPlay: () -> Void
    let onOpen: () -> Void

    var body: some View {
        CoverArt(seed: entry.id)
            .frame(height: compact ? 340 : 440)
            .frame(maxWidth: .infinity)
            .overlay(alignment: .bottomLeading) {
                VStack(alignment: .leading, spacing: PearTheme.Space.s3) {
                    if let tier = entry.tierLabel {
                        CoverBadge(text: tier, symbol: "dot.radiowaves.left.and.right", fill: PearTheme.sandy)
                    }
                    Text(entry.title.isEmpty ? "Untitled game" : entry.title)
                        .font(PearTheme.display(compact ? 40 : 64))
                        .tracking(compact ? -0.3 : -0.6)
                        .foregroundStyle(PearTheme.paper)
                        .lineLimit(2)
                        .minimumScaleFactor(0.6)
                        .frame(maxWidth: compact ? .infinity : 560, alignment: .leading)
                    Text(entry.author.isEmpty ? entry.runModeLabel : "by \(entry.author) · \(entry.runModeLabel)")
                        .font(PearTheme.sans(compact ? 15 : 18, relativeTo: .title3))
                        .foregroundStyle(PearTheme.paper.opacity(0.85))
                    HStack(spacing: PearTheme.Space.s3) {
                        Button(action: onPlay) {
                            Label("Play", systemImage: "play.fill")
                                .font(PearTheme.sans(18, .semibold))
                                .frame(minWidth: compact ? 120 : 160, minHeight: 52)
                        }
                        .buttonStyle(PearPrimaryButtonStyle())
                        Button("Details", action: onOpen)
                            .buttonStyle(PearSecondaryButtonStyle())
                    }
                    .padding(.top, PearTheme.Space.s2)
                    // Art is always dark under the scrim, so the hero's controls take the Emerald theme.
                    .environment(\.colorScheme, .dark)
                }
                .padding(compact ? 20 : 36)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(PearTheme.scrim)
            }
            .clipShape(RoundedRectangle(cornerRadius: 24))
            .shadow(color: PearTheme.ink.opacity(0.4), radius: 24, y: 14)
            .contentShape(RoundedRectangle(cornerRadius: 24))
            .onTapGesture(perform: onOpen)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Featured, \(entry.title)")
    }
}

/// The kit's tag (Powder) or badge (Sandy) on top of cover art: Ink text, 4 pt corners.
struct CoverBadge: View {
    let text: String
    let symbol: String
    let fill: Color

    var body: some View {
        Label(text, systemImage: symbol)
            .font(PearTheme.sans(12, .semibold, relativeTo: .caption))
            .foregroundStyle(PearTheme.ink)
            .padding(.horizontal, PearTheme.Space.s2)
            .frame(minHeight: 24)
            .background(fill, in: RoundedRectangle(cornerRadius: PearTheme.radiusTag))
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

/// Shows the running game: full screen on iOS, a sheet on the Mac. Leaving (or dismissing) stops the session.
private struct PlaySurface: ViewModifier {
    let model: PlayerModel

    private var session: Binding<GameSession?> {
        Binding(get: { model.activeSession }, set: { if $0 == nil { model.leaveGame() } })
    }

    func body(content: Content) -> some View {
        #if os(iOS)
        content.fullScreenCover(item: session) { PlayView(session: $0, onLeave: model.leaveGame) }
        #else
        content.sheet(item: session) { PlayView(session: $0, onLeave: model.leaveGame) }
        #endif
    }
}
