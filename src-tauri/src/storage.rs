use anyhow::{Context, Result};
use std::fs;
use std::path::{Path, PathBuf};

/// Atomically write `value` as pretty JSON to `path`.
///
/// Strategy: write to `<path>.tmp` then rename over the target. Both files live
/// in the same directory (same volume) so the rename is atomic on Windows.
pub fn write_json_atomic<T: serde::Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let bytes = serde_json::to_vec_pretty(value).context("serialize json")?;
    let tmp = sibling(path, ".tmp");
    fs::write(&tmp, &bytes).with_context(|| format!("write tmp {:?}", tmp))?;
    fs::rename(&tmp, path).with_context(|| format!("rename {:?}", path))?;
    Ok(())
}

/// Read and parse JSON from `path`.
pub fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T> {
    let data = fs::read(path).with_context(|| format!("read {:?}", path))?;
    serde_json::from_slice(&data).context("parse json")
}

/// Read JSON, or return Default if the file is missing / unreadable / unparseable.
pub fn read_json_or_default<T: serde::de::DeserializeOwned + Default>(path: &Path) -> T {
    read_json::<T>(path).unwrap_or_default()
}

/// Best-effort copy of `path` to `<path>.bak` if it exists (call before mutating).
pub fn backup_if_exists(path: &Path) -> Result<()> {
    if path.exists() {
        let bak = sibling(path, ".bak");
        let _ = fs::copy(path, &bak);
    }
    Ok(())
}

fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Serialize;

    #[derive(Serialize, Deserialize, PartialEq, Debug)]
    struct Data {
        a: i32,
        b: String,
    }
    use serde::Deserialize;

    #[test]
    fn write_then_read_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("x.json");
        let d = Data { a: 5, b: "hi".into() };
        write_json_atomic(&path, &d).unwrap();
        assert!(path.exists());
        // tmp file should be gone after rename
        assert!(!sibling(&path, ".tmp").exists());
        let back: Data = read_json(&path).unwrap();
        assert_eq!(back, d);
    }

    #[test]
    fn read_or_default_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nope.json");
        let v: HashMap<String, i32> = read_json_or_default(&path);
        assert!(v.is_empty());
    }

    use std::collections::HashMap;
}
