import Foundation
import Synchronization
import PearCore
import PearInput

/// Pure replay schedule over a parsed recording. Time is an argument (`elapsedMs` since replay start,
/// `startHostMs` on the host clock), so tests drive it without sleeping.
struct ReplayTimeline: Sendable {
    private let packets: [UsisPacket]
    private let offsetsMs: [Double]
    private let loopLengthMs: Double
    private let seqSpan: [String: Int]
    private let loops: Bool
    private var index = 0
    private var loopCount = 0

    init(packets: [UsisPacket], loops: Bool) {
        // Stable sort by device time so out-of-order lines still replay in order.
        let sorted = packets.enumerated().sorted { ($0.element.t, $0.offset) < ($1.element.t, $1.offset) }.map(\.element)
        self.packets = sorted
        self.loops = loops
        let first = sorted.first?.t ?? 0
        let offsets = sorted.map { Double($0.t - first) }
        self.offsetsMs = offsets
        let duration = offsets.last ?? 0
        // One mean interval of padding so the first packet of the next loop does not share a timestamp with the last.
        let pad = sorted.count > 1 ? duration / Double(sorted.count - 1) : 1
        self.loopLengthMs = duration + max(pad, 1)
        var ranges: [String: (min: Int, max: Int)] = [:]
        for p in sorted {
            if let r = ranges[p.deviceId] {
                ranges[p.deviceId] = (Swift.min(r.min, p.seq), Swift.max(r.max, p.seq))
            } else {
                ranges[p.deviceId] = (p.seq, p.seq)
            }
        }
        self.seqSpan = ranges.mapValues { $0.max - $0.min + 1 }
    }

    /// Elapsed ms at which the next packet is due; nil when the replay is finished.
    var nextDueElapsedMs: Double? {
        if index < packets.count { return Double(loopCount) * loopLengthMs + offsetsMs[index] }
        if loops, let firstOffset = offsetsMs.first { return Double(loopCount + 1) * loopLengthMs + firstOffset }
        return nil
    }

    mutating func reset() {
        index = 0
        loopCount = 0
    }

    /// Every packet due at or before `elapsedMs`, re-stamped: `t` = start + offset on the host clock (a looped replay
    /// adds a whole loop length per pass) and `seq` advances by each device's seq span per pass, so clock anchoring and
    /// seq-gap stats see one continuous stream. Gaps recorded inside the file are kept.
    mutating func popDue(elapsedMs: Double, startHostMs: Double) -> [UsisPacket] {
        var out: [UsisPacket] = []
        while true {
            if index >= packets.count {
                guard loops, !packets.isEmpty else { break }
                index = 0
                loopCount += 1
            }
            let due = Double(loopCount) * loopLengthMs + offsetsMs[index]
            guard due <= elapsedMs else { break }
            var p = packets[index]
            p.t = Int64((startHostMs + due).rounded())
            p.seq += loopCount * (seqSpan[p.deviceId] ?? 0)
            p.source = .sim
            out.append(p)
            index += 1
        }
        return out
    }
}

/// Replays a `.usis.jsonl` recording as an `InputSource` with its original relative timing.
/// Packets are stamped `source: "sim"`. Malformed lines are skipped and counted in `malformedLineCount`.
public final class UsisPlayer: InputSource, Sendable {
    private struct State {
        var timeline: ReplayTimeline
        var task: Task<Void, Never>?
    }

    public let descriptors: [DeviceDescriptor]
    /// Non-blank lines that did not decode as a packet.
    public let malformedLineCount: Int
    /// Packets parsed from the recording.
    public let packetCount: Int
    private let state: Mutex<State>

    /// Parses `jsonl` (one packet per line; blank lines ignored). `loop` restarts the replay after the last packet.
    public init(jsonl: String, loop: Bool = false) {
        let decoder = JSONDecoder()
        var packets: [UsisPacket] = []
        var bad = 0
        for line in jsonl.split(whereSeparator: \.isNewline) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty { continue }
            if let packet = try? decoder.decode(UsisPacket.self, from: Data(trimmed.utf8)) {
                packets.append(packet)
            } else {
                bad += 1
            }
        }
        self.malformedLineCount = bad
        self.packetCount = packets.count
        self.descriptors = UsisPlayer.makeDescriptors(packets)
        self.state = Mutex(State(timeline: ReplayTimeline(packets: packets, loops: loop)))
    }

    public convenience init(contentsOf url: URL, loop: Bool = false) throws {
        self.init(jsonl: try String(contentsOf: url, encoding: .utf8), loop: loop)
    }

    private static func makeDescriptors(_ packets: [UsisPacket]) -> [DeviceDescriptor] {
        var order: [String] = []
        var groups: [String: [UsisPacket]] = [:]
        for p in packets {
            if groups[p.deviceId] == nil { order.append(p.deviceId) }
            groups[p.deviceId, default: []].append(p)
        }
        return order.compactMap { id in
            guard let group = groups[id], let first = group.first else { return nil }
            var channels: Set<ChannelKind> = []
            for p in group {
                if p.ch.orientation != nil { channels.insert(.orientation) }
                if p.ch.position != nil { channels.insert(.position) }
                if p.ch.accel != nil { channels.insert(.accel) }
                if p.ch.touch != nil { channels.insert(.touch) }
                if p.ch.gesture != nil { channels.insert(.gesture) }
                if p.ch.heartRate != nil { channels.insert(.heartRate) }
                if p.ch.pencil != nil { channels.insert(.pencil) }
            }
            let times = group.map(\.t)
            let span = Double((times.max() ?? 0) - (times.min() ?? 0))
            let rate = group.count > 1 && span > 0 ? Double(group.count - 1) / (span / 1000) : 0
            return DeviceDescriptor(
                deviceId: id, kind: first.kind, slot: first.slot, sampleRateHz: rate, channels: channels
            )
        }
    }

    /// Packets due `elapsedMs` after replay start, for a replay that began at `startHostMs`. Test and driver entry point.
    func due(elapsedMs: Double, startHostMs: Double) -> [UsisPacket] {
        state.withLock { $0.timeline.popDue(elapsedMs: elapsedMs, startHostMs: startHostMs) }
    }

    func nextDueElapsedMs() -> Double? {
        state.withLock { $0.timeline.nextDueElapsedMs }
    }

    public func start(bus: InputBus) {
        stop()
        state.withLock { $0.timeline.reset() }
        let startHost = HostClock.nowMs()
        let new = Task { [self] in
            while !Task.isCancelled {
                let elapsed = HostClock.nowMs() - startHost
                for packet in due(elapsedMs: elapsed, startHostMs: startHost) {
                    bus.ingest(packet)
                }
                guard let next = nextDueElapsedMs() else { return }
                let waitMs = max(next - (HostClock.nowMs() - startHost), 0.5)
                try? await Task.sleep(nanoseconds: UInt64(waitMs * 1_000_000))
            }
        }
        let old = state.withLock { s -> Task<Void, Never>? in
            let previous = s.task
            s.task = new
            return previous
        }
        old?.cancel()
    }

    public func stop() {
        let old = state.withLock { s -> Task<Void, Never>? in
            let previous = s.task
            s.task = nil
            return previous
        }
        old?.cancel()
    }
}
