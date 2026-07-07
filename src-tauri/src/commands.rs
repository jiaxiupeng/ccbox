use crate::claude_config_writer;
use crate::models::{
    ActiveProviderInfo, AppSettings, ModelPricing, Provider, ProviderQuota, TestResult, UsageReport,
};
use crate::presets;
use crate::provider_quota;
use crate::state::AppState;
use crate::storage;
use crate::usage_service;
use serde_json::Value;
use std::collections::HashMap;
use tauri::State;

/// True iff the provider should be treated as GLM (智谱 / Z.AI). Matches the
/// heuristic used by the 1M-context auto-config in apply_switch.
pub fn is_glm_provider(p: &Provider) -> bool {
    matches!(p.brand.as_deref(), Some("glm"))
        || p.base_url.contains("bigmodel")
        || p.base_url.contains("z.ai")
}

/// Core switch logic, callable both from the Tauri command layer and the tray
/// menu handler. Writes the provider's full config (base url / token / default
/// model / opus-sonnet-haiku tier mapping / extra env) to ~/.claude/settings.json,
/// cleaning up the previous provider's managed keys, and marks it active.
pub fn apply_switch(state: &AppState, id: &str) -> anyhow::Result<Provider> {
    let svc = state.providers();
    let file = svc.load();
    let prev_extra_keys = file.active_extra_keys.clone();
    let p = file
        .providers
        .into_iter()
        .find(|x| x.id == id)
        .ok_or_else(|| anyhow::anyhow!("provider not found: {}", id))?;

    // Smart 1M: for GLM providers, if any tier model carries a `[1m]` suffix,
    // auto-add the long-context compaction window env.
    let is_glm = is_glm_provider(&p);
    let has_1m = p.model_map.as_ref().is_some_and(|mm| {
        [mm.opus.as_deref(), mm.sonnet.as_deref(), mm.haiku.as_deref()]
            .iter()
            .any(|v| v.is_some_and(|s| s.contains("[1m]")))
    });
    let mut extra = p.extra_env.clone();
    if is_glm && has_1m {
        extra.insert(
            "CLAUDE_CODE_AUTO_COMPACT_WINDOW".into(),
            "1000000".into(),
        );
    }

    claude_config_writer::write_provider_config(
        &p.base_url,
        &p.auth_token,
        p.default_model.as_deref(),
        p.model_map.as_ref(),
        &extra,
        &prev_extra_keys,
    )?;
    let new_extra_keys: Vec<String> = extra.keys().cloned().collect();
    svc.set_active(Some(id), &new_extra_keys)?;

    // The custom statusLine is GLM-only: when switching to a non-GLM provider,
    // unregister it so Claude Code falls back to its default status line. The
    // user's arrangement in ~/.ccbox/settings.json is preserved.
    if !is_glm {
        let _ = claude_config_writer::clear_statusline_config();
    }
    Ok(p)
}

#[tauri::command]
pub fn list_providers(state: State<'_, AppState>) -> Result<Vec<Provider>, String> {
    Ok(state.providers().list())
}

#[tauri::command]
pub fn add_provider(provider: Provider, state: State<'_, AppState>) -> Result<Provider, String> {
    state.providers().add(provider).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_provider(provider: Provider, state: State<'_, AppState>) -> Result<Provider, String> {
    state.providers().update(provider).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_provider(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let prev_extra_keys = state
        .providers()
        .delete(&id)
        .map_err(|e| e.to_string())?;
    // If the deleted provider was active, its env keys linger in
    // ~/.claude/settings.json — clear them so Claude Code doesn't keep using
    // a dead endpoint/token. The new fallback active id is recorded but we do
    // NOT auto-switch (the user may have deleted intentionally).
    if let Some(keys) = prev_extra_keys {
        claude_config_writer::clear_provider_env(&keys).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn switch_provider(id: String, state: State<'_, AppState>) -> Result<Provider, String> {
    apply_switch(state.inner(), &id).map_err(|e| e.to_string())
}

/// Reorder providers in the stored list (drag-to-reorder in the UI). Indices
/// refer to positions in the list the frontend rendered.
#[tauri::command]
pub fn reorder_providers(
    from: usize,
    to: usize,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.providers().reorder(from, to).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_active(state: State<'_, AppState>) -> Result<(), String> {
    let prev = state.providers().load().active_extra_keys.clone();
    state
        .providers()
        .set_active(None, &[])
        .map_err(|e| e.to_string())?;
    claude_config_writer::clear_provider_env(&prev).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_active_id(state: State<'_, AppState>) -> Option<String> {
    state.providers().load().active_id
}

#[tauri::command]
pub fn list_presets() -> Vec<Provider> {
    presets::preset_providers()
}

#[tauri::command]
pub fn get_usage(
    days: Option<u32>,
    project: Option<String>,
    state: State<'_, AppState>,
) -> Result<UsageReport, String> {
    // The full-history scan (days=None, project=None) is the expensive case —
    // memoize it for a short TTL so reopening the usage tab is instant.
    if days.is_none() && project.is_none() {
        if let Some(cached) = state.usage_cached() {
            return Ok(cached);
        }
    }
    let settings = state.load_settings();
    let pricing = merged_pricing(&settings);
    let dir = usage_service::claude_projects_dir().map_err(|e| e.to_string())?;
    let report = usage_service::compute_usage(&dir, &pricing, days, project.as_deref())
        .map_err(|e| e.to_string())?;
    if days.is_none() && project.is_none() {
        state.usage_store(report.clone());
    }
    Ok(report)
}

/// Force a fresh rescan, bypassing the cache. The frontend can call this when
/// the user wants up-to-the-second numbers (e.g. via a refresh button).
#[tauri::command]
pub fn refresh_usage(state: State<'_, AppState>) -> Result<UsageReport, String> {
    state.usage_invalidate();
    get_usage(None, None, state)
}

#[tauri::command]
pub fn test_provider(base_url: String, _token: String) -> Result<TestResult, String> {
    Ok(test_connectivity(&base_url))
}

/// Append a sub-path to a base URL without doubling a trailing `/v1`.
/// Some presets (Qwen, DashScope) end the base URL in `/v1`; Anthropic/GLM do not.
fn join_api_path(base_url: &str, path: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        format!("{}{}", trimmed, path) // path includes leading "/..."
    } else {
        format!("{}/v1{}", trimmed, path)
    }
}

/// Fetch the list of available models from a provider. The model-listing
/// endpoint is non-standard across Anthropic-compatible providers, so we try a
/// few candidate paths derived from the base URL and return the first that
/// yields a `{ "data": [{ "id": ... }] }` payload.
///
/// Sends `Authorization: Bearer` + `x-api-key` + `anthropic-version` so the
/// same call works across Anthropic / GLM / Qwen / Kimi compatible APIs.
#[tauri::command]
pub fn fetch_models(base_url: String, token: String) -> Result<Vec<String>, String> {
    let trimmed = base_url.trim_end_matches('/');
    // Candidate model-listing paths. Anthropic-compatible bases often expose
    // /v1/models; GLM's anthropic base does not, but its OpenAI base
    // (/api/paas/v4/models) does. Build a few variants from the given base.
    let mut candidates: Vec<String> = Vec::new();
    if trimmed.ends_with("/v1") || trimmed.ends_with("/paas/v4") {
        // base already includes the API version segment
        candidates.push(format!("{}/models", trimmed));
    } else if trimmed.ends_with("/anthropic") {
        // Anthropic-compatible bases usually have NO model-list endpoint.
        // Fall back to a few provider-specific OpenAI-compatible shapes:
        let stripped = trimmed.trim_end_matches("/anthropic");
        candidates.push(format!("{}/models", stripped)); // DeepSeek: api.deepseek.com/models
        candidates.push(format!("{}/v1/models", stripped));
        candidates.push(format!("{}/models", trimmed.replace("/anthropic", "/paas/v4"))); // GLM
        candidates.push(format!("{}/v1/models", trimmed)); // last-ditch anthropic/v1/models
    } else {
        candidates.push(format!("{}/v1/models", trimmed));
        candidates.push(format!("{}/models", trimmed));
    }

    let mut last_err = String::from("未尝试任何端点");
    for url in &candidates {
        match fetch_models_at(url, &token) {
            Ok(ids) if !ids.is_empty() => return Ok(ids),
            Ok(_) => last_err = format!("{url} 返回空列表"),
            Err(e) => last_err = e,
        }
    }
    Err(format!(
        "未能获取模型列表（已尝试 {} 个端点）。最后错误：{}",
        candidates.len(),
        last_err
    ))
}

/// Hit one candidate /models URL. Returns Ok(ids) (possibly empty) on HTTP 2xx,
/// or Err(message) including the status + url on failure.
fn fetch_models_at(url: &str, token: &str) -> Result<Vec<String>, String> {
    let resp = ureq::get(url)
        .set("Authorization", &format!("Bearer {}", token))
        .set("x-api-key", token)
        .set("anthropic-version", "2023-06-01")
        .timeout(std::time::Duration::from_secs(10))
        .call();
    match resp {
        Ok(r) => {
            let v: Value = r.into_json().map_err(|e| format!("{url} 解析失败：{e}"))?;
            let ids: Vec<String> = v["data"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|x| x["id"].as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            Ok(ids)
        }
        Err(ureq::Error::Status(code, r)) => {
            let body = r.into_string().unwrap_or_default();
            let short: String = body.chars().take(160).collect();
            Err(format!("HTTP {code} @ {url}：{short}"))
        }
        Err(ureq::Error::Transport(e)) => Err(format!("连接失败 @ {url}：{e}")),
    }
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppSettings {
    state.load_settings()
}

#[tauri::command]
pub fn set_settings(settings: AppSettings, state: State<'_, AppState>) -> Result<(), String> {
    state.save_settings(&settings).map_err(|e| e.to_string())
}

/// Apply the user's statusLine arrangement to the CLI. GLM-only: installs the
/// self-contained Node script to ~/.ccbox/statusline.cjs and registers the
/// `statusLine` key in ~/.claude/settings.json. Returns the active provider
/// name on success. Errors (with a friendly message) if no GLM provider is
/// active, so the frontend can prompt the user to switch first.
#[tauri::command]
pub fn apply_statusbar(state: State<'_, AppState>) -> Result<String, String> {
    let p = state.providers().get_active().ok_or_else(|| {
        "当前没有激活的供应商。请先切换到 GLM 供应商后再应用状态栏。".to_string()
    })?;
    if !is_glm_provider(&p) {
        return Err(format!(
            "状态栏自定义仅适用于 GLM 供应商。当前激活的是「{}」，请先切换到 GLM。",
            p.name
        ));
    }
    claude_config_writer::write_statusline_config().map_err(|e| e.to_string())?;
    Ok(p.name)
}

/// Whether the `statusLine` key is currently registered in settings.json.
/// (The script file may exist, but if the key is absent Claude Code ignores it.)
fn statusline_is_registered() -> bool {
    claude_config_writer::claude_settings_path()
        .ok()
        .and_then(|path| {
            let v: Value = storage::read_json_or_default(&path);
            v.get("statusLine").map(|_| true)
        })
        .unwrap_or(false)
}

/// Summary of the active provider, so the status-bar page can show whether the
/// GLM-only feature is applicable and whether the statusLine is live.
#[tauri::command]
pub fn get_active_provider_info(state: State<'_, AppState>) -> ActiveProviderInfo {
    match state.providers().get_active() {
        Some(p) => {
            let is_glm = is_glm_provider(&p);
            ActiveProviderInfo {
                name: Some(p.name),
                brand: p.brand,
                is_glm,
                statusline_active: statusline_is_registered(),
            }
        }
        None => ActiveProviderInfo {
            name: None,
            brand: None,
            is_glm: false,
            statusline_active: statusline_is_registered(),
        },
    }
}

/// Fetch a provider's live quota/balance for display on its card. GLM returns
/// the 5-hour + weekly remaining windows; DeepSeek returns account balance.
/// Returns None on any failure (network/auth/shape) — the UI then omits the
/// row. Blocking network call, but short timeout (3.5s); the frontend calls
/// this per-card on demand.
#[tauri::command]
pub fn get_provider_quota(provider: Provider) -> Option<ProviderQuota> {
    provider_quota::fetch_quota(&provider)
}

#[tauri::command]
pub fn default_pricing() -> HashMap<String, ModelPricing> {
    presets::default_pricing()
}

fn merged_pricing(settings: &AppSettings) -> HashMap<String, ModelPricing> {
    let mut m = presets::default_pricing();
    for (k, v) in &settings.pricing {
        m.insert(k.clone(), v.clone());
    }
    m
}

/// Return the current ~/.claude/settings.json as pretty JSON with secrets
/// (auth tokens / api keys) masked, for the config preview panel.
#[tauri::command]
pub fn get_claude_settings_preview() -> Result<String, String> {
    let path = claude_config_writer::claude_settings_path().map_err(|e| e.to_string())?;
    let mut v: Value = if path.exists() {
        storage::read_json(&path).unwrap_or(Value::Null)
    } else {
        Value::Null
    };
    if let Some(env) = v.get_mut("env").and_then(|e| e.as_object_mut()) {
        for k in ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"] {
            if let Some(val) = env.get(k).and_then(|x| x.as_str()) {
                env.insert(k.to_string(), Value::String(mask_secret(val)));
            }
        }
    }
    Ok(serde_json::to_string_pretty(&v).unwrap_or_else(|_| "{}".into()))
}

fn mask_secret(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() > 8 {
        let head: String = chars[..4].iter().collect();
        let tail: String = chars[chars.len() - 4..].iter().collect();
        format!("{head}…{tail}")
    } else {
        "••••".into()
    }
}

/// Probe reachability of an Anthropic-compatible endpoint. We don't validate the
/// key (that needs a real /v1/messages call and would spend tokens) — we only
/// confirm the host responds with any HTTP status.
fn test_connectivity(base_url: &str) -> TestResult {
    let url = join_api_path(base_url, "/messages");
    let start = std::time::Instant::now();
    let res = ureq::get(&url)
        .timeout(std::time::Duration::from_secs(8))
        .call();
    let latency_ms = start.elapsed().as_millis() as u64;
    match res {
        Ok(resp) => TestResult {
            ok: true,
            latency_ms,
            message: format!("HTTP {} — 端点可达", resp.status()),
        },
        Err(ureq::Error::Status(code, _)) => TestResult {
            ok: true,
            latency_ms,
            message: format!("HTTP {code} — 端点可达"),
        },
        Err(ureq::Error::Transport(_)) => TestResult {
            ok: false,
            latency_ms,
            message: "连接失败：网络/DNS/端口不可达".into(),
        },
    }
}

/// Get the current Claude Code permission mode. Prefers the value stored in
/// CCBox's own settings (so it survives provider switches); falls back to the
/// value actually present in ~/.claude/settings.json. Returns null if neither
/// has a value.
#[tauri::command]
pub fn get_permission_mode(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let settings = state.load_settings();
    if let Some(mode) = settings.permission_mode {
        return Ok(Some(mode));
    }
    claude_config_writer::read_permission_mode().map_err(|e| e.to_string())
}

/// Set the Claude Code permission mode: writes it to permissions.defaultMode
/// in ~/.claude/settings.json (safe-merge, preserves allow/deny/ask lists)
/// and persists the choice in CCBox's settings so it survives provider switches.
#[tauri::command]
pub fn set_permission_mode(
    mode: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    claude_config_writer::write_permission_mode(&mode).map_err(|e| e.to_string())?;
    let mut settings = state.load_settings();
    settings.permission_mode = Some(mode);
    state.save_settings(&settings).map_err(|e| e.to_string())
}
