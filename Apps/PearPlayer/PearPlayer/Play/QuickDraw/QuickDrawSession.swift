#if os(iOS)
import CoreMotion
import Foundation
import Observation
import UIKit

/// One Quick Draw connection: the `/play/{gameId}` socket (with reconnect), the motion sensor, the sounds and haptics.
/// All protocol rules live in `QuickDrawProtocol.swift`; this class only wires them to the platform.
@MainActor
@Observable
final class QuickDrawSession: Identifiable {
    enum Link: Equatable { case connecting, connected, reconnecting }

    let title: String
    /// The code the player asked for; nil is the shared OPEN lobby. The server's `_welcome` echoes the effective one.
    private(set) var lobby: String
    private(set) var link: Link = .connecting
    private(set) var myId = ""
    private(set) var state = QDState()
    /// The phase the screen follows: events (`fire`) arrive a moment before the state broadcast that confirms them.
    private(set) var phase = "lobby"
    private(set) var countdownValue: Int?
    private(set) var lastResult: QDRoundResult?
    private(set) var matchWinner: String?
    private(set) var matchOver = false
    private(set) var calibrating = false
    private(set) var notice: String?
    private(set) var degrees = 0.0
    private(set) var isRaised = false
    private(set) var isCalibrated = false

    private let url: URL
    private let sounds = QuickDrawSounds()
    private let motion = CMMotionManager()
    private var detector = QDRaiseDetector()
    private var task: URLSessionWebSocketTask?
    private var runner: Task<Void, Never>?
    private var countdownTask: Task<Void, Never>?
    private var resultSound: Task<Void, Never>?
    private var round = 0
    private var fireAt: UInt64?
    private var stopped = false

    init?(base: URL, gameId: String, token: String, version: Int, lobby: String?, title: String) {
        guard let url = QDWire.socketURL(base: base, gameId: gameId, token: token, version: version, lobby: lobby) else {
            return nil
        }
        self.url = url
        self.lobby = lobby ?? "OPEN"
        self.title = title
        #if DEBUG
        QDRaiseDetector.selfCheck()
        #endif
    }

    var me: QDPlayer? { state.players.first { $0.id == myId } }
    func name(of id: String?) -> String {
        guard let id else { return "" }
        return id == myId ? "You" : state.players.first { $0.id == id }?.name ?? "Opponent"
    }
    var canReady: Bool {
        ["lobby", "roundOver", "matchOver"].contains(phase) && me?.role == "phone" && me?.ready != true && !calibrating
    }
    var inQueue: Int? { state.queue.firstIndex(of: myId).map { $0 + 1 } }

    func start() {
        guard runner == nil else { return }
        UIApplication.shared.isIdleTimerDisabled = true
        sounds.prepare()
        startMotion()
        runner = Task { [weak self] in await self?.run() }
    }

    func stop() {
        stopped = true
        runner?.cancel()
        runner = nil
        countdownTask?.cancel()
        resultSound?.cancel()
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        motion.stopDeviceMotionUpdates()
        sounds.shutdown()
        UIApplication.shared.isIdleTimerDisabled = false
    }

    // MARK: Socket

    private func run() async {
        var delay = 0.5
        while !stopped && !Task.isCancelled {
            let socket = URLSession.shared.webSocketTask(with: url)
            task = socket
            socket.resume()
            do {
                while true {
                    let message = try await socket.receive()
                    if case .string(let text) = message, let event = QDWire.decode(text) {
                        if case .welcome = event { delay = 0.5 }
                        handle(event)
                    }
                }
            } catch {
                socket.cancel(with: .goingAway, reason: nil)
            }
            if stopped || Task.isCancelled { return }
            link = .reconnecting
            try? await Task.sleep(for: .seconds(delay))
            delay = min(delay * 2, 8)
        }
    }

    private func send(_ text: String) {
        guard let task else { return }
        Task { try? await task.send(.string(text)) }
    }

    private func handle(_ event: QDEvent) {
        switch event {
        case .welcome(let id, _, let code):
            myId = id
            if let code, !code.isEmpty { lobby = code }
            link = .connected
            send(QDWire.role())
        case .reload:
            send(QDWire.role())
            detector.reset()
            isCalibrated = false
            isRaised = false
        case .state(let s):
            state = s
            round = s.round
            if phase != s.phase { enter(s.phase) }
            if s.phase != "matchOver" { matchOver = false }
        case .countdown(let r, _, let ms):
            round = r
            enter("countdown")
            runCountdown(ms: ms)
        case .arming(let r):
            round = r
            enter("arming")
            // Already raised when arming starts: the server only sees transitions, so report it as a foul.
            if detector.raised { send(QDWire.raised(round: round, sinceFireMs: nil)) }
        case .fire(let r):
            // The reaction clock starts when this phone receives the cue, so the other phone's clock never enters.
            round = r
            fireAt = DispatchTime.now().uptimeNanoseconds
            enter("fire")
        case .roundResult(let result):
            lastResult = result
            enter("roundOver")
            announce(result)
        case .matchOver(let winner, _):
            matchWinner = winner
            matchOver = true
            resultSound?.cancel()
            phase = "matchOver"
            if winner == myId {
                sounds.matchWin()
                notify(.success)
            } else {
                sounds.roundLose()
                notify(.error)
            }
        case .unknown:
            break
        }
    }

    /// Phase side effects, once per change.
    private func enter(_ next: String) {
        guard phase != next else { return }
        phase = next
        if next != "countdown" { countdownTask?.cancel(); countdownValue = nil }
        if next != "arming" { sounds.stopDrone() }
        if next != "fire" { fireAt = nil }
        switch next {
        case "arming": sounds.startDrone()
        case "fire":
            sounds.fire()
            UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
        case "countdown":
            lastResult = nil
            matchWinner = nil
            matchOver = false
        default: break
        }
    }

    private func runCountdown(ms: Int) {
        countdownTask?.cancel()
        let steps = max(1, Int((Double(ms) / 1000).rounded(.up)))
        countdownTask = Task { [weak self] in
            for n in stride(from: steps, through: 1, by: -1) {
                guard let self, !Task.isCancelled else { return }
                self.countdownValue = n
                self.sounds.tick()
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    /// The round sound waits a beat: a deciding round is followed at once by `matchOver`, which has its own sound.
    private func announce(_ result: QDRoundResult) {
        resultSound?.cancel()
        resultSound = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(150))
            guard let self, !Task.isCancelled, result.winnerId != nil else { return }
            if result.winnerId == self.myId {
                self.sounds.roundWin()
                self.notify(.success)
            } else {
                self.sounds.roundLose()
                self.notify(.error)
            }
        }
    }

    private func notify(_ type: UINotificationFeedbackGenerator.FeedbackType) {
        UINotificationFeedbackGenerator().notificationOccurred(type)
    }

    // MARK: Ready and motion

    /// Calibrates the lowered pose after a short hold, then reports ready. Needed for the first round and for a replay.
    func readyTapped() {
        guard canReady else { return }
        if detector.raised {
            notice = "Lower your phone, then tap again."
            return
        }
        guard motion.isDeviceMotionAvailable else {
            notice = "This device has no motion sensor."
            return
        }
        calibrating = true
        notice = "Hold still at your side..."
        Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(700)) // lets the low-pass settle on the rest pose
            guard let self else { return }
            self.calibrating = false
            if self.detector.calibrate() {
                self.isCalibrated = true
                self.notice = nil
                // The phase may have moved on during the wait; the server drops a stale round anyway.
                self.send(QDWire.ready(round: self.round))
            } else {
                self.notice = "No motion data from this device. Allow Motion access in Settings."
            }
        }
    }

    private func startMotion() {
        guard motion.isDeviceMotionAvailable else { return }
        motion.deviceMotionUpdateInterval = 1.0 / 60
        motion.startDeviceMotionUpdates(to: .main) { [weak self] data, _ in
            guard let self, let g = data?.gravity else { return }
            MainActor.assumeIsolated { self.feed(QDVec(x: g.x, y: g.y, z: g.z)) }
        }
    }

    private func feed(_ g: QDVec) {
        let transition = detector.feed(g)
        degrees = detector.degrees
        isRaised = detector.raised
        switch transition {
        case .raised:
            let ms = fireAt.map { Int((DispatchTime.now().uptimeNanoseconds - $0) / 1_000_000) }
            send(QDWire.raised(round: round, sinceFireMs: ms))
        case .lowered:
            send(QDWire.lowered())
        case nil:
            break
        }
    }
}
#endif
