import PearCloud
import PearLibrary
import SwiftUI
#if os(iOS)
#endif

struct LibraryView: View {
    let model: PlayerModel

    private enum LibraryFilter: Hashable { case all, playable }
    private enum Section: Hashable { case discover, friends }

    @State private var filter: LibraryFilter? = .all
    @State private var section: Section = .discover
    @State private var path = NavigationPath()
    @State private var showProfile = false
    @Environment(\.horizontalSizeClass) private var sizeClass

    private var playableOnly: Bool { filter == .playable }

    var body: some View {
        NavigationStack(path: $path) {
            dashboard
                .background(PearTheme.bgWindow.ignoresSafeArea())
                .navigationDestination(for: CatalogEntry.self) { GameDetailView(entry: $0, model: model) }
                .navigationDestination(for: PlayRequest.self) { GameDetailView(entry: $0.entry, model: model, autoplay: true, lobby: $0.lobby) }
                #if os(iOS)
                .toolbar(.hidden, for: .navigationBar)
                #else
                .toolbar(.hidden, for: .windowToolbar)
                #endif
        }
        .task {
            await model.library.load()
            #if DEBUG
            // Screenshots: `PEAR_DEV_OPEN=<title>` opens that game's page after the library loads.
            if let title = ProcessInfo.processInfo.environment["PEAR_DEV_OPEN"],
               let entry = model.library.entries.first(where: { $0.title == title }) { path.append(entry) }
            // Smoke test: `PEAR_DEV_PLAY=<title>` runs Play on that game (same path as the Play button).
            if let title = ProcessInfo.processInfo.environment["PEAR_DEV_PLAY"],
               let entry = model.library.entries.first(where: { $0.title == title }) {
                // `PEAR_DEV_LOBBY=<code>` picks the lobby for a lobby-based game (Quick Draw).
                let lobby = ProcessInfo.processInfo.environment["PEAR_DEV_LOBBY"]
                do { try await model.play(entry, lobby: lobby); print("PEAR_DEV_PLAY ok: \(title)") }
                catch { print("PEAR_DEV_PLAY failed: \(error)") }
            }
            #endif
        }
        .task { await model.refreshFriends() }
        .onChange(of: model.library.state) { _, state in
            if state == .failed(.signedOut) { Task { await model.sessionExpired() } }
        }
        .onChange(of: filter) { path = NavigationPath() }
        .onChange(of: model.library.query) { path = NavigationPath() }
        .sheet(isPresented: $showProfile) { ProfileSettingsSheet(model: model) }
        .modifier(PlaySurface(model: model))
        #if os(macOS)
        .frame(minWidth: 760, minHeight: 520)
        #endif
    }

    #if os(iOS)
    private var compact: Bool { sizeClass == .compact }
    #else
    private let compact = false
    #endif

    // MARK: Layout

    private var dashboard: some View {
        HStack(spacing: 0) {
            if !compact { sidebar }
            VStack(alignment: .leading, spacing: 0) {
                topBar
                if compact { tabs }
                ScrollView {
                    VStack(alignment: .leading, spacing: 28) {
                        switch section {
                        case .discover: discover
                        case .friends: friendsPage
                        }
                    }
                    .padding(.horizontal, compact ? 16 : 32)
                    .padding(.bottom, 32)
                    .frame(maxWidth: 1400)
                    .frame(maxWidth: .infinity)
                }
                .refreshable {
                    await model.library.refresh()
                    await model.refreshFriends()
                }
            }
        }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: PearTheme.Space.s2) {
            HStack(spacing: 10) {
                Image("PearMark").resizable().scaledToFit().frame(height: 30).accessibilityHidden(true)
                Text("pear").font(PearTheme.display(28)).foregroundStyle(PearTheme.text)
            }
            .padding(.horizontal, PearTheme.Space.s3)
            .padding(.top, 28)
            .padding(.bottom, 32)
            NavRow(title: "Discover", symbol: "safari", badge: 0, selected: section == .discover) { section = .discover }
            NavRow(title: "Friends", symbol: "person.2", badge: model.requests.incoming.count, selected: section == .friends) { section = .friends }
            Spacer()
            Button { showProfile = true } label: {
                HStack(spacing: 10) {
                    AvatarView(name: accountName, size: 36, accountId: accountId)
                    Text(accountName)
                        .font(PearTheme.sans(15, .medium))
                        .foregroundStyle(PearTheme.text)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    Image(systemName: "gearshape").foregroundStyle(PearTheme.textSecondary)
                }
                .padding(PearTheme.Space.s3)
                .background(PearTheme.bgPanel, in: RoundedRectangle(cornerRadius: PearTheme.radiusControl))
                .overlay(RoundedRectangle(cornerRadius: PearTheme.radiusControl).strokeBorder(PearTheme.line))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Profile, \(accountName)")
        }
        .padding(PearTheme.Space.s4)
        .frame(width: 248)
        .frame(maxHeight: .infinity)
        .background(PearTheme.bgField.ignoresSafeArea())
    }

    /// Compact widths have no sidebar: a pill row switches between the two pages.
    private var tabs: some View {
        HStack(spacing: PearTheme.Space.s2) {
            Chip(title: "Discover", selected: section == .discover) { section = .discover }
            Chip(title: model.requests.incoming.isEmpty ? "Friends" : "Friends (\(model.requests.incoming.count))", selected: section == .friends) { section = .friends }
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.bottom, PearTheme.Space.s3)
    }

    private var topBar: some View {
        @Bindable var library = model.library
        return VStack(alignment: .leading, spacing: PearTheme.Space.s3) {
            HStack(spacing: PearTheme.Space.s3) {
                if !compact {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(section == .discover ? "Step into something new." : "Friends")
                            .font(PearTheme.display(30))
                            .foregroundStyle(PearTheme.text)
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                        Text(section == .discover ? greetingSummary : "\(model.friends.filter { $0.playing != nil }.count) playing now · \(model.friends.count) friends")
                            .font(PearTheme.sans(16))
                            .foregroundStyle(PearTheme.textSecondary)
                            .lineLimit(1)
                    }
                    Spacer(minLength: PearTheme.Space.s4)
                }
                searchField(text: $library.query)
                    .frame(maxWidth: compact ? .infinity : 440)
                iconButton("arrow.clockwise", label: "Refresh library") {
                    Task { await model.library.refresh(); await model.refreshFriends() }
                }
                .disabled(model.library.isLoading)
                if compact {
                    Button { showProfile = true } label: { AvatarView(name: accountName, size: 48, accountId: accountId) }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Profile, \(accountName)")
                }
            }
        }
        .padding(.horizontal, compact ? 16 : 32)
        .padding(.top, compact ? 12 : 28)
        .padding(.bottom, compact ? 12 : 20)
    }

    private func searchField(text: Binding<String>) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(PearTheme.textSecondary)
            TextField("Search games and creators", text: text)
                .textFieldStyle(.plain)
                .font(PearTheme.sans(16))
                .foregroundStyle(PearTheme.text)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                #endif
            if !text.wrappedValue.isEmpty {
                Button { text.wrappedValue = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(PearTheme.textSecondary) }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, PearTheme.Space.s4)
        .frame(height: 48)
        .background(PearTheme.bgPanel, in: RoundedRectangle(cornerRadius: PearTheme.radiusControl))
        .overlay(RoundedRectangle(cornerRadius: PearTheme.radiusControl).strokeBorder(PearTheme.line))
    }

    private func iconButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Group {
                if model.library.isLoading && symbol == "arrow.clockwise" {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: symbol).font(.system(size: 18, weight: .medium))
                }
            }
            .foregroundStyle(PearTheme.text)
            .frame(width: 48, height: 48)
            .background(PearTheme.bgPanel, in: RoundedRectangle(cornerRadius: PearTheme.radiusControl))
            .overlay(RoundedRectangle(cornerRadius: PearTheme.radiusControl).strokeBorder(PearTheme.line))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    // MARK: Pages

    @ViewBuilder private var discover: some View {
        if let featured {
            FeaturedHero(entry: featured, compact: compact) {
                path.append(PlayRequest(entry: featured))
            } onOpen: {
                path.append(featured)
            }
        }
        gamesSection
    }

    private var friendsPage: some View {
        FriendsPanel(model: model) { friend in
            if let id = friend.playing?.gameId,
               let entry = model.library.entries.first(where: { $0.id == id }) {
                path.append(PlayRequest(entry: entry, lobby: friend.playing?.lobby))
            }
        }
    }

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

    private var searching: Bool { !model.library.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// The hero: the first playable game in server order, hidden while searching.
    private var featured: CatalogEntry? {
        searching ? nil : visible.first { model.library.playability(of: $0).isPlayable }
    }

    @ViewBuilder private var gamesSection: some View {
        let library = model.library
        VStack(alignment: .leading, spacing: 20) {
            HStack(alignment: .firstTextBaseline, spacing: PearTheme.Space.s3) {
                Text(searching ? "Results" : "All games")
                    .font(PearTheme.display(28))
                    .foregroundStyle(PearTheme.text)
                    .accessibilityAddTraits(.isHeader)
                Text("\(visible.count) \(visible.count == 1 ? "game" : "games")")
                    .font(PearTheme.sans(15))
                    .foregroundStyle(PearTheme.textSecondary)
                Spacer()
            }
            HStack(spacing: PearTheme.Space.s2) {
                Chip(title: "All games", selected: !playableOnly) { filter = .all }
                Chip(title: "Playable here", selected: playableOnly) { filter = .playable }
            }
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
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: compact ? 160 : 230), spacing: 20)], spacing: 20) {
                    ForEach(visible) { entry in
                        NavigationLink(value: entry) {
                            GameCard(entry: entry, playability: library.playability(of: entry))
                        }
                        .buttonStyle(PearPressStyle())
                    }
                }
            }
        }
        .animation(PearTheme.motion, value: filter)
    }
}

/// A shelf route that opens the game page and starts Play at once.
struct PlayRequest: Hashable {
    let entry: CatalogEntry
    /// A friend's lobby to join; with none, a phone-only game opens its lobby choices instead of starting.
    var lobby: String?
}

/// A sidebar row: selected rows take the dark-green fill, others stay flat.
private struct NavRow: View {
    let title: String
    let symbol: String
    let badge: Int
    let selected: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: PearTheme.Space.s3) {
                Image(systemName: symbol)
                    .font(.system(size: 18))
                    .foregroundStyle(selected ? PearTheme.accent : PearTheme.textSecondary)
                    .frame(width: 24)
                Text(title)
                    .font(PearTheme.sans(17, selected ? .semibold : .medium))
                    .foregroundStyle(selected ? PearTheme.text : PearTheme.textSecondary)
                Spacer()
                if badge > 0 {
                    Text("\(badge)")
                        .font(PearTheme.sans(13, .semibold, relativeTo: .caption))
                        .monospacedDigit()
                        .foregroundStyle(PearTheme.text)
                        .frame(minWidth: 24, minHeight: 24)
                        .background(PearTheme.bgSelected, in: RoundedRectangle(cornerRadius: 8))
                }
            }
            .padding(.horizontal, PearTheme.Space.s3)
            .frame(height: 52)
            .background(
                selected ? PearTheme.bgSelected : (hovering ? PearTheme.bgHover : Color.clear),
                in: RoundedRectangle(cornerRadius: PearTheme.radiusControl))
            .contentShape(RoundedRectangle(cornerRadius: PearTheme.radiusControl))
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// A filter pill: lime when selected, dark panel otherwise.
private struct Chip: View {
    let title: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(PearTheme.sans(15, .medium))
                .foregroundStyle(selected ? PearTheme.onAccent : PearTheme.text)
                .padding(.horizontal, 20)
                .frame(height: 44)
                .background(selected ? PearTheme.accent : PearTheme.bgPanel, in: RoundedRectangle(cornerRadius: PearTheme.radiusControl))
                .overlay(RoundedRectangle(cornerRadius: PearTheme.radiusControl).strokeBorder(selected ? Color.clear : PearTheme.line))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

private struct GameCard: View {
    let entry: CatalogEntry
    let playability: Playability
    @State private var hovering = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Color.clear
                .aspectRatio(16 / 10, contentMode: .fit)
                .overlay { CoverArt(seed: entry.id, url: entry.coverURL) }
                .overlay(alignment: .topLeading) {
                    Text(entry.tierLabel ?? entry.runModeLabel)
                        .font(PearTheme.sans(12, .medium, relativeTo: .caption))
                        .foregroundStyle(PearTheme.text)
                        .padding(.horizontal, 10)
                        .frame(minHeight: 26)
                        .background(PearTheme.bgWindow.opacity(0.85), in: RoundedRectangle(cornerRadius: 8))
                        .padding(10)
                }
                .clipped()
            VStack(alignment: .leading, spacing: 4) {
                Text(entry.title.isEmpty ? "Untitled game" : entry.title)
                    .font(PearTheme.sans(18, .semibold, relativeTo: .headline))
                    .foregroundStyle(PearTheme.text)
                    .lineLimit(1)
                Text(entry.author.isEmpty ? "Unknown author" : "by \(entry.author)")
                    .font(PearTheme.small)
                    .foregroundStyle(PearTheme.textSecondary)
                    .lineLimit(1)
                Label {
                    Text(playability.isPlayable ? "Playable here" : playability.summary)
                } icon: {
                    Image(systemName: playability.symbol)
                        .foregroundStyle(playability.isPlayable ? PearTheme.ok : PearTheme.textSecondary)
                }
                .font(PearTheme.sans(13, .medium, relativeTo: .subheadline))
                .foregroundStyle(PearTheme.textSecondary)
                .lineLimit(1)
                .padding(.top, 4)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(PearTheme.bgPanel)
        .clipShape(RoundedRectangle(cornerRadius: PearTheme.radiusPoster))
        .overlay {
            RoundedRectangle(cornerRadius: PearTheme.radiusPoster)
                .strokeBorder(hovering ? PearTheme.accent : PearTheme.line, lineWidth: hovering ? 2 : 1)
        }
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        #if os(macOS)
        .pointerStyle(.link)
        #endif
        .animation(PearTheme.motionFast, value: hovering)
        .accessibilityElement(children: .combine)
    }
}

/// The featured game: art on the right fading into the panel, title and the two actions on the left.
private struct FeaturedHero: View {
    let entry: CatalogEntry
    let compact: Bool
    let onPlay: () -> Void
    let onOpen: () -> Void

    var body: some View {
        ZStack(alignment: .leading) {
            PearTheme.bgPanel
            CoverArt(seed: entry.id, url: entry.coverURL)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .mask(LinearGradient(
                    stops: [.init(color: .clear, location: compact ? 0.1 : 0.3), .init(color: .black, location: 1)],
                    startPoint: .leading, endPoint: .trailing))
            VStack(alignment: .leading, spacing: PearTheme.Space.s3) {
                Text(entry.tierLabel.map { "Editor's pick · \($0)" } ?? "Editor's pick")
                    .font(PearTheme.sans(12, .semibold, relativeTo: .caption))
                    .foregroundStyle(PearTheme.text)
                    .padding(.horizontal, 10)
                    .frame(minHeight: 26)
                    .background(PearTheme.bgWindow.opacity(0.7), in: RoundedRectangle(cornerRadius: 8))
                Text(entry.title.isEmpty ? "Untitled game" : entry.title)
                    .font(PearTheme.display(compact ? 32 : 48))
                    .foregroundStyle(PearTheme.text)
                    .lineLimit(2)
                    .minimumScaleFactor(0.6)
                Text(entry.author.isEmpty ? entry.runModeLabel : "by \(entry.author) · \(entry.runModeLabel)")
                    .font(PearTheme.sans(compact ? 15 : 17))
                    .foregroundStyle(PearTheme.textSecondary)
                HStack(spacing: PearTheme.Space.s3) {
                    Button(action: onPlay) {
                        Label("Play now", systemImage: "play")
                            .font(PearTheme.sans(17, .semibold))
                            .frame(minHeight: 28)
                    }
                    .buttonStyle(PearPrimaryButtonStyle())
                    Button(action: onOpen) {
                        Label("View game", systemImage: "arrow.right")
                            .labelStyle(.titleAndIcon)
                            .frame(minHeight: 28)
                    }
                    .buttonStyle(PearSecondaryButtonStyle())
                }
                .padding(.top, PearTheme.Space.s2)
            }
            .padding(compact ? 20 : 36)
            .frame(maxWidth: compact ? .infinity : 520, alignment: .leading)
        }
        .frame(height: compact ? 300 : 300)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(PearTheme.line))
        .contentShape(RoundedRectangle(cornerRadius: 20))
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

    #if os(iOS)
    private var quickDraw: Binding<QuickDrawSession?> {
        Binding(get: { model.quickDraw }, set: { if $0 == nil { model.leaveGame() } })
    }

    private var pearUI: Binding<PearUISession?> {
        Binding(get: { model.pearUI }, set: { if $0 == nil { model.leaveGame() } })
    }
    #endif

    func body(content: Content) -> some View {
        #if os(iOS)
        content
            .fullScreenCover(item: session) { PlayView(session: $0, onLeave: model.leaveGame).gameChrome(title: $0.gameName, onLeave: model.leaveGame) }
            .fullScreenCover(item: quickDraw) { QuickDrawView(session: $0, onLeave: model.leaveGame).gameChrome(title: $0.title, onLeave: model.leaveGame) }
            .fullScreenCover(item: pearUI) { PearUIView(session: $0).gameChrome(title: $0.title, onLeave: model.leaveGame) }
        #else
        content.sheet(item: session) { PlayView(session: $0, onLeave: model.leaveGame).gameChrome(title: $0.gameName, onLeave: model.leaveGame) }
        #endif
    }
}
