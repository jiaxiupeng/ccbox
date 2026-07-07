import type { StatusBarConfig, StatusBarModule } from "./types";

/** Module type -> display metadata + per-module defaults + preview sample.
 *  Drives the catalog in the status-bar page and the live preview. */
export interface ModuleDef {
  label: string;
  /** default format when the user first enables it */
  defaultFormat: string;
  /** which format options make sense for this module */
  formats: string[];
  /** true when the value is a percentage and supports threshold coloring */
  supportsThreshold: boolean;
  /** true when the "bar" format applies (percentage modules) */
  supportsBar: boolean;
  /** one-line description shown under the label */
  hint: string;
}

export const MODULE_DEFS: Record<string, ModuleDef> = {
  context: {
    label: "上下文使用",
    defaultFormat: "percent",
    formats: ["percent", "frac", "bar"],
    supportsThreshold: true,
    supportsBar: true,
    hint: "当前会话上下文窗口占用",
  },
  fiveHourQuota: {
    label: "5 小时额度",
    defaultFormat: "percent",
    formats: ["percent", "bar"],
    supportsThreshold: true,
    supportsBar: true,
    hint: "GLM Coding Plan 5 小时窗口用量",
  },
  fiveHourReset: {
    label: "5 小时额度刷新",
    defaultFormat: "text",
    formats: ["text"],
    supportsThreshold: false,
    supportsBar: false,
    hint: "距下次 5 小时额度恢复",
  },
  weeklyQuota: {
    label: "周额度",
    defaultFormat: "percent",
    formats: ["percent", "bar"],
    supportsThreshold: true,
    supportsBar: true,
    hint: "GLM 周期额度用量",
  },
  model: {
    label: "模型",
    defaultFormat: "text",
    formats: ["text"],
    supportsThreshold: false,
    supportsBar: false,
    hint: "当前调用的模型名",
  },
  cost: {
    label: "费用",
    defaultFormat: "text",
    formats: ["text"],
    supportsThreshold: false,
    supportsBar: false,
    hint: "当前会话累计费用",
  },
  dir: {
    label: "目录",
    defaultFormat: "text",
    formats: ["text"],
    supportsThreshold: false,
    supportsBar: false,
    hint: "当前工作目录名",
  },
};

/** All module types in catalog order. */
export const ALL_MODULE_TYPES = Object.keys(MODULE_DEFS);

/** The default config the backend ships with; mirrored here so the UI can
 *  restore to defaults and so newly-added modules adopt sane options. */
export function defaultStatusBarConfig(): StatusBarConfig {
  const mk = (type: string, format: string, enabled: boolean): StatusBarModule => ({
    type,
    enabled,
    format,
    barWidth: 10,
    colorMode: "threshold",
  });
  return {
    enabled: false,
    separator: " | ",
    modules: [
      mk("context", "percent", true),
      mk("fiveHourQuota", "percent", true),
      mk("fiveHourReset", "text", true),
      mk("weeklyQuota", "percent", false),
      mk("model", "text", false),
      mk("cost", "text", false),
      mk("dir", "text", false),
    ],
  };
}

/** Ensure the config is well-formed: drop unknown types, fill in any catalog
 *  modules the user is missing (so they appear in the "available" pool), and
 *  default any blank format/colorMode. */
export function normalizeStatusBarConfig(cfg: StatusBarConfig | undefined): StatusBarConfig {
  const base = defaultStatusBarConfig();
  if (!cfg || !Array.isArray(cfg.modules)) return base;
  const known = new Set(ALL_MODULE_TYPES);
  const seen = new Set<string>();
  const modules = cfg.modules
    .filter((m) => {
      if (!m || !known.has(m.type) || seen.has(m.type)) return false;
      seen.add(m.type);
      return true;
    })
    .map((m) => {
      const def = MODULE_DEFS[m.type];
      const format =
        m.format && def.formats.includes(m.format) ? m.format : def.defaultFormat;
      const colorMode =
        m.colorMode === "static" || m.colorMode === "threshold"
          ? m.colorMode
          : "threshold";
      return {
        type: m.type,
        enabled: !!m.enabled,
        format,
        barWidth: typeof m.barWidth === "number" && m.barWidth > 0 ? m.barWidth : 10,
        colorMode: def.supportsThreshold ? colorMode : "static",
      };
    });
  // append any catalog modules the saved config lacked (disabled by default)
  for (const t of ALL_MODULE_TYPES) {
    if (!seen.has(t)) {
      const def = MODULE_DEFS[t];
      modules.push({
        type: t,
        enabled: false,
        format: def.defaultFormat,
        barWidth: 10,
        colorMode: def.supportsThreshold ? "threshold" : "static",
      });
    }
  }
  return {
    enabled: !!cfg.enabled,
    separator: " | ",
    modules,
  };
}

