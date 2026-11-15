import Foundation
import PearCloud

// PearUI v1 (plan.md Contract C1): a `ui.json` tree kept as raw JSON. Nodes stay `JSONValue` so any unknown
// `type` or prop survives decoding and simply renders nothing (forward compatible).
// ponytail: no typed Node enum; add one when the kit stops changing.

/// A decoded `ui.json`: routes plus screens.
struct PearUIDoc: Equatable {
    let root: JSONValue

    init?(data: Data) {
        guard let root = try? JSONDecoder().decode(JSONValue.self, from: data), root["pearui"] != nil else { return nil }
        self.root = root
    }

    /// First `route` whose `when` is truthy (an entry without `when` always matches), else the first screen.
    func screen(_ state: JSONValue) -> JSONValue? {
        let screens = root["screens"]
        for r in root["route"]?.array ?? [] {
            if let when = r["when"]?.string, !PearUIExpr.truthy(PearUIExpr.eval(when, state)) { continue }
            if let id = r["screen"]?.string, let node = screens?[id] { return node }
        }
        if case .object(let all)? = screens, let first = all.keys.sorted().first { return all[first] }
        return nil
    }

    /// Generic lobby for a phone game that ships no ui.json: title, lobby code, the game's own status and player list
    /// (`view`/`state` events, whatever the script sends), a Ready button, and motion + location streams the game may use.
    /// Game-agnostic on purpose: no player count, pose or rules are assumed.
    static func fallback(title: String) -> PearUIDoc? {
        let name = (try? String(data: JSONEncoder().encode(title), encoding: .utf8)) ?? "\"Game\""
        let json = """
        {"pearui":1,"route":[{"screen":"main"}],"screens":{"main":{"type":"column","style":{"pad":2},"children":[
          {"type":"text","value":\(name),"style":{"size":"xl","align":"center","fit":true}},
          {"type":"text","value":"Lobby {{me.lobby}}","style":{"size":"s","caps":true,"align":"center"}},
          {"type":"text","value":"{{ev.view.status || ev.state.status || ev.state.needs || ev.state.phase || 'Waiting for players'}}","style":{"align":"center"}},
          {"type":"list","items":"ev.view.players || ev.state.players","item":{"type":"text","value":"{{item.name}}","style":{"card":true}}},
          {"type":"spacer"},
          {"type":"sensor","kind":"motion","event":"aim","hz":10},
          {"type":"sensor","kind":"location","event":"location","hz":1},
          {"type":"button","label":"Ready","action":{"send":"ready","data":{}}}
        ]}}}
        """
        return PearUIDoc(data: Data(json.utf8))
    }

    /// The `ui.json` of a version: a file shipped next to scene.json/scripts, stored with the assets.
    static func find(in bundle: GameBundle) -> PearUIDoc? {
        bundle.assets.first { $0.name == "ui.json" || $0.name.hasSuffix("/ui.json") }.flatMap { PearUIDoc(data: $0.data) }
    }
}

extension JSONValue {
    subscript(key: String) -> JSONValue? {
        if case .object(let o) = self { return o[key] }
        return nil
    }
    var string: String? { if case .string(let s) = self { return s }; return nil }
    var number: Double? {
        switch self {
        case .number(let n): n
        case .string(let s): Double(s)
        case .bool(let b): b ? 1 : 0
        default: nil
        }
    }
    var array: [JSONValue]? { if case .array(let a) = self { return a }; return nil }
    var object: [String: JSONValue]? { if case .object(let o) = self { return o }; return nil }

    /// Text form for interpolation: whole numbers without ".0", null as "".
    var text: String {
        switch self {
        case .null: ""
        case .bool(let b): b ? "true" : "false"
        case .number(let n): n == n.rounded() && abs(n) < 1e15 ? String(Int(n)) : String(n)
        case .string(let s): s
        case .array, .object:
            (try? JSONEncoder().encode(self)).map { String(decoding: $0, as: UTF8.self) } ?? ""
        }
    }

    /// For `JSONSerialization` (the socket frame).
    var any: Any {
        switch self {
        case .null: NSNull()
        case .bool(let b): b
        case .number(let n): n
        case .string(let s): s
        case .array(let a): a.map(\.any)
        case .object(let o): o.mapValues(\.any)
        }
    }

    init(any: Any?) {
        switch any {
        case let n as NSNumber where CFGetTypeID(n) == CFBooleanGetTypeID(): self = .bool(n.boolValue)
        case let n as NSNumber: self = .number(n.doubleValue)
        case let s as String: self = .string(s)
        case let a as [Any]: self = .array(a.map { JSONValue(any: $0) })
        case let o as [String: Any]: self = .object(o.mapValues { JSONValue(any: $0) })
        default: self = .null
        }
    }
}
