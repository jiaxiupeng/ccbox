use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Maps Claude Code's model tiers (opus/sonnet/haiku) to concrete model names
/// from the provider (e.g. opus -> "glm-5.2[1m]"). Written to settings.json as
/// ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL on switch.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelMap {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opus: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sonnet: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub haiku: Option<String>,
}

/// A configured API provider (an instance the user added with a key).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub auth_token: String,
    /// Base model for ANTHROPIC_MODEL (optional; tier mapping usually suffices).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
    /// Available models for this provider (suggestions in the UI).
    #[serde(default)]
    pub models: Vec<String>,
    /// opus/sonnet/haiku -> provider model mapping.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_map: Option<ModelMap>,
    /// Extra env vars to write on switch (e.g. CLAUDE_CODE_AUTO_COMPACT_WINDOW).
    #[serde(default)]
    pub extra_env: HashMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub website_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_color: Option<String>,
    /// Brand key for icon rendering: "claude" | "glm" | "qwen" | "kimi" | "custom".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub brand: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(default)]
    pub is_preset: bool,
    #[serde(default)]
    pub created_at: i64,
}

/// On-disk shape of ~/.ccbox/providers.json
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvidersFile {
    #[serde(default)]
    pub providers: Vec<Provider>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_id: Option<String>,
    /// Extra-env keys written by the currently active provider, tracked so we
    /// can clean them up when switching to a different provider.
    #[serde(default)]
    pub active_extra_keys: Vec<String>,
}

/// Per-model token pricing (price per 1,000,000 tokens), in USD.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPricing {
    pub input_per_m: f64,
    pub output_per_m: f64,
    pub cache_read_per_m: f64,
    pub cache_write_per_m: f64,
}

/// On-disk shape of ~/.ccbox/settings.json (CCBox UI prefs + pricing overrides).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default)]
    pub pricing: HashMap<String, ModelPricing>,
    /// Custom Claude Code statusLine config. Only applied to ~/.claude/settings.json
    /// when the active provider is GLM; the config itself is always stored here
    /// so the user's arrangement survives provider switches.
    #[serde(default)]
    pub status_bar: StatusBarConfig,
}
fn default_theme() -> String {
    "system".to_string()
}

/// One configurable status-bar module. `r#type` identifies the data source
/// (context usage, 5-hour quota, …); the remaining fields control how it renders.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusBarModule {
    /// "context" | "fiveHourQuota" | "fiveHourReset" | "weeklyQuota" |
    /// "model" | "cost" | "dir"
    pub r#type: String,
    pub enabled: bool,
    /// "percent" | "frac" | "bar" | "text" — best-fitting default per type.
    #[serde(default)]
    pub format: String,
    /// Progress-bar width in cells (used when format == "bar"). Default 10.
    #[serde(default = "default_bar_width")]
    pub bar_width: u32,
    /// "static" (no color) | "threshold" (green < 50% < yellow < 80% < red).
    #[serde(default)]
    pub color_mode: String,
}

impl Default for StatusBarModule {
    fn default() -> Self {
        Self {
            r#type: String::new(),
            enabled: true,
            format: String::new(),
            bar_width: default_bar_width(),
            color_mode: "threshold".to_string(),
        }
    }
}

fn default_bar_width() -> u32 {
    10
}

/// User's statusLine arrangement. Stored inside AppSettings and read live by
/// the installed Node statusline script, so changes take effect without a
/// re-apply (re-apply only (re)installs the script + registers the key).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusBarConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_separator")]
    pub separator: String,
    #[serde(default = "default_status_modules")]
    pub modules: Vec<StatusBarModule>,
}

impl Default for StatusBarConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            separator: default_separator(),
            modules: default_status_modules(),
        }
    }
}

fn default_separator() -> String {
    " | ".to_string()
}

/// Default arrangement: context + 5h quota + 5h reset enabled, the rest
/// present-but-disabled so the user can drag them in from the pool.
fn default_status_modules() -> Vec<StatusBarModule> {
    let mk = |t: &str, format: &str, enabled: bool| StatusBarModule {
        r#type: t.to_string(),
        enabled,
        format: format.to_string(),
        bar_width: default_bar_width(),
        color_mode: "threshold".to_string(),
    };
    vec![
        mk("context", "percent", true),
        mk("fiveHourQuota", "percent", true),
        mk("fiveHourReset", "text", true),
        mk("weeklyQuota", "percent", false),
        mk("model", "text", false),
        mk("cost", "text", false),
        mk("dir", "text", false),
    ]
}

/// Aggregated usage report returned to the frontend.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageReport {
    pub total_input: u64,
    pub total_output: u64,
    pub total_cache_read: u64,
    pub total_cache_write: u64,
    pub total_cost: f64,
    pub total_requests: u64,
    pub total_sessions: u64,
    pub by_model: Vec<ModelUsage>,
    pub by_day: Vec<DayUsage>,
    /// Per-model daily breakdown: model name -> [daily usage for that model].
    /// Lets the frontend filter the model table by day/week/month/all.
    #[serde(default)]
    pub by_model_day: HashMap<String, Vec<DayUsage>>,
    /// Hourly breakdown for the most recent active day (24 buckets, 0..23).
    /// Used by the frontend "天" (day) view of the trend chart.
    pub by_hour: Vec<HourUsage>,
    /// Which calendar date `by_hour` belongs to (None if no data).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hour_date: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub model: String,
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub requests: u64,
    pub cost: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayUsage {
    pub date: String,
    pub tokens: u64,
    pub cost: f64,
}

/// One hour bucket (0..23) of token usage for a single day.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HourUsage {
    pub hour: u32,
    pub tokens: u64,
    pub cost: f64,
}

/// Result of a provider connectivity test.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub ok: bool,
    pub latency_ms: u64,
    pub message: String,
}

/// Summary of the currently active provider, for the status-bar page to decide
/// whether the GLM-only statusLine feature is applicable.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveProviderInfo {
    /// None when no provider is active.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub brand: Option<String>,
    /// True iff the active provider is GLM (brand or base URL heuristic).
    pub is_glm: bool,
    /// Whether statusLine is currently registered in ~/.claude/settings.json.
    pub statusline_active: bool,
}

/// Live quota/balance for a provider, shown on the provider card instead of
/// the raw API URL. GLM fills the percentage/reset fields; DeepSeek fills the
/// balance/currency fields. Fields are optional because any single window may
/// be absent from the API response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderQuota {
    /// "glm" | "deepseek"
    pub kind: String,
    /// Remaining percentage of the 5-hour window (0..100). None if unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub five_hour_remaining_pct: Option<i64>,
    /// Epoch-millis timestamp when the 5-hour window resets.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub five_hour_reset_ms: Option<i64>,
    /// Remaining percentage of the weekly window (0..100).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weekly_remaining_pct: Option<i64>,
    /// Epoch-millis timestamp when the weekly window resets.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weekly_reset_ms: Option<i64>,
    /// Account balance (DeepSeek). Numeric.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub balance: Option<f64>,
    /// Balance currency code, e.g. "CNY" / "USD".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
}
