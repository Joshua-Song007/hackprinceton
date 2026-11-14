import Foundation
import Network

setvbuf(stdout, nil, _IOLBF, 0) // line-buffer so output survives a crash or a pipe

// MARK: - Pure helpers (stats copied from AirPodsProbe; throwaway, no shared module)

func percentile(_ sorted: [Double], _ p: Double) -> Double {
    guard !sorted.isEmpty else { return 0 }
    return sorted[min(sorted.count - 1, Int((Double(sorted.count - 1) * p).rounded()))]
}

func hz(_ intervalsMs: [Double]) -> Double {
    let total = intervalsMs.reduce(0, +)
    return total > 0 ? Double(intervalsMs.count) / (total / 1000) : 0
}

/// Splits complete newline-terminated lines off the front of `buffer`; a partial last line stays buffered.
func splitLines(_ buffer: inout Data) -> [String] {
    var lines: [String] = []
    while let nl = buffer.firstIndex(of: 0x0A) {
        let line = String(decoding: buffer[buffer.startIndex..<nl], as: UTF8.self)
        buffer.removeSubrange(buffer.startIndex...nl)
        if !line.isEmpty { lines.append(line) }
    }
    return lines
}

/// One stats bucket (a 2 s window or the whole session). Times in ms.
struct Bucket {
    var intervals: [Double] = []
    var seqDrops = 0
    var motionSamples = 0
    var rtts: [Double] = []
    var offsets: [Double] = []
    var motionLatencies: [Double] = []
    var touches = 0
    var hapticRtts: [Double] = []
    // Pencil (iPad). Ranges are [min, max]; empty means no samples.
    var pencilIntervals: [Double] = []
    var pencilSamples = 0
    var force: [Double] = [], alt: [Double] = [], roll: [Double] = [], hoverZ: [Double] = []
    var squeezes = 0, taps = 0

    var hasPencil: Bool { pencilSamples > 0 || !hoverZ.isEmpty || squeezes > 0 || taps > 0 }

    func describePencil() -> String {
        func range(_ v: [Double], _ scale: Double = 1) -> String {
            guard let lo = v.min(), let hi = v.max() else { return "—" }
            return String(format: "[%.2f, %.2f]", lo * scale, hi * scale)
        }
        let iv = pencilIntervals.sorted(), deg = 180 / Double.pi
        return String(format: "    pencil n=%d %.1f Hz  interval p50 %.2f / p95 %.2f ms  force %@  alt %@°  roll %@°  hover n=%d z %@  squeeze %d  tap %d",
                      pencilSamples, hz(pencilIntervals), percentile(iv, 0.5), percentile(iv, 0.95),
                      range(force), range(alt, deg), range(roll, deg), hoverZ.count, range(hoverZ), squeezes, taps)
    }

    func describe(seconds: Double) -> String {
        let iv = intervals.sorted(), rt = rtts.sorted(), off = offsets.sorted(), ml = motionLatencies.sorted(), hp = hapticRtts.sorted()
        let dropPct = motionSamples + seqDrops > 0 ? 100 * Double(seqDrops) / Double(motionSamples + seqDrops) : 0
        return String(format: """
            motion n=%d %.1f Hz  interval p50 %.1f / p95 %.1f / max %.1f ms  gaps>100ms %d  gaps>500ms %d  seq drops %d (%.2f%%)
                link rtt p50 %.1f / p95 %.1f ms  clock offset %.1f ms (spread p5–p95 %.1f)  motion latency est p50 %.1f / p95 %.1f ms
                touch %.1f/s  haptic ack rtt p50 %.1f ms (%d acks)
            """,
            motionSamples, hz(intervals), percentile(iv, 0.5), percentile(iv, 0.95), iv.last ?? 0,
            iv.filter { $0 > 100 }.count, iv.filter { $0 > 500 }.count, seqDrops, dropPct,
            percentile(rt, 0.5), percentile(rt, 0.95), percentile(off, 0.5), percentile(off, 0.95) - percentile(off, 0.05),
            percentile(ml, 0.5), percentile(ml, 0.95),
            seconds > 0 ? Double(touches) / seconds : 0, percentile(hp, 0.5), hapticRtts.count)
    }
}

func selftest() {
    var buf = Data("a\nb".utf8)
    assert(splitLines(&buf) == ["a"])
    assert(String(decoding: buf, as: UTF8.self) == "b")
    buf.append(Data("c\n\nd\n".utf8))
    assert(splitLines(&buf) == ["bc", "d"])
    assert(buf.isEmpty)
    let iv = Array(repeating: 10.0, count: 99) + [600]
    assert(abs(hz(iv) - 100 / 1.59) < 1e-9)
    assert(percentile(iv.sorted(), 0.5) == 10 && percentile([], 0.5) == 0)
    var b = Bucket()
    assert(!b.hasPencil)
    b.pencilSamples = 1; b.force = [0.2, 0.9]
    assert(b.hasPencil && b.describePencil().contains("force [0.20, 0.90]"))
    print("selftest ok")
}

// MARK: - Args

var outPath = "phone-\(Int(Date().timeIntervalSince1970)).jsonl"
var duration = 0.0
var args = CommandLine.arguments.dropFirst().makeIterator()
while let a = args.next() {
    switch a {
    case "--selftest": selftest(); exit(0)
    case "--out": outPath = args.next() ?? outPath
    case "--duration": duration = Double(args.next() ?? "") ?? 0
    default: print("usage: PhoneProbeHost [--out file.jsonl] [--duration seconds] [--selftest]"); exit(2)
    }
}

FileManager.default.createFile(atPath: outPath, contents: nil)
guard let file = FileHandle(forWritingAtPath: outPath) else { print("cannot open \(outPath)"); exit(1) }
func writeLine(_ s: String) { file.write(Data((s + "\n").utf8)) }
func now() -> Double { ProcessInfo.processInfo.systemUptime }

// MARK: - State (only touched on `queue`)

let queue = DispatchQueue(label: "phone-probe-host")
let started = now()
var current: NWConnection?
var buffer = Data()
var lastSeq: Int?
var lastT: Double?
var window = Bucket(), session = Bucket()
var hapticSentAt: [Int: Double] = [:]
var nextHaptic = 1
var lastPhase = "?"
var lastPencilT: Double?

func record(_ update: (inout Bucket) -> Void) { update(&window); update(&session) }

func handle(_ line: String, recv: Double) {
    writeLine("{\"recv\":\(recv),\"msg\":\(line)}")
    guard let obj = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any] else { return }
    if let seq = obj["m"] as? Int, let t = obj["t"] as? Double {
        record { $0.motionSamples += 1 }
        if let lastSeq, seq > lastSeq + 1 { record { $0.seqDrops += seq - lastSeq - 1 } }
        if let lastT { let iv = (t - lastT) * 1000; record { $0.intervals.append(iv) } }
        if let offset = session.offsets.sorted().dropFirst(session.offsets.count / 2).first {
            // phone time → host time via the median clock offset (both clocks are seconds since boot)
            let lat = (recv - (t - offset / 1000)) * 1000
            record { $0.motionLatencies.append(lat) }
        }
        lastSeq = seq
        lastT = t
    } else if let hostT = obj["pong"] as? Double, let dev = obj["dev"] as? Double {
        let rtt = recv - hostT
        let offset = (dev - (hostT + rtt / 2)) * 1000
        record { $0.rtts.append(rtt * 1000); $0.offsets.append(offset) }
    } else if let p = obj["pencil"] as? [String: Any], let t = obj["t"] as? Double {
        record { b in
            b.pencilSamples += 1
            if let f = p["force"] as? Double { b.force.append(f) }
            if let a = p["alt"] as? Double { b.alt.append(a) }
            if let r = p["roll"] as? Double { b.roll.append(r) }
        }
        // a new stroke starts a new interval chain, so pen-up time isn't counted as a sample gap
        if (p["phase"] as? String) != "began", let lastPencilT { let iv = (t - lastPencilT) * 1000; record { $0.pencilIntervals.append(iv) } }
        lastPencilT = (p["phase"] as? String) == "ended" ? nil : t
    } else if let h = obj["hover"] as? [String: Any] {
        if let z = h["z"] as? Double { record { $0.hoverZ.append(z) } }
    } else if let g = obj["pencilGesture"] as? String {
        if g == "tap" { record { $0.taps += 1 } }
        if g == "squeeze", (obj["phase"] as? String) == "ended" { record { $0.squeezes += 1 } }
        print(">>> pencil \(g)\((obj["phase"] as? String).map { " \($0)" } ?? "") via \(obj["via"] as? String ?? "?")")
    } else if obj["touch"] != nil {
        record { $0.touches += 1 }
    } else if let id = obj["hapticAck"] as? Int, let sent = hapticSentAt.removeValue(forKey: id) {
        let rtt = (recv - sent) * 1000
        record { $0.hapticRtts.append(rtt) }
    } else if let model = obj["hello"] as? String {
        print(">>> hello from \(model) (\(obj["idiom"] as? String ?? "?"))")
    } else if let phase = obj["phase"] as? String {
        lastPhase = phase
        print(">>> phone phase: \(phase)")
    }
}

func send(_ line: String) {
    guard let c = current, c.state == .ready else { return }
    c.send(content: Data((line + "\n").utf8), completion: .idempotent)
}

func receive(on c: NWConnection) {
    c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, isComplete, error in
        let recv = now()
        if let data { buffer.append(data) }
        for line in splitLines(&buffer) { handle(line, recv: recv) }
        if isComplete || error != nil { c.cancel(); return }
        receive(on: c)
    }
}

// MARK: - Listener

let tcp = NWProtocolTCP.Options()
tcp.noDelay = true
let listener: NWListener
do { listener = try NWListener(using: NWParameters(tls: nil, tcp: tcp)) } catch { print("listener: \(error)"); exit(1) }
listener.service = NWListener.Service(name: Host.current().localizedName ?? "Omni Mac", type: "_omniprobe._tcp")
listener.stateUpdateHandler = { state in
    print("listener \(state)\(listener.port.map { " on port \($0)" } ?? "")  advertising _omniprobe._tcp")
    if case .failed = state { exit(1) }
}
listener.newConnectionHandler = { c in
    current?.cancel() // one phone at a time; the newest wins
    current = c
    buffer.removeAll()
    lastSeq = nil
    lastT = nil
    c.stateUpdateHandler = { state in
        switch state {
        case .ready:
            print(String(format: ">>> connect %@ (%.1f s after start)", "\(c.endpoint)", now() - started))
            writeLine("{\"event\":\"connect\",\"recv\":\(now())}")
            receive(on: c)
        case .failed, .cancelled:
            print(">>> disconnect")
            writeLine("{\"event\":\"disconnect\",\"recv\":\(now())}")
            if current === c { current = nil }
        default:
            break
        }
    }
    c.start(queue: queue)
}
listener.start(queue: queue)
print("recording to \(outPath)  (Ctrl-C to stop). Open PhoneProbe on the iPhone.")

// MARK: - Timers

func every(_ seconds: Double, _ body: @escaping () -> Void) -> DispatchSourceTimer {
    let t = DispatchSource.makeTimerSource(queue: queue)
    t.schedule(deadline: .now() + seconds, repeating: seconds)
    t.setEventHandler(handler: body)
    t.resume()
    return t
}

let pinger = every(0.5) { send("{\"ping\":\(now())}") }
let haptics = every(3) {
    guard current?.state == .ready else { return }
    hapticSentAt[nextHaptic] = now()
    send("{\"haptic\":\(nextHaptic)}")
    nextHaptic += 1
}
let reporter = every(2) {
    print((current?.state == .ready ? "" : "(no phone connected)  ") + "phase=\(lastPhase)\n" + window.describe(seconds: 2) + (window.hasPencil ? "\n" + window.describePencil() : ""))
    window = Bucket()
}

func finish() {
    print("\n=== session ===\n" + session.describe(seconds: now() - started) + (session.hasPencil ? "\n" + session.describePencil() : ""))
    try? file.close()
    print("saved \(outPath)")
    exit(0)
}

signal(SIGINT, SIG_IGN)
let sigint = DispatchSource.makeSignalSource(signal: SIGINT, queue: queue)
sigint.setEventHandler { finish() }
sigint.resume()
if duration > 0 { queue.asyncAfter(deadline: .now() + duration) { finish() } }

dispatchMain()
