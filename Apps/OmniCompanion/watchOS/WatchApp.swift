import OmniCore
import SwiftUI

/// Owns the Watch sensors and the relay to the phone; the view only shows state.
@MainActor
@Observable
final class WatchModel {
    private(set) var phoneReachable = false
    private(set) var workoutState = "idle"
    private(set) var heartRate: Double?
    private(set) var running = false

    private var relay: WatchRelay?
    private var workout: HeartRateWorkout?
    private var gestures: WristGestureDetector?

    init() {
        // The callbacks run off the main actor, so build the parts here and hop back for UI state.
        let relay = WatchRelay { [weak self] reachable in Task { @MainActor in self?.phoneReachable = reachable } }
        self.relay = relay
        workout = HeartRateWorkout(
            onHeartRate: { [weak self] bpm in
                relay.send(UsisChannels(heartRate: bpm), at: DeviceClock.nowMs)
                Task { @MainActor in self?.heartRate = bpm }
            },
            onState: { [weak self] state in Task { @MainActor in self?.workoutState = state } }
        )
        gestures = WristGestureDetector { event, t in relay.send(UsisChannels(gesture: event), at: t) }
        relay.start()
    }

    func toggle() {
        if running {
            gestures?.stop()
            workout?.stop()
            running = false
        } else {
            running = true
            gestures?.start()
            Task { await workout?.start() }
        }
    }

    /// System double-tap action (`handGestureShortcut`).
    func doubleTap() {
        gestures?.report(.doubleTap)
    }
}

/// Watch uptime in milliseconds, the same basis as CoreMotion timestamps.
enum DeviceClock {
    static var nowMs: Int64 { Int64(ProcessInfo.processInfo.systemUptime * 1000) }
}

@main
struct OmniWatchApp: App {
    @State private var model = WatchModel()

    var body: some Scene {
        WindowGroup {
            VStack(spacing: 6) {
                Text(model.heartRate.map { "\(Int($0)) bpm" } ?? "-- bpm").font(.headline)
                Text(model.phoneReachable ? "phone linked" : "phone not reachable").font(.caption2)
                Text(model.workoutState).font(.caption2).foregroundStyle(.secondary)
                Button(model.running ? "Stop" : "Start") { model.toggle() }
                    .handGestureShortcut(.primaryAction)
            }
        }
    }
}
