use crate::models::{Provider, ProvidersFile};
use crate::storage;
use anyhow::{bail, Result};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

/// CRUD over `~/.ccbox/providers.json`. Cheap to construct: holds only the path
/// and re-reads the file on each operation (local, single-user, low frequency).
pub struct ProviderService {
    path: PathBuf,
}

impl ProviderService {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn load(&self) -> ProvidersFile {
        storage::read_json_or_default(&self.path)
    }

    pub fn save(&self, file: &ProvidersFile) -> Result<()> {
        storage::write_json_atomic(&self.path, file)
    }

    pub fn list(&self) -> Vec<Provider> {
        self.load().providers
    }

    /// Add a provider. Always assigns a fresh id/timestamp and marks it as a
    /// user-owned instance (deletable), regardless of what the caller passed.
    pub fn add(&self, mut p: Provider) -> Result<Provider> {
        p.id = Uuid::new_v4().to_string();
        p.created_at = now_ms();
        p.is_preset = false;
        let mut file = self.load();
        file.providers.push(p.clone());
        self.save(&file)?;
        Ok(p)
    }

    pub fn update(&self, p: Provider) -> Result<Provider> {
        let mut file = self.load();
        let slot = file.providers.iter_mut().find(|x| x.id == p.id);
        match slot {
            Some(s) => {
                *s = p.clone();
                self.save(&file)?;
                Ok(p)
            }
            None => bail!("provider not found: {}", p.id),
        }
    }

    /// Delete a provider. Returns Some(prev_extra_keys) if the deleted provider
    /// was the active one, so the caller can clear its env keys from
    /// ~/.claude/settings.json.
    pub fn delete(&self, id: &str) -> Result<Option<Vec<String>>> {
        let mut file = self.load();
        let was_active = file.active_id.as_deref() == Some(id);
        let prev_extra_keys = if was_active {
            Some(std::mem::take(&mut file.active_extra_keys))
        } else {
            None
        };
        file.providers.retain(|x| x.id != id);
        // If we just deleted the active provider, fall back to the first remaining
        // and clear the stale extra-key tracking (env cleanup handled by caller).
        if was_active {
            file.active_id = file.providers.first().map(|p| p.id.clone());
            file.active_extra_keys.clear();
        }
        self.save(&file)?;
        Ok(prev_extra_keys)
    }

    /// Record the active provider + the extra-env keys it wrote (for residue
    /// cleanup on the next switch).
    pub fn set_active(&self, id: Option<&str>, extra_keys: &[String]) -> Result<()> {
        let mut file = self.load();
        file.active_id = id.map(|s| s.to_string());
        file.active_extra_keys = extra_keys.to_vec();
        self.save(&file)
    }

    pub fn get_active(&self) -> Option<Provider> {
        let file = self.load();
        let id = file.active_id?;
        file.providers.into_iter().find(|p| p.id == id)
    }

    /// Move the provider at `from` index to `to` index in the stored list.
    /// Out-of-range indices are ignored. The active provider is unaffected
    /// (tracked by id, not position).
    pub fn reorder(&self, from: usize, to: usize) -> Result<()> {
        let mut file = self.load();
        if from >= file.providers.len() || to >= file.providers.len() || from == to {
            return Ok(());
        }
        let item = file.providers.remove(from);
        file.providers.insert(to, item);
        self.save(&file)
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn p(id: &str) -> Provider {
        Provider {
            id: id.into(),
            name: id.into(),
            base_url: "https://x".into(),
            auth_token: "t".into(),
            default_model: None,
            models: vec![],
            model_map: None,
            extra_env: HashMap::new(),
            website_url: None,
            icon_color: None,
            brand: None,
            note: None,
            is_preset: false,
            created_at: 0,
        }
    }

    #[test]
    fn add_assigns_id_and_marks_user_owned() {
        let dir = tempfile::tempdir().unwrap();
        let svc = ProviderService::new(dir.path().join("providers.json"));
        let added = svc.add(p("")).unwrap();
        assert_ne!(added.id, "");
        assert!(!added.is_preset);
        assert!(added.created_at > 0);
        assert_eq!(svc.list().len(), 1);
    }

    #[test]
    fn delete_active_falls_back_to_first_and_returns_extra_keys() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("providers.json");
        let svc = ProviderService::new(path.clone());
        let a = svc.add(p("a")).unwrap();
        let b = svc.add(p("b")).unwrap();
        svc.set_active(Some(&a.id), &["X".into()]).unwrap();
        let prev = svc.delete(&a.id).unwrap();
        assert_eq!(prev, Some(vec!["X".to_string()]));
        let file = svc.load();
        assert_eq!(file.providers.len(), 1);
        assert_eq!(file.active_id.as_deref(), Some(b.id.as_str()));
        assert!(file.active_extra_keys.is_empty());
    }

    #[test]
    fn delete_inactive_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        let svc = ProviderService::new(dir.path().join("providers.json"));
        let a = svc.add(p("a")).unwrap();
        let b = svc.add(p("b")).unwrap();
        svc.set_active(Some(&a.id), &["X".into()]).unwrap();
        // delete the non-active one
        let prev = svc.delete(&b.id).unwrap();
        assert_eq!(prev, None);
        // active id untouched
        assert_eq!(svc.load().active_id.as_deref(), Some(a.id.as_str()));
    }

    #[test]
    fn update_replaces_in_place() {
        let dir = tempfile::tempdir().unwrap();
        let svc = ProviderService::new(dir.path().join("providers.json"));
        let mut a = svc.add(p("a")).unwrap();
        a.name = "renamed".into();
        let updated = svc.update(a.clone()).unwrap();
        assert_eq!(updated.name, "renamed");
        assert_eq!(svc.list()[0].name, "renamed");
    }
}
