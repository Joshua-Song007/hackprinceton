import PearScript
import SwiftUI

/// Script editor: edits one script's source and hot-reloads it through `ScriptReloader` shortly after typing stops.
/// A compile error leaves the previous version running and is shown under the editor.
struct ScriptEditorView: View {
    let reloader: ScriptReloader
    let scriptName: String
    @State private var text: String
    @State private var status = "Not loaded"
    @State private var failure: String?
    @State private var pending: Task<Void, Never>?

    init(reloader: ScriptReloader, scriptName: String, initialSource: String) {
        self.reloader = reloader
        self.scriptName = scriptName
        _text = State(initialValue: reloader.source(of: scriptName) ?? initialSource)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(scriptName).font(.headline)
                Spacer()
                Text(status).font(.caption).foregroundStyle(.secondary)
            }
            TextEditor(text: $text)
                .font(.system(.body, design: .monospaced))
                .autocorrectionDisabled()
                .onChange(of: text) { _, _ in scheduleReload() }
            if let failure {
                Text(failure)
                    .font(.caption.monospaced())
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
            }
        }
        .padding(8)
        .onAppear { reload() }
        .onDisappear { pending?.cancel() }
    }

    /// Debounce: reload 300 ms after the last keystroke.
    private func scheduleReload() {
        pending?.cancel()
        pending = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            reload()
        }
    }

    private func reload() {
        switch reloader.update(name: scriptName, source: text) {
        case .loaded: status = "Loaded"; failure = nil
        case .reloaded: status = "Reloaded"; failure = nil
        case .unchanged: status = "Up to date"; failure = reloader.failures[scriptName]
        case .failed(let message): status = "Compile error"; failure = message
        }
    }
}
