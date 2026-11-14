import CoreMotion
import Network
import SwiftUI
import UIKit

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

func tcpParameters() -> NWParameters {
    let tcp = NWProtocolTCP.Options()
    tcp.noDelay = true // small JSON lines; don't let Nagle batch them
    return NWParameters(tls: nil, tcp: tcp)
}

/// All networking and motion state lives on `queue`; only the @Published fields are touched on main.
final class Probe: ObservableObject {
    @Published var status = "starting"
    @Published var host = "—"
    @Published var sentPerSecond = 0

    private let queue = DispatchQueue(label: "phone-probe")
    private let opQueue = OperationQueue()
    private let motion = CMMotionManager()
    private let haptic = UIImpactFeedbackGenerator(style: .heavy)
    private var browser: NWBrowser?
    private var connection: NWConnection?
    private var buffer = Data()
    private var seq = 0
    private var sentThisSecond = 0

    init() { opQueue.underlyingQueue = queue }

    func start() {
        browse()
        startMotion()
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 1, repeating: 1)
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            let n = sentThisSecond
            sentThisSecond = 0
            DispatchQueue.main.async { self.sentPerSecond = n }
        }
        timer.resume()
        self.timer = timer
    }
    private var timer: DispatchSourceTimer?

    // MARK: Link

    private func browse() {
        let b = NWBrowser(for: .bonjour(type: "_omniprobe._tcp", domain: nil), using: tcpParameters())
        b.stateUpdateHandler = { [weak self] state in self?.setStatus("browser \(state)") }
        b.browseResultsChangedHandler = { [weak self] _, _ in self?.connectIfIdle() }
        b.start(queue: queue)
        browser = b
    }

    private func connectIfIdle() {
        guard connection == nil, let result = browser?.browseResults.first else { return }
        let c = NWConnection(to: result.endpoint, using: tcpParameters())
        connection = c
        buffer.removeAll()
        c.stateUpdateHandler = { [weak self, weak c] state in
            guard let self, let c else { return }
            switch state {
            case .ready:
                setStatus("connected")
                DispatchQueue.main.async { self.host = "\(result.endpoint)" }
                receive(on: c)
            case .waiting(let error):
                setStatus("waiting: \(error)")
                drop(c) // don't sit in .waiting; rediscover instead
            case .failed(let error):
                setStatus("failed: \(error)")
                drop(c)
            case .cancelled:
                drop(c)
            default:
                break
            }
        }
        c.start(queue: queue)
    }

    private func drop(_ c: NWConnection) {
        guard connection === c else { return }
        c.cancel()
        connection = nil
        queue.asyncAfter(deadline: .now() + 1) { [weak self] in self?.connectIfIdle() }
    }

    private func receive(on c: NWConnection) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            if let data { buffer.append(data) }
            for line in splitLines(&buffer) { handle(line) }
            if isComplete || error != nil { setStatus("host closed"); drop(c); return }
            receive(on: c)
        }
    }

    private func send(_ line: String) {
        guard let c = connection, c.state == .ready else { return }
        c.send(content: Data((line + "\n").utf8), completion: .idempotent)
        sentThisSecond += 1
    }

    private func handle(_ line: String) {
        guard let obj = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any] else { return }
        if let hostT = obj["ping"] as? Double {
            send("{\"pong\":\(hostT),\"dev\":\(ProcessInfo.processInfo.systemUptime)}")
        }
        if let id = obj["haptic"] as? Int {
            DispatchQueue.main.async {
                self.haptic.impactOccurred()
                let dev = ProcessInfo.processInfo.systemUptime
                self.queue.async { self.send("{\"hapticAck\":\(id),\"dev\":\(dev)}") }
            }
        }
    }

    // MARK: Signals

    private func startMotion() {
        guard motion.isDeviceMotionAvailable else { setStatus("device motion unavailable"); return }
        motion.deviceMotionUpdateInterval = 0.01 // request 100 Hz
        motion.startDeviceMotionUpdates(using: .xArbitraryZVertical, to: opQueue) { [weak self] m, _ in
            guard let self, let m else { return }
            seq += 1
            let q = m.attitude.quaternion, r = m.rotationRate, a = m.userAcceleration, g = m.gravity
            send("{\"m\":\(seq),\"t\":\(m.timestamp),\"q\":[\(q.x),\(q.y),\(q.z),\(q.w)],\"rot\":[\(r.x),\(r.y),\(r.z)],\"acc\":[\(a.x),\(a.y),\(a.z)],\"grav\":[\(g.x),\(g.y),\(g.z)]}")
        }
    }

    func touch(x: Double, y: Double, phase: String) {
        let t = ProcessInfo.processInfo.systemUptime
        queue.async { self.send("{\"touch\":{\"x\":\(x),\"y\":\(y),\"phase\":\"\(phase)\"},\"t\":\(t)}") }
    }

    func phase(_ name: String) {
        queue.async { self.send("{\"phase\":\"\(name)\"}") }
    }

    private func setStatus(_ s: String) {
        DispatchQueue.main.async { self.status = s }
    }
}

@main
struct PhoneProbeApp: App {
    @StateObject private var probe = Probe()
    @Environment(\.scenePhase) private var scenePhase
    @State private var touching = false

    var body: some Scene {
        WindowGroup {
            GeometryReader { geo in
                VStack(spacing: 8) {
                    Text("Omni phone probe").font(.headline)
                    Text(probe.status).font(.subheadline).multilineTextAlignment(.center)
                    Text("host: \(probe.host)").font(.caption).lineLimit(1)
                    Text("\(probe.sentPerSecond) msgs/s").font(.title2.monospacedDigit())
                    Text("Drag anywhere to send touches").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                }
                .padding()
                .frame(width: geo.size.width, height: geo.size.height)
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { v in
                            probe.touch(x: v.location.x / geo.size.width, y: v.location.y / geo.size.height,
                                        phase: touching ? "moved" : "began")
                            touching = true
                        }
                        .onEnded { v in
                            probe.touch(x: v.location.x / geo.size.width, y: v.location.y / geo.size.height, phase: "ended")
                            touching = false
                        }
                )
            }
            .onAppear {
                UIApplication.shared.isIdleTimerDisabled = true
                probe.start()
            }
            .onChange(of: scenePhase) { _, new in
                probe.phase(new == .active ? "active" : new == .inactive ? "inactive" : "background")
            }
        }
    }
}
