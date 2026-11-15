import Foundation

// Pure Quick Draw logic (no UI, no CoreMotion): the wire protocol of Games/QuickDraw/scripts/game.js and the raise detector
// that mirrors Web/studio/public/qd-phone.html. `selfCheck()` is the one runnable check; the session runs it under DEBUG.

/// Lobby codes: 4-8 of [A-Z0-9]; the host picks 5 from an alphabet without look-alikes (I, O, 0, 1).
enum QDLobby {
    static let alphabet = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")

    static func randomCode() -> String { String((0..<5).map { _ in alphabet.randomElement()! }) }

    /// Uppercased and stripped to [A-Z0-9]; nil when the length is not 4-8.
    static func normalize(_ text: String) -> String? {
        let code = String(text.uppercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) })
        return (4...8).contains(code.count) ? code : nil
    }
}

struct QDPlayer: Equatable, Identifiable {
    var id: String
    var name: String
    var ready = false
    var role: String?
    var raised = false
    /// Epoch milliseconds the server will drop this player for idling; nil when no kick is pending.
    var idleKickAt: Double?
}

struct QDState: Equatable {
    var phase = "lobby"
    var round = 0
    var matchRound = 0
    var scores: [String: Int] = [:]
    var queue: [String] = []
    var phones: [String] = []
    var players: [QDPlayer] = []
    var needs = ""
}

struct QDRoundResult: Equatable {
    var round: Int
    var matchRound: Int
    var winnerId: String?
    var reason: String
    var reactionMs: [String: Int?]
    var scores: [String: Int]
}

enum QDEvent: Equatable {
    case welcome(id: String, name: String, lobby: String?)
    case reload
    case state(QDState)
    case countdown(round: Int, matchRound: Int, ms: Int)
    case arming(round: Int)
    case fire(round: Int)
    case roundResult(QDRoundResult)
    case matchOver(winnerId: String?, scores: [String: Int])
    case unknown(String)
}

/// Frames are `{"name", "data"}` JSON both ways. Decoding is tolerant: a missing or mistyped field takes a default.
enum QDWire {
    static func decode(_ text: String) -> QDEvent? {
        guard let obj = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
              let name = obj["name"] as? String else { return nil }
        let d = obj["data"] as? [String: Any] ?? [:]
        switch name {
        case "_welcome":
            return .welcome(id: d["id"] as? String ?? "", name: d["name"] as? String ?? "", lobby: d["lobby"] as? String)
        case "_reload": return .reload
        case "state":
            var s = QDState()
            s.phase = d["phase"] as? String ?? "lobby"
            s.round = int(d["round"]) ?? 0
            s.matchRound = int(d["matchRound"]) ?? 0
            s.scores = ints(d["scores"])
            s.queue = d["queue"] as? [String] ?? []
            s.phones = d["phones"] as? [String] ?? []
            s.needs = d["needs"] as? String ?? ""
            for case let p as [String: Any] in d["players"] as? [Any] ?? [] {
                guard let id = p["id"] as? String else { continue }
                s.players.append(QDPlayer(
                    id: id, name: p["name"] as? String ?? id, ready: p["ready"] as? Bool ?? false,
                    role: p["role"] as? String, raised: p["raised"] as? Bool ?? false,
                    idleKickAt: (p["idleKickAt"] as? NSNumber)?.doubleValue))
            }
            if s.phones.isEmpty { s.phones = s.players.filter { $0.role == "phone" }.map(\.id) }
            return .state(s)
        case "countdown":
            return .countdown(round: int(d["round"]) ?? 0, matchRound: int(d["matchRound"]) ?? 0, ms: int(d["ms"]) ?? 3000)
        case "arming": return .arming(round: int(d["round"]) ?? 0)
        case "fire": return .fire(round: int(d["round"]) ?? 0)
        case "roundResult":
            var times: [String: Int?] = [:]
            for (k, v) in d["reactionMs"] as? [String: Any] ?? [:] { times[k] = int(v) }
            return .roundResult(QDRoundResult(
                round: int(d["round"]) ?? 0, matchRound: int(d["matchRound"]) ?? 0, winnerId: d["winnerId"] as? String,
                reason: d["reason"] as? String ?? "", reactionMs: times, scores: ints(d["scores"])))
        case "matchOver": return .matchOver(winnerId: d["winnerId"] as? String, scores: ints(d["scores"]))
        default: return .unknown(name)
        }
    }

    private static func int(_ v: Any?) -> Int? { (v as? NSNumber).map { Int(truncating: $0) } }
    private static func ints(_ v: Any?) -> [String: Int] {
        (v as? [String: Any] ?? [:]).compactMapValues { int($0) }
    }

    static func frame(_ name: String, _ data: [String: Any] = [:]) -> String {
        let obj: [String: Any] = ["name": name, "data": data]
        let bytes = (try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])) ?? Data("{}".utf8)
        return String(decoding: bytes, as: UTF8.self)
    }

    static func role() -> String { frame("role", ["role": "phone"]) }
    static func ready(round: Int) -> String { frame("ready", ["round": round]) }
    static func lowered() -> String { frame("lowered") }
    /// `sinceFireMs` nil is sent as JSON null: the phone raised before `fire` reached it (a foul).
    static func raised(round: Int, sinceFireMs: Int?) -> String {
        frame("raised", ["round": round, "sinceFireMs": sinceFireMs.map { $0 as Any } ?? NSNull()])
    }

    /// `wss://<base>/play/{gameId}?token=&version=&lobby=`; no lobby means the shared OPEN lobby.
    static func socketURL(base: URL, gameId: String, token: String, version: Int, lobby: String?) -> URL? {
        guard var parts = URLComponents(url: base, resolvingAgainstBaseURL: false) else { return nil }
        parts.scheme = parts.scheme == "https" ? "wss" : "ws"
        parts.path = (parts.path.hasSuffix("/") ? String(parts.path.dropLast()) : parts.path) + "/play/\(gameId)"
        var items = [URLQueryItem(name: "token", value: token), URLQueryItem(name: "version", value: String(version))]
        if let lobby, !lobby.isEmpty { items.append(URLQueryItem(name: "lobby", value: lobby)) }
        parts.queryItems = items
        return parts.url
    }
}

struct QDVec: Equatable {
    var x: Double, y: Double, z: Double

    var normalized: QDVec {
        let l = (x * x + y * y + z * z).squareRoot()
        return l == 0 ? self : QDVec(x: x / l, y: y / l, z: z / l)
    }
    func dot(_ o: QDVec) -> Double { x * o.x + y * o.y + z * o.z }
}

/// Angle between the rest gravity and the current (low-passed) gravity; 80 degrees raises, 70 lowers. A vector angle has
/// no gimbal lock near 90 degrees, and turning about the vertical axis alone is invisible, which is fine for an arm raise.
struct QDRaiseDetector {
    static let raiseDeg = 80.0
    static let lowerDeg = 70.0

    enum Transition { case raised, lowered }

    private(set) var gravity: QDVec?
    private(set) var rest: QDVec?
    private(set) var raised = false
    private(set) var degrees = 0.0

    /// Low-pass 0.8 old / 0.2 new. Returns a transition only when a calibrated phone crosses a threshold.
    mutating func feed(_ sample: QDVec) -> Transition? {
        let v = sample.normalized
        if let g = gravity {
            gravity = QDVec(x: 0.8 * g.x + 0.2 * v.x, y: 0.8 * g.y + 0.2 * v.y, z: 0.8 * g.z + 0.2 * v.z).normalized
        } else {
            gravity = v
        }
        guard let rest, let gravity else { return nil }
        degrees = acos(max(-1, min(1, rest.dot(gravity)))) * 180 / .pi
        if !raised && degrees >= Self.raiseDeg {
            raised = true
            return .raised
        }
        if raised && degrees <= Self.lowerDeg {
            raised = false
            return .lowered
        }
        return nil
    }

    /// Takes the current gravity as the lowered pose; false when no motion data has arrived yet.
    mutating func calibrate() -> Bool {
        guard let gravity else { return false }
        rest = gravity
        raised = false
        degrees = 0
        return true
    }

    /// A reload clears readiness on the server, so the next Ready must calibrate again.
    mutating func reset() {
        rest = nil
        raised = false
        degrees = 0
    }

    /// The one runnable check for this file.
    static func selfCheck() {
        var d = QDRaiseDetector()
        _ = d.feed(QDVec(x: 0, y: 0, z: -1))
        assert(d.calibrate())
        var events: [Transition] = []
        // Rotate gravity about the x axis, holding each angle long enough for the low-pass to settle.
        func hold(_ deg: Double) {
            let r = deg * .pi / 180
            for _ in 0..<60 { if let t = d.feed(QDVec(x: 0, y: sin(r), z: -cos(r))) { events.append(t) } }
        }
        hold(0); hold(60); hold(90); hold(75); hold(60); hold(0)
        assert(events == [.raised, .lowered], "hysteresis: 75 degrees stays raised, 60 lowers: \(events)")

        assert(QDLobby.normalize(" k7qm2 ") == "K7QM2" && QDLobby.normalize("abc") == nil && QDLobby.normalize("ABCDEFGHJ") == nil)
        assert(QDLobby.randomCode().count == 5)
        let url = QDWire.socketURL(base: URL(string: "https://pear.test")!, gameId: "g", token: "t", version: 3, lobby: "K7QM2")
        assert(url?.absoluteString == "wss://pear.test/play/g?token=t&version=3&lobby=K7QM2")
        assert(QDWire.raised(round: 4, sinceFireMs: nil) == #"{"data":{"round":4,"sinceFireMs":null},"name":"raised"}"#)
        assert(QDWire.raised(round: 4, sinceFireMs: 212).contains(#""sinceFireMs":212"#))
        // Tolerant decode: no players, scores or idleKickAt must not crash.
        if case .state(let s)? = QDWire.decode(#"{"name":"state","data":{"phase":"fire","round":7}}"#) {
            assert(s.phase == "fire" && s.round == 7 && s.players.isEmpty)
        } else { assertionFailure("state decode") }
        if case .roundResult(let r)? = QDWire.decode(
            #"{"name":"roundResult","data":{"round":2,"winnerId":null,"reason":"tie","reactionMs":{"a":150,"b":null}}}"#) {
            assert(r.winnerId == nil && r.reactionMs["a"] == .some(150) && r.reactionMs["b"] == .some(nil))
        } else { assertionFailure("result decode") }
    }
}
