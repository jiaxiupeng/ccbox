import { invoke } from "@tauri-apps/api/core";
import type {
  ActiveProviderInfo,
  AppSettings,
  ModelPricing,
  Provider,
  ProviderQuota,
  TestResult,
  UsageReport,
} from "./types";

// Tauri converts camelCase JS keys to snake_case Rust params automatically,
// and Provider/AppSettings carry serde camelCase field names.
export const api = {
  listProviders: () => invoke<Provider[]>("list_providers"),
  addProvider: (provider: Provider) =>
    invoke<Provider>("add_provider", { provider }),
  updateProvider: (provider: Provider) =>
    invoke<Provider>("update_provider", { provider }),
  deleteProvider: (id: string) => invoke<void>("delete_provider", { id }),
  switchProvider: (id: string) => invoke<Provider>("switch_provider", { id }),
  reorderProviders: (from: number, to: number) =>
    invoke<void>("reorder_providers", { from, to }),
  clearActive: () => invoke<void>("clear_active"),
  getActiveId: () => invoke<string | null>("get_active_id"),
  listPresets: () => invoke<Provider[]>("list_presets"),
  getUsage: (days?: number | null, project?: string | null) =>
    invoke<UsageReport>("get_usage", { days: days ?? null, project: project ?? null }),
  refreshUsage: () => invoke<UsageReport>("refresh_usage"),
  testProvider: (baseUrl: string, token: string) =>
    invoke<TestResult>("test_provider", { baseUrl, token }),
  fetchModels: (baseUrl: string, token: string) =>
    invoke<string[]>("fetch_models", { baseUrl, token }),
  getSettings: () => invoke<AppSettings>("get_settings"),
  setSettings: (settings: AppSettings) =>
    invoke<void>("set_settings", { settings }),
  defaultPricing: () => invoke<Record<string, ModelPricing>>("default_pricing"),
  getClaudeSettingsPreview: () => invoke<string>("get_claude_settings_preview"),
  /** Install the Node statusLine script + register the statusLine key.
   *  GLM-only; errors with a friendly message otherwise. Returns the active
   *  provider name on success. */
  applyStatusBar: () => invoke<string>("apply_statusbar"),
  getActiveProviderInfo: () => invoke<ActiveProviderInfo>("get_active_provider_info"),
  /** Live quota/balance for a provider card. Returns null on any failure. */
  getProviderQuota: (provider: Provider) =>
    invoke<ProviderQuota | null>("get_provider_quota", { provider }),
};

