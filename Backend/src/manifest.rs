// Game package manifest (`pear-game.json`, stored as `metadata.manifest` on a published version). The same rules as
// Web/packages/pear-runtime/src/manifest.ts (Schema/pear-game.schema.json documents them); fields it does not know are
// ignored, and the stored JSON is never rewritten, so they are kept.
use serde_json::{Map, Value};

pub const FORMAT: &str = "pear-game/1";
const MAX_NAME_LEN: usize = 256;
const SENSORS: [&str; 4] = ["head", "position", "heartRate", "motion"];
const GESTURES: [&str; 5] = ["tap", "doubleTap", "flick", "squeeze", "pinch"];

fn object<'a>(v: &'a Value, path: &str) -> Result<&'a Map<String, Value>, String> {
    v.as_object().ok_or_else(|| format!("{path} must be an object"))
}

/// A path inside the package: relative, forward slashes, nothing that climbs out.
fn package_path(v: &Value, path: &str) -> Result<(), String> {
    let s = v.as_str().filter(|s| !s.is_empty()).ok_or_else(|| format!("{path} must be a non-empty string"))?;
    if s.starts_with('/') || s.contains(['\\', ':', '\0']) || s.split('/').any(|seg| seg.is_empty() || seg == "." || seg == "..") {
        return Err(format!("{path} must be a relative path inside the package"));
    }
    Ok(())
}

fn names(v: &Value, path: &str) -> Result<(), String> {
    let list = v.as_array().ok_or_else(|| format!("{path} must be an array"))?;
    for (i, n) in list.iter().enumerate() {
        if !n.as_str().is_some_and(|s| !s.is_empty()) {
            return Err(format!("{path}[{i}] must be a non-empty string"));
        }
    }
    Ok(())
}

fn one_of(v: &Value, allowed: &[&str], path: &str, what: &str) -> Result<(), String> {
    let list = v.as_array().ok_or_else(|| format!("{path} must be an array"))?;
    for (i, item) in list.iter().enumerate() {
        if !item.as_str().is_some_and(|s| allowed.contains(&s)) {
            return Err(format!("{path}[{i}]: unknown {what}"));
        }
    }
    Ok(())
}

fn raise(v: &Value) -> Result<(), String> {
    let g = object(v, "capabilities.gestures.raise")?;
    let number = |key: &str, default: f64| -> Result<f64, String> {
        match g.get(key) {
            None => Ok(default),
            Some(n) => n.as_f64().ok_or_else(|| format!("capabilities.gestures.raise.{key} must be a number")),
        }
    };
    let angle = number("angleDeg", 80.0)?;
    let hysteresis = number("hysteresisDeg", 10.0)?;
    if !(angle > 0.0 && angle < 180.0) {
        return Err("capabilities.gestures.raise.angleDeg must be between 0 and 180".into());
    }
    if !(hysteresis >= 0.0 && hysteresis < angle) {
        return Err("capabilities.gestures.raise.hysteresisDeg must be >= 0 and less than angleDeg".into());
    }
    Ok(())
}

fn capabilities(v: &Value) -> Result<(), String> {
    let c = object(v, "capabilities")?;
    if let Some(t) = c.get("tier") {
        if !t.as_i64().is_some_and(|t| (1..=3).contains(&t)) {
            return Err("capabilities.tier must be 1, 2 or 3".into());
        }
    }
    if let Some(s) = c.get("sensors") {
        one_of(s, &SENSORS, "capabilities.sensors", "sensor")?;
    }
    if let Some(g) = c.get("gestures") {
        let g = object(g, "capabilities.gestures")?;
        if let Some(b) = g.get("builtin") {
            one_of(b, &GESTURES, "capabilities.gestures.builtin", "gesture")?;
        }
        if let Some(r) = g.get("raise") {
            raise(r)?;
        }
    }
    Ok(())
}

/// Checks a manifest object; the error names the field, like the TypeScript parser.
pub fn validate(manifest: &Value) -> Result<(), String> {
    let m = object(manifest, "manifest")?;
    if m.get("format").and_then(Value::as_str) != Some(FORMAT) {
        return Err(format!("format must be \"{FORMAT}\""));
    }
    if !m.get("name").and_then(Value::as_str).is_some_and(|n| !n.trim().is_empty() && n.chars().count() <= MAX_NAME_LEN) {
        return Err(format!("name must be a non-empty string of at most {MAX_NAME_LEN} characters"));
    }
    for key in ["scene", "checks"] {
        if let Some(p) = m.get(key) {
            package_path(p, key)?;
        }
    }
    if let Some(s) = m.get("scripts") {
        let s = object(s, "scripts")?;
        for side in ["client", "server"] {
            if let Some(list) = s.get(side) {
                names(list, &format!("scripts.{side}"))?;
            }
        }
    }
    if let Some(p) = m.get("players") {
        let p = object(p, "players")?;
        let bound = |key: &str| p.get(key).and_then(Value::as_i64);
        match (bound("min"), bound("max")) {
            (Some(min), Some(max)) if (1..=32).contains(&min) && (1..=32).contains(&max) && min <= max => {}
            _ => return Err("players must be {min, max} whole numbers with 1 <= min <= max <= 32".into()),
        }
    }
    if let Some(c) = m.get("capabilities") {
        capabilities(c)?;
    }
    for key in ["controller", "cues", "instructions"] {
        if let Some(v) = m.get(key) {
            object(v, key)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn base() -> Value {
        json!({ "format": "pear-game/1", "name": "Demo" })
    }

    fn with(key: &str, value: Value) -> Value {
        let mut m = base();
        m[key] = value;
        m
    }

    #[test]
    fn minimal_and_full_manifests_pass_and_unknown_fields_are_ignored() {
        assert!(validate(&base()).is_ok());
        let full = json!({
            "format": "pear-game/1", "name": "Demo", "scene": "scene.json", "checks": "check.json",
            "scripts": { "client": ["p"], "server": ["g"] }, "players": { "min": 2, "max": 4 },
            "capabilities": { "tier": 2, "sensors": ["motion", "head"], "gestures": { "builtin": ["tap"], "raise": {} } },
            "controller": {}, "cues": {}, "instructions": { "goal": "x" }, "future": [1, 2]
        });
        assert!(validate(&full).is_ok());
    }

    #[test]
    fn rejects_each_bad_field_and_names_it() {
        let cases: Vec<(Value, &str)> = vec![
            (json!(null), "manifest must be an object"),
            (json!({ "name": "x" }), "format must be"),
            (json!({ "format": "pear-game/2", "name": "x" }), "format must be"),
            (with("name", json!("  ")), "name must be"),
            (with("name", json!("x".repeat(257))), "name must be"),
            (with("scene", json!("../x.json")), "scene must be a relative path"),
            (with("scene", json!("/abs")), "scene must be a relative path"),
            (with("scene", json!("a\\b")), "scene must be a relative path"),
            (with("checks", json!("")), "checks must be a non-empty string"),
            (with("scripts", json!({ "client": [1] })), "scripts.client[0]"),
            (with("players", json!({ "min": 0, "max": 2 })), "players must be"),
            (with("players", json!({ "min": 3, "max": 2 })), "players must be"),
            (with("players", json!({ "min": 1, "max": 33 })), "players must be"),
            (with("players", json!({ "min": 1.5, "max": 2 })), "players must be"),
            (with("capabilities", json!({ "tier": 0 })), "capabilities.tier"),
            (with("capabilities", json!({ "tier": 4 })), "capabilities.tier"),
            (with("capabilities", json!({ "sensors": ["sonar"] })), "unknown sensor"),
            (with("capabilities", json!({ "gestures": { "builtin": ["wave"] } })), "unknown gesture"),
            (with("capabilities", json!({ "gestures": { "raise": { "angleDeg": 180 } } })), "angleDeg must be between 0 and 180"),
            (with("capabilities", json!({ "gestures": { "raise": { "angleDeg": 20, "hysteresisDeg": 20 } } })), "hysteresisDeg must be"),
            (with("capabilities", json!({ "gestures": { "raise": { "angleDeg": "x" } } })), "angleDeg must be a number"),
            (with("controller", json!([])), "controller must be an object"),
            (with("cues", json!("x")), "cues must be an object"),
            (with("instructions", json!(3)), "instructions must be an object"),
        ];
        for (manifest, expected) in cases {
            let err = validate(&manifest).expect_err(&manifest.to_string());
            assert!(err.contains(expected), "{manifest}: {err}");
        }
    }

    #[test]
    fn quick_draw_package_is_valid() {
        let text = include_str!("../../Games/QuickDraw/pear-game.json");
        assert!(validate(&serde_json::from_str(text).unwrap()).is_ok());
    }
}
