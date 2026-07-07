// Mirrors the Rust models in src-tauri/src/models.rs (serde camelCase).

/** opus/sonnet/haiku tier -> concrete model name. */
export interface ModelMap {
  opus?: string;
  sonnet?: string;
  haiku?: string;
}

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  authToken: string;
  defaultModel?: string;
  models: string[];
  modelMap?: ModelMap;
  extraEnv: Record<string, string>;
  websiteUrl?: string;
  iconColor?: string;
  /** "claude" | "glm" | "qwen" | "kimi" | "custom" */
  brand?: string;
  note?: string;
  isPreset: boolean;
  createdAt: number;
}

export interface ModelPricing {
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM: number;
  cacheWritePerM: number;
}

export interface AppSettings {
  theme: string;
  pricing: Record<string, ModelPricing>;
  statusBar: StatusBarConfig;
}

/** One configurable status-bar module.
 *  `type` identifies the data source; the rest control rendering. */
export interface StatusBarModule {
  /** "context" | "fiveHourQuota" | "fiveHourReset" | "weeklyQuota" | "model" | "cost" | "dir" */
  type: string;
  enabled: boolean;
  /** "percent" | "frac" | "bar" | "text" */
  format: string;
  /** progress-bar width in cells (used when format === "bar") */
  barWidth: number;
  /** "static" (no color) | "threshold" (green < 50% < yellow < 80% < red) */
  colorMode: string;
}

export interface StatusBarConfig {
  enabled: boolean;
  separator: string;
  modules: StatusBarModule[];
}

/** Summary of the active provider, for the status-bar page. */
export interface ActiveProviderInfo {
  name?: string;
  brand?: string;
  isGlm: boolean;
  statuslineActive: boolean;
}

/** Live quota/balance for a provider card. GLM fills the window fields;
 *  DeepSeek fills balance/currency. All optional — any may be unknown. */
export interface ProviderQuota {
  /** "glm" | "deepseek" */
  kind: string;
  /** Remaining % of the 5-hour window (0..100). */
  fiveHourRemainingPct?: number;
  /** Epoch-ms when the 5-hour window resets. */
  fiveHourResetMs?: number;
  /** Remaining % of the weekly window (0..100). */
  weeklyRemainingPct?: number;
  /** Epoch-ms when the weekly window resets. */
  weeklyResetMs?: number;
  /** Account balance (DeepSeek). */
  balance?: number;
  /** Balance currency, e.g. "CNY" / "USD". */
  currency?: string;
}

export interface ModelUsage {
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  requests: number;
  cost: number;
}

export interface DayUsage {
  date: string;
  tokens: number;
  cost: number;
}

export interface HourUsage {
  hour: number;
  tokens: number;
  cost: number;
}

export interface UsageReport {
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalCost: number;
  totalRequests: number;
  totalSessions: number;
  byModel: ModelUsage[];
  byDay: DayUsage[];
  /** Per-model daily breakdown for period-filtering the model table. */
  byModelDay: Record<string, DayUsage[]>;
  byHour: HourUsage[];
  hourDate?: string;
}

export interface TestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
}

export type Theme = "light" | "dark" | "system";
