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
                Text(entry.title.isEmpty ? "Untitled game" : entry.title).font(.largeTitle.bold())
                Text(entry.author.isEmpty ? "Unknown author" : entry.author)
                    .font(.title3)
                    .foregroundStyle(.secondary)

                Divider()
                LabeledContent("Version", value: "v\(entry.latestVersion)")
                LabeledContent("Plays", value: entry.runModeLabel)
                if entry.tierLabel != nil {
                    LabeledContent("Sensors", value: entry.tierDetail)
                }
                Text(entry.runModeExplanation).font(.callout).foregroundStyle(.secondary)

                Label(playability.summary, systemImage: playability.symbol)
                    .foregroundStyle(playability.isPlayable ? Color.green : Color.secondary)
                if let why = playability.explanation {
                    Text(why).font(.callout)
                }

                if playability.isPlayable {
                    Button {
                        Task { await playTapped() }
                    } label: {
                        if case .working = play {
                            ProgressView()
                        } else {
                            Text("Play").frame(maxWidth: 240)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(isWorking)
                } else {
                    Button("Not playable on this device") {}
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                        .disabled(true)
                }

                result
            }
            .labeledContentStyle(ColumnLabeledContentStyle())
            .padding()
            .frame(maxWidth: 640, alignment: .leading)
        }
        .navigationTitle(entry.title.isEmpty ? "Game" : entry.title)
        #if os(iOS)
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
        case .fetched(let launch):
            let game = launch.game
            Text("Fetched version \(game.version): \(game.bundle.clientScripts.count) client scripts, \(game.bundle.serverScripts.count) server scripts, \(game.bundle.assets.count) assets. Running games on this device is not available yet.")
                .font(.callout)
        case .failed(let text):
            Text(text).font(.callout).foregroundStyle(.red)
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
                .foregroundStyle(.secondary)
                .frame(minWidth: 100, alignment: .leading)
            configuration.content
        }
    }
}
