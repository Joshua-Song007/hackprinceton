import AppKit
import SwiftUI

@main
struct OmniStudioApp: App {
    @State private var model = AppModel()
    @State private var showCloud = false

    var body: some Scene {
        Window("Omni Studio", id: "main") {
            ViewportView(model: model)
                .frame(minWidth: 640, minHeight: 480)
                .toolbar {
                    ToolbarItem { ModeToggleView(controller: model.modeController, demo: model.demoMode) }
                    ToolbarItem {
                        Menu("Game") {
                            Button("Reload Flagship") { model.loadFlagship() }
                            Button("Open folder…") { openFolder() }
                            Button("Open from cloud…") { showCloud = true }
                        }
                    }
                    if model.modeController.mode == .sim {
                        ToolbarItem { Button("Pinch") { model.simGesture(.pinch) } }
                        ToolbarItem { Button("Flick") { model.simGesture(.flick) } }
                    }
                }
                .sheet(isPresented: $showCloud) { OpenFromCloudView(model: model) }
                .onAppear { model.start() }
                .onDisappear { model.stop() }
        }
    }

    private func openFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        if panel.runModal() == .OK, let url = panel.url { model.loadFolder(url) }
    }
}

/// Sign in (existing `SignInView`), then load a published game by id.
private struct OpenFromCloudView: View {
    let model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var gameId = ""
    @State private var version = ""
    @State private var working = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SignInView(model: model.account)
            if model.account.isSignedIn {
                TextField("Game id", text: $gameId)
                TextField("Version (blank = latest)", text: $version)
                if let error = model.loadError { Text(error).font(.caption).foregroundStyle(.red) }
            }
            HStack {
                Button("Cancel") { dismiss() }
                Button("Open") {
                    working = true
                    Task {
                        await model.openFromCloud(
                            id: gameId.trimmingCharacters(in: .whitespaces), version: Int(version))
                        working = false
                        if model.loadError == nil { dismiss() }
                    }
                }
                .disabled(!model.account.isSignedIn || gameId.isEmpty || working)
            }
        }
        .padding()
        .frame(width: 420)
    }
}
