import SwiftUI

@main
struct OmniPlayerApp: App {
    @State private var model = PlayerModel()

    var body: some Scene {
        WindowGroup {
            RootView(model: model)
                .task { if model.phase == .launching { await model.start() } }
        }
    }
}

private struct RootView: View {
    let model: PlayerModel

    var body: some View {
        Group {
            switch model.phase {
            case .launching: ProgressView("Starting…")
            case .signedOut: AppleSignInView(model: model)
            case .signedIn: LibraryView(model: model)
            }
        }
        #if os(macOS)
        .frame(minWidth: 480, minHeight: 520)
        #endif
    }
}
