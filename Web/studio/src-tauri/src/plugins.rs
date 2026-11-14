//! Marketplace plugin commands: write a plugin bundle to disk and run its runtime process.
//! Layout: <app data>/omni/projects/<projectId>/plugins/<id>/ ; OMNI_PROJECT_DIR is the project dir.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

/// One running runtime child per project.
#[derive(Default)]
pub struct Runtimes(Mutex<HashMap<String, Child>>);

/// Plugin ids are [a-z0-9-]; project ids are what the Studio's projectId() produces, [A-Za-z0-9_-].
fn validate_id(kind: &str, value: &str) -> Result<(), String> {
    let project = kind == "projectId";
    let ok = |b: u8| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || (project && (b.is_ascii_uppercase() || b == b'_'));
    if !value.is_empty() && value.bytes().all(ok) {
        Ok(())
    } else {
        Err(format!("invalid {kind}: {value:?}"))
    }
}

/// A bundle path must be relative and stay inside the plugin dir.
fn validate_relative_path(path: &str) -> Result<(), String> {
    let bad = path.is_empty()
        || path.contains(':')
        || Path::new(path).is_absolute()
        || path.split(['/', '\\']).any(|seg| seg.is_empty() || seg == "..");
    if bad {
        Err(format!("unsafe plugin file path: {path:?}"))
    } else {
        Ok(())
    }
}

fn project_dir(base: &Path, project_id: &str) -> PathBuf {
    base.join("omni").join("projects").join(project_id)
}

fn plugin_dir(base: &Path, project_id: &str, id: &str) -> PathBuf {
    project_dir(base, project_id).join("plugins").join(id)
}

fn app_data(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// Reads and validates the plugin id from the bundle's omni-plugin.json.
fn bundle_plugin_id(files: &HashMap<String, String>) -> Result<String, String> {
    let manifest = files.get("omni-plugin.json").ok_or("bundle has no omni-plugin.json")?;
    let manifest: serde_json::Value = serde_json::from_str(manifest).map_err(|e| format!("bad omni-plugin.json: {e}"))?;
    let id = manifest.get("id").and_then(|v| v.as_str()).ok_or("omni-plugin.json has no id")?;
    validate_id("plugin id", id)?;
    Ok(id.to_string())
}

fn write_bundle(base: &Path, project_id: &str, files: &HashMap<String, String>) -> Result<PathBuf, String> {
    validate_id("projectId", project_id)?;
    let id = bundle_plugin_id(files)?;
    // Validate everything before writing anything.
    files.keys().try_for_each(|p| validate_relative_path(p))?;
    let dir = plugin_dir(base, project_id, &id);
    for (rel, content) in files {
        let target = dir.join(rel);
        std::fs::create_dir_all(target.parent().unwrap_or(&dir)).map_err(|e| e.to_string())?;
        std::fs::write(&target, content).map_err(|e| format!("{rel}: {e}"))?;
    }
    Ok(dir)
}

#[tauri::command]
pub fn install_plugin(app: AppHandle, project_id: String, files: HashMap<String, String>) -> Result<(), String> {
    write_bundle(&app_data(&app)?, &project_id, &files).map(|_| ())
}

#[tauri::command]
pub fn uninstall_plugin(app: AppHandle, project_id: String, id: String) -> Result<(), String> {
    validate_id("projectId", &project_id)?;
    validate_id("plugin id", &id)?;
    match std::fs::remove_dir_all(plugin_dir(&app_data(&app)?, &project_id, &id)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

/// Only these commands may be started as a plugin runtime.
const ALLOWED_RUNTIME_COMMANDS: [&str; 1] = ["uv"];

/// (command, args, port) from an omni-plugin.json; rejects any command outside the allow-list.
fn runtime_spec(manifest_json: &str) -> Result<(String, Vec<String>, u16), String> {
    let manifest: serde_json::Value = serde_json::from_str(manifest_json).map_err(|e| format!("bad omni-plugin.json: {e}"))?;
    let runtime = manifest.get("runtime").ok_or("omni-plugin.json has no runtime")?;
    let command = runtime.get("command").and_then(|v| v.as_str()).ok_or("runtime.command missing")?;
    if !ALLOWED_RUNTIME_COMMANDS.contains(&command) {
        return Err(format!("runtime command {command:?} is not allowed (allowed: {ALLOWED_RUNTIME_COMMANDS:?})"));
    }
    let args = runtime
        .get("args")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();
    let port = match runtime.get("port") {
        None => 9410,
        Some(p) => p.as_u64().and_then(|p| u16::try_from(p).ok()).filter(|p| *p > 0).ok_or("runtime.port must be 1-65535")?,
    };
    Ok((command.to_string(), args, port))
}

#[tauri::command]
pub fn start_runtime(
    app: AppHandle,
    runtimes: State<Runtimes>,
    project_id: String,
    manifest: serde_json::Value,
) -> Result<(), String> {
    validate_id("projectId", &project_id)?;
    let id = manifest.get("id").and_then(|v| v.as_str()).ok_or("manifest has no id")?;
    validate_id("plugin id", id)?;
    // The webview only names the plugin; the command comes from the omni-plugin.json that was written to disk.
    let base = app_data(&app)?;
    let dir = plugin_dir(&base, &project_id, id);
    let on_disk = std::fs::read_to_string(dir.join("omni-plugin.json")).map_err(|e| format!("plugin {id} is not installed: {e}"))?;
    let (command, args, port) = runtime_spec(&on_disk)?;

    let mut running = runtimes.0.lock().map_err(|e| e.to_string())?;
    if let Some(child) = running.get_mut(&project_id) {
        if matches!(child.try_wait(), Ok(None)) {
            return Ok(());
        }
    }
    let mut cmd = Command::new(&command);
    cmd.args(args)
        .current_dir(dir)
        .env("OMNI_PLUGIN_PORT", port.to_string())
        .env("OMNI_PROJECT_DIR", project_dir(&base, &project_id))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    std::os::windows::process::CommandExt::creation_flags(&mut cmd, 0x0800_0000); // CREATE_NO_WINDOW
    let child = cmd.spawn().map_err(|e| format!("cannot start {command}: {e}"))?;
    running.insert(project_id, child);
    Ok(())
}

fn kill_tree(mut child: Child) {
    // shortcut: Windows kills the whole tree (uv -> python); elsewhere only the direct child, upgrade with process groups if uv leaves orphans.
    #[cfg(windows)]
    let _ = Command::new("taskkill").args(["/F", "/T", "/PID", &child.id().to_string()]).output();
    let _ = child.kill();
    let _ = child.wait();
}

#[tauri::command]
pub fn stop_runtime(runtimes: State<Runtimes>, project_id: String) -> Result<(), String> {
    validate_id("projectId", &project_id)?;
    if let Some(child) = runtimes.0.lock().map_err(|e| e.to_string())?.remove(&project_id) {
        kill_tree(child);
    }
    Ok(())
}

/// Called when the app exits so no runtime outlives Studio.
pub fn stop_all(runtimes: &Runtimes) {
    if let Ok(mut running) = runtimes.0.lock() {
        running.drain().for_each(|(_, child)| kill_tree(child));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundle(entries: &[(&str, &str)]) -> HashMap<String, String> {
        entries.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn rejects_absolute_and_parent_paths_and_accepts_nested_relative() {
        for bad in ["/etc/passwd", "\\evil", "C:\\evil.txt", "C:/evil.txt", "../x", "a/../../x", "a\\..\\x", "", "a//b"] {
            assert!(validate_relative_path(bad).is_err(), "{bad} should be rejected");
        }
        for good in ["omni-plugin.json", "runtime/server.py", "skills/omni-scripting/SKILL.md"] {
            assert!(validate_relative_path(good).is_ok(), "{good} should be accepted");
        }
    }

    #[test]
    fn ids_must_be_lowercase_slug() {
        assert!(validate_id("plugin id", "langchain-deepagents").is_ok());
        for bad in ["", "../x", "A", "a_b", "a b", "a/b"] {
            assert!(validate_id("plugin id", bad).is_err(), "{bad} should be rejected");
        }
        assert!(validate_id("projectId", "Local_1-x").is_ok());
        for bad in ["", "..", "a/b", r"a\b", "a.b"] {
            assert!(validate_id("projectId", bad).is_err(), "{bad} should be rejected");
        }
    }

    #[test]
    fn runtime_spec_allows_only_uv_and_reads_args_and_port() {
        let ok = r#"{"runtime":{"command":"uv","args":["run","python","runtime/server.py"],"port":9411}}"#;
        assert_eq!(runtime_spec(ok).unwrap(), ("uv".to_string(), vec!["run".into(), "python".into(), "runtime/server.py".into()], 9411));
        assert_eq!(runtime_spec(r#"{"runtime":{"command":"uv"}}"#).unwrap().2, 9410);
        for bad in [
            r#"{"runtime":{"command":"powershell","args":["-c","calc"]}}"#,
            r#"{"runtime":{"command":"/usr/bin/uv"}}"#,
            r#"{"runtime":{"command":"uv.exe"}}"#,
            r#"{"runtime":{"command":"uv","port":70000}}"#,
            r#"{"runtime":{"command":"uv","port":0}}"#,
            r#"{"runtime":{}}"#,
            r#"{}"#,
            "not json",
        ] {
            assert!(runtime_spec(bad).is_err(), "{bad} should be rejected");
        }
    }

    #[test]
    fn writes_bundle_into_project_plugin_dir() {
        let base = std::env::temp_dir().join(format!("omni-plugins-test-{}", std::process::id()));
        let files = bundle(&[("omni-plugin.json", r#"{"id":"demo-plugin"}"#), ("runtime/server.py", "print(1)")]);
        let dir = write_bundle(&base, "proj-1", &files).unwrap();
        assert_eq!(dir, base.join("omni").join("projects").join("proj-1").join("plugins").join("demo-plugin"));
        assert_eq!(std::fs::read_to_string(dir.join("runtime").join("server.py")).unwrap(), "print(1)");
        assert_eq!(project_dir(&base, "proj-1"), base.join("omni").join("projects").join("proj-1"));
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn write_bundle_rejects_bad_input_without_writing() {
        let base = std::env::temp_dir().join(format!("omni-plugins-test-bad-{}", std::process::id()));
        let manifest = r#"{"id":"demo-plugin"}"#;
        assert!(write_bundle(&base, "proj-1", &bundle(&[("omni-plugin.json", manifest), ("../x", "")])).is_err());
        assert!(write_bundle(&base, "proj-1", &bundle(&[("a.txt", "")])).is_err());
        assert!(write_bundle(&base, "proj-1", &bundle(&[("omni-plugin.json", r#"{"id":"../x"}"#)])).is_err());
        assert!(write_bundle(&base, "../p", &bundle(&[("omni-plugin.json", manifest)])).is_err());
        assert!(!base.exists());
    }
}
