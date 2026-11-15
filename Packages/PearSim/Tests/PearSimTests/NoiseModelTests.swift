import Foundation
import Testing
import PearCore
import PearInput
@testable import PearSim

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

    private func assertValid(_ packets: [UsisPacket]) {
        let validator = PacketValidator()
        for p in packets { #expect(validator.validate(p) == nil) }
    }

    @Test func airpodsSendOrientationOnlyAndNoPosition() {
        let d = VirtualAirPods(seed: 1)
        d.targetOrientation = Quaternion(0.1, 0.5, 0, 1)
        d.targetPosition = Vector3(1, 2, 3)
        let ps = (0..<100).map { d.makePacket(hostNowMs: Double($0) * 20) }
        assertValid(ps)
        #expect(ps.allSatisfy { $0.kind == .airpods && $0.slot == .head && $0.source == .sim })
        #expect(ps.allSatisfy { $0.ch.orientation != nil && $0.ch.position == nil && $0.ch.accel == nil })
        #expect(d.descriptors.first?.sampleRateHz == 50)
    }

    @Test func watchHeartRateSpikeDecaysAndNeverNegative() {
        let d = VirtualWatch(restingBpm: 70, noise: NoiseModel(sampleRateHz: 5), seed: 2)
        #expect(d.makePacket(hostNowMs: 0).ch.heartRate == 70)
        d.spike(by: 50)
        let first = d.makePacket(hostNowMs: 200).ch.heartRate ?? 0
        #expect(first == 120)
        var last = first
        for i in 0..<200 { last = d.makePacket(hostNowMs: Double(i)).ch.heartRate ?? -1 }
        #expect(last == 70)

        d.heartRate = -30
        let noisy = VirtualWatch(restingBpm: -5, noise: NoiseModel(sampleRateHz: 5, heartRateNoiseBpm: 40), seed: 3)
        let ps = (0..<200).map { noisy.makePacket(hostNowMs: Double($0)) }
        #expect(ps.allSatisfy { ($0.ch.heartRate ?? -1) >= 0 })
        assertValid(ps)
        #expect(d.makePacket(hostNowMs: 0).ch.heartRate == 0)
    }

    @Test func watchGesturesAreSentOnceInOrder() {
        let d = VirtualWatch(seed: 4)
        d.queueGesture(.flick, dir: Vector3(1, 0, 0))
        d.queueGesture(.doubleTap)
        let ps = (0..<4).map { d.makePacket(hostNowMs: Double($0)) }
        #expect(ps[0].ch.gesture == GestureEvent(type: .flick, dir: Vector3(1, 0, 0)))
        #expect(ps[1].ch.gesture == GestureEvent(type: .doubleTap))
        #expect(ps[2].ch.gesture == nil && ps[3].ch.gesture == nil)
        #expect(ps.allSatisfy { $0.kind == .watch && $0.ch.heartRate != nil })
        assertValid(ps)
    }

    @Test func phoneSendsAccelAndTouchOnce() {
        let d = VirtualPhone(seed: 5)
        d.targetAccel = Vector3(0, 9.81, .nan)
        d.sendTouch(id: 1, x: 0.2, y: 1.7, phase: .began)
        d.sendTouch(id: 1, x: 0.3, y: 0.5, phase: .moved)
        d.sendTouch(id: 1, x: 0.4, y: 0.5, phase: .moved)
        d.sendTouch(id: 1, x: 0.4, y: 0.5, phase: .ended)
        let p0 = d.makePacket(hostNowMs: 0)
        let p1 = d.makePacket(hostNowMs: 10)
        #expect(p0.ch.touch?.map(\.phase) == [.began, .moved, .ended])
        #expect(p0.ch.touch?[0].y == 1)
        #expect(p0.ch.touch?[1].x == 0.4)
        #expect(p1.ch.touch == nil)
        #expect(abs((p0.ch.accel?.y ?? 0) - 9.81) < 0.5)
        #expect(abs(p0.ch.accel?.z ?? 1) < 0.5)
        #expect(p0.kind == .phone && d.descriptors.first?.sampleRateHz == 100)
        assertValid([p0, p1])
    }

    @Test func pencilContactAndHoverPackets() {
        let d = VirtualPencil(seed: 6)
        d.touchDown(tip: Vector3(0.1, 0, 0.2), pressure: 4, roll: 1.5)
        let contact = d.makePacket(hostNowMs: 0)
        #expect(contact.ch.pencil?.pressure == 1)
        #expect(contact.ch.pencil?.roll == 1.5)
        #expect(contact.ch.pencil?.hover == 0)

        d.hover(tip: Vector3(0.1, 0, 0.2), height: 0.02)
        let hover = d.makePacket(hostNowMs: 4)
        #expect(hover.ch.pencil?.roll == 0)
        #expect(hover.ch.pencil?.pressure == 0)
        #expect(hover.ch.pencil?.hover == 0.02)
        assertValid([contact, hover])
        #expect(contact.kind == .pencil && contact.slot == .stylus)
        #expect(d.descriptors.first?.sampleRateHz == 240)
    }

    @Test func pencilIntervalsFollowContactAndHoverRates() {
        let d = VirtualPencil(seed: 7)
        func rate() -> Double {
            let total = (0..<2000).reduce(0.0) { acc, _ in acc + d.nextIntervalMs() }
            return 2000 / (total / 1000)
        }
        d.touchDown(tip: Vector3(0, 0, 0), pressure: 0.5)
        #expect(abs(rate() - 240) / 240 < 0.05)
        d.hover(tip: Vector3(0, 0, 0), height: 0.01)
        #expect(abs(rate() - 60) / 60 < 0.05)
    }
}

private final class Box: @unchecked Sendable {
    // Test-only holder; the handler runs synchronously on the calling thread.
    private(set) var value: String?
    func set(_ v: String) { value = v }
}
