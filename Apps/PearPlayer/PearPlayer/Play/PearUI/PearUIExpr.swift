import Foundation
import PearCloud

/// C1 expressions over the view state `{ev, me, local, device, item?}`: dotted path, optional `==`/`!=` literal,
/// `!` prefix, `a && b` (first falsy, else last; binds tighter), `a || b` fallback (first truthy). No arbitrary code. Same rules as the web renderer.
enum PearUIExpr {
    static func eval(_ raw: String, _ state: JSONValue) -> JSONValue {
        var expr = raw.trimmingCharacters(in: .whitespaces)
        if expr.hasPrefix("{{"), expr.hasSuffix("}}") { expr = String(expr.dropFirst(2).dropLast(2)) }
        let parts = expr.components(separatedBy: "||")
        var last = JSONValue.null
        for part in parts {
            last = conj(part, state)
            if truthy(last) { return last }
        }
        return last
    }

    private static func conj(_ raw: String, _ state: JSONValue) -> JSONValue {
        var last = JSONValue.null
        for part in raw.components(separatedBy: "&&") {
            last = term(part, state)
            if !truthy(last) { return last }
        }
        return last
    }

    private static func term(_ raw: String, _ state: JSONValue) -> JSONValue {
        var t = raw.trimmingCharacters(in: .whitespaces)
        var negate = false
        if t.hasPrefix("!"), !t.hasPrefix("!=") { negate = true; t = String(t.dropFirst()).trimmingCharacters(in: .whitespaces) }
        var value: JSONValue
        if let r = t.range(of: "!=") ?? t.range(of: "==") {
            let equal = operand(String(t[..<r.lowerBound]), state) == operand(String(t[r.upperBound...]), state)
            value = .bool(t[r] == "==" ? equal : !equal)
        } else {
            value = operand(t, state)
        }
        if negate { value = .bool(!truthy(value)) }
        return value
    }

    /// A literal (quoted string, number, true/false/null) or a dotted path into the state.
    private static func operand(_ raw: String, _ state: JSONValue) -> JSONValue {
        let t = raw.trimmingCharacters(in: .whitespaces)
        if t.count >= 2, let f = t.first, (f == "'" || f == "\""), t.last == f { return .string(String(t.dropFirst().dropLast())) }
        if t == "true" { return .bool(true) }
        if t == "false" { return .bool(false) }
        if t == "null" || t.isEmpty { return .null }
        if let n = Double(t) { return .number(n) }
        var cur: JSONValue = state
        for key in t.split(separator: ".") {
            if let i = Int(key), let a = cur.array { cur = a.indices.contains(i) ? a[i] : .null; continue }
            if key == "length", let a = cur.array { cur = .number(Double(a.count)); continue }
            guard let next = cur[String(key)] else { return .null }
            cur = next
        }
        return cur
    }

    static func truthy(_ v: JSONValue) -> Bool {
        switch v {
        case .null: false
        case .bool(let b): b
        case .number(let n): n != 0
        case .string(let s): !s.isEmpty
        case .array, .object: true
        }
    }

    /// Replaces each `{{expr}}` in a string prop.
    static func interpolate(_ s: String, _ state: JSONValue) -> String {
        guard s.contains("{{") else { return s }
        var out = "", rest = Substring(s)
        while let open = rest.range(of: "{{"), let close = rest[open.upperBound...].range(of: "}}") {
            out += rest[..<open.lowerBound]
            out += eval(String(rest[open.upperBound..<close.lowerBound]), state).text
            rest = rest[close.upperBound...]
        }
        return out + rest
    }

    /// A prop that holds a value: a lone `{{expr}}` keeps its JSON type, other strings interpolate,
    /// objects/arrays resolve recursively (action `data`).
    static func resolve(_ v: JSONValue, _ state: JSONValue) -> JSONValue {
        switch v {
        case .string(let s):
            let t = s.trimmingCharacters(in: .whitespaces)
            if t.hasPrefix("{{"), t.hasSuffix("}}"), t.dropFirst(2).range(of: "{{") == nil { return eval(t, state) }
            return .string(interpolate(s, state))
        case .array(let a): return .array(a.map { resolve($0, state) })
        case .object(let o): return .object(o.mapValues { resolve($0, state) })
        default: return v
        }
    }

    #if DEBUG
    static func selfCheck() {
        let s = JSONValue.object([
            "ev": .object(["state": .object(["phase": .string("fire"), "players": .array([.string("a")])])]),
            "me": .object(["id": .string("a")]),
        ])
        assert(eval("ev.state.phase", s) == .string("fire"))
        assert(truthy(eval("ev.state.phase == 'fire'", s)))
        assert(!truthy(eval("ev.state.phase != \"fire\"", s)))
        assert(truthy(eval("!ev.missing", s)))
        assert(eval("ev.missing || 'Waiting'", s) == .string("Waiting"))
        assert(eval("ev.state.players.length", s) == .number(1))
        assert(eval("ev.state.phase == 'fire' && me.id == 'a'", s) == .bool(true))
        assert(eval("ev.state.phase == 'lobby' && 'x' || ev.state.phase == 'fire' && 'bad'", s) == .string("bad"))
        assert(!truthy(eval("me.id == 'a' && ev.missing", s)))
        assert(interpolate("Phase {{ev.state.phase}}!", s) == "Phase fire!")
        assert(resolve(.string("{{ev.state.players}}"), s).array?.count == 1)
    }
    #endif
}
