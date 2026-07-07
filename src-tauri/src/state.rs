use crate::models::{AppSettings, UsageReport};
use crate::provider_service::ProviderService;
use crate::storage;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

/// How long a cached usage report stays fresh (seconds). Within this window,
/// repeated opens of the usage tab return instantly without rescanning logs.
const USAGE_CACHE_TTL_SECS: u64 = 30;

/// Paths / handles shared across Tauri commands.
pub struct AppState {
    pub providers_path: PathBuf,
    pub settings_path: PathBuf,
    /// Cached usage report + when it was computed. Scanning the full log
    /// history is expensive (hundreds of JSONL files), so we memoize it for
    /// a short TTL and let the user force-refresh on demand.
    usage_cache: Mutex<Option<(Instant, UsageReport)>>,
}

impl AppState {
    pub fn new() -> anyhow::Result<Self> {
        let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("home dir not found"))?;
        let dir = home.join(".ccbox");
        let _ = std::fs::create_dir_all(&dir);
        Ok(Self {
            providers_path: dir.join("providers.json"),
            settings_path: dir.join("settings.json"),
            usage_cache: Mutex::new(None),
        })
    }

    pub fn providers(&self) -> ProviderService {
        ProviderService::new(self.providers_path.clone())
    }

    pub fn load_settings(&self) -> AppSettings {
        storage::read_json_or_default(&self.settings_path)
    }

    pub fn save_settings(&self, s: &AppSettings) -> anyhow::Result<()> {
        storage::write_json_atomic(&self.settings_path, s)
    }

    /// Return the cached report if it's still fresh (within TTL).
    pub fn usage_cached(&self) -> Option<UsageReport> {
        let guard = self.usage_cache.lock().ok()?;
        match guard.as_ref() {
            Some((at, report)) if at.elapsed().as_secs() < USAGE_CACHE_TTL_SECS => {
                Some(report.clone())
            }
            _ => None,
        }
    }

    /// Store a freshly computed report in the cache.
    pub fn usage_store(&self, report: UsageReport) {
        if let Ok(mut guard) = self.usage_cache.lock() {
            *guard = Some((Instant::now(), report));
        }
    }

    /// Force-invalidate the cache (e.g. the user explicitly wants fresh data).
    pub fn usage_invalidate(&self) {
        if let Ok(mut guard) = self.usage_cache.lock() {
            *guard = None;
        }
    }
}
