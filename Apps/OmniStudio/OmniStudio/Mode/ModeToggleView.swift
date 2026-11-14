import SwiftUI

/// Toolbar toggle bound to `ModeController`: Sim / Live segmented picker plus a short Live status line.
struct ModeToggleView: View {
    let controller: ModeController
    /// [provisional: needs-tien-review] Demo toggle and failure text; wiring is not a plan.md item.
    let demo: DemoMode

    var body: some View {
        HStack(spacing: 8) {
            Picker(
                "Input",
                selection: Binding(get: { controller.mode }, set: { controller.switchTo($0) })
            ) {
                ForEach(InputMode.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(width: 120)
            if controller.mode == .live {
                Text(Self.status(controller))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            Toggle("Demo", isOn: Binding(get: { demo.isOn }, set: { demo.setOn($0) }))
                .toggleStyle(.switch)
            switch demo.status {
            case .off:
                EmptyView()
            case .replaying(let packets):
                Text("replaying \(packets) packets")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            case .failed(let message):
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
    }

    static func status(_ controller: ModeController) -> String {
        switch controller.listenerState {
        case .ready: "\(controller.liveDeviceCount) device(s)"
        case .failed(let message): "listener failed: \(message)"
        case .starting, nil: "starting"
        case .stopped: "stopped"
        }
    }
}
