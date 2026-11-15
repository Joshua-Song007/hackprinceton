import PearCloud
import PearLibrary
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
                    .foregroundStyle(PearTheme.text)
                Text(entry.author.isEmpty ? "Unknown author" : entry.author)
                    .font(.callout)
                    .foregroundStyle(PearTheme.textSecondary)

                Rectangle().fill(PearTheme.line).frame(height: 1)
                LabeledContent("Version", value: "v\(entry.latestVersion)")
                LabeledContent("Plays", value: entry.runModeLabel)
                if entry.tierLabel != nil {
                    LabeledContent("Sensors", value: entry.tierDetail)
                }
                Text(entry.runModeExplanation).font(.callout).foregroundStyle(PearTheme.textSecondary)

                Label {
                    Text(playability.summary)
                        .foregroundStyle(playability.isPlayable ? PearTheme.ok : PearTheme.text)
                } icon: {
                    Image(systemName: playability.symbol)
                        .foregroundStyle(playability.isPlayable ? PearTheme.ok : PearTheme.textSecondary)
                }
                if let why = playability.explanation {
                    Text(why).font(.callout).foregroundStyle(PearTheme.text)
                }

                if playability.isPlayable {
                    Button {
                        Task { await playTapped() }
                    } label: {
                        if case .working = play {
                            ProgressView().tint(PearTheme.onAccent)
                        } else {
                            Text("Play").frame(maxWidth: 240)
                        }
                    }
                    .buttonStyle(PearPrimaryButtonStyle())
                    .disabled(isWorking)
                } else {
                    Button("Not playable on this device") {}
                        .buttonStyle(PearSecondaryButtonStyle())
                        .disabled(true)
                }

                result
            }
            .labeledContentStyle(ColumnLabeledContentStyle())
            .padding()
            .frame(maxWidth: 640, alignment: .leading)
        }
        .background(PearTheme.bgField)
        .navigationTitle(entry.title.isEmpty ? "Game" : entry.title)
        #if os(macOS)
        .toolbarBackground(PearTheme.bgWindow, for: .windowToolbar)
        .toolbarBackground(.visible, for: .windowToolbar)
        #else
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(PearTheme.bgWindow, for: .navigationBar)
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
                .foregroundStyle(PearTheme.text)
        case .failed(let text):
            Text(text).font(.callout).foregroundStyle(PearTheme.error)
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
                .foregroundStyle(PearTheme.textSecondary)
                .frame(minWidth: 100, alignment: .leading)
            configuration.content
                .foregroundStyle(PearTheme.text)
        }
    }
}
