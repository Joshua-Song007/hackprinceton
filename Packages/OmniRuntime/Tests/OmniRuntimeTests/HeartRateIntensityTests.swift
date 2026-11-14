import Foundation
import Testing
import RealityKit
import OmniCore
@testable import OmniRuntime

@MainActor
struct HeartRateIntensityTests {
    private func frame(hr: Double?, stale: Bool = false) -> InputFrame {
        InputFrame(
            timestamp: 0,
            devices: [DeviceSample(deviceId: "w", kind: .watch, slot: .leftWrist, stale: stale, heartRate: hr)])
    }

    @Test func normalizesAndClamps() {
        #expect(HeartRateIntensity.intensity(bpm: 120, restBpm: 60, maxBpm: 180) == 0.5)
        #expect(HeartRateIntensity.intensity(bpm: 40, restBpm: 60, maxBpm: 180) == 0)
        #expect(HeartRateIntensity.intensity(bpm: 220, restBpm: 60, maxBpm: 180) == 1)
    }

    @Test func degenerateRangeIsZero() {
        #expect(HeartRateIntensity.intensity(bpm: 100, restBpm: 100, maxBpm: 100) == 0)
        #expect(HeartRateIntensity.intensity(bpm: 100, restBpm: 120, maxBpm: 80) == 0)
    }

    @Test func emitsOnChangeOnly() {
        let d = HeartRateIntensity(restBpm: 60, maxBpm: 180)
        let root = Entity()
        #expect(d.derive(from: frame(hr: 120), deltaTime: 0.016, root: root) == [.heartRate(bpm: 120, intensity: 0.5)])
        #expect(d.derive(from: frame(hr: 120), deltaTime: 0.016, root: root).isEmpty)
        #expect(d.derive(from: frame(hr: 180), deltaTime: 0.016, root: root) == [.heartRate(bpm: 180, intensity: 1)])
    }

    @Test func staleOrMissingEmitsNothing() {
        let d = HeartRateIntensity()
        let root = Entity()
        #expect(d.derive(from: frame(hr: 120, stale: true), deltaTime: 0.016, root: root).isEmpty)
        #expect(d.derive(from: frame(hr: nil), deltaTime: 0.016, root: root).isEmpty)
    }
}
