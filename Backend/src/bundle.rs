// Plugin bundles as deterministic gzip tarballs: the same files always give the same bytes (mtime 0,
// fixed modes, sorted paths), so the SHA-256 identifies the content and a re-seed is a no-op.
use std::collections::BTreeMap;
use std::io::Read;
use std::path::Path;

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;

pub type Files = BTreeMap<String, Vec<u8>>;

pub const MANIFEST_FILE: &str = "omni-plugin.json";
/// Per-file cap (uv.lock is ~400 KB).
pub const MAX_FILE_BYTES: u64 = 1024 * 1024;
/// Whole-bundle caps, uncompressed.
pub const MAX_TOTAL_BYTES: u64 = 32 * 1024 * 1024;
pub const MAX_FILES: usize = 2000;
/// Directories never bundled: tool caches and environments. Other dot entries (.python-version) are kept.
pub const SKIPPED_DIRS: [&str; 7] = [".venv", ".git", "__pycache__", "node_modules", ".pytest_cache", ".ruff_cache", ".mypy_cache"];

/// A bundle path must be relative, POSIX, and stay inside the plugin dir.
pub fn valid_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains(['\\', ':', '\0'])
        && path.split('/').all(|seg| !seg.is_empty() && seg != "." && seg != "..")
        && !path.split('/').any(|seg| SKIPPED_DIRS.contains(&seg))
}

/// Reads every file under `dir` (skipping SKIPPED_DIRS and symlinks). A file over MAX_FILE_BYTES is an error,
/// so a bundle is never silently missing a file.
pub fn collect_dir(dir: &Path) -> Result<Files, String> {
    fn walk(root: &Path, dir: &Path, out: &mut Files, total: &mut u64) -> Result<(), String> {
        let mut entries: Vec<_> = std::fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))?.filter_map(Result::ok).collect();
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            let name = entry.file_name().to_string_lossy().into_owned();
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            let path = entry.path();
            if kind.is_dir() {
                if !SKIPPED_DIRS.contains(&name.as_str()) {
                    walk(root, &path, out, total)?;
                }
            } else if kind.is_file() {
                let rel: Vec<_> = path.strip_prefix(root).unwrap_or(&path).iter().map(|s| s.to_string_lossy().into_owned()).collect();
                let rel = rel.join("/");
                let len = entry.metadata().map_err(|e| e.to_string())?.len();
                if len > MAX_FILE_BYTES {
                    return Err(format!("{rel} is {len} bytes, over the {MAX_FILE_BYTES}-byte limit"));
                }
                *total += len;
                out.insert(rel, std::fs::read(&path).map_err(|e| e.to_string())?);
            }
        }
        Ok(())
    }
    let mut out = Files::new();
    let mut total = 0;
    walk(dir, dir, &mut out, &mut total)?;
    check_limits(&out)?;
    Ok(out)
}

fn check_limits(files: &Files) -> Result<(), String> {
    if files.len() > MAX_FILES {
        return Err(format!("{} files, over the {MAX_FILES}-file limit", files.len()));
    }
    let total: u64 = files.values().map(|f| f.len() as u64).sum();
    if total > MAX_TOTAL_BYTES {
        return Err(format!("{total} bytes, over the {MAX_TOTAL_BYTES}-byte bundle limit"));
    }
    if let Some(bad) = files.keys().find(|p| !valid_path(p)) {
        return Err(format!("unsafe path {bad:?}"));
    }
    Ok(())
}

pub fn build_tarball(files: &Files) -> Vec<u8> {
    let mut tar = tar::Builder::new(GzEncoder::new(Vec::new(), Compression::best()));
    tar.mode(tar::HeaderMode::Deterministic);
    for (path, bytes) in files {
        let mut h = tar::Header::new_ustar();
        h.set_size(bytes.len() as u64);
        h.set_mode(0o644);
        h.set_mtime(0);
        h.set_entry_type(tar::EntryType::Regular);
        tar.append_data(&mut h, path, bytes.as_slice()).expect("writing a tarball to memory");
    }
    tar.into_inner().and_then(|gz| gz.finish()).expect("writing a tarball to memory")
}

/// Unpacks an uploaded gzip tarball: regular files only (directories ignored), a leading "./" dropped,
/// every path checked with `valid_path` and the size limits enforced while reading.
pub fn read_tarball(bytes: &[u8]) -> Result<Files, String> {
    let mut archive = tar::Archive::new(GzDecoder::new(bytes));
    let mut out = Files::new();
    let mut total = 0u64;
    for entry in archive.entries().map_err(|e| format!("bad tarball: {e}"))? {
        let mut entry = entry.map_err(|e| format!("bad tarball: {e}"))?;
        let kind = entry.header().entry_type();
        let raw = entry.path().map_err(|e| format!("bad tarball path: {e}"))?.to_string_lossy().into_owned();
        let path = raw.trim_start_matches("./").trim_end_matches('/').to_string();
        if kind.is_dir() || path.is_empty() {
            continue;
        }
        if !kind.is_file() {
            return Err(format!("{raw}: only regular files are allowed"));
        }
        if path.split('/').any(|seg| SKIPPED_DIRS.contains(&seg)) {
            continue;
        }
        if !valid_path(&path) {
            return Err(format!("unsafe path {raw:?}"));
        }
        let mut buf = Vec::new();
        entry.by_ref().take(MAX_FILE_BYTES + 1).read_to_end(&mut buf).map_err(|e| format!("{raw}: {e}"))?;
        if buf.len() as u64 > MAX_FILE_BYTES {
            return Err(format!("{path} is over the {MAX_FILE_BYTES}-byte limit"));
        }
        total += buf.len() as u64;
        if total > MAX_TOTAL_BYTES || out.len() >= MAX_FILES {
            return Err("bundle over the size or file-count limit".into());
        }
        out.insert(path, buf);
    }
    check_limits(&out)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn files(entries: &[(&str, &[u8])]) -> Files {
        entries.iter().map(|(k, v)| (k.to_string(), v.to_vec())).collect()
    }

    #[test]
    fn tarball_is_deterministic_and_round_trips_binary_and_dotfiles() {
        let f = files(&[("omni-plugin.json", b"{}"), (".python-version", b"3.12\n"), ("bin/x", &[0, 0xff, 7])]);
        let a = build_tarball(&f);
        assert_eq!(a, build_tarball(&f));
        assert_eq!(read_tarball(&a).unwrap(), f);
    }

    #[test]
    fn rejects_unsafe_paths_and_skips_tool_dirs() {
        for bad in ["/abs", "../x", "a/../b", "a//b", "a\\b", "C:x", "", "./x"] {
            assert!(!valid_path(bad), "{bad}");
        }
        assert!(valid_path(".python-version") && valid_path("runtime/server.py") && valid_path("uv.lock"));
        assert!(!valid_path(".venv/lib/x.py") && !valid_path("a/__pycache__/x.pyc"));
    }

    #[test]
    fn read_tarball_refuses_traversal_symlinks_and_oversize() {
        let mut b = tar::Builder::new(GzEncoder::new(Vec::new(), Compression::fast()));
        let mut h = tar::Header::new_gnu();
        h.set_size(1);
        h.set_entry_type(tar::EntryType::Regular);
        // append_data refuses "..", so write the name bytes directly.
        h.as_gnu_mut().unwrap().name[..7].copy_from_slice(b"../evil");
        h.set_cksum();
        b.append(&h, &b"x"[..]).unwrap();
        assert!(read_tarball(&b.into_inner().unwrap().finish().unwrap()).is_err());

        let mut b = tar::Builder::new(GzEncoder::new(Vec::new(), Compression::fast()));
        let mut h = tar::Header::new_ustar();
        h.set_entry_type(tar::EntryType::Symlink);
        h.set_size(0);
        b.append_link(&mut h, "link", "/etc/passwd").unwrap();
        assert!(read_tarball(&b.into_inner().unwrap().finish().unwrap()).is_err());

        let big = files(&[("big", &vec![b'a'; MAX_FILE_BYTES as usize + 1])]);
        let mut b = tar::Builder::new(GzEncoder::new(Vec::new(), Compression::fast()));
        for (p, d) in &big {
            let mut h = tar::Header::new_ustar();
            h.set_size(d.len() as u64);
            b.append_data(&mut h, p, d.as_slice()).unwrap();
        }
        assert!(read_tarball(&b.into_inner().unwrap().finish().unwrap()).is_err());
        assert!(read_tarball(b"not a tarball").is_err());
    }

    #[test]
    fn collect_dir_keeps_lock_and_dotfiles_skips_venv() {
        let dir = std::env::temp_dir().join(format!("omni-bundle-collect-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for (rel, data) in [("omni-plugin.json", &b"{}"[..]), (".python-version", b"3.12"), ("uv.lock", &vec![b'l'; 500 * 1024]), (".venv/x", b"skip"), ("a/__pycache__/y", b"skip")] {
            let p = dir.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, data).unwrap();
        }
        let f = collect_dir(&dir).unwrap();
        assert_eq!(f.keys().map(String::as_str).collect::<Vec<_>>(), [".python-version", "omni-plugin.json", "uv.lock"]);
        std::fs::write(dir.join("huge"), vec![0u8; MAX_FILE_BYTES as usize + 1]).unwrap();
        assert!(collect_dir(&dir).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
