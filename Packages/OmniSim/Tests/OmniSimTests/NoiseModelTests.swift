import Foundation
import Testing
import OmniCore
import OmniInput
@testable import OmniSim

struct NoiseModelTests {
    @Test func sameSeedGivesSameSequence() {
        var a = SeededGenerator(seed: 42)
        var b = SeededGenerator(seed: 42)
        let xs = (0..<10).map { _ in NoiseModel.airpods.nextIntervalMs(using: &a) }
        let ys = (0..<10).map { _ in NoiseModel.airpods.nextIntervalMs(using: &b) }
        #expect(xs == ys)
    }

    @Test func emittedRateMatchesDeclaredRate() {
        for model in [NoiseModel.airpods, .watch, .phone, .pencil, .pencilHover] {
            var rng = SeededGenerator(seed: 7)
            let n = 4000
            let total = (0..<n).reduce(0.0) { acc, _ in acc + model.nextIntervalMs(using: &rng) }
            let rate = Double(n) / (total / 1000)
            #expect(abs(rate - model.sampleRateHz) / model.sampleRateHz < 0.05)
        }
    }

    @Test func intervalJitterIsWithinTolerance() {
        var rng = SeededGenerator(seed: 3)
        let model = NoiseModel.airpods
        let xs = (0..<4000).map { _ in model.nextIntervalMs(using: &rng) }
        let mean = xs.reduce(0, +) / Double(xs.count)
        let sd = (xs.map { ($0 - mean) * ($0 - mean) }.reduce(0, +) / Double(xs.count)).squareRoot()
        #expect(abs(sd - model.intervalJitterMs) < 0.3)
        #expect(xs.min() ?? 0 > 0)
    }

    @Test func perturbedQuaternionStaysUnitAndNearInput() {
        var rng = SeededGenerator(seed: 11)
        let q = Quaternion(0, 0.707, 0, 0.707).normalized
        for _ in 0..<500 {
            let p = NoiseModel.watch.perturb(q, using: &rng)
            #expect(abs(p.norm - 1) < 1e-9)
            #expect(p.angle(to: q) < 0.2)
        }
    }

    @Test func zeroNoiseIsExact() {
        var rng = SeededGenerator(seed: 1)
        let model = NoiseModel(sampleRateHz: 50)
        #expect(model.perturb(.identity, using: &rng) == .identity)
        #expect(model.nextIntervalMs(using: &rng) == 20)
    }

    @Test func heartRateNeverNegative() {
        var rng = SeededGenerator(seed: 5)
        let model = NoiseModel(sampleRateHz: 1, heartRateNoiseBpm: 50)
        for _ in 0..<200 { #expect(model.perturbHeartRate(1, using: &rng) >= 0) }
    }

    @Test func virtualDeviceStampsSimSeqAndTimeWithUnitQuaternions() {
        let d = VirtualDevice(
            deviceId: "sim-1", kind: .airpods, slot: .head, channels: [.orientation],
            noise: .airpods, seed: 9
        )
        d.targetOrientation = Quaternion(0, 0.5, 0, 1)
        let p0 = d.makePacket(hostNowMs: 1000.4)
        let p1 = d.makePacket(hostNowMs: 1020.6)
        #expect(p0.source == .sim)
        #expect(p0.t == 1000 && p1.t == 1021)
        #expect(p0.seq == 0 && p1.seq == 1)
        #expect(abs((p1.ch.orientation?.norm ?? 0) - 1) < 1e-9)
        #expect(d.descriptors.first?.sampleRateHz == 50)
    }

    @Test func virtualDeviceFeedbackHookReceivesCommands() {
        let d = VirtualDevice(
            deviceId: "sim-2", kind: .phone, slot: .pocket, channels: [.orientation],
            noise: .phone, seed: 1
        )
        let got = Box()
        d.setFeedbackHandler { cmd in got.set(cmd.pattern) }
        d.deliverFeedback(OutputCommand(target: "sim-2", type: .haptic, pattern: "thud", intensity: 1, durationMs: 50))
        #expect(got.value == "thud")
    }
}

private final class Box: @unchecked Sendable {
    // Test-only holder; the handler runs synchronously on the calling thread.
    private(set) var value: String?
    func set(_ v: String) { value = v }
}
