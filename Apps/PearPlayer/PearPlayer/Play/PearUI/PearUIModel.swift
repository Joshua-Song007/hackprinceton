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
