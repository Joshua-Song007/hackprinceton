import Foundation
import Observation
import OmniBridge
import OmniInput
import OmniOutput

/// Which kind of input the Studio is running on.
enum InputMode: String, CaseIterable, Identifiable, Sendable {
    case sim
    case live

    var id: String { rawValue }
    var title: String { self == .sim ? "Sim" : "Live" }
}

/// Sim / Live toggle. The only place concrete `InputSource` / `OutputSink` pairs are chosen: `switchTo` stops the
/// active sources, then starts the other pair on the same `InputBus`. The runtime reads the bus and drains into
/// `activeSink` only, so nothing in it changes between modes.
/// Live = `BridgeInputSource` fed by a `BonjourListener`, plus the optional AirPods source. [provisional:
/// needs-tien-review] AirPods are opt-in (`airPods` is nil by default) because the Studio target has no
/// `NSMotionUsageDescription` yet; without it CoreMotion aborts the app on first use.
@MainActor
@Observable
final class ModeController {
    private(set) var mode: InputMode = .sim
    /// Last listener state, for the status UI; nil until Live has been entered.
    private(set) var listenerState: BonjourListenerState?

    @ObservationIgnored private let bus: any InputBus
    @ObservationIgnored private let simSources: [any InputSource]
    @ObservationIgnored private let simSink: any OutputSink
    @ObservationIgnored private let bridge: BridgeInputSource
    @ObservationIgnored private let bridgeSink: BridgeOutputSink
    @ObservationIgnored private let airPods: (any InputSource)?
    @ObservationIgnored private var listener: BonjourListener?
    @ObservationIgnored private var running = false
    @ObservationIgnored private var inputOverride: (any InputSource)?

    init(
        bus: any InputBus,
        simSources: [any InputSource],
        simSink: any OutputSink,
        airPods: (any InputSource)? = nil
    ) {
        self.bus = bus
        self.simSources = simSources
        self.simSink = simSink
        self.airPods = airPods
        let bridge = BridgeInputSource()
        self.bridge = bridge
        self.bridgeSink = BridgeOutputSink(source: bridge)
    }

    /// Sink the runtime's `OutputQueue` is drained into for the current mode.
    var activeSink: any OutputSink {
        switch mode {
        case .sim: simSink
        case .live: bridgeSink
        }
    }

    /// Connected live devices (zero in Sim mode).
    var liveDeviceCount: Int { mode == .live ? bridge.sessionCount : 0 }

    /// Starts the sources of the current mode. Does nothing if already started.
    func start() {
        guard !running else { return }
        running = true
        startSources(for: mode)
    }

    /// Stops every active source.
    func stop() {
        guard running else { return }
        stopSources(for: mode)
        running = false
    }

    /// Replaces the mode's input sources with `source` on the same bus (Demo mode replay); nil restores them.
    /// The mode's sink stays active. While stopped it only records the override, applied by the next `start()`.
    func setInputOverride(_ source: (any InputSource)?) {
        if running { stopSources(for: mode) }
        inputOverride?.stop()
        inputOverride = source
        if running { startSources(for: mode) }
    }

    /// Swaps the active pair. While stopped it only records the mode, applied by the next `start()`.
    func switchTo(_ newMode: InputMode) {
        guard newMode != mode else { return }
        if running { stopSources(for: mode) }
        mode = newMode
        if running { startSources(for: newMode) }
    }

    private func startSources(for mode: InputMode) {
        if let inputOverride {
            inputOverride.start(bus: bus)
            return
        }
        switch mode {
        case .sim:
            simSources.forEach { $0.start(bus: bus) }
        case .live:
            bridge.start(bus: bus)
            airPods?.start(bus: bus)
            let bridge = self.bridge
            let listener = BonjourListener(
                onConnection: { connection in bridge.accept(connection) },
                onState: { [weak self] state in
                    Task { @MainActor in
                        // A late callback after leaving Live must not resurrect the status.
                        if self?.mode == .live { self?.listenerState = state }
                    }
                })
            self.listener = listener
            listener.start()
        }
    }

    private func stopSources(for mode: InputMode) {
        if let inputOverride {
            inputOverride.stop()
            return
        }
        switch mode {
        case .sim:
            simSources.forEach { $0.stop() }
        case .live:
            listener?.stop()
            listener = nil
            airPods?.stop()
            bridge.stop()
            listenerState = nil
        }
    }
}
