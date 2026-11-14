import OmniCloud
import OmniLibrary
import SwiftUI

struct GameDetailView: View {
    let entry: CatalogEntry
    let model: PlayerModel

    private enum PlayState {
        case idle
        case working
        case fetched(LaunchResult)
        case failed(String)
    }

    @State private var play: PlayState = .idle

    var body: some View {
        let playability = model.playability(of: entry)
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(entry.title.isEmpty ? "Untitled game" : entry.title)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(OmniTheme.text)
                Text(entry.author.isEmpty ? "Unknown author" : entry.author)
                    .font(.callout)
                    .foregroundStyle(OmniTheme.textSecondary)

                Rectangle().fill(OmniTheme.line).frame(height: 1)
                LabeledContent("Version", value: "v\(entry.latestVersion)")
                LabeledContent("Plays", value: entry.runModeLabel)
                if entry.tierLabel != nil {
                    LabeledContent("Sensors", value: entry.tierDetail)
                }
                Text(entry.runModeExplanation).font(.callout).foregroundStyle(OmniTheme.textSecondary)

                Label {
                    Text(playability.summary)
                        .foregroundStyle(playability.isPlayable ? OmniTheme.ok : OmniTheme.text)
                } icon: {
                    Image(systemName: playability.symbol)
                        .foregroundStyle(playability.isPlayable ? OmniTheme.ok : OmniTheme.textSecondary)
                }
                if let why = playability.explanation {
                    Text(why).font(.callout).foregroundStyle(OmniTheme.text)
                }

                if playability.isPlayable {
                    Button {
                        Task { await playTapped() }
                    } label: {
                        if case .working = play {
                            ProgressView().tint(OmniTheme.onAccent)
                        } else {
                            Text("Play").frame(maxWidth: 240)
                        }
                    }
                    .buttonStyle(OmniPrimaryButtonStyle())
                    .disabled(isWorking)
                } else {
                    Button("Not playable on this device") {}
                        .buttonStyle(OmniSecondaryButtonStyle())
                        .disabled(true)
                }

                result
            }
            .labeledContentStyle(ColumnLabeledContentStyle())
            .padding()
            .frame(maxWidth: 640, alignment: .leading)
        }
        .background(OmniTheme.bgField)
        .navigationTitle(entry.title.isEmpty ? "Game" : entry.title)
        #if os(macOS)
        .toolbarBackground(OmniTheme.bgWindow, for: .windowToolbar)
        .toolbarBackground(.visible, for: .windowToolbar)
        #else
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(OmniTheme.bgWindow, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
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
        case .fetched(let launch):
            let game = launch.game
            Text("Fetched version \(game.version): \(game.bundle.clientScripts.count) client scripts, \(game.bundle.serverScripts.count) server scripts, \(game.bundle.assets.count) assets. Running games on this device is not available yet.")
                .font(.callout)
                .foregroundStyle(OmniTheme.text)
        case .failed(let text):
            Text(text).font(.callout).foregroundStyle(OmniTheme.error)
        }
    }

    private func playTapped() async {
        play = .working
        do {
            play = .fetched(try await model.launch(entry))
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
                .foregroundStyle(OmniTheme.textSecondary)
                .frame(minWidth: 100, alignment: .leading)
            configuration.content
                .foregroundStyle(OmniTheme.text)
        }
    }
}
