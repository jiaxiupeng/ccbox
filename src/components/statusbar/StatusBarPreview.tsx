import type { StatusBarConfig, StatusBarModule } from "@/lib/types";
import { MODULE_DEFS } from "@/lib/statusbar";
import { cn } from "@/lib/utils";

/** Threshold color class for a percentage value (mirrors the CLI script). */
function pctClass(pct: number, colorMode: string) {
  if (colorMode !== "threshold") return "";
  if (pct >= 80) return "text-red-500";
  if (pct >= 50) return "text-yellow-500 dark:text-yellow-400";
  return "text-emerald-600 dark:text-emerald-400";
}

/** Smoother progress bar: solid blocks + a partial eighths-block leading edge,
 *  light shade for the empty track. Mirrors the CLI script's bar(). */
const PARTIAL = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"];
function buildBar(pct: number, width: number) {
  const w = Math.max(3, width || 10);
  const p = Math.min(100, Math.max(0, pct)) / 100;
  const exact = p * w;
  const whole = Math.floor(exact);
  const frac = Math.round((exact - whole) * 8);
  const filled = frac >= 8 ? whole + 1 : whole;
  const lead = frac > 0 && frac < 8 && filled < w ? PARTIAL[frac] : "";
  const empty = Math.max(0, w - filled - (lead ? 1 : 0));
  return "█".repeat(filled) + lead + "┄".repeat(empty);
}

/** Sample values per module type, in the same shape the CLI script would emit.
 *  Percentages here drive both the number and the threshold color in preview. */
const SAMPLE_PCT: Record<string, number> = {
  context: 42,
  fiveHourQuota: 63,
  weeklyQuota: 38,
};

function renderModule(mod: StatusBarModule): { node: React.ReactNode; key: string } {
  const def = MODULE_DEFS[mod.type];
  if (!def) return { node: null, key: mod.type };

  switch (mod.type) {
    case "context":
    case "fiveHourQuota":
    case "weeklyQuota": {
      const pct = SAMPLE_PCT[mod.type] ?? 0;
      const cls = pctClass(pct, mod.colorMode);
      let body: React.ReactNode;
      if (mod.format === "bar") {
        body = (
          <span>
            <span className="opacity-80">{buildBar(pct, mod.barWidth)}</span> {pct}%
          </span>
        );
      } else if (mod.format === "frac" && mod.type === "context") {
        body = "84k/200k";
      } else {
        body = `${pct}%`;
      }
      return { key: mod.type, node: <span className={cn(cls)}>{body}</span> };
    }
    case "fiveHourReset":
      return { key: mod.type, node: <span className="opacity-60">2h14m</span> };
    case "model":
      return { key: mod.type, node: <span>GLM-5.2</span> };
    case "cost":
      return { key: mod.type, node: <span>1.24</span> };
    case "dir":
      return { key: mod.type, node: <span>ccbox</span> };
    default:
      return { key: mod.type, node: null };
  }
}

/** A simulated terminal status bar that mirrors what the CLI shows.
 *  Renders only enabled modules, separated by a fixed "|" with breathing room. */
export function StatusBarPreview({ config }: { config: StatusBarConfig }) {
  const parts = config.modules
    .filter((m) => m.enabled)
    .map(renderModule)
    .filter((p) => p.node != null);

  return (
    <div className="rounded-lg border border-border bg-zinc-950 px-4 py-2.5 font-mono text-xs text-zinc-200 shadow-inner">
      {parts.length === 0 ? (
        <span className="text-zinc-500">
          {config.enabled ? "（没有已启用的状态项）" : "（状态栏总开关已关闭）"}
        </span>
      ) : (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {parts.map((p, i) => (
            <span key={p.key} className="flex items-center gap-x-2.5">
              {i > 0 && <span className="text-zinc-600">|</span>}
              {p.node}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
