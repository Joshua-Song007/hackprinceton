## Status: Staged
Library: top toolbar -> left sidebar (macOS only; iOS keeps the current top bar). Files: `Apps/OmniPlayer/OmniPlayer/Library/LibraryView.swift`, `Apps/OmniPlayer/OmniPlayer/OmniPlayerApp.swift`. No package, backend, `GameDetailView.swift` or git changes. Existing comments kept as-is.

### LibraryView.swift
- Replace `@State playableOnly: Bool` with `private enum LibraryFilter: Hashable { case all, playable }` and `@State private var filter: LibraryFilter? = .all`; keep `private var playableOnly: Bool { filter == .playable }` so `visible` and the "Show all games" branch stay as they are, except "Show all games" sets `filter = .all`. nil selection (cmd-click deselect) = all.
- `body`: `#if os(macOS)` `NavigationSplitView { sidebar } detail: { NavigationStack { content ...detail modifiers } }` `#else` the current `NavigationStack` + toolbar unchanged (iOS toggle bound through `Binding(get: { filter == .playable }, set: { filter = $0 ? .playable : .all })`) `#endif`. `.task { load }` and `.onChange(of: state)` stay on the outside for both.
- macOS `sidebar`: `List(selection: $filter)` with `Section("Library")`:
  - `Label("All games", systemImage: "square.grid.2x2").tag(LibraryFilter.all).badge(Text("\(library.entries.count)"))`
  - `Label("Playable on this device", systemImage: "checkmark.circle").tag(LibraryFilter.playable).badge(Text("\(playableCount)"))`
  - `Text` badges, NOT `badge(Int)`: `badge(0)` hides itself and the 0 is the point.
  - `playableCount` = entries where `library.playability(of:).isPlayable`.
- Sidebar modifiers: `.listStyle(.sidebar)`, `.searchable(text: $library.query, placement: .sidebar, prompt: "Search games")` (field at the top of the sidebar, takes cmd-F), `.navigationSplitViewColumnWidth(min: 200, ideal: 240, max: 300)`, `.safeAreaInset(edge: .bottom) { accountRow }`.
- `accountRow` (bottom-left, `Divider` above): `Menu` with label `HStack { Circle with the first letter of the name; Text(name); Spacer; chevron.up.chevron.down }`, `.menuStyle(.borderlessButton)`, `.buttonStyle(.plain)`; menu items: name as a disabled `Text`, `Button("Sign out", role: .destructive) { Task { await model.signOut() } }`. Name = `account.displayName` or "Signed in" (same rule as today). `.accessibilityLabel("Account, \(name)")`.
- macOS detail toolbar: only `Refresh` (`arrow.clockwise`, `.disabled(isLoading)`, `.help("Refresh library")`, `.keyboardShortcut("r")`) at `.primaryAction`. Toggle and Account toolbar items are not built on macOS.
- macOS detail title: `.navigationTitle(playableOnly ? "Playable on this device" : "All games")`; `.navigationDestination` for `CatalogEntry` and the `content` grid are unchanged.

### OmniPlayerApp.swift
- `RootView` macOS frame: `.frame(minWidth: 480, minHeight: 520)` -> `.frame(minWidth: 760, minHeight: 520)` (sidebar 200 + one 280 card column + padding). Applies to the sign-in screen too.

### Not staged
- iPhone / iPad sidebar (a permanent sidebar does not fit a phone width); iOS stays as built in round 2.
- One banner for the repeated "Needs a controller" blocker (round-2 critique P2); separate change.
- Test-data games and raw authors: backend data, delete by hand.

### Verify
- `xcodebuild -workspace Omni.xcworkspace -scheme OmniPlayer` Debug for iOS Simulator and macOS, no new warnings; `swift test` in `Packages/OmniLibrary` still 36 pass (no package edits). iOS build must be unchanged in behaviour (compile check only).
- By eye (user, macOS): the search field sits at the top of the sidebar (if `placement: .sidebar` is ignored on the sidebar `List`, attach `.searchable` to the `NavigationSplitView` instead); the `0` badge shows; profile row at the bottom-left opens the menu; Refresh at the top-right; sidebar width 200-300; window minimum width 760; back button and detail navigation still work inside the detail column.
- After apply: `currentDev.md` back to Clear.
