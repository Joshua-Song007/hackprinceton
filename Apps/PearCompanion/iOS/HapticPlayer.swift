import CoreHaptics
import PearCore
import UIKit

/// Plays Core Haptics patterns for `output` commands. Haptics only play while the app is in the
/// foreground (phone probe, 2026-11-14), so commands that arrive while suspended are lost.
/// A bare impact generator gives only a short bump; Core Haptics covers longer buzzes.
@MainActor
final class HapticPlayer {
    private var engine: CHHapticEngine?
    private let fallback = UIImpactFeedbackGenerator(style: .heavy)

    /// Pattern names that mean a single short hit instead of a sustained buzz.
    private static let transientSharpness: [String: Float] = ["tap": 0.8, "thud": 0.3]

    func play(_ command: OutputCommand) {
        guard command.type == .haptic else { return }
        let intensity = Float(min(max(command.intensity, 0), 1))
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else {
            fallback.impactOccurred(intensity: CGFloat(intensity))
            return
        }
        do {
            let engine = try readyEngine()
            let player = try engine.makePlayer(with: pattern(for: command, intensity: intensity))
            try player.start(atTime: CHHapticTimeImmediate)
        } catch {
            engine = nil // recreate next time (engine was reset or stopped by the system)
            fallback.impactOccurred(intensity: CGFloat(intensity))
        }
    }

    private func readyEngine() throws -> CHHapticEngine {
        let engine = try self.engine ?? CHHapticEngine()
        self.engine = engine
        engine.playsHapticsOnly = true
        try engine.start() // no-op when already running
        return engine
    }

    private func pattern(for command: OutputCommand, intensity: Float) throws -> CHHapticPattern {
        let sharpness = Self.transientSharpness[command.pattern]
        let event: CHHapticEvent
        if sharpness != nil || command.durationMs <= 40 {
            event = CHHapticEvent(eventType: .hapticTransient, parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness ?? 0.5),
            ], relativeTime: 0)
        } else {
            let seconds = min(Double(command.durationMs) / 1000, 30) // Core Haptics caps a continuous event at 30 s
            event = CHHapticEvent(eventType: .hapticContinuous, parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.5),
            ], relativeTime: 0, duration: seconds)
        }
        return try CHHapticPattern(events: [event], parameters: [])
    }
}
