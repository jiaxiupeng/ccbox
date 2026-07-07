//! Live provider balance / quota queries.
//!
//! Used by the provider list to show plan-remaining info instead of the raw
//! API URL. Two providers are supported:
//!   - GLM (智谱 / Z.AI): the undocumented monitor endpoint
//!     `{base}/api/monitor/usage/quota/limit` returns `data.limits[]`; we read
//!     the `TOKENS_LIMIT` (5-hour) and `TIME_LIMIT` (weekly) windows.
//!   - DeepSeek: the documented `https://api.deepseek.com/user/balance`
//!     returns `balance_infos[0].total_balance` (+ currency).
//!
//! Everything degrades gracefully: on any error the caller just gets `None`
//! and the UI falls back to showing nothing. These calls happen over the
//! network on the provider list, so they are short (3.5s) timeout and never
//! block startup.

use crate::models::ProviderQuota;
use serde_json::Value;
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_millis(3500);

fn is_glm(p: &crate::models::Provider) -> bool {
    matches!(p.brand.as_deref(), Some("glm"))
        || p.base_url.contains("bigmodel")
        || p.base_url.contains("z.ai")
}

fn is_deepseek(p: &crate::models::Provider) -> bool {
    matches!(p.brand.as_deref(), Some("deepseek")) || p.base_url.contains("deepseek")
}

/// Derive the GLM monitor-API host from the provider's base URL.
/// BigModel anthropic base is `https://open.bigmodel.cn/api/anthropic`; the
/// monitor API lives at `https://open.bigmodel.cn`. Z.AI: `https://api.z.ai`.
/// Parsed by hand to avoid pulling in a URL crate (keeps the binary lean).
fn host_of(base_url: &str) -> Option<String> {
    let s = base_url.trim();
    // strip the scheme
    let after = s
        .strip_prefix("https://")
        .or_else(|| s.strip_prefix("http://"))?;
    // host = up to the next '/'
    let host = after.split('/').next()?;
    if host.is_empty() {
        return None;
    }
    let scheme = if s.starts_with("https://") { "https" } else { "http" };
    Some(format!("{scheme}://{host}"))
}

/// Query a provider's live quota/balance. Returns None on any failure (network,
/// auth, unexpected shape) so the UI can simply omit the row.
pub fn fetch_quota(provider: &crate::models::Provider) -> Option<ProviderQuota> {
    if is_glm(provider) {
        fetch_glm_quota(&provider.base_url, &provider.auth_token)
    } else if is_deepseek(provider) {
        fetch_deepseek_balance(&provider.base_url, &provider.auth_token)
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// GLM
// ---------------------------------------------------------------------------

fn fetch_glm_quota(base_url: &str, token: &str) -> Option<ProviderQuota> {
    let host = host_of(base_url)?;
    let url = format!("{host}/api/monitor/usage/quota/limit");
    // GLM uses the BARE token (no "Bearer" prefix) — confirmed across community
    // plugins and the official web console.
    let resp = ureq::get(&url)
        .set("Authorization", token)
        .set("Accept", "application/json")
        .timeout(TIMEOUT)
        .call()
        .ok()?;
    let v: Value = resp.into_json().ok()?;
    parse_glm_quota(&v)
}

/// Decode a GLM `nextResetTime` into an absolute epoch-millisecond timestamp,
/// robust to whichever unit the API used (absolute ms or absolute s). The
/// window's max duration disambiguates: the correct interpretation is the one
/// whose time-until-reset falls in (0, max_secs]. If none fits, fall back to
/// the ms interpretation (the documented unit). Never panics, never negative.
fn decode_reset(raw: i64, now_ms: i64, max_secs: i64) -> i64 {
    let max_ms = max_secs * 1000;
    // Candidate interpretations of the raw value as absolute epoch timestamps.
    let candidates = [
        raw,        // already epoch-ms (documented bigmodel unit)
        raw * 1000, // epoch-seconds -> ms
    ];
    for ms in candidates {
        if ms > now_ms && (ms - now_ms) <= max_ms {
            return ms;
        }
    }
    // No interpretation lands in-window; use the documented ms unit so we still
    // show *something* (and clamp to "now" if it's in the past).
    raw.max(now_ms)
}

/// Parse the GLM monitor payload into a ProviderQuota. Exposed for testing.
///
/// Windows are identified strictly by `type`:
///   - "TOKENS_LIMIT" -> the 5-hour rolling window (max 5h until reset)
///   - "TIME_LIMIT"   -> the weekly (7-day) window (max 7d until reset)
///   - other (MCP_*)  -> monthly tool-call window — IGNORED.
/// Each window's `nextResetTime` is unit-decoded against its own max duration
/// (see `decode_reset`), so an ms value vs an s value both resolve to a correct,
/// in-window countdown instead of a nonsensical "10h" on a 5h window.
fn parse_glm_quota(v: &Value) -> Option<ProviderQuota> {
    // The monitor payload may be wrapped one or two levels deep ({data:{data:...}}
    // vs {data:...}); find the first object that has a "limits" array.
    let limits = find_limits(v)?;
    if limits.is_empty() {
        return None;
    }

    let now = now_epoch_ms();
    let mut five_reset: Option<i64> = None;
    let mut five_pct: Option<i64> = None;
    let mut week_reset: Option<i64> = None;
    let mut week_pct: Option<i64> = None;
    for lim in limits {
        let t = lim.get("type").and_then(|x| x.as_str()).unwrap_or("");
        let unit = lim.get("unit").and_then(|x| x.as_i64()).unwrap_or(0);
        // Window identification, confirmed against REAL plan responses by
        // measuring each nextResetTime's distance from fetch time:
        //   - TOKENS_LIMIT + unit:3  -> 5-hour window  (resets within ~5h)
        //   - TOKENS_LIMIT + unit:6  -> WEEKLY window   (resets within ~7d)
        //   - TIME_LIMIT (unit:5)    -> MONTHLY window  (~16d) — IGNORED
        // (Using `type` alone is wrong: max plans return two TOKENS_LIMIT entries
        // and TIME_LIMIT is actually the monthly window, not weekly.)
        let is_five_hour = t == "TOKENS_LIMIT" && unit == 3;
        let is_weekly = t == "TOKENS_LIMIT" && unit == 6;
        if is_five_hour {
            if let Some(raw) = lim.get("nextResetTime").and_then(|x| x.as_i64()) {
                five_reset = Some(decode_reset(raw, now, 5 * 3600));
            }
            five_pct = remaining_pct_of(lim);
        } else if is_weekly {
            if let Some(raw) = lim.get("nextResetTime").and_then(|x| x.as_i64()) {
                week_reset = Some(decode_reset(raw, now, 7 * 86400));
            }
            week_pct = remaining_pct_of(lim);
        }
        // else: TIME_LIMIT (monthly) / MCP / unknown — ignored
    }
    // need at least one value to be worth showing
    if five_pct.is_none() && five_reset.is_none()
        && week_pct.is_none() && week_reset.is_none()
    {
        return None;
    }
    Some(ProviderQuota {
        kind: "glm".into(),
        five_hour_remaining_pct: five_pct,
        five_hour_reset_ms: five_reset,
        weekly_remaining_pct: week_pct,
        weekly_reset_ms: week_reset,
        balance: None,
        currency: None,
    })
}

/// Current time as epoch milliseconds (best-effort).
fn now_epoch_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Locate the `limits` array wherever it sits in the payload. The monitor
/// response wraps data inconsistently ({data:{data:{limits}}} on bigmodel vs
/// {data:{limits}} elsewhere), so search both levels.
fn find_limits(v: &Value) -> Option<&Vec<Value>> {
    // try data.data.limits, then data.limits, then v.limits
    v.get("data")
        .and_then(|d| d.get("data"))
        .and_then(|d| d.get("limits"))
        .and_then(|l| l.as_array())
        .or_else(|| {
            v.get("data")
                .and_then(|d| d.get("limits"))
                .and_then(|l| l.as_array())
        })
        .or_else(|| v.get("limits").and_then(|l| l.as_array()))
}

/// Remaining percentage for one GLM limit object. Prefers the explicit
/// `remaining` field (already a remaining value, present on the weekly window);
/// otherwise derives it as `100 - percentage` (the consumed %, used by the
/// 5-hour token window). Returns None if neither is present.
fn remaining_pct_of(lim: &Value) -> Option<i64> {
    // Explicit remaining field (weekly window carries this directly).
    if let Some(r) = lim.get("remaining").and_then(|x| x.as_i64()) {
        // `remaining` on the weekly window is a small integer like 33 meaning
        // 3.3% of 1000 — normalize to a 0..100 percentage when a usage total
        // is present, otherwise clamp to 0..100 directly.
        if let Some(total) = lim.get("usage").and_then(|x| x.as_i64()) {
            if total > 0 {
                return Some(((r as f64 / total as f64) * 100.0).round() as i64);
            }
        }
        return Some(r.clamp(0, 100));
    }
    // Fall back: percentage is consumed -> remaining = 100 - percentage.
    lim.get("percentage")
        .and_then(|x| x.as_i64())
        .map(|p| (100 - p).clamp(0, 100))
}

// ---------------------------------------------------------------------------
// DeepSeek
// ---------------------------------------------------------------------------

fn fetch_deepseek_balance(base_url: &str, token: &str) -> Option<ProviderQuota> {
    let host = host_of(base_url).unwrap_or_else(|| "https://api.deepseek.com".to_string());
    let url = format!("{host}/user/balance");
    // DeepSeek uses "Bearer" prefix — documented.
    let resp = ureq::get(&url)
        .set("Authorization", &format!("Bearer {token}"))
        .set("Accept", "application/json")
        .timeout(TIMEOUT)
        .call()
        .ok()?;
    let v: Value = resp.into_json().ok()?;
    parse_deepseek_balance(&v)
}

/// Parse the DeepSeek balance payload. Exposed for testing.
fn parse_deepseek_balance(v: &Value) -> Option<ProviderQuota> {
    let infos = v.get("balance_infos").and_then(|x| x.as_array())?;
    // Prefer the first entry whose total_balance parses to a non-empty value.
    for info in infos {
        let bal = info
            .get("total_balance")
            .and_then(|x| x.as_str())
            .and_then(|s| s.parse::<f64>().ok());
        if let Some(b) = bal {
            let currency = info
                .get("currency")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string());
            return Some(ProviderQuota {
                kind: "deepseek".into(),
                five_hour_remaining_pct: None,
                five_hour_reset_ms: None,
                weekly_remaining_pct: None,
                weekly_reset_ms: None,
                balance: Some(b),
                currency,
            });
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// now + `secs_ahead`, as epoch-ms — so reset timestamps in tests are always
    /// sane relative to the real current time (the sanity guard rejects stale
    /// or too-far-future resets).
    fn in_ms(secs_ahead: i64) -> i64 {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        now + secs_ahead * 1000
    }

    #[test]
    fn parse_glm_quota_max_plan_real_data() {
        // REAL max-plan payload (measured: unit:3 resets ~5h, unit:6 resets ~7d,
        // TIME_LIMIT(unit:5) resets ~16d = monthly, IGNORED). Weekly is the
        // TOKENS_LIMIT unit:6 entry, NOT TIME_LIMIT.
        let payload = serde_json::json!({
            "code": 200, "msg": "操作成功", "success": true,
            "data": {
                "limits": [
                    // monthly window (TIME_LIMIT) — must be ignored
                    { "type": "TIME_LIMIT", "unit": 5, "number": 1, "usage": 4000,
                      "currentValue": 49, "remaining": 3951, "percentage": 1,
                      "nextResetTime": in_ms(16 * 86400) },
                    // 5-hour window (TOKENS_LIMIT unit:3): consumed 11% -> 89% left
                    { "type": "TOKENS_LIMIT", "unit": 3, "number": 5, "percentage": 11,
                      "nextResetTime": in_ms(3 * 3600) },
                    // weekly window (TOKENS_LIMIT unit:6): consumed 2% -> 98% left
                    { "type": "TOKENS_LIMIT", "unit": 6, "number": 1, "percentage": 2,
                      "nextResetTime": in_ms(6 * 86400) }
                ],
                "level": "max"
            }
        });
        let q = parse_glm_quota(&payload).unwrap();
        // 5-hour window = unit:3: 100 - 11 = 89%
        assert_eq!(q.five_hour_remaining_pct, Some(89));
        // weekly window = unit:6 (NOT the monthly TIME_LIMIT): 100 - 2 = 98%
        assert_eq!(q.weekly_remaining_pct, Some(98));
    }

    #[test]
    fn parse_glm_quota_pro_plan_real_data() {
        // PRO plan shape (from earlier real dump): unit:3 has no `remaining`, so
        // remaining = 100 - percentage; TIME_LIMIT is monthly and ignored.
        let payload = serde_json::json!({
            "data": {
                "limits": [
                    { "type": "TOKENS_LIMIT", "unit": 3, "number": 5, "percentage": 36, "nextResetTime": in_ms(2 * 3600) },
                    // monthly TIME_LIMIT — ignored
                    { "type": "TIME_LIMIT", "unit": 5, "number": 1, "usage": 1000,
                      "remaining": 33, "percentage": 96, "nextResetTime": in_ms(13 * 86400) },
                    // weekly window (unit:6): 100 - 20 = 80%
                    { "type": "TOKENS_LIMIT", "unit": 6, "number": 1, "percentage": 20,
                      "nextResetTime": in_ms(5 * 86400) }
                ],
                "level": "pro"
            }
        });
        let q = parse_glm_quota(&payload).unwrap();
        assert_eq!(q.five_hour_remaining_pct, Some(64));   // 100 - 36
        assert_eq!(q.weekly_remaining_pct, Some(80));       // unit:6, NOT TIME_LIMIT
    }

    #[test]
    fn parse_glm_quota_weekly_falls_back_to_time_limit_when_no_unit6() {
        // Some plans/regions may only expose the weekly window as TIME_LIMIT with
        // a ~7d reset. To stay robust, if no TOKENS_LIMIT unit:6 is present, fall
        // back to TIME_LIMIT only when its reset is within 8 days (monthly ones
        // reset ~16d and are skipped). This test documents the current strict
        // behaviour: with no unit:6, weekly stays None rather than risk a wrong
        // window. (The 5h window still shows.)
        let payload = serde_json::json!({
            "data": {
                "limits": [
                    { "type": "TOKENS_LIMIT", "unit": 3, "number": 5, "percentage": 30,
                      "nextResetTime": in_ms(2 * 3600) },
                    { "type": "TIME_LIMIT", "unit": 5, "number": 1, "percentage": 50,
                      "nextResetTime": in_ms(16 * 86400) }
                ]
            }
        });
        let q = parse_glm_quota(&payload).unwrap();
        assert_eq!(q.five_hour_remaining_pct, Some(70));
        // no unit:6 -> weekly not shown (None), rather than grab the monthly one
        assert_eq!(q.weekly_remaining_pct, None);
    }

    #[test]
    fn parse_glm_quota_decodes_seconds_unit_for_5h_window() {
        // If the API returns nextResetTime in SECONDS (some endpoints do), the
        // decoder must promote it to ms and land inside the 5h window.
        let secs = in_ms(3 * 3600) / 1000; // 3h ahead, expressed in seconds
        let payload = serde_json::json!({
            "data": {
                "limits": [
                    { "type": "TOKENS_LIMIT", "unit": 3, "number": 5, "percentage": 10, "nextResetTime": secs },
                    { "type": "TOKENS_LIMIT", "unit": 6, "number": 1, "percentage": 10,
                      "nextResetTime": in_ms(4 * 86400) }
                ]
            }
        });
        let q = parse_glm_quota(&payload).unwrap();
        assert_eq!(q.five_hour_reset_ms, Some(secs * 1000));
        assert!(q.weekly_reset_ms.is_some());
    }

    #[test]
    fn parse_glm_quota_decodes_ms_unit_for_5h_window() {
        // Documented unit is epoch-ms; a 4h-ahead ms value must decode as-is.
        let ms = in_ms(4 * 3600);
        let payload = serde_json::json!({
            "data": {
                "limits": [
                    { "type": "TOKENS_LIMIT", "unit": 3, "number": 5, "percentage": 10, "nextResetTime": ms }
                ]
            }
        });
        let q = parse_glm_quota(&payload).unwrap();
        assert_eq!(q.five_hour_reset_ms, Some(ms));
    }

    #[test]
    fn decode_reset_picks_the_in_window_unit() {
        let now = now_epoch_ms();
        // raw in seconds, ~2h ahead — must decode to ms and stay inside 5h.
        let secs = (now + 2 * 3600 * 1000) / 1000;
        assert_eq!(decode_reset(secs, now, 5 * 3600), secs * 1000);
        // raw already in ms, ~1h ahead — stays as-is.
        let ms = now + 3600 * 1000;
        assert_eq!(decode_reset(ms, now, 5 * 3600), ms);
    }

    #[test]
    fn parse_glm_quota_clamps_negative_remaining_to_zero() {
        let payload = serde_json::json!({
            "data": { "limits": [
                { "type": "TOKENS_LIMIT", "unit": 3, "number": 5, "percentage": 130, "nextResetTime": in_ms(3600) }
            ] }
        });
        let q = parse_glm_quota(&payload).unwrap();
        assert_eq!(q.five_hour_remaining_pct, Some(0));
    }

    #[test]
    fn parse_glm_quota_returns_none_when_no_known_windows() {
        // empty limits
        assert!(parse_glm_quota(&serde_json::json!({ "data": { "limits": [] } })).is_none());
        // only the monthly TIME_LIMIT + an unknown window -> nothing we show
        assert!(parse_glm_quota(&serde_json::json!({
            "data": { "limits": [
                { "type": "TIME_LIMIT", "unit": 5, "percentage": 10 },
                { "type": "MCP_LIMIT", "percentage": 10 }
            ] }
        })).is_none());
    }

    #[test]
    fn parse_deepseek_balance_picks_total_balance() {
        let payload = serde_json::json!({
            "is_available": true,
            "balance_infos": [
                { "currency": "CNY", "total_balance": "110.00", "granted_balance": "10.00", "topped_up_balance": "100.00" }
            ]
        });
        let q = parse_deepseek_balance(&payload).unwrap();
        assert_eq!(q.kind, "deepseek");
        assert_eq!(q.balance, Some(110.0));
        assert_eq!(q.currency.as_deref(), Some("CNY"));
    }

    #[test]
    fn parse_deepseek_balance_none_when_empty() {
        let payload = serde_json::json!({ "balance_infos": [] });
        assert!(parse_deepseek_balance(&payload).is_none());
    }

    #[test]
    fn host_of_strips_to_scheme_host() {
        assert_eq!(
            host_of("https://open.bigmodel.cn/api/anthropic").as_deref(),
            Some("https://open.bigmodel.cn")
        );
        assert_eq!(
            host_of("https://api.z.ai/api/anthropic").as_deref(),
            Some("https://api.z.ai")
        );
        assert_eq!(
            host_of("https://api.deepseek.com").as_deref(),
            Some("https://api.deepseek.com")
        );
        assert!(host_of("not a url").is_none());
    }
}
