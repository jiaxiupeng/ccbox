use crate::models::{DayUsage, HourUsage, ModelPricing, ModelUsage, UsageReport};
use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// `~/.claude/projects` — where Claude Code writes per-session JSONL logs.
pub fn claude_projects_dir() -> anyhow::Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("home dir not found"))?;
    Ok(home.join(".claude").join("projects"))
}

/// Scan Claude Code session logs and aggregate token usage / cost.
///
/// - `projects_dir`: pass the real `~/.claude/projects` in production, or a temp
///   dir in tests.
/// - `pricing`: merged pricing map (defaults + user overrides).
/// - `days`: if Some(n), only include log lines dated within the last n days.
/// - `project_filter`: if Some(s), only scan paths containing s (substring).
pub fn compute_usage(
    projects_dir: &Path,
    pricing: &HashMap<String, ModelPricing>,
    days: Option<u32>,
    project_filter: Option<&str>,
) -> anyhow::Result<UsageReport> {
    let mut by_model: HashMap<String, ModelUsage> = HashMap::new();
    let mut by_day: HashMap<String, DayUsage> = HashMap::new();
    let mut by_hour: HourMap = HashMap::new();
    // model -> (date -> DayUsage accumulator)
    let mut by_model_day: HashMap<String, HashMap<String, DayUsage>> = HashMap::new();
    let mut report = UsageReport::default();

    if !projects_dir.exists() {
        return Ok(report);
    }

    let mut files: Vec<PathBuf> = Vec::new();
    walk_jsonl(projects_dir, &mut files);

    let cutoff = days.map(cutoff_date);

    for f in files {
        if let Some(filt) = project_filter {
            if !f.to_string_lossy().contains(filt) {
                continue;
            }
        }
        let Ok(content) = fs::read_to_string(&f) else {
            continue;
        };
        // each session file = one Claude Code conversation
        report.total_sessions += 1;
        // Dedup usage by message.id WITHIN this file: Claude Code writes one
        // usage block per content chunk for the same API response id.
        let mut seen_msg_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let parsed: LogLine = match serde_json::from_str(line) {
                Ok(v) => v,
                Err(_) => continue, // skip non-message / malformed lines
            };
            let Some(msg) = parsed.message else { continue };
            let Some(usage) = msg.usage else { continue };

            let model = msg.model.unwrap_or_else(|| "unknown".to_string());
            // Skip synthetic messages (internal Claude Code bookkeeping, not real API calls).
            if model == "<synthetic>" {
                continue;
            }
            // Dedup: if this API response id was already counted in this session, skip.
            if let Some(id) = &msg.id {
                if !id.is_empty() && !seen_msg_ids.insert(id.clone()) {
                    continue;
                }
            }

            let ts = parsed.timestamp.as_deref().unwrap_or("");
            // Bucket in LOCAL time (UTC+8), not raw UTC.
            let (date, hour) = match local_from_ts(ts) {
                Some(v) => v,
                None => continue,
            };

            if let Some(c) = &cutoff {
                if date.as_str() < c.as_str() {
                    continue;
                }
            }

            let line_cost = line_cost(&usage, lookup_pricing(&model, pricing));

            // by model
            let mu = by_model.entry(model.clone()).or_default();
            mu.model = model.clone();
            mu.input += usage.input_tokens;
            mu.output += usage.output_tokens;
            mu.cache_read += usage.cache_read_input_tokens;
            mu.cache_write += usage.cache_creation_input_tokens;
            mu.requests += 1;
            mu.cost += line_cost;

            // totals
            report.total_input += usage.input_tokens;
            report.total_output += usage.output_tokens;
            report.total_cache_read += usage.cache_read_input_tokens;
            report.total_cache_write += usage.cache_creation_input_tokens;
            report.total_requests += 1;
            report.total_cost += line_cost;

            // by day (local date). `tokens` includes cache_read — ZCode/计费
            // tools count input+output+cache, and cache_read dominates long chats.
            {
                let du = by_day.entry(date.clone()).or_default();
                du.date = date.clone();
                du.tokens += usage.input_tokens
                    + usage.output_tokens
                    + usage.cache_read_input_tokens
                    + usage.cache_creation_input_tokens;
                du.cost += line_cost;

                // by model + day (for period-filterable model table)
                let mday = by_model_day
                    .entry(model.clone())
                    .or_default()
                    .entry(date.clone())
                    .or_default();
                mday.date = date.clone();
                mday.tokens += usage.input_tokens
                    + usage.output_tokens
                    + usage.cache_read_input_tokens
                    + usage.cache_creation_input_tokens;
                mday.cost += line_cost;
            }

            // by hour (local hour): accumulate into the most-recent active day's 24-bucket map
            {
                let entry = by_hour.entry(date.clone()).or_insert_with(|| (date.clone(), [0u64; 24], [0f64; 24]));
                entry.1[hour as usize] += usage.input_tokens
                    + usage.output_tokens
                    + usage.cache_read_input_tokens
                    + usage.cache_creation_input_tokens;
                entry.2[hour as usize] += line_cost;
            }
        }
    }

    let mut models: Vec<ModelUsage> = by_model.into_values().collect();
    models.sort_by(|a, b| b.cost.partial_cmp(&a.cost).unwrap_or(std::cmp::Ordering::Equal));
    report.by_model = models;

    let mut days_v: Vec<DayUsage> = by_day.into_values().collect();
    days_v.sort_by(|a, b| a.date.cmp(&b.date));
    report.by_day = days_v;

    // Flatten model -> date -> usage into model -> sorted Vec<DayUsage>.
    report.by_model_day = by_model_day
        .into_iter()
        .map(|(model, map)| {
            let mut v: Vec<DayUsage> = map.into_values().collect();
            v.sort_by(|a, b| a.date.cmp(&b.date));
            (model, v)
        })
        .collect();

    // The "day" view represents TODAY in local time. Emit today's hourly
    // breakdown even if it's empty (all-zero buckets) — this keeps the day tab
    // honest: if the user did nothing today, it shows nothing today, instead of
    // silently surfacing the most-recent *past* day's numbers as if they were
    // today's. The most-recent past day's hourly split is intentionally dropped.
    let today = today_local();
    let (toks, costs) = by_hour
        .remove(&today)
        .map(|(_, t, c)| (t, c))
        .unwrap_or(([0u64; 24], [0f64; 24]));
    report.hour_date = Some(today);
    report.by_hour = (0..24u32)
        .map(|h| HourUsage {
            hour: h,
            tokens: toks[h as usize],
            cost: costs[h as usize],
        })
        .collect();

    Ok(report)
}

// keyed by date -> (date, token buckets[24], cost buckets[24])
type HourMap = HashMap<String, (String, [u64; 24], [f64; 24])>;

fn line_cost(u: &UsageBlock, p: &ModelPricing) -> f64 {
    let m = 1_000_000.0;
    (u.input_tokens as f64 / m) * p.input_per_m
        + (u.output_tokens as f64 / m) * p.output_per_m
        + (u.cache_read_input_tokens as f64 / m) * p.cache_read_per_m
        + (u.cache_creation_input_tokens as f64 / m) * p.cache_write_per_m
}

/// Exact key, else longest matching prefix key, else "default", else a built-in.
fn lookup_pricing<'a>(model: &str, pricing: &'a HashMap<String, ModelPricing>) -> &'a ModelPricing {
    if let Some(p) = pricing.get(model) {
        return p;
    }
    let mut best: Option<(&str, &ModelPricing)> = None;
    for (k, v) in pricing.iter() {
        if model.starts_with(k) && best.map_or(true, |(bk, _)| k.len() > bk.len()) {
            best = Some((k.as_str(), v));
        }
    }
    if let Some((_, v)) = best {
        return v;
    }
    // No matching pricing key. Prefer a user-defined "default", else a safe
    // built-in fallback (never panic — compute_usage may run on edge inputs).
    if let Some(v) = pricing.get("default") {
        return v;
    }
    &FALLBACK_PRICING
}

/// Last-resort pricing used when the map has no "default" entry.
static FALLBACK_PRICING: ModelPricing = ModelPricing {
    input_per_m: 1.0,
    output_per_m: 3.0,
    cache_read_per_m: 0.2,
    cache_write_per_m: 1.25,
};

fn walk_jsonl(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = fs::read_dir(dir) else {
        return;
    };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            walk_jsonl(&p, out);
        } else if p.extension().and_then(|x| x.to_str()) == Some("jsonl") {
            out.push(p);
        }
    }
}

/// Display timezone offset in hours (UTC+8 for Beijing). Claude Code logs store
/// UTC timestamps; we bucket/display in local time so a 1am-UTC line shows as 9am.
const TZ_OFFSET_HOURS: i64 = 8;

/// Parse an ISO-8601 UTC timestamp into (local_date, local_hour).
/// Returns None if the timestamp can't be parsed.
fn local_from_ts(ts: &str) -> Option<(String, u32)> {
    // YYYY-MM-DDTHH:MM:SS[.fff]Z  — extract the date + hour, then shift by TZ.
    let b = ts.as_bytes();
    if b.len() < 19 || b.get(10) != Some(&b'T') || b.get(4) != Some(&b'-') {
        return None;
    }
    let y: i64 = ts[0..4].parse().ok()?;
    let mo: i64 = ts[5..7].parse().ok()?;
    let d: i64 = ts[8..10].parse().ok()?;
    let hh: i64 = ts[11..13].parse().ok()?;
    let mi: i64 = ts[14..16].parse().ok()?;
    let ss: i64 = ts[17..19].parse().ok()?;

    // Convert (y,m,d) to days since epoch, add time, apply TZ offset.
    let days = days_from_civil(y, mo, d);
    let total_secs = days * 86400 + hh * 3600 + mi * 60 + ss + TZ_OFFSET_HOURS * 3600;
    let local_days = total_secs.div_euclid(86400);
    let day_secs = total_secs.rem_euclid(86400);
    let (ly, lm, ld) = civil_from_days(local_days);
    let lhour = (day_secs / 3600) as u32;
    Some((format!("{:04}-{:02}-{:02}", ly, lm, ld), lhour))
}

/// Howard Hinnant's algorithms — no chrono dependency.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as i64;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Today minus `days`, as a LOCAL "YYYY-MM-DD" (UTC+8). Used as a string cutoff
/// compared against local dates derived from log timestamps.
fn cutoff_date(days: u32) -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let cutoff_secs = secs.saturating_sub(days as u64 * 86400) as i64
        + TZ_OFFSET_HOURS * 3600;
    let local_days = cutoff_secs.div_euclid(86400);
    let (y, m, d) = civil_from_days(local_days);
    format!("{:04}-{:02}-{:02}", y, m, d)
}

/// Today's date in LOCAL time (UTC+8) as "YYYY-MM-DD". The "day" view anchors to
/// this so a day with no activity shows nothing, rather than a past day's data.
fn today_local() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let local_secs = secs as i64 + TZ_OFFSET_HOURS * 3600;
    let local_days = local_secs.div_euclid(86400);
    let (y, m, d) = civil_from_days(local_days);
    format!("{:04}-{:02}-{:02}", y, m, d)
}

#[derive(Deserialize)]
struct LogLine {
    #[serde(default)]
    message: Option<MessageBlock>,
    #[serde(default)]
    timestamp: Option<String>,
}

#[derive(Deserialize)]
struct MessageBlock {
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    usage: Option<UsageBlock>,
    /// The API response id (e.g. "msg_..."). Claude Code writes one usage
    /// block per content chunk for the SAME message id, so we dedup on this.
    #[serde(default)]
    id: Option<String>,
}

#[derive(Deserialize, Default)]
struct UsageBlock {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
    #[serde(default)]
    cache_creation_input_tokens: u64,
    #[serde(default)]
    cache_read_input_tokens: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aggregates_tokens_and_groups_by_model_and_day() {
        let dir = tempfile::tempdir().unwrap();
        let proj = dir.path().join("proj-abc");
        fs::create_dir_all(&proj).unwrap();
        // 10:00 UTC -> 18:00 local (UTC+8); 11:00 UTC -> 19:00 local; same day.
        let log = concat!(
            r#"{"type":"assistant","timestamp":"2026-06-14T10:00:00.000Z","message":{"id":"msg_a","model":"claude-sonnet-4-6","#,
            r#""usage":{"input_tokens":1000,"output_tokens":500,"cache_creation_input_tokens":200,"cache_read_input_tokens":100}}}"#,
            "\n",
            r#"{"type":"assistant","timestamp":"2026-06-14T11:00:00.000Z","message":{"id":"msg_b","model":"glm-4.6","#,
            r#""usage":{"input_tokens":300,"output_tokens":300}}}"#,
            "\n",
            // malformed line should be skipped, not fatal
            "{ this is not json }\n",
        );
        fs::write(proj.join("s.jsonl"), log).unwrap();

        let mut pricing = HashMap::new();
        pricing.insert(
            "claude-sonnet".into(),
            ModelPricing { input_per_m: 3.0, output_per_m: 15.0, cache_read_per_m: 0.3, cache_write_per_m: 3.75 },
        );
        pricing.insert("default".into(), ModelPricing { input_per_m: 1.0, output_per_m: 3.0, cache_read_per_m: 0.2, cache_write_per_m: 1.25 });

        let report = compute_usage(dir.path(), &pricing, None, None).unwrap();

        assert_eq!(report.total_requests, 2);
        assert_eq!(report.total_input, 1300);
        assert_eq!(report.total_output, 800);
        assert_eq!(report.total_cache_write, 200);
        assert_eq!(report.total_cache_read, 100);

        let sonnet = report
            .by_model
            .iter()
            .find(|m| m.model == "claude-sonnet-4-6")
            .unwrap();
        assert_eq!(sonnet.input, 1000);
        assert!(sonnet.cost > 0.0);

        // both lines on the same day -> one day bucket.
        // `tokens`口径 = input+output+cache (matches ZCode / billing tools).
        assert_eq!(report.by_day.len(), 1);
        assert_eq!(report.by_day[0].date, "2026-06-14");
        assert_eq!(report.by_day[0].tokens, (1000 + 500 + 200 + 100) + (300 + 300));

        // The "day" view anchors to TODAY. The test data is dated 2026-06-14,
        // so unless today happens to be that date, the hourly buckets are all
        // zero (no activity today) — the day tab must NOT surface a past day's
        // numbers as today's. hour_date is always today's local date.
        assert_eq!(report.hour_date.as_deref(), Some(today_local().as_str()));
        assert_eq!(report.by_hour.len(), 24);
        let today_sum: u64 = report.by_hour.iter().map(|h| h.tokens).sum();
        if today_local() == "2026-06-14" {
            // 10:00Z -> 18:00 local, 11:00Z -> 19:00 local
            assert_eq!(report.by_hour[18].tokens, 1000 + 500 + 200 + 100);
            assert_eq!(report.by_hour[19].tokens, 300 + 300);
        } else {
            // a past day's data must NOT leak into today's hourly view
            assert_eq!(today_sum, 0);
        }
    }

    #[test]
    fn dedups_usage_by_message_id() {
        let dir = tempfile::tempdir().unwrap();
        let proj = dir.path().join("p");
        fs::create_dir_all(&proj).unwrap();
        // Same message.id appearing on two content chunks should count ONCE.
        let log = concat!(
            r#"{"timestamp":"2026-06-14T10:00:00.000Z","message":{"id":"msg_dup","model":"glm-5.2","usage":{"input_tokens":500,"output_tokens":100}}}"#,
            "\n",
            r#"{"timestamp":"2026-06-14T10:00:01.000Z","message":{"id":"msg_dup","model":"glm-5.2","usage":{"input_tokens":500,"output_tokens":100}}}"#,
            "\n",
        );
        fs::write(proj.join("s.jsonl"), log).unwrap();
        let pricing: HashMap<String, ModelPricing> = HashMap::new();
        let report = compute_usage(dir.path(), &pricing, None, None).unwrap();
        // Deduped -> only 500 input counted, not 1000.
        assert_eq!(report.total_input, 500);
        assert_eq!(report.total_requests, 1);
    }

    #[test]
    fn skips_synthetic_messages() {
        let dir = tempfile::tempdir().unwrap();
        let proj = dir.path().join("p");
        fs::create_dir_all(&proj).unwrap();
        let log = concat!(
            r#"{"timestamp":"2026-06-14T10:00:00.000Z","message":{"id":"s1","model":"<synthetic>","usage":{"input_tokens":999,"output_tokens":0}}}"#,
            "\n",
            r#"{"timestamp":"2026-06-14T10:00:00.000Z","message":{"id":"s2","model":"glm-5.2","usage":{"input_tokens":100,"output_tokens":50}}}"#,
            "\n",
        );
        fs::write(proj.join("s.jsonl"), log).unwrap();
        let pricing: HashMap<String, ModelPricing> = HashMap::new();
        let report = compute_usage(dir.path(), &pricing, None, None).unwrap();
        assert_eq!(report.total_input, 100); // synthetic 999 skipped
        assert_eq!(report.total_requests, 1);
    }

    #[test]
    fn local_from_ts_shifts_to_utc8() {
        // 2026-06-14T01:30:00Z -> 09:30 Beijing, same day.
        let (d, h) = local_from_ts("2026-06-14T01:30:00.000Z").unwrap();
        assert_eq!(d, "2026-06-14");
        assert_eq!(h, 9);
        // 2026-06-14T20:00:00Z -> 04:00 next day (2026-06-15).
        let (d2, h2) = local_from_ts("2026-06-14T20:00:00.000Z").unwrap();
        assert_eq!(d2, "2026-06-15");
        assert_eq!(h2, 4);
        // unparseable
        assert!(local_from_ts("").is_none());
        assert!(local_from_ts("not-a-timestamp").is_none());
    }

    #[test]
    fn missing_dir_returns_empty_report() {
        let pricing = HashMap::new();
        let report =
            compute_usage(Path::new("/nonexistent/definitely/not/here"), &pricing, None, None)
                .unwrap();
        assert_eq!(report.total_requests, 0);
    }

    #[test]
    fn civil_from_days_known_values() {
        // epoch (1970-01-01) = day 0
        let (y, m, d) = civil_from_days(0);
        assert_eq!((y, m, d), (1970, 1, 1));
        // 2026-06-14 = 20618 days since epoch
        let (y, m, d) = civil_from_days(20618);
        assert_eq!((y, m, d), (2026, 6, 14));
        // leap day: 2024-02-29 = 19782 days since epoch
        let (y, m, d) = civil_from_days(19782);
        assert_eq!((y, m, d), (2024, 2, 29));
    }
}
