import PearCloud
import PearLibrary
import SwiftUI

struct GameDetailView: View {
    let entry: CatalogEntry
    let model: PlayerModel
    /// Set by the home hero's Play: start fetching as soon as the page opens.
    var autoplay = false

    private enum PlayState {
        case idle
        case working
        case failed(String)
    }

    @State private var play: PlayState = .idle
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var wide: Bool { sizeClass == .regular }
    #else
    private let wide = true
    #endif

    var body: some View {
        let playability = model.playability(of: entry)
        ScrollView {
            VStack(alignment: .leading, spacing: PearTheme.Space.s6) {
                CoverArt(seed: entry.id)
                    .frame(height: wide ? 440 : 300)
                    .frame(maxWidth: .infinity)
                    .overlay(alignment: .bottomLeading) {
                        VStack(alignment: .leading, spacing: PearTheme.Space.s2) {
                            Text(entry.title.isEmpty ? "Untitled game" : entry.title)
                                .font(PearTheme.display(wide ? 64 : 40))
                                .tracking(wide ? -0.6 : -0.3)
                                .foregroundStyle(PearTheme.paper)
                                .lineLimit(2)
                                .minimumScaleFactor(0.6)
                            Text(entry.author.isEmpty ? "Unknown author" : "by \(entry.author)")
                                .font(PearTheme.sans(wide ? 21 : 17, relativeTo: .title3))
                                .foregroundStyle(PearTheme.paper.opacity(0.85))
                        }
                        .padding(wide ? 36 : 20)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(PearTheme.scrim)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 24))
                    .shadow(color: PearTheme.ink.opacity(0.4), radius: 24, y: 14)
                    .overlay(alignment: .topLeading) {
                        HStack(spacing: PearTheme.Space.s2) {
                            CoverBadge(
                                text: entry.runModeLabel, symbol: entry.runMode == "device" ? "iphone" : "tv",
                                fill: PearTheme.powder)
                            if let tier = entry.tierLabel {
                                CoverBadge(text: tier, symbol: "dot.radiowaves.left.and.right", fill: PearTheme.sandy)
                            }
                        }
                        .padding(PearTheme.Space.s4)
                    }

                let columns = wide
                    ? AnyLayout(HStackLayout(alignment: .top, spacing: 40))
                    : AnyLayout(VStackLayout(alignment: .leading, spacing: PearTheme.Space.s6))
                columns {
                VStack(alignment: .leading, spacing: PearTheme.Space.s6) {
                VStack(alignment: .leading, spacing: PearTheme.Space.s3) {
                    if playability.isPlayable {
                        Button {
                            Task { await playTapped() }
                        } label: {
                            if case .working = play {
                                ProgressView().tint(PearTheme.onAccent).frame(minWidth: 200)
                            } else {
                                Label("Play", systemImage: "play.fill")
                                    .font(PearTheme.sans(18, .semibold))
                                    .frame(minWidth: 220, minHeight: 52)
                            }
                        }
                        .buttonStyle(PearPrimaryButtonStyle())
                        .controlSize(.large)
                        .disabled(isWorking)
                        Label {
                            Text(playability.summary).foregroundStyle(PearTheme.text)
                        } icon: {
                            Image(systemName: playability.symbol).foregroundStyle(PearTheme.ok)
                        }
                        .font(PearTheme.sans(16, .medium))
                    } else {
                        // The kit's warning callout: what is missing and why, instead of a dead button.
                        HStack(alignment: .top, spacing: PearTheme.Space.s3) {
                            Image(systemName: playability.symbol)
                                .font(.system(size: 20))
                                .foregroundStyle(PearTheme.warn)
                            VStack(alignment: .leading, spacing: PearTheme.Space.s1) {
                                Text(playability.summary).font(PearTheme.sans(16, .semibold))
                                if let why = playability.explanation {
                                    Text(why).font(PearTheme.sans(16))
                                }
                            }
                            .foregroundStyle(PearTheme.text)
                        }
                        .padding(.horizontal, PearTheme.Space.s6)
                        .padding(.vertical, PearTheme.Space.s4)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            PearTheme.warn.mix(with: PearTheme.bgField, by: 0.88),
                            in: RoundedRectangle(cornerRadius: PearTheme.radiusWindow))
                        .overlay(RoundedRectangle(cornerRadius: PearTheme.radiusWindow).strokeBorder(PearTheme.warn))
                    }
                    result
                }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                VStack(alignment: .leading, spacing: PearTheme.Space.s3) {
                    LabeledContent("Version", value: "v\(entry.latestVersion)")
                    LabeledContent("Plays", value: entry.runModeLabel)
                    if entry.tierLabel != nil {
                        LabeledContent("Sensors", value: entry.tierDetail)
                    }
                    Rectangle().fill(PearTheme.line).frame(height: 1)
                    Text(entry.runModeExplanation)
                        .font(PearTheme.sans(16))
                        .foregroundStyle(PearTheme.textSecondary)
                }
                .font(PearTheme.sans(16))
                .padding(PearTheme.Space.s6)
                .frame(width: wide ? 380 : nil)
                .background(PearTheme.bgPanel, in: RoundedRectangle(cornerRadius: PearTheme.radiusWindow))
                .overlay {
                    RoundedRectangle(cornerRadius: PearTheme.radiusWindow).strokeBorder(PearTheme.lineControl)
                }
                }
            }
            .labeledContentStyle(ColumnLabeledContentStyle())
            .padding(.horizontal, 28)
            .padding(.vertical, PearTheme.Space.s6)
            .frame(maxWidth: 1100, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background { PearBackdrop(seed: entry.id) }
        .task { if autoplay, case .idle = play, model.playability(of: entry).isPlayable { await playTapped() } }
        .navigationTitle(entry.title.isEmpty ? "Game" : entry.title)
        #if os(macOS)
        .toolbarBackground(PearTheme.bgWindow, for: .windowToolbar)
        .toolbarBackground(.visible, for: .windowToolbar)
        #else
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    private var isWorking: Bool {
        if case .working = play { return true }
        return false
    }

    @ViewBuilder private var result: some View {
        switch play {
        case .idle, .working:
            EmptyView()
        case .failed(let text):
            Text(text).font(PearTheme.sans(16)).foregroundStyle(PearTheme.error)
        }
    }

    private func playTapped() async {
        play = .working
        do {
            try await model.play(entry)
            play = .idle
        } catch {
            if let cloud = error as? CloudError, cloud == .unauthorized || cloud == .notSignedIn {
                await model.sessionExpired()
                return
            }
            play = .failed(PlayerModel.describe(error))
        }
    }
}

/// Label and value in two aligned columns; keeps `LabeledContent`'s label/value pairing for VoiceOver.
private struct ColumnLabeledContentStyle: LabeledContentStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 16) {
            configuration.label
                .foregroundStyle(PearTheme.textSecondary)
                .frame(minWidth: 100, alignment: .leading)
            configuration.content
                .foregroundStyle(PearTheme.text)
        }
    }
}
