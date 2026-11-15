import Foundation
import Synchronization
import Testing
import PearCore
import PearInput
@testable import PearSim

/// Settable host clock so `InputPipeline` arrival times are explicit; no test reads the real clock or sleeps.
private final class TestClock: Sendable {
    private let now = Mutex<Double>(0)
    func set(_ ms: Double) { now.withLock { $0 = ms } }
    var read: Double { now.withLock { $0 } }
}

private func makePipeline(_ clock: TestClock, delayMs: Double = 50) -> InputPipeline {
    InputPipeline(delayMs: delayMs, clock: { [clock] in clock.read })
}

/// Rotation about +Y; linear in angle, so slerp between two samples is exact.
private func yaw(_ a: Double) -> Quaternion {
    Quaternion(0, sin(a / 2), 0, cos(a / 2))
}

private let radPerMs = 0.002

/// Steady (jitter-free, noise-free) models so timing and values are fully determined by the explicit host times.
private let steady50 = NoiseModel(sampleRateHz: 50)
private let steady100 = NoiseModel(sampleRateHz: 100)

/// Drives `device` at fixed `stepMs` over `[from, to]` host ms; orientation follows `radPerMs` ramp unless `angle` is given.
private func drive(
    _ device: VirtualDevice, into pipeline: InputPipeline, clock: TestClock,
    from: Int, to: Int, stepMs: Int, angle: (Double) -> Double = { $0 * radPerMs }
) {
    var t = from
    while t <= to {
        device.targetOrientation = yaw(angle(Double(t)))
        clock.set(Double(t))
        pipeline.ingest(device.makePacket(hostNowMs: Double(t)))
        t += stepMs
    }
}

private func sample(_ frame: InputFrame, _ id: String) -> DeviceSample? {
    frame.devices.first { $0.deviceId == id }
}

struct SimPipelineTests {
    @Test func mixedRatesInterpolateToTheRenderTime() throws {
        let clock = TestClock()
        let pipeline = makePipeline(clock)
        let pods = VirtualAirPods(noise: steady50, seed: 1)
        let phone = VirtualPhone(noise: steady100, seed: 2)
        phone.targetAccel = Vector3(0, 0, 9.81)
        drive(pods, into: pipeline, clock: clock, from: 0, to: 300, stepMs: 20)
        drive(phone, into: pipeline, clock: clock, from: 0, to: 300, stepMs: 10)

        // t_render = 285 - 50 = 235: between AirPods samples 220 and 240, between phone samples 230 and 240.
        let frame = pipeline.frame(at: 285)
        let p = try #require(sample(frame, "sim-airpods"))
        let ph = try #require(sample(frame, "sim-phone"))
        let want = yaw(235 * radPerMs)
        #expect(!p.stale && !ph.stale)
        #expect(try #require(p.orientation).angle(to: want) < 1e-6)
        #expect(try #require(ph.orientation).angle(to: want) < 1e-6)
        let accel = try #require(ph.accel)
        #expect(abs(accel.z - 9.81) < 1e-9)
        #expect(frame.timestamp == 285)
    }

    @Test func delayChangesWhichInstantIsSampled() throws {
        let clock = TestClock()
        let pipeline = makePipeline(clock, delayMs: 30)
        let pods = VirtualAirPods(noise: steady50, seed: 1)
        drive(pods, into: pipeline, clock: clock, from: 0, to: 300, stepMs: 20)
        let a = try #require(sample(pipeline.frame(at: 285), "sim-airpods")?.orientation)
        #expect(a.angle(to: yaw(255 * radPerMs)) < 1e-6)
        pipeline.delayMs = 80
        let b = try #require(sample(pipeline.frame(at: 285), "sim-airpods")?.orientation)
        #expect(b.angle(to: yaw(205 * radPerMs)) < 1e-6)
    }

    @Test func silentDeviceGoesStaleAndFreezesWhileOthersKeepRunning() throws {
        let clock = TestClock()
        let pipeline = makePipeline(clock)
        let pods = VirtualAirPods(noise: steady50, seed: 1)
        let phone = VirtualPhone(noise: steady100, seed: 2)
        drive(pods, into: pipeline, clock: clock, from: 0, to: 1000, stepMs: 20)
        drive(phone, into: pipeline, clock: clock, from: 0, to: 1700, stepMs: 10)

        let early = pipeline.frame(at: 1400)
        #expect(try #require(sample(early, "sim-airpods")).stale == false)

        // AirPods silent since 1000: stale at 1600 (> 500 ms), orientation frozen at the last packet.
        let late = pipeline.frame(at: 1600)
        let frozen = try #require(sample(late, "sim-airpods"))
        #expect(frozen.stale)
        #expect(try #require(frozen.orientation).angle(to: yaw(1000 * radPerMs)) < 1e-6)
        let later = try #require(sample(pipeline.frame(at: 1690), "sim-airpods"))
        #expect(later.orientation == frozen.orientation)
        #expect(try #require(sample(late, "sim-phone")).stale == false)
        let stats = pipeline.statsSnapshot()
        #expect(stats.first { $0.deviceId == "sim-airpods" }?.stale == true)
        #expect(stats.first { $0.deviceId == "sim-phone" }?.stale == false)

        // It comes back with a fresh packet.
        drive(pods, into: pipeline, clock: clock, from: 1700, to: 1760, stepMs: 20)
        let back = try #require(sample(pipeline.frame(at: 1780), "sim-airpods"))
        #expect(back.stale == false)
        #expect(try #require(back.orientation).angle(to: yaw(1730 * radPerMs)) < 1e-6)
    }

    @Test func airPodsCalibrationIsYawOnlyAndPhoneIsFull() throws {
        let clock = TestClock()
        let pipeline = makePipeline(clock)
        let pods = VirtualAirPods(noise: steady50, seed: 1)
        let phone = VirtualPhone(noise: steady100, seed: 2)
        let facing = Double.pi / 2
        drive(pods, into: pipeline, clock: clock, from: 0, to: 200, stepMs: 20, angle: { _ in facing })
        drive(phone, into: pipeline, clock: clock, from: 0, to: 200, stepMs: 10, angle: { _ in facing })
        #expect(pipeline.calibrate(deviceId: "sim-airpods"))
        #expect(pipeline.calibrate(deviceId: "sim-phone"))
        #expect(pipeline.calibrate(deviceId: "nope") == false)

        // Same pose after the tap is identity; a further 30 degree turn reads as 30 degrees.
        drive(pods, into: pipeline, clock: clock, from: 220, to: 400, stepMs: 20, angle: { _ in facing })
        drive(phone, into: pipeline, clock: clock, from: 210, to: 400, stepMs: 10, angle: { _ in facing })
        let still = pipeline.frame(at: 450)
        #expect(try #require(sample(still, "sim-airpods")?.orientation).angle(to: .identity) < 1e-6)
        #expect(try #require(sample(still, "sim-phone")?.orientation).angle(to: .identity) < 1e-6)

        let turned = facing + Double.pi / 6
        drive(pods, into: pipeline, clock: clock, from: 420, to: 700, stepMs: 20, angle: { _ in turned })
        drive(phone, into: pipeline, clock: clock, from: 410, to: 700, stepMs: 10, angle: { _ in turned })
        let after = pipeline.frame(at: 750)
        let want = yaw(Double.pi / 6)
        #expect(try #require(sample(after, "sim-airpods")?.orientation).angle(to: want) < 1e-6)
        #expect(try #require(sample(after, "sim-phone")?.orientation).angle(to: want) < 1e-6)

        pipeline.resetCalibration(deviceId: "sim-airpods")
        let raw = try #require(sample(pipeline.frame(at: 750), "sim-airpods")?.orientation)
        #expect(raw.angle(to: yaw(turned)) < 1e-6)
    }

    @Test func playerReplayThroughPipelineInterpolatesAndFlagsStale() throws {
        // Recording is in device time (offset 5000); the player re-stamps it onto the host clock at startHost.
        var lines = ""
        let encoder = JSONEncoder()
        for i in 0...25 {
            let ms = i * 20
            let p = UsisPacket(
                deviceId: "rec-pods", kind: .airpods, slot: .head, source: .live, t: Int64(5000 + ms), seq: i,
                ch: UsisChannels(orientation: yaw(Double(ms) * radPerMs))
            )
            lines += String(decoding: try encoder.encode(p), as: UTF8.self) + "\n"
        }
        let player = UsisPlayer(jsonl: lines)
        #expect(player.packetCount == 26)

        let clock = TestClock()
        let pipeline = makePipeline(clock)
        let startHost = 10_000.0
        var elapsed = 0.0
        while elapsed <= 500 {
            for packet in player.due(elapsedMs: elapsed, startHostMs: startHost) {
                clock.set(Double(packet.t))
                pipeline.ingest(packet)
            }
            elapsed += 10
        }

        // Host 10285 - 50 = 10235 = offset 235, between recorded 220 and 240.
        let frame = pipeline.frame(at: startHost + 285)
        let s = try #require(sample(frame, "rec-pods"))
        #expect(s.stale == false)
        #expect(try #require(s.orientation).angle(to: yaw(235 * radPerMs)) < 1e-6)

        let stats = try #require(pipeline.statsSnapshot().first)
        #expect(stats.packetCount == 26)
        #expect(stats.seqGaps == 0)
        #expect(stats.schemaErrors == 0)
        #expect(stats.source == .sim)

        // Replay is over; later the device is stale and frozen at the last recorded pose.
        let end = try #require(sample(pipeline.frame(at: startHost + 1200), "rec-pods"))
        #expect(end.stale)
        #expect(try #require(end.orientation).angle(to: yaw(500 * radPerMs)) < 1e-6)
    }

    @Test func frameCarriesNoSourceButStatsKeepIt() throws {
        let clock = TestClock()
        let pipeline = makePipeline(clock)
        let pods = VirtualAirPods(noise: steady50, seed: 1)
        let phone = VirtualPhone(noise: steady100, seed: 2)
        drive(pods, into: pipeline, clock: clock, from: 0, to: 200, stepMs: 20)
        drive(phone, into: pipeline, clock: clock, from: 0, to: 200, stepMs: 10)
        #expect(pods.makePacket(hostNowMs: 0).source == .sim)

        let frame = pipeline.frame(at: 250)
        #expect(frame.devices.count == 2)
        var labels: Set<String> = []
        for d in frame.devices {
            for child in Mirror(reflecting: d).children {
                if let label = child.label { labels.insert(label) }
            }
        }
        for child in Mirror(reflecting: frame).children {
            if let label = child.label { labels.insert(label) }
        }
        #expect(!labels.isEmpty)
        #expect(labels.contains { $0.lowercased().contains("source") } == false)
        #expect(!String(describing: frame).lowercased().contains("source"))

        let stats = pipeline.statsSnapshot()
        #expect(stats.count == 2)
        #expect(stats.allSatisfy { $0.source == .sim })
    }
}
