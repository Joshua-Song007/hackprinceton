//! Marketplace plugin commands: write a plugin bundle to disk and run its runtime process.
//! Layout: <app data>/pear/projects/<projectId>/plugins/<id>/ ; PEAR_PROJECT_DIR is the project dir.
//! A bundle arrives as the registry's gzip tarball; its SHA-256 and Ed25519 signature are checked
//! before anything is read out of it or written to disk.
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

/// One running runtime child per (project, plugin).
#[derive(Default)]
pub struct Runtimes(Mutex<HashMap<(String, String), Child>>);

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
    base.join("pear").join("projects").join(project_id)
}

fn plugin_dir(base: &Path, project_id: &str, id: &str) -> PathBuf {
    project_dir(base, project_id).join("plugins").join(id)
}

fn app_data(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// Reads and validates the plugin id from the bundle's pear-plugin.json.
fn bundle_plugin_id(files: &HashMap<String, String>) -> Result<String, String> {
    let manifest = files.get("pear-plugin.json").ok_or("bundle has no pear-plugin.json")?;
    let manifest: serde_json::Value = serde_json::from_str(manifest).map_err(|e| format!("bad pear-plugin.json: {e}"))?;
    let id = manifest.get("id").and_then(|v| v.as_str()).ok_or("pear-plugin.json has no id")?;
    validate_id("plugin id", id)?;
    Ok(id.to_string())
}

fn write_bundle(base: &Path, project_id: &str, files: &HashMap<String, Vec<u8>>) -> Result<PathBuf, String> {
    validate_id("projectId", project_id)?;
    let manifest = files.get("pear-plugin.json").map(|m| String::from_utf8_lossy(m).into_owned());
    let id = bundle_plugin_id(&manifest.into_iter().map(|m| ("pear-plugin.json".to_string(), m)).collect())?;
    // Validate everything before writing anything.
    files.keys().try_for_each(|p| validate_relative_path(p))?;
    let dir = plugin_dir(base, project_id, &id);
    // A reinstall replaces the whole dir, so files dropped from the new version do not linger.
    match std::fs::remove_dir_all(&dir) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.to_string()),
        _ => {}
    }
    for (rel, content) in files {
        let target = dir.join(rel);
        std::fs::create_dir_all(target.parent().unwrap_or(&dir)).map_err(|e| e.to_string())?;
        std::fs::write(&target, content).map_err(|e| format!("{rel}: {e}"))?;
    }
    Ok(dir)
}

const MAX_FILE_BYTES: u64 = 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 32 * 1024 * 1024;

/// The registry's release metadata for the tarball being installed.
#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub id: String,
    pub version: String,
    pub sha256: String,
    pub signature: String,
    /// The registry's Ed25519 public key (hex), from GET /api/plugin-signing-key.
    pub public_key: String,
}

/// The same text the backend signs (Backend/src/crypto.rs signed_message).
fn signed_message(id: &str, version: &str, sha256: &str) -> String {
    format!("pear-plugin-v1\n{id}\n{version}\n{sha256}")
}

/// Checks hash and signature, then reads the tarball's regular files into memory (paths validated,
/// sizes capped) and checks its manifest names the signed id and version.
fn verify_and_read(tarball: &[u8], r: &Release) -> Result<HashMap<String, Vec<u8>>, String> {
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    use sha2::{Digest, Sha256};
    let sha = hex::encode(Sha256::digest(tarball));
    if sha != r.sha256 {
        return Err(format!("bundle hash mismatch: got {sha}, registry says {}", r.sha256));
    }
    let key: [u8; 32] = hex::decode(&r.public_key).ok().and_then(|k| k.try_into().ok()).ok_or("bad registry public key")?;
    let sig: [u8; 64] = hex::decode(&r.signature).ok().and_then(|s| s.try_into().ok()).ok_or("bad bundle signature")?;
    VerifyingKey::from_bytes(&key)
        .map_err(|e| e.to_string())?
        .verify(signed_message(&r.id, &r.version, &r.sha256).as_bytes(), &Signature::from_bytes(&sig))
        .map_err(|_| "bundle signature does not verify".to_string())?;

    let mut files = HashMap::new();
    let mut total = 0u64;
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(tarball));
    for entry in archive.entries().map_err(|e| format!("bad tarball: {e}"))? {
        let mut entry = entry.map_err(|e| format!("bad tarball: {e}"))?;
        let kind = entry.header().entry_type();
        let path = entry.path().map_err(|e| e.to_string())?.to_string_lossy().trim_start_matches("./").to_string();
        if kind.is_dir() {
            continue;
        }
        if !kind.is_file() {
            return Err(format!("{path}: only regular files are allowed"));
        }
        validate_relative_path(&path)?;
        let mut buf = Vec::new();
        entry.by_ref().take(MAX_FILE_BYTES + 1).read_to_end(&mut buf).map_err(|e| e.to_string())?;
        total += buf.len() as u64;
        if buf.len() as u64 > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES {
            return Err(format!("{path}: bundle over the size limit"));
        }
        files.insert(path, buf);
    }
    let manifest: serde_json::Value = serde_json::from_slice(files.get("pear-plugin.json").ok_or("bundle has no pear-plugin.json")?)
        .map_err(|e| format!("bad pear-plugin.json: {e}"))?;
    if manifest["id"] != r.id.as_str() || manifest["version"] != r.version.as_str() {
        return Err("bundle manifest does not match the signed id and version".into());
    }
    Ok(files)
}

/// Installs a registry tarball (base64) into the project after `verify_and_read` passes.
#[tauri::command]
pub fn install_plugin(app: AppHandle, project_id: String, tarball: String, release: Release) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(tarball).map_err(|e| format!("bad tarball encoding: {e}"))?;
    let files = verify_and_read(&bytes, &release)?;
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

/// (command, args, port) from an pear-plugin.json; rejects any command outside the allow-list.
fn runtime_spec(manifest_json: &str) -> Result<(String, Vec<String>, u16), String> {
    let manifest: serde_json::Value = serde_json::from_str(manifest_json).map_err(|e| format!("bad pear-plugin.json: {e}"))?;
    let runtime = manifest.get("runtime").ok_or("pear-plugin.json has no runtime")?;
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
    // The webview only names the plugin; the command comes from the pear-plugin.json that was written to disk.
    let base = app_data(&app)?;
    let dir = plugin_dir(&base, &project_id, id);
    let on_disk = std::fs::read_to_string(dir.join("pear-plugin.json")).map_err(|e| format!("plugin {id} is not installed: {e}"))?;
    let (command, args, port) = runtime_spec(&on_disk)?;

    let key = (project_id.clone(), id.to_string());
    let mut running = runtimes.0.lock().map_err(|e| e.to_string())?;
    if let Some(child) = running.get_mut(&key) {
        if matches!(child.try_wait(), Ok(None)) {
            return Ok(());
        }
    }
    let mut cmd = Command::new(&command);
    cmd.args(args)
        .current_dir(dir)
        .env("PEAR_PLUGIN_PORT", port.to_string())
        .env("PEAR_PROJECT_DIR", project_dir(&base, &project_id))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    std::os::windows::process::CommandExt::creation_flags(&mut cmd, 0x0800_0000); // CREATE_NO_WINDOW
    // Own process group (pgid = child pid), so stopping kills uv and the python it started.
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut cmd, 0);
    let child = cmd.spawn().map_err(|e| format!("cannot start {command}: {e}"))?;
    running.insert(key, child);
    Ok(())
}

fn kill_tree(mut child: Child) {
    // Windows kills the whole tree (uv -> python); elsewhere the child's process group (see start_runtime).
    #[cfg(windows)]
    let _ = Command::new("taskkill").args(["/F", "/T", "/PID", &child.id().to_string()]).output();
    #[cfg(unix)]
    let _ = Command::new("kill").args(["-KILL", "--", &format!("-{}", child.id())]).output();
    let _ = child.kill();
    let _ = child.wait();
}

#[tauri::command]
pub fn stop_runtime(runtimes: State<Runtimes>, project_id: String, id: String) -> Result<(), String> {
    validate_id("projectId", &project_id)?;
    validate_id("plugin id", &id)?;
    if let Some(child) = runtimes.0.lock().map_err(|e| e.to_string())?.remove(&(project_id, id)) {
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

    fn bundle(entries: &[(&str, &str)]) -> HashMap<String, Vec<u8>> {
        entries.iter().map(|(k, v)| (k.to_string(), v.as_bytes().to_vec())).collect()
    }

    #[test]
    fn rejects_absolute_and_parent_paths_and_accepts_nested_relative() {
        for bad in ["/etc/passwd", "\\evil", "C:\\evil.txt", "C:/evil.txt", "../x", "a/../../x", "a\\..\\x", "", "a//b"] {
            assert!(validate_relative_path(bad).is_err(), "{bad} should be rejected");
        }
        for good in ["pear-plugin.json", "runtime/server.py", "skills/pear-scripting/SKILL.md"] {
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
        let base = std::env::temp_dir().join(format!("pear-plugins-test-{}", std::process::id()));
        let files = bundle(&[("pear-plugin.json", r#"{"id":"demo-plugin"}"#), ("runtime/server.py", "print(1)")]);
        let dir = write_bundle(&base, "proj-1", &files).unwrap();
        assert_eq!(dir, base.join("pear").join("projects").join("proj-1").join("plugins").join("demo-plugin"));
        assert_eq!(std::fs::read_to_string(dir.join("runtime").join("server.py")).unwrap(), "print(1)");
        assert_eq!(project_dir(&base, "proj-1"), base.join("pear").join("projects").join("proj-1"));
        // Reinstall without runtime/server.py: the stale file is gone.
        write_bundle(&base, "proj-1", &bundle(&[("pear-plugin.json", r#"{"id":"demo-plugin"}"#)])).unwrap();
        assert!(!dir.join("runtime").join("server.py").exists());
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn write_bundle_rejects_bad_input_without_writing() {
        let base = std::env::temp_dir().join(format!("pear-plugins-test-bad-{}", std::process::id()));
        let manifest = r#"{"id":"demo-plugin"}"#;
        assert!(write_bundle(&base, "proj-1", &bundle(&[("pear-plugin.json", manifest), ("../x", "")])).is_err());
        assert!(write_bundle(&base, "proj-1", &bundle(&[("a.txt", "")])).is_err());
        assert!(write_bundle(&base, "proj-1", &bundle(&[("pear-plugin.json", r#"{"id":"../x"}"#)])).is_err());
        assert!(write_bundle(&base, "../p", &bundle(&[("pear-plugin.json", manifest)])).is_err());
        assert!(!base.exists());
    }

    /// A tarball + release signed with a fixed test key, like the registry would serve.
    fn signed(files: &[(&str, &[u8])], id: &str, version: &str) -> (Vec<u8>, Release) {
        use ed25519_dalek::{Signer, SigningKey};
        use sha2::{Digest, Sha256};
        let mut tar = tar::Builder::new(flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast()));
        for (path, data) in files {
            let mut h = tar::Header::new_ustar();
            h.set_size(data.len() as u64);
            h.set_mode(0o644);
            tar.append_data(&mut h, path, *data).unwrap();
        }
        let bytes = tar.into_inner().unwrap().finish().unwrap();
        let sha = hex::encode(Sha256::digest(&bytes));
        let key = SigningKey::from_bytes(&[9; 32]);
        let signature = hex::encode(key.sign(signed_message(id, version, &sha).as_bytes()).to_bytes());
        let release = Release { id: id.into(), version: version.into(), sha256: sha, signature, public_key: hex::encode(key.verifying_key().to_bytes()) };
        (bytes, release)
    }

    #[test]
    fn verified_tarball_reads_and_any_tamper_is_refused() {
        let manifest = br#"{"id":"demo-plugin","version":"1.0.0"}"#;
        let (bytes, release) = signed(&[("pear-plugin.json", manifest), ("uv.lock", b"lock"), (".python-version", b"3.12")], "demo-plugin", "1.0.0");
        let files = verify_and_read(&bytes, &release).unwrap();
        assert_eq!(files["uv.lock"], b"lock");
        assert!(files.contains_key(".python-version"));

        // One flipped byte anywhere in the tarball.
        for i in [0, bytes.len() / 2, bytes.len() - 1] {
            let mut bad = bytes.clone();
            bad[i] ^= 1;
            assert!(verify_and_read(&bad, &release).unwrap_err().contains("hash mismatch"), "byte {i}");
        }
        // Hash updated to match the tampered bytes, but the signature does not cover it.
        let mut bad = bytes.clone();
        bad[10] ^= 1;
        let sha = { use sha2::{Digest, Sha256}; hex::encode(Sha256::digest(&bad)) };
        assert!(verify_and_read(&bad, &Release { sha256: sha, ..release.clone() }).unwrap_err().contains("signature"));
        // Signed for another version, or checked against another key.
        assert!(verify_and_read(&bytes, &Release { version: "2.0.0".into(), ..release.clone() }).is_err());
        let other_key = hex::encode(ed25519_dalek::SigningKey::from_bytes(&[8; 32]).verifying_key().to_bytes());
        assert!(verify_and_read(&bytes, &Release { public_key: other_key, ..release.clone() }).is_err());
    }

    #[test]
    fn signed_tarball_with_traversal_or_wrong_manifest_is_refused() {
        let (bytes, release) = signed(&[("pear-plugin.json", br#"{"id":"other","version":"1.0.0"}"#)], "demo-plugin", "1.0.0");
        assert!(verify_and_read(&bytes, &release).unwrap_err().contains("does not match"));
        let mut tar = tar::Builder::new(flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast()));
        let mut h = tar::Header::new_gnu();
        h.set_size(1);
        h.set_entry_type(tar::EntryType::Regular);
        h.as_gnu_mut().unwrap().name[..7].copy_from_slice(b"../evil");
        h.set_cksum();
        tar.append(&h, &b"x"[..]).unwrap();
        let bytes = tar.into_inner().unwrap().finish().unwrap();
        let sha = { use sha2::{Digest, Sha256}; hex::encode(Sha256::digest(&bytes)) };
        let (_, base) = signed(&[], "demo-plugin", "1.0.0");
        let key = ed25519_dalek::SigningKey::from_bytes(&[9; 32]);
        let sig = { use ed25519_dalek::Signer; hex::encode(key.sign(signed_message("demo-plugin", "1.0.0", &sha).as_bytes()).to_bytes()) };
        let release = Release { sha256: sha, signature: sig, ..base };
        assert!(verify_and_read(&bytes, &release).unwrap_err().contains("unsafe"));
    }
}
