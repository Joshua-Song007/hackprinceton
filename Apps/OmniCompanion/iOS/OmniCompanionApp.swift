import OmniCore
import SwiftUI
import UIKit

/// Owns the link, the sensors and the haptic output; the SwiftUI view only shows `status`.
@MainActor
@Observable
final class CompanionModel {
    private(set) var status = "starting"
    private(set) var motionNote = ""

    private let client: BridgeClient
    private let motion = MotionStreamer()
    private let haptics = HapticPlayer()

    init() {
        let isPad = UIDevice.current.userInterfaceIdiom == .pad
        // Provisional: device id is the vendor id so it is stable across launches; slot `hand` for a held phone.
        let identity = BridgeClient.Identity(
            deviceId: "phone-" + (UIDevice.current.identifierForVendor?.uuidString.prefix(8).lowercased() ?? "unknown"),
            kind: isPad ? .tablet : .phone,
            slot: .hand,
            name: UIDevice.current.name
        )
        // Created before `self` is usable in the closures, so route through a box.
        let box = ModelBox()
        client = BridgeClient(
            identity: identity,
            onStatus: { status in Task { @MainActor in box.model?.status = status } },
            onOutput: { command in Task { @MainActor in box.model?.handle(command) } }
        )
        box.model = self
    }

    /// Output commands are addressed to a device id or a slot.
    private func handle(_ command: OutputCommand) {
        let id = client.identity
        guard command.target == id.deviceId || command.target == id.slot.rawValue else { return }
        haptics.play(command)
    }

    func foreground() {
        UIApplication.shared.isIdleTimerDisabled = true // streaming stops when the screen locks
        client.start()
        client.reconnect()
        motionNote = motion.start(client: client) ? "" : "device motion unavailable"
    }

    func background() {
        motion.stop()
        client.stop()
    }

    func touched(_ channels: UsisChannels, at uptime: TimeInterval) {
        client.send(channels, at: Int64(uptime * 1000))
    }
}

/// Lets the client's callbacks reach the model that owns the client.
@MainActor
private final class ModelBox {
    weak var model: CompanionModel?
}

@main
struct OmniCompanionApp: App {
    @State private var model = CompanionModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            VStack(spacing: 8) {
                Text("Omni Companion").font(.headline)
                Text(model.status).font(.subheadline)
                if !model.motionNote.isEmpty {
                    Text(model.motionNote).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .allowsHitTesting(false) // labels must not swallow touches meant for the capture view below
            .background(
                TouchCapture { channels, uptime in model.touched(channels, at: uptime) }
                    .ignoresSafeArea()
            )
            .onChange(of: scenePhase, initial: true) { _, phase in
                if phase == .active { model.foreground() } else { model.background() }
            }
        }
    }
}
