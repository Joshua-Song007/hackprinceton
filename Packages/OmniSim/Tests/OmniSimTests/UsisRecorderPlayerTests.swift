import Foundation
import Synchronization
import Testing
import OmniCore
import OmniInput
@testable import OmniSim

private final class LineCollector: Sendable {
    private let lines = Mutex<[String]>([])
    func add(_ s: String) { lines.withLock { $0.append(s) } }
    var all: [String] { lines.withLock { $0 } }
    var text: String { all.joined() }
}

private func packet(_ id: String = "watch-1", t: Int64, seq: Int, hr: Double? = nil) -> UsisPacket {
    UsisPacket(
        deviceId: id, kind: .watch, slot: .leftWrist, source: .live, t: t, seq: seq,
        ch: UsisChannels(orientation: Quaternion(0, 0, 0, 1), heartRate: hr)
    )
}

private func record(_ packets: [UsisPacket]) -> String {
    let sink = LineCollector()
    let recorder = UsisRecorder(write: { sink.add($0) })
    for p in packets { recorder.record(p) }
    return sink.text
}

struct UsisRecorderPlayerTests {
    @Test func recorderWritesOneJSONObjectPerLine() throws {
        let sink = LineCollector()
        let recorder = UsisRecorder(write: { sink.add($0) })
        #expect(recorder.record(packet(t: 100, seq: 0)))
        #expect(recorder.record(packet(t: 120, seq: 1, hr: 90)))
        #expect(recorder.packetCount == 2)
        #expect(sink.all.count == 2)
        for line in sink.all {
            #expect(line.hasSuffix("\n"))
            #expect(line.dropLast().contains("\n") == false)
            _ = try JSONDecoder().decode(UsisPacket.self, from: Data(line.utf8))
        }
    }

    @Test func recorderIgnoresPacketsAfterStop() {
        let sink = LineCollector()
        let recorder = UsisRecorder(write: { sink.add($0) })
        recorder.stop()
        #expect(recorder.record(packet(t: 1, seq: 0)) == false)
        #expect(sink.all.isEmpty)
        #expect(recorder.packetCount == 0)
    }

    @Test func recordReplayRoundTripPreservesPacketsAndSpacing() {
        let original = [
            packet(t: 5_000, seq: 10, hr: 80),
            packet(t: 5_020, seq: 11),
            packet(t: 5_070, seq: 12, hr: 85),
        ]
        let player = UsisPlayer(jsonl: record(original))
        #expect(player.packetCount == 3)
        #expect(player.malformedLineCount == 0)
        let out = player.due(elapsedMs: 10_000, startHostMs: 1_000)
        #expect(out.count == 3)
        // Same payload and seq; `t` re-based to the host clock with the original spacing; source becomes sim.
        #expect(out.map(\.seq) == [10, 11, 12])
        #expect(out.map(\.t) == [1_000, 1_020, 1_070])
        #expect(out.map(\.ch) == original.map(\.ch))
        #expect(out.allSatisfy { $0.source == .sim })
    }

    @Test func packetsAreReleasedOnlyWhenDue() {
        let player = UsisPlayer(jsonl: record([packet(t: 0, seq: 0), packet(t: 100, seq: 1), packet(t: 300, seq: 2)]))
        #expect(player.due(elapsedMs: 0, startHostMs: 0).count == 1)
        #expect(player.nextDueElapsedMs() == 100)
        #expect(player.due(elapsedMs: 99, startHostMs: 0).isEmpty)
        #expect(player.due(elapsedMs: 100, startHostMs: 0).count == 1)
        #expect(player.due(elapsedMs: 1_000, startHostMs: 0).count == 1)
        #expect(player.nextDueElapsedMs() == nil)
        #expect(player.due(elapsedMs: 5_000, startHostMs: 0).isEmpty)
    }

    @Test func loopedReplayRestampsTimeAndSeqContinuously() {
        let player = UsisPlayer(
            jsonl: record([packet(t: 0, seq: 0), packet(t: 100, seq: 1), packet(t: 200, seq: 2)]), loop: true
        )
        // Loop length = 200 ms duration + 100 ms mean interval = 300 ms.
        let out = player.due(elapsedMs: 650, startHostMs: 10_000)
        #expect(out.map(\.t) == [10_000, 10_100, 10_200, 10_300, 10_400, 10_500, 10_600])
        #expect(out.map(\.seq) == [0, 1, 2, 3, 4, 5, 6])
        #expect(player.nextDueElapsedMs() == 700)
    }

    @Test func loopedSeqStaysContinuousPerDevice() {
        let player = UsisPlayer(
            jsonl: record([packet("a", t: 0, seq: 7), packet("b", t: 10, seq: 100), packet("a", t: 20, seq: 8)]),
            loop: true
        )
        let out = player.due(elapsedMs: 100, startHostMs: 0)
        let a = out.filter { $0.deviceId == "a" }.map(\.seq)
        let b = out.filter { $0.deviceId == "b" }.map(\.seq)
        #expect(a == Array(7..<(7 + a.count)))
        #expect(b == Array(100..<(100 + b.count)))
    }

    @Test func malformedLinesAreSkippedAndCounted() {
        let good = record([packet(t: 0, seq: 0), packet(t: 10, seq: 1)])
        let text = "not json\n" + good + "\n   \n{\"v\":1}\n"
        let player = UsisPlayer(jsonl: text)
        #expect(player.packetCount == 2)
        #expect(player.malformedLineCount == 2)
        #expect(player.due(elapsedMs: 100, startHostMs: 0).count == 2)
    }

    @Test func emptyRecordingProducesNothing() {
        let player = UsisPlayer(jsonl: "", loop: true)
        #expect(player.descriptors.isEmpty)
        #expect(player.nextDueElapsedMs() == nil)
        #expect(player.due(elapsedMs: 1_000, startHostMs: 0).isEmpty)
    }

    @Test func descriptorsReflectRecordedDevices() {
        let player = UsisPlayer(jsonl: record([
            packet("a", t: 0, seq: 0, hr: 70), packet("a", t: 100, seq: 1), packet("a", t: 200, seq: 2),
        ]))
        #expect(player.descriptors.count == 1)
        let d = player.descriptors[0]
        #expect(d.deviceId == "a")
        #expect(d.kind == .watch)
        #expect(d.slot == .leftWrist)
        #expect(d.channels == [.orientation, .heartRate])
        #expect(abs(d.sampleRateHz - 10) < 0.001)
    }

    @Test func replayedPacketsPassThroughInputPipeline() {
        let pipeline = InputPipeline()
        let player = UsisPlayer(jsonl: record([packet(t: 0, seq: 0), packet(t: 20, seq: 1), packet(t: 40, seq: 2)]))
        let start = HostClock.nowMs()
        for p in player.due(elapsedMs: 100, startHostMs: start) { pipeline.ingest(p) }
        let frame = pipeline.frame(at: start + 200)
        #expect(frame.devices.count == 1)
    }
}
