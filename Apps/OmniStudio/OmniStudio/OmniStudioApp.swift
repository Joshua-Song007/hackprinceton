import SwiftUI

@main
struct OmniStudioApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        Window("Omni Studio", id: "main") {
            ViewportView(model: model)
                .frame(minWidth: 640, minHeight: 480)
                .onAppear { model.start() }
                .onDisappear { model.stop() }
        }
    }
}
