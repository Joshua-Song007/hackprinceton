import Foundation
import PearCore
import RealityKit

/// Emits `onHeartRate` with the normalized intensity `d = clamp((HR - HR_rest) / (HR_max - HR_rest), 0, 1)`.
/// Heart rate is sample-and-hold in the frame, so an event fires only when the value changes.
@MainActor
public final class HeartRateIntensity: EventDeriver {
    public var restBpm: Double
    public var maxBpm: Double
    private var lastBpm: Double?

    public init(restBpm: Double = 60, maxBpm: Double = 180) {
        self.restBpm = restBpm
        self.maxBpm = maxBpm
    }

    /// 0 when `maxBpm <= restBpm` (degenerate range) instead of dividing by zero.
    public static func intensity(bpm: Double, restBpm: Double, maxBpm: Double) -> Double {
        let range = maxBpm - restBpm
        guard range > 0, bpm.isFinite else { return 0 }
        return min(max((bpm - restBpm) / range, 0), 1)
    }

    public func derive(from frame: InputFrame, deltaTime: TimeInterval, root: Entity) -> [GameEvent] {
        guard let bpm = frame.devices.first(where: { !$0.stale && $0.heartRate != nil })?.heartRate else {
            return []
        }
        guard bpm != lastBpm else { return [] }
        lastBpm = bpm
        let d = Self.intensity(bpm: bpm, restBpm: restBpm, maxBpm: maxBpm)
        return [.heartRate(bpm: bpm, intensity: d)]
    }
}
