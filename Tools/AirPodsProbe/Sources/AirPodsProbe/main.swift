import CoreMotion
import Foundation

// MARK: - Stats (pure)

struct Summary {
    var samples: Int
    var hz: Double
    var intervalP50: Double
    var intervalP95: Double
    var intervalMax: Double
    var gapsOver100: Int
    var gapsOver500: Int
    var latencyP50: Double
    var latencyP95: Double
}

func percentile(_ sorted: [Double], _ p: Double) -> Double {
    guard !sorted.isEmpty else { return 0 }
    return sorted[min(sorted.count - 1, Int((Double(sorted.count - 1) * p).rounded()))]
}

/// Intervals and latencies in milliseconds. `samples` is the latency count (one latency per sample).
func summarize(intervals: [Double], latencies: [Double]) -> Summary {
    let iv = intervals.sorted()
    let lat = latencies.sorted()
    let totalMs = iv.reduce(0, +)
    return Summary(
        samples: lat.count,
        hz: totalMs > 0 ? Double(iv.count) / (totalMs / 1000) : 0,
        intervalP50: percentile(iv, 0.5),
        intervalP95: percentile(iv, 0.95),
        intervalMax: iv.last ?? 0,
        gapsOver100: iv.filter { $0 > 100 }.count,
        gapsOver500: iv.filter { $0 > 500 }.count,
        latencyP50: percentile(lat, 0.5),
        latencyP95: percentile(lat, 0.95)
    )
}

func describe(_ s: Summary) -> String {
    String(format: "n=%d  %.1f Hz  interval p50 %.1f / p95 %.1f / max %.1f ms  gaps>100ms %d  gaps>500ms %d  latency p50 %.1f / p95 %.1f ms",
           s.samples, s.hz, s.intervalP50, s.intervalP95, s.intervalMax, s.gapsOver100, s.gapsOver500, s.latencyP50, s.latencyP95)
}

func selftest() {
    let intervals = Array(repeating: 20.0, count: 98) + [150, 600]
    let s = summarize(intervals: intervals, latencies: [5, 5, 5, 10])
    assert(s.samples == 4)
    assert(s.intervalP50 == 20 && s.intervalMax == 600)
    assert(s.gapsOver100 == 2 && s.gapsOver500 == 1)
    assert(abs(s.hz - 100 / 2.71) < 1e-9)
    assert(s.latencyP50 == 5 && s.latencyP95 == 10)
    let empty = summarize(intervals: [], latencies: [])
    assert(empty.hz == 0 && empty.intervalMax == 0)
    print("selftest ok")
}

// MARK: - Args

setvbuf(stdout, nil, _IOLBF, 0) // line-buffer so output survives a crash or a pipe

var outPath = "airpods-\(Int(Date().timeIntervalSince1970)).jsonl"
var duration = 0.0
var args = CommandLine.arguments.dropFirst().makeIterator()
while let a = args.next() {
    switch a {
    case "--selftest": selftest(); exit(0)
    case "--out": outPath = args.next() ?? outPath
    case "--duration": duration = Double(args.next() ?? "") ?? 0
    default: print("usage: AirPodsProbe [--out file.jsonl] [--duration seconds] [--selftest]"); exit(2)
    }
}

// MARK: - Probe

let queue = DispatchQueue(label: "airpods-probe")
let opQueue = OperationQueue()
opQueue.underlyingQueue = queue

let manager = CMHeadphoneMotionManager()

let auth: String
switch CMHeadphoneMotionManager.authorizationStatus() {
case .notDetermined: auth = "notDetermined"
case .restricted: auth = "restricted"
case .denied: auth = "denied"
case .authorized: auth = "authorized"
@unknown default: auth = "unknown"
}
print("isDeviceMotionAvailable=\(manager.isDeviceMotionAvailable)  authorizationStatus=\(auth)")
guard manager.isDeviceMotionAvailable else {
    print("Headphone motion unavailable. Are supported AirPods (Pro/Pro 2/3/4/Max) connected to this Mac, not the phone?")
    exit(1)
}

FileManager.default.createFile(atPath: outPath, contents: nil)
guard let file = FileHandle(forWritingAtPath: outPath) else { print("cannot open \(outPath)"); exit(1) }
print("recording to \(outPath)  (Ctrl-C to stop)")

func writeLine(_ s: String) { file.write(Data((s + "\n").utf8)) }

// All state below is touched only on `queue`.
var lastT: Double?
var windowIntervals: [Double] = [], windowLatencies: [Double] = []
var allIntervals: [Double] = [], allLatencies: [Double] = []
var latest: CMDeviceMotion?

func budName(_ loc: CMDeviceMotion.SensorLocation) -> String {
    switch loc {
    case .headphoneLeft: "left"
    case .headphoneRight: "right"
    case .default: "default"
    @unknown default: "unknown"
    }
}

// Types are hoisted above top-level code, so the delegate forwards through a closure instead of touching globals.
final class Delegate: NSObject, CMHeadphoneMotionManagerDelegate {
    var onEvent: ((String) -> Void)?
    func headphoneMotionManagerDidConnect(_ manager: CMHeadphoneMotionManager) { onEvent?("connect") }
    func headphoneMotionManagerDidDisconnect(_ manager: CMHeadphoneMotionManager) { onEvent?("disconnect") }
}
let delegate = Delegate()
delegate.onEvent = { name in
    queue.async {
        print(">>> \(name)")
        writeLine("{\"event\":\"\(name)\",\"recv\":\(ProcessInfo.processInfo.systemUptime)}")
        if name == "disconnect" { lastT = nil } // don't count the disconnect gap as a sample interval
    }
}
manager.delegate = delegate

manager.startDeviceMotionUpdates(to: opQueue) { motion, error in
    if let error { print("motion error: \(error)"); return }
    guard let m = motion else { return }
    let recv = ProcessInfo.processInfo.systemUptime
    let q = m.attitude.quaternion, r = m.rotationRate, a = m.userAcceleration, g = m.gravity
    writeLine("{\"t\":\(m.timestamp),\"recv\":\(recv),\"q\":[\(q.x),\(q.y),\(q.z),\(q.w)],\"rot\":[\(r.x),\(r.y),\(r.z)],\"acc\":[\(a.x),\(a.y),\(a.z)],\"grav\":[\(g.x),\(g.y),\(g.z)],\"bud\":\"\(budName(m.sensorLocation))\"}")
    let latency = (recv - m.timestamp) * 1000
    windowLatencies.append(latency); allLatencies.append(latency)
    if let lastT {
        let interval = (m.timestamp - lastT) * 1000
        windowIntervals.append(interval); allIntervals.append(interval)
    }
    lastT = m.timestamp
    latest = m
}

let timer = DispatchSource.makeTimerSource(queue: queue)
timer.schedule(deadline: .now() + 2, repeating: 2)
timer.setEventHandler {
    print(describe(summarize(intervals: windowIntervals, latencies: windowLatencies)))
    if let m = latest {
        let d = 180 / Double.pi, q = m.attitude.quaternion
        print(String(format: "    bud=%@  roll %.1f  pitch %.1f  yaw %.1f deg  q=[%.3f, %.3f, %.3f, %.3f]",
                     budName(m.sensorLocation), m.attitude.roll * d, m.attitude.pitch * d, m.attitude.yaw * d, q.x, q.y, q.z, q.w))
    } else {
        print("    no samples yet (put the AirPods in your ears)")
    }
    windowIntervals.removeAll(keepingCapacity: true)
    windowLatencies.removeAll(keepingCapacity: true)
}
timer.resume()

func finish() {
    manager.stopDeviceMotionUpdates()
    print("\n=== session ===\n" + describe(summarize(intervals: allIntervals, latencies: allLatencies)))
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
