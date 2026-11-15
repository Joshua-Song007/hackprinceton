import Foundation
import Synchronization
import Testing
import PearCore
@testable import PearInput

private final class FakeClock: Sendable {
    private let value = Mutex(0.0)
    func now() -> Double { value.withLock { $0 } }
    func set(_ t: Double) { value.withLock { $0 = t } }
}

private func ry(_ a: Double) -> Quaternion { Quaternion(0, sin(a / 2), 0, cos(a / 2)) }

/// Same device, same samples, same timing; only the packet `source` differs.
private func run(source: PacketSource) -> (frame: InputFrame, stats: [DeviceStats]) {
    let clock = FakeClock()
    let pipeline = InputPipeline(clock: { clock.now() })
    for i in 0..<10 {
        clock.set(Double(i) * 20)
        pipeline.ingest(UsisPacket(
            deviceId: "w-1", kind: .watch, slot: .leftWrist, source: source, t: Int64(i * 20), seq: i,
            ch: UsisChannels(
                orientation: ry(Double(i) * 0.01),
                gesture: i == 5 ? GestureEvent(type: .tap) : nil,
                heartRate: 70 + Double(i)
            )
        ))
    }
    return (pipeline.frame(at: 200), pipeline.statsSnapshot())
}

private func labels(of value: Any) -> [String] {
    Mirror(reflecting: value).children.flatMap { child -> [String] in
        (child.label.map { [$0] } ?? []) + labels(of: child.value)
    }
}

@Suite struct SourceStrippingTests {
    @Test func liveAndSimInputProduceIdenticalFrames() {
        let live = run(source: .live)
        let sim = run(source: .sim)
        #expect(live.frame == sim.frame)
        #expect(live.frame.devices.count == 1)
        #expect(live.frame.devices[0].gestures == [GestureEvent(type: .tap)])
    }

    @Test func inputFrameCarriesNoSourceInformation() {
        let frame = run(source: .live).frame
        let found = labels(of: frame)
        #expect(found.contains("deviceId")) // the walk really descends into the frame
        #expect(!found.contains("source"))
    }

    @Test func deviceStatsIsTheOnePlaceSourceSurvives() {
        let live = run(source: .live).stats
        let sim = run(source: .sim).stats
        #expect(live[0].source == .live)
        #expect(sim[0].source == .sim)
        #expect(live[0].lastPacket?.source == .live)
    }
}
