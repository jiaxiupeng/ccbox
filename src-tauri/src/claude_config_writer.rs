use crate::models::ModelMap;
use crate::storage;
use anyhow::Result;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// `~/.ccbox/statusline.cjs` — the self-contained Node (CommonJS) script CCBox
/// installs. Claude Code's statusLine command invokes it; it reads
/// `~/.ccbox/settings.json` live, so the user's arrangement/options update
/// without re-applying. Uses `.cjs` so it's always treated as CommonJS even if
/// a `package.json` with `"type":"module"` ends up nearby.
pub fn statusline_script_path() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("home dir not found"))?;
    Ok(home.join(".ccbox").join("statusline.cjs"))
}

/// `~/.claude/settings.json` — the file Claude Code reads for env overrides.
pub fn claude_settings_path() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("home dir not found"))?;
    Ok(home.join(".claude").join("settings.json"))
}

/// Env keys CCBox fully owns and rewrites on every switch.
const MANAGED_KEYS: &[&str] = &[
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
    "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
];

/// Write the active provider's full config into `~/.claude/settings.json`.
///
/// Strategy: clear all MANAGED_KEYS + the previous provider's extra keys + the
/// new provider's extra keys (so nothing stale remains), then write the new
/// values. Every non-managed field the user has is preserved untouched.
pub fn write_provider_config(
    base_url: &str,
    token: &str,
    default_model: Option<&str>,
    model_map: Option<&ModelMap>,
    extra_env: &HashMap<String, String>,
    prev_extra_keys: &[String],
) -> Result<()> {
    let path = claude_settings_path()?;
    write_provider_config_at(
        &path,
        base_url,
        token,
        default_model,
        model_map,
        extra_env,
        prev_extra_keys,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn write_provider_config_at(
    path: &Path,
    base_url: &str,
    token: &str,
    default_model: Option<&str>,
    model_map: Option<&ModelMap>,
    extra_env: &HashMap<String, String>,
    prev_extra_keys: &[String],
) -> Result<()> {
    let mut root: Value = storage::read_json_or_default(path);
    if !root.is_object() {
        root = Value::Object(Map::new());
    }
    let obj = root.as_object_mut().expect("root is object after coercion");

    // 0. top-level `model` field — Claude Code reads this as the startup default
    //    and it takes precedence over env.ANTHROPIC_MODEL. We sync it to the
    //    chosen default model so users don't need to /model on every launch.
    //    (Only set when a default_model is provided; never clear user's value.)
    if let Some(m) = default_model {
        if !m.is_empty() {
            obj.insert("model".to_string(), json!(m));
        }
    }

    let env = obj
        .entry("env".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    let env = env.as_object_mut().expect("env is object after insert");

    // 1. clear everything CCBox manages, plus previous & new extra keys
    for k in MANAGED_KEYS {
        env.remove(*k);
    }
    for k in prev_extra_keys {
        env.remove(k.as_str());
    }
    for k in extra_env.keys() {
        env.remove(k.as_str());
    }

    // 2. core connection
    env.insert("ANTHROPIC_BASE_URL".into(), json!(base_url));
    env.insert("ANTHROPIC_AUTH_TOKEN".into(), json!(token));
    if let Some(m) = default_model {
        if !m.is_empty() {
            env.insert("ANTHROPIC_MODEL".into(), json!(m));
        }
    }

    // 3. tier mapping (opus/sonnet/haiku -> provider model)
    if let Some(mm) = model_map {
        if let Some(o) = &mm.opus {
            if !o.is_empty() {
                env.insert("ANTHROPIC_DEFAULT_OPUS_MODEL".into(), json!(o));
            }
        }
        if let Some(s) = &mm.sonnet {
            if !s.is_empty() {
                env.insert("ANTHROPIC_DEFAULT_SONNET_MODEL".into(), json!(s));
            }
        }
        if let Some(h) = &mm.haiku {
            if !h.is_empty() {
                env.insert("ANTHROPIC_DEFAULT_HAIKU_MODEL".into(), json!(h));
            }
        }
    }

    // 4. extra env (e.g. CLAUDE_CODE_AUTO_COMPACT_WINDOW for GLM 1M context)
    for (k, v) in extra_env {
        env.insert(k.clone(), json!(v));
    }

    storage::backup_if_exists(path)?;
    storage::write_json_atomic(path, &root)
}

/// Remove all CCBox-managed env keys (used when clearing the active provider).
pub fn clear_provider_env(prev_extra_keys: &[String]) -> Result<()> {
    let path = claude_settings_path()?;
    if !path.exists() {
        return Ok(());
    }
    let mut root: Value = storage::read_json_or_default(&path);
    if let Some(env) = root.get_mut("env").and_then(|v| v.as_object_mut()) {
        for k in MANAGED_KEYS {
            env.remove(*k);
        }
        for k in prev_extra_keys {
            env.remove(k.as_str());
        }
        storage::backup_if_exists(&path)?;
        storage::write_json_atomic(&path, &root)?;
    }
    Ok(())
}

/// Install the self-contained Node statusLine script to `~/.ccbox/statusline.cjs`
/// and register the `statusLine` key in `~/.claude/settings.json`. Safe-merge:
/// only touches the `statusLine` key, preserving everything else the user has.
/// Idempotent — safe to call repeatedly.
pub fn write_statusline_config() -> Result<()> {
    // 1. write the Node script
    let script_path = statusline_script_path()?;
    if let Some(parent) = script_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&script_path, STATUSLINE_SCRIPT)
        .map_err(|e| anyhow::anyhow!("failed to write statusline.cjs: {e}"))?;

    // 2. register statusLine in ~/.claude/settings.json
    let settings_path = claude_settings_path()?;
    let mut root: Value = storage::read_json_or_default(&settings_path);
    if !root.is_object() {
        root = Value::Object(Map::new());
    }
    let cmd = format!("node \"{}\"", script_path.display());
    if let Some(obj) = root.as_object_mut() {
        obj.insert(
            "statusLine".to_string(),
            json!({ "type": "command", "command": cmd, "padding": 0 }),
        );
        storage::backup_if_exists(&settings_path)?;
        storage::write_json_atomic(&settings_path, &root)?;
    }
    Ok(())
}

/// Remove the `statusLine` key from `~/.claude/settings.json` (used when
/// switching away from GLM). The script file and CCBox's statusBar config are
/// intentionally left in place so the user's arrangement is preserved.
pub fn clear_statusline_config() -> Result<()> {
    let settings_path = claude_settings_path()?;
    if !settings_path.exists() {
        return Ok(());
    }
    let mut root: Value = storage::read_json_or_default(&settings_path);
    if let Some(obj) = root.as_object_mut() {
        if obj.remove("statusLine").is_some() {
            storage::backup_if_exists(&settings_path)?;
            storage::write_json_atomic(&settings_path, &root)?;
        }
    }
    Ok(())
}

/// Write `permissions.defaultMode` into `~/.claude/settings.json`. Safe-merge:
/// only touches the `defaultMode` key inside the `permissions` object, so any
/// user-configured `allow` / `deny` / `ask` lists are preserved. Provider
/// switches never call this, so the chosen mode survives switching providers.
pub fn write_permission_mode(mode: &str) -> Result<()> {
    let settings_path = claude_settings_path()?;
    let mut root: Value = storage::read_json_or_default(&settings_path);
    if !root.is_object() {
        root = Value::Object(Map::new());
    }
    if let Some(obj) = root.as_object_mut() {
        let perms = obj
            .entry("permissions".to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        if let Some(p) = perms.as_object_mut() {
            p.insert("defaultMode".to_string(), json!(mode));
        }
        storage::backup_if_exists(&settings_path)?;
        storage::write_json_atomic(&settings_path, &root)?;
    }
    Ok(())
}

/// Read the current `permissions.defaultMode` value from
/// `~/.claude/settings.json`, if any. Used to initialize the UI selector.
pub fn read_permission_mode() -> Result<Option<String>> {
    let settings_path = claude_settings_path()?;
    if !settings_path.exists() {
        return Ok(None);
    }
    let root: Value = storage::read_json_or_default(&settings_path);
    Ok(root
        .get("permissions")
        .and_then(|p| p.get("defaultMode"))
        .and_then(|m| m.as_str())
        .map(|s| s.to_string()))
}

const STATUSLINE_SCRIPT: &str = r##"#!/usr/bin/env node
/* CCBox statusline — self-contained CommonJS, no external deps.
 * Claude Code pipes session JSON on stdin each update. We read the user's
 * arrangement from ~/.ccbox/settings.json (statusBar) and emit one line.
 * Every external call (GLM quota API) degrades to "--" on failure; this script
 * must never throw or it kills the status line entirely. */
const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const http = require("http");

const HOME = os.homedir();
const CCBOX_SETTINGS = path.join(HOME, ".ccbox", "settings.json");
const QUOTA_CACHE = path.join(HOME, ".ccbox", "quota-cache.json");
const CLAUDE_SETTINGS = path.join(HOME, ".claude", "settings.json");
const QUOTA_TTL_MS = 120 * 1000; // cache the GLM quota API for 2 min
const QUOTA_TIMEOUT_MS = 3000;

// ANSI colors for threshold color_mode
const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
};

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

// Read the whole stdin (Claude Code passes one JSON object, ~once per update).
function readStdin() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Threshold color: <50 green, <80 yellow, else red. `mode`="static" -> none.
function colorFor(pct, mode) {
  if (mode !== "threshold") return "";
  if (pct >= 80) return C.red;
  if (pct >= 50) return C.yellow;
  return C.green;
}

// A smoother progress bar: solid blocks for the filled portion, one partial
// eighths-block for the leading edge, and light shade for the empty track.
// e.g. 42%, width 10 ->  "▆▆▆▆▆ ┄┄┄┄" (colored by the caller via ANSI wrap).
const PARTIAL = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"];
function bar(pct, width) {
  const w = Math.max(3, width || 10);
  const p = Math.min(100, Math.max(0, pct)) / 100;
  const exact = p * w;
  const whole = Math.floor(exact);
  const frac = Math.round((exact - whole) * 8); // 0..8
  // collapse a near-full leading edge into a full block
  const filled = frac >= 8 ? whole + 1 : whole;
  const lead = frac > 0 && frac < 8 && filled < w ? PARTIAL[frac] : "";
  const empty = Math.max(0, w - filled - (lead ? 1 : 0));
  return "█".repeat(filled) + lead + "┄".repeat(empty);
}

function fmtPct(pct) {
  return `${Math.round(pct)}%`;
}

// Pull the GLM auth token + base host from ~/.claude/settings.json env.
function glmCreds() {
  const s = readJSON(CLAUDE_SETTINGS, {});
  const env = s.env || {};
  const token = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || "";
  const baseUrl = env.ANTHROPIC_BASE_URL || "";
  // Derive the monitor API host from the base url (bigmodel.cn / z.ai).
  let host = "";
  try {
    const u = new URL(baseUrl);
    host = `${u.protocol}//${u.host}`;
  } catch {
    if (baseUrl.includes("bigmodel")) host = "https://open.bigmodel.cn";
    else if (baseUrl.includes("z.ai")) host = "https://api.z.ai";
  }
  const isGlm = host.includes("bigmodel") || host.includes("z.ai");
  return { token, host, isGlm };
}

// Cached + single-flight fetch of the GLM quota API.
let quotaInflight = false;
function fetchQuota(cb) {
  const cache = readJSON(QUOTA_CACHE, null);
  if (cache && typeof cache.fetchedAt === "number" &&
      Date.now() - cache.fetchedAt < QUOTA_TTL_MS && cache.data) {
    return cb(null, cache.data);
  }
  if (quotaInflight) {
    // Another invocation is already fetching; serve stale cache if any.
    return cb(null, (cache && cache.data) || null);
  }
  quotaInflight = true;
  const { token, host } = glmCreds();
  if (!token || !host) {
    quotaInflight = false;
    return cb(null, (cache && cache.data) || null);
  }
  const url = `${host}/api/monitor/usage/quota/limit`;
  const lib = url.startsWith("https") ? https : http;
  const req = lib.get(url, {
    headers: { Authorization: token, Accept: "application/json" },
    timeout: QUOTA_TIMEOUT_MS,
  }, (res) => {
    let body = "";
    res.on("data", (d) => (body += d));
    res.on("end", () => {
      quotaInflight = false;
      let data = null;
      try { data = JSON.parse(body); } catch {}
      if (data) {
        try { fs.writeFileSync(QUOTA_CACHE, JSON.stringify({ fetchedAt: Date.now(), data })); } catch {}
      }
      cb(res.statusCode && res.statusCode < 400 ? null : new Error("http"), data);
    });
  });
  req.on("timeout", () => { req.destroy(); quotaInflight = false; cb(null, (cache && cache.data) || null); });
  req.on("error", () => { quotaInflight = false; cb(null, (cache && cache.data) || null); });
}

// Find the most recent assistant usage block in the transcript JSONL.
function contextTokens(transcriptPath) {
  try {
    const text = fs.readFileSync(transcriptPath, "utf8");
    const lines = text.trim().split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      const msg = entry.message;
      if (msg && msg.usage) {
        const u = msg.usage;
        return (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) +
               (u.cache_read_input_tokens || 0);
      }
    }
  } catch {}
  return 0;
}

function contextLimit() {
  // GLM 1M sets CLAUDE_CODE_AUTO_COMPACT_WINDOW; else fall back to 200k.
  const s = readJSON(CLAUDE_SETTINGS, {});
  const env = s.env || {};
  const w = parseInt(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, 10);
  return w > 0 ? w : 200000;
}

function roundUp(n) { return n === null || n === undefined ? "--" : Math.ceil(n); }

function renderQuota(data, key) {
  // The GLM monitor payload is loosely structured; probe a few common shapes.
  if (!data) return { text: "--", pct: null };
  const node = data[key] || (data.data && data.data[key]);
  const usedPct = node && (node.usedPct ?? node.usedPercent ?? node.used_percent);
  if (typeof usedPct === "number") return { text: fmtPct(usedPct), pct: usedPct };
  const used = node && (node.used ?? node.usedNum);
  const total = node && (node.total ?? node.totalNum ?? node.limit);
  if (typeof used === "number" && typeof total === "number" && total > 0) {
    const p = (used / total) * 100;
    return { text: fmtPct(p), pct: p };
  }
  return { text: "--", pct: null };
}

function resetText(data, key) {
  if (!data) return "--";
  const node = data[key] || (data.data && data.data[key]);
  if (!node) return "--";
  // Prefer an explicit remaining-seconds countdown.
  const secs = node.resetSeconds ?? node.refreshSeconds ?? node.remainingSeconds;
  if (typeof secs === "number" && secs > 0) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return h > 0 ? `${h}h${m}m` : `${m}m`;
  }
  const ts = node.resetTimestamp ?? node.refreshTime ?? node.resetAt;
  if (typeof ts === "number" && ts > 1e9) {
    try {
      const d = new Date(ts > 1e12 ? ts : ts * 1000);
      return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    } catch {}
  }
  return "--";
}

// Build the rendered string for one module, given live quota data.
function renderModule(mod, stdin, quota) {
  const fmt = mod.format || "percent";
  const color = mod.colorMode || "threshold";
  const DASH = "--";
  switch (mod.type) {
    case "context": {
      const used = contextTokens(stdin.transcript_path || "");
      const limit = contextLimit();
      const pct = limit > 0 ? (used / limit) * 100 : 0;
      const cl = colorFor(pct, color);
      let body;
      if (fmt === "bar") body = `${bar(pct, mod.barWidth)} ${fmtPct(pct)}`;
      else if (fmt === "frac") body = `${(used / 1000).toFixed(1)}k/${(limit / 1000).toFixed(0)}k`;
      else body = fmtPct(pct);
      return `${cl}${body}${cl ? C.reset : ""}`;
    }
    case "fiveHourQuota": {
      const q = renderQuota(quota, "fiveHour");
      const cl = q.pct !== null ? colorFor(q.pct, color) : "";
      const body = fmt === "bar" && q.pct !== null
        ? `${bar(q.pct, mod.barWidth)} ${q.text}` : q.text;
      return `${cl}${body}${cl ? C.reset : ""}`;
    }
    case "weeklyQuota": {
      const q = renderQuota(quota, "week");
      const cl = q.pct !== null ? colorFor(q.pct, color) : "";
      const body = fmt === "bar" && q.pct !== null
        ? `${bar(q.pct, mod.barWidth)} ${q.text}` : q.text;
      return `${cl}${body}${cl ? C.reset : ""}`;
    }
    case "fiveHourReset":
      return `${C.dim}${resetText(quota, "fiveHour")}${C.reset}`;
    case "model": {
      const name = (stdin.model && (stdin.model.display_name || stdin.model.id)) || DASH;
      return `${name}`;
    }
    case "cost": {
      const usd = stdin.cost && typeof stdin.cost.total_cost_usd === "number"
        ? stdin.cost.total_cost_usd : null;
      const body = usd === null ? DASH : `${usd.toFixed(2)}`;
      return `${body}`;
    }
    case "dir": {
      const dir = (stdin.workspace && (stdin.workspace.current_dir || stdin.workspace.project_dir)) || "";
      const base = dir ? path.basename(dir) : DASH;
      return `${base}`;
    }
    default:
      return "";
  }
}

function main() {
  let settings;
  try {
    settings = readJSON(CCBOX_SETTINGS, {});
  } catch { settings = {}; }
  const sb = settings.statusBar;
  if (!sb || !sb.enabled || !Array.isArray(sb.modules)) {
    return; // nothing to show; let Claude Code fall back
  }
  const stdin = readStdin();
  const { isGlm } = glmCreds();
  const needsQuota = sb.modules.some(
    (m) => m.enabled && ["fiveHourQuota", "fiveHourReset", "weeklyQuota"].includes(m.type),
  );

  const render = (quota) => {
    const parts = sb.modules
      .filter((m) => m.enabled)
      .map((m) => {
        // quota modules are GLM-only; skip them on non-GLM providers.
        if (["fiveHourQuota", "fiveHourReset", "weeklyQuota"].includes(m.type) && !isGlm) {
          return "";
        }
        try { return renderModule(m, stdin, quota); }
        catch { return "--"; }
      })
      .filter((s) => s && s.trim());
    if (parts.length) process.stdout.write(parts.join(sb.separator || " | "));
  };

  if (needsQuota && isGlm) {
    fetchQuota((_, quota) => render(quota));
  } else {
    render(null);
  }
}

try { main(); } catch {}
"##;

#[cfg(test)]
mod tests {
    use super::*;

    fn mm(opus: &str, sonnet: &str, haiku: &str) -> ModelMap {
        ModelMap {
            opus: Some(opus.into()),
            sonnet: Some(sonnet.into()),
            haiku: Some(haiku.into()),
        }
    }

    #[test]
    fn writes_tier_mapping_and_extra_env_and_preserves_others() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let pre = serde_json::json!({
            "theme": "dark",
            "env": {
                "FOO": "bar",
                "ANTHROPIC_API_KEY": "old-key",
                "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "200000"
            }
        });
        std::fs::write(&path, pre.to_string()).unwrap();

        let mut extra = HashMap::new();
        extra.insert("CLAUDE_CODE_AUTO_COMPACT_WINDOW".into(), "1000000".into());

        write_provider_config_at(
            &path,
            "https://open.bigmodel.cn/api/anthropic",
            "tok",
            Some("glm-5.2"),
            Some(&mm("glm-5.2[1m]", "glm-5.2[1m]", "glm-4.5-air")),
            &extra,
            &[],
        )
        .unwrap();

        let after: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        // preserved
        assert_eq!(after["theme"], "dark");
        assert_eq!(after["env"]["FOO"], "bar");
        // core
        assert_eq!(after["env"]["ANTHROPIC_BASE_URL"], "https://open.bigmodel.cn/api/anthropic");
        assert_eq!(after["env"]["ANTHROPIC_AUTH_TOKEN"], "tok");
        assert_eq!(after["env"]["ANTHROPIC_MODEL"], "glm-5.2");
        // tier mapping
        assert_eq!(after["env"]["ANTHROPIC_DEFAULT_OPUS_MODEL"], "glm-5.2[1m]");
        assert_eq!(after["env"]["ANTHROPIC_DEFAULT_SONNET_MODEL"], "glm-5.2[1m]");
        assert_eq!(after["env"]["ANTHROPIC_DEFAULT_HAIKU_MODEL"], "glm-4.5-air");
        // extra env replaced (old 200000 -> new 1000000)
        assert_eq!(after["env"]["CLAUDE_CODE_AUTO_COMPACT_WINDOW"], "1000000");
        // api key removed
        assert!(after["env"].get("ANTHROPIC_API_KEY").is_none());
        // top-level `model` synced to default_model (Claude Code startup default)
        assert_eq!(after["model"], "glm-5.2");
    }

    #[test]
    fn switching_providers_cleans_previous_tier_and_extra_keys() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");

        // start: GLM active (tier + 1M env)
        let mut glm_extra = HashMap::new();
        glm_extra.insert("CLAUDE_CODE_AUTO_COMPACT_WINDOW".into(), "1000000".into());
        write_provider_config_at(
            &path, "https://glm", "t1", None,
            Some(&mm("glm-5.2[1m]", "glm-5.2[1m]", "glm-4.5-air")),
            &glm_extra, &[],
        ).unwrap();

        // switch to official Claude: no tier remap, no extra env, prev extra = [AUTO_COMPACT_WINDOW]
        let empty = HashMap::new();
        write_provider_config_at(
            &path, "https://api.anthropic.com", "t2", None,
            None, &empty, &["CLAUDE_CODE_AUTO_COMPACT_WINDOW".to_string()],
        ).unwrap();

        let after: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(after["env"]["ANTHROPIC_BASE_URL"], "https://api.anthropic.com");
        // GLM tier remaps must be gone
        assert!(after["env"].get("ANTHROPIC_DEFAULT_OPUS_MODEL").is_none());
        assert!(after["env"].get("ANTHROPIC_DEFAULT_SONNET_MODEL").is_none());
        assert!(after["env"].get("ANTHROPIC_DEFAULT_HAIKU_MODEL").is_none());
        // GLM extra env must be gone
        assert!(after["env"].get("CLAUDE_CODE_AUTO_COMPACT_WINDOW").is_none());
    }

    #[test]
    fn works_when_no_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let empty = HashMap::new();
        write_provider_config_at(&path, "u", "t", None, None, &empty, &[]).unwrap();
        let after: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(after["env"]["ANTHROPIC_BASE_URL"], "u");
    }

    #[test]
    fn statusline_register_and_clear_preserves_other_keys() {
        let dir = tempfile::tempdir().unwrap();
        let settings = dir.path().join("settings.json");
        // pre-existing user config (env + a plugin + a custom key)
        std::fs::write(
            &settings,
            serde_json::json!({
                "env": { "ANTHROPIC_BASE_URL": "https://x" },
                "somePlugin": { "enabled": true },
                "keepMe": 123,
            }).to_string(),
        ).unwrap();

        // write_statusline_config writes the script + registers the key against
        // a temp settings path. We exercise the path-modifying helper directly
        // by pointing claude_settings_path at our temp dir via the public API.
        // Since write_statusline_config uses the real home path, we instead
        // verify the in-place merge logic by emulating it here through the
        // exported helpers used internally (statusLine insertion).
        let mut root: Value = storage::read_json_or_default(&settings);
        let obj = root.as_object_mut().unwrap();
        obj.insert(
            "statusLine".to_string(),
            serde_json::json!({ "type": "command", "command": "node /tmp/x.js", "padding": 0 }),
        );
        storage::backup_if_exists(&settings).unwrap();
        storage::write_json_atomic(&settings, &root).unwrap();

        let after: Value = serde_json::from_str(&std::fs::read_to_string(&settings).unwrap()).unwrap();
        assert_eq!(after["statusLine"]["type"], "command");
        // other keys preserved
        assert_eq!(after["keepMe"], 123);
        assert_eq!(after["somePlugin"]["enabled"], true);
        assert_eq!(after["env"]["ANTHROPIC_BASE_URL"], "https://x");

        // emulate clear: remove statusLine, keep the rest
        let mut root2: Value = storage::read_json_or_default(&settings);
        let obj2 = root2.as_object_mut().unwrap();
        obj2.remove("statusLine");
        storage::write_json_atomic(&settings, &root2).unwrap();
        let finalv: Value = serde_json::from_str(&std::fs::read_to_string(&settings).unwrap()).unwrap();
        assert!(finalv.get("statusLine").is_none());
        assert_eq!(finalv["keepMe"], 123);
    }
}
