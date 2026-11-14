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
                send("{\"hello\":\"\(UIDevice.current.model)\",\"idiom\":\"\(UIDevice.current.userInterfaceIdiom == .pad ? "pad" : "phone")\"}")
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

    /// For callers on other threads (the UIKit touch surface); sends on `queue`.
    func sendRaw(_ line: String) {
        queue.async { self.send(line) }
    }

    func phase(_ name: String) {
        queue.async { self.send("{\"phase\":\"\(name)\"}") }
    }

    private func setStatus(_ s: String) {
        DispatchQueue.main.async { self.status = s }
    }
}

/// UIKit touch view: SwiftUI gestures don't expose Pencil force, tilt, roll, hover or squeeze.
struct TouchSurface: UIViewRepresentable {
    let probe: Probe
    func makeUIView(context: Context) -> SurfaceView { SurfaceView(probe: probe) }
    func updateUIView(_ view: SurfaceView, context: Context) {}
}

final class SurfaceView: UIView, UIPencilInteractionDelegate {
    private let probe: Probe
    private let counter = UILabel()
    private var fingerEvents = 0, pencilEvents = 0, hoverEvents = 0

    init(probe: Probe) {
        self.probe = probe
        super.init(frame: .zero)
        isMultipleTouchEnabled = true
        backgroundColor = .systemBackground
        // diagnostic: proves touches reach this view, independent of the network
        counter.font = .monospacedDigitSystemFont(ofSize: 15, weight: .medium)
        counter.textColor = .secondaryLabel
        counter.text = "surface: finger 0  pencil 0  hover 0"
        counter.translatesAutoresizingMaskIntoConstraints = false
        addSubview(counter)
        NSLayoutConstraint.activate([
            counter.centerXAnchor.constraint(equalTo: centerXAnchor),
            counter.bottomAnchor.constraint(equalTo: safeAreaLayoutGuide.bottomAnchor, constant: -16),
        ])
        addGestureRecognizer(UIHoverGestureRecognizer(target: self, action: #selector(hover(_:))))
        let pencil = UIPencilInteraction()
        pencil.delegate = self
        addInteraction(pencil)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) { report(touches, event) }
    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) { report(touches, event) }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) { report(touches, event) }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { report(touches, event) }

    private func phaseName(_ p: UITouch.Phase) -> String {
        switch p {
        case .began: "began"
        case .ended, .cancelled: "ended"
        default: "moved"
        }
    }

    /// Every coalesced sample (iPadOS batches up to ~240 Hz Pencil samples per display frame).
    private func updateCounter() {
        counter.text = "surface: finger \(fingerEvents)  pencil \(pencilEvents)  hover \(hoverEvents)"
    }

    private func report(_ touches: Set<UITouch>, _ event: UIEvent?) {
        defer { updateCounter() }
        let w = max(bounds.width, 1), h = max(bounds.height, 1)
        for touch in touches {
            if touch.type == .pencil { pencilEvents += 1 } else { fingerEvents += 1 }
            for c in event?.coalescedTouches(for: touch) ?? [touch] {
                let p = c.location(in: self)
                if c.type == .pencil {
                    let force = c.maximumPossibleForce > 0 ? c.force / c.maximumPossibleForce : 0
                    var roll = "null"
                    if #available(iOS 17.5, *) { roll = "\(c.rollAngle)" }
                    probe.sendRaw("{\"pencil\":{\"x\":\(p.x / w),\"y\":\(p.y / h),\"force\":\(force),\"alt\":\(c.altitudeAngle),\"azi\":\(c.azimuthAngle(in: self)),\"roll\":\(roll),\"phase\":\"\(phaseName(c.phase))\"},\"t\":\(c.timestamp)}")
                } else {
                    probe.touch(x: p.x / w, y: p.y / h, phase: phaseName(c.phase))
                }
            }
        }
    }

    @objc private func hover(_ g: UIHoverGestureRecognizer) {
        hoverEvents += 1
        updateCounter()
        switch g.state {
        case .began, .changed:
            let p = g.location(in: self)
            let w = max(bounds.width, 1), h = max(bounds.height, 1)
            probe.sendRaw("{\"hover\":{\"x\":\(p.x / w),\"y\":\(p.y / h),\"z\":\(g.zOffset),\"alt\":\(g.altitudeAngle),\"azi\":\(g.azimuthAngle(in: self))},\"t\":\(ProcessInfo.processInfo.systemUptime)}")
        default:
            probe.sendRaw("{\"hover\":null}")
        }
    }

    @available(iOS 17.5, *)
    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveTap tap: UIPencilInteraction.Tap) {
        probe.sendRaw("{\"pencilGesture\":\"tap\",\"via\":\"uikit\"}")
    }

    @available(iOS 17.5, *)
    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveSqueeze squeeze: UIPencilInteraction.Squeeze) {
        let phase: String = switch squeeze.phase {
        case .began: "began"
        case .changed: "changed"
        case .ended: "ended"
        case .cancelled: "cancelled"
        @unknown default: "unknown"
        }
        probe.sendRaw("{\"pencilGesture\":\"squeeze\",\"phase\":\"\(phase)\",\"via\":\"uikit\"}")
    }

    // Pre-17.5 fallback; iPadOS 17.5+ calls didReceiveTap instead.
    func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
        probe.sendRaw("{\"pencilGesture\":\"tap\",\"via\":\"uikit\"}")
    }
}

@main
struct PhoneProbeApp: App {
    @StateObject private var probe = Probe()
    @Environment(\.scenePhase) private var scenePhase
    private let isPad = UIDevice.current.userInterfaceIdiom == .pad

    var body: some Scene {
        WindowGroup {
            VStack(spacing: 8) {
                Text(isPad ? "Omni pencil probe" : "Omni phone probe").font(.headline)
                Text(probe.status).font(.subheadline).multilineTextAlignment(.center)
                Text("host: \(probe.host)").font(.caption).lineLimit(1)
                Text("\(probe.sentPerSecond) msgs/s").font(.title2.monospacedDigit())
                Text(isPad ? "Draw anywhere with the Pencil" : "Drag anywhere to send touches").font(.caption).foregroundStyle(.secondary)
                Spacer()
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .allowsHitTesting(false) // labels must not swallow touches meant for the surface below
            .background(TouchSurface(probe: probe).ignoresSafeArea())
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
