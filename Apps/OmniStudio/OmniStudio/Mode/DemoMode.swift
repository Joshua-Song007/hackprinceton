import Foundation
import Observation
import OmniSim

/// One-switch offline demo: replays `Recordings/demo-fallback.usis.jsonl` through `UsisPlayer` onto the same
/// `InputBus` the live and sim sources use, by overriding `ModeController`'s input sources. Turning it off restores
/// the current Sim / Live sources. A missing or empty recording is reported in `status`, never a crash.
@MainActor
@Observable
final class DemoMode {
    enum Status: Equatable {
        case off
        case replaying(packets: Int)
        case failed(String)
    }

    nonisolated static let fileName = "demo-fallback.usis.jsonl"

    private(set) var status: Status = .off
    var isOn: Bool {
        if case .replaying = status { return true }
        return false
    }

    @ObservationIgnored private let modeController: ModeController
    @ObservationIgnored private let locate: @Sendable () -> URL?

    /// `locate` resolves the recording at switch time (the file may land after the app is built).
    init(modeController: ModeController, locate: @escaping @Sendable () -> URL? = DemoMode.defaultRecordingURL) {
        self.modeController = modeController
        self.locate = locate
    }

    func setOn(_ on: Bool) {
        on ? enable() : disable()
    }

    func enable() {
        guard !isOn else { return }
        guard let url = locate() else {
            status = .failed("Recording not found: \(Self.fileName)")
            return
        }
        let player: UsisPlayer
        do {
            player = try UsisPlayer(contentsOf: url, loop: true)
        } catch {
            status = .failed("Cannot read \(url.lastPathComponent): \(error.localizedDescription)")
            return
        }
        guard player.packetCount > 0 else {
            status = .failed("Recording has no valid packets: \(url.lastPathComponent)")
            return
        }
        modeController.setInputOverride(player)
        status = .replaying(packets: player.packetCount)
    }

    func disable() {
        guard status != .off else { return }
        if isOn { modeController.setInputOverride(nil) }
        status = .off
    }

    /// [provisional: needs-tien-review] Lookup order: `OMNI_DEMO_RECORDING` env path, app bundle resource, then
    /// `Recordings/<file>` in the current directory or any ancestor of the app bundle (a dev build runs inside the repo).
    nonisolated static func defaultRecordingURL() -> URL? {
        let fm = FileManager.default
        if let path = ProcessInfo.processInfo.environment["OMNI_DEMO_RECORDING"], fm.fileExists(atPath: path) {
            return URL(fileURLWithPath: path)
        }
        if let url = Bundle.main.url(forResource: "demo-fallback.usis", withExtension: "jsonl") { return url }
        var starts = [URL(fileURLWithPath: fm.currentDirectoryPath)]
        starts.append(Bundle.main.bundleURL)
        for start in starts {
            var dir = start
            for _ in 0..<12 {
                let candidate = dir.appendingPathComponent("Recordings").appendingPathComponent(fileName)
                if fm.fileExists(atPath: candidate.path) { return candidate }
                let parent = dir.deletingLastPathComponent()
                if parent == dir { break }
                dir = parent
            }
        }
        return nil
    }
}
