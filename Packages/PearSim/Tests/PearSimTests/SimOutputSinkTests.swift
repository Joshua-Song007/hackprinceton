import Foundation
import Synchronization
import Testing
import PearCore
import PearInput
import PearOutput
@testable import PearSim

private final class Recorder: Sendable {
    private let items = Mutex<[OutputCommand]>([])
    func add(_ c: OutputCommand) { items.withLock { $0.append(c) } }
    var all: [OutputCommand] { items.withLock { $0 } }
}

private func device(_ id: String, _ slot: Slot) -> VirtualDevice {
    VirtualDevice(deviceId: id, kind: .phone, slot: slot, channels: [.orientation], noise: .phone, seed: 1)
}

private func haptic(_ target: String, _ pattern: String = "thud") -> OutputCommand {
    OutputCommand(target: target, type: .haptic, pattern: pattern, intensity: 0.8, durationMs: 120)
}

struct SimOutputSinkTests {
    @Test func routesByDeviceIdAndNothingIsDeliveredBeforeDrain() {
        let sink = SimOutputSink()
        let a = device("phone-1", .pocket)
        let b = device("watch-1", .leftWrist)
        let ra = Recorder(), rb = Recorder()
        a.setFeedbackHandler { ra.add($0) }
        b.setFeedbackHandler { rb.add($0) }
        sink.register(a); sink.register(b)

        sink.send(haptic("watch-1"))
        #expect(rb.all.isEmpty)
        #expect(sink.pendingCount == 1)

        let delivered = sink.drain()
        #expect(delivered.map(\.deviceId) == ["watch-1"])
        #expect(rb.all == [haptic("watch-1")])
        #expect(ra.all.isEmpty)
        #expect(sink.pendingCount == 0)
    }

    @Test func routesBySlotAndPreservesOrder() {
        let sink = SimOutputSink()
        let w = device("watch-1", .leftWrist)
        let r = Recorder()
        w.setFeedbackHandler { r.add($0) }
        sink.register(w)

        sink.send([haptic("leftWrist", "a"), haptic("leftWrist", "b")])
        sink.drain()
        #expect(r.all.map(\.pattern) == ["a", "b"])
    }

    @Test func slotReachesEveryDeviceInThatSlot() {
        let sink = SimOutputSink()
        let a = device("p1-watch", .leftWrist)
        let b = device("p2-watch", .leftWrist)
        let ra = Recorder(), rb = Recorder()
        a.setFeedbackHandler { ra.add($0) }
        b.setFeedbackHandler { rb.add($0) }
        sink.register(a); sink.register(b)

        sink.send(haptic("leftWrist"))
        #expect(sink.drain().count == 2)
        #expect(ra.all.count == 1 && rb.all.count == 1)
    }

    @Test func unknownTargetIsCountedAndDropped() {
        let sink = SimOutputSink()
        let a = device("phone-1", .pocket)
        sink.register(a)
        sink.send([haptic("nobody"), haptic("phone-1")])
        #expect(sink.unknownTargetCount == 1)
        #expect(sink.drain().count == 1)
    }

    @Test func emptySendIsNoOp() {
        let sink = SimOutputSink()
        sink.send([])
        #expect(sink.pendingCount == 0)
        #expect(sink.unknownTargetCount == 0)
        #expect(sink.drain().isEmpty)
    }

    @Test func unregisterDiscardsQueuedAndStopsRouting() {
        let sink = SimOutputSink()
        let a = device("phone-1", .pocket)
        let r = Recorder()
        a.setFeedbackHandler { r.add($0) }
        sink.register(a)
        sink.register(a)
        sink.send(haptic("phone-1"))
        #expect(sink.pendingCount == 1)
        sink.unregister(a)
        #expect(sink.pendingCount == 0)
        sink.send(haptic("phone-1"))
        #expect(sink.unknownTargetCount == 1)
        sink.drain()
        #expect(r.all.isEmpty)
    }

    @Test func queueIsCappedDroppingOldest() {
        let sink = SimOutputSink()
        sink.register(device("phone-1", .pocket))
        let n = SimOutputSink.maxQueued + 5
        sink.send((0..<n).map { haptic("phone-1", "p\($0)") })
        #expect(sink.pendingCount == SimOutputSink.maxQueued)
        #expect(sink.overflowCount == 5)
        #expect(sink.drain().first?.command.pattern == "p5")
    }

    @Test func worksThroughOutputSinkProtocol() {
        let sink: OutputSink = SimOutputSink()
        sink.send(haptic("x"))
        #expect((sink as? SimOutputSink)?.unknownTargetCount == 1)
    }
}
