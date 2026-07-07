import { useEffect, useMemo, useState } from "react";
import { Activity, Coins, FileText, MessagesSquare } from "lucide-react";
import { api } from "@/lib/api";
import type { DayUsage, UsageReport } from "@/lib/types";
import { Heatmap } from "./Heatmap";
import { BarChart } from "./BarChart";
import { formatCNY, formatTokens, cn } from "@/lib/utils";

/** One tab in the top switcher. "day" shows the most-recent day hourly;
 *  week/month show daily; all shows the full daily history. */
type Period = "day" | "week" | "month" | "all";

interface ChartPoint {
  label: string;
  tokens: number;
  cost: number;
}

/** Daily points filtered to the current calendar month (all days in-month). */
function currentMonthDays(data: DayUsage[]): DayUsage[] {
  const now = new Date();
  const prefix = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const inMonth = data.filter((d) => d.date.startsWith(prefix));
  // span from the 1st of this month through today, inclusive
  const start = `${prefix}-01`;
  const end = new Date().toISOString().slice(0, 10);
  return fillDays(inMonth, start, end);
}

/** Fill in any missing calendar days between start and end with zeroed buckets. */
function fillDays(data: DayUsage[], start: string, end: string): DayUsage[] {
  const map = new Map(data.map((d) => [d.date, d]));
  const out: DayUsage[] = [];
  const cur = new Date(start + "T00:00:00Z");
  const stop = new Date(end + "T00:00:00Z");
  for (; cur <= stop; cur.setUTCDate(cur.getUTCDate() + 1)) {
    const iso = cur.toISOString().slice(0, 10);
    out.push(map.get(iso) ?? { date: iso, tokens: 0, cost: 0 });
  }
  return out;
}

/** Build chart points for the selected period. The daily views (week/month/all)
 *  show one bar per calendar day — missing days are filled with 0. */
function buildPoints(report: UsageReport, p: Period): ChartPoint[] {
  if (p === "day") {
    return report.byHour.map((h) => ({
      label: `${h.hour.toString().padStart(2, "0")}:00`,
      tokens: h.tokens,
      cost: h.cost,
    }));
  }
  let daily: DayUsage[];
  if (p === "month") {
    daily = currentMonthDays(report.byDay);
  } else if (p === "week") {
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 6 * 86400_000).toISOString().slice(0, 10);
    daily = fillDays(
      report.byDay.filter((d) => d.date >= start && d.date <= end),
      start,
      end,
    );
  } else {
    // all: span from earliest to latest active day (or today)
    if (report.byDay.length === 0) return [];
    const start = report.byDay[0].date;
    const end = report.byDay[report.byDay.length - 1].date;
    daily = fillDays(report.byDay, start, end);
  }
  return daily.map((d) => ({ label: d.date, tokens: d.tokens, cost: d.cost }));
}

/** The daily window used by both the chart and the stat cards, so they always
 *  agree. Returns the filled DayUsage[] for week/month/all (day uses byHour). */
function periodDaily(report: UsageReport, p: Period): DayUsage[] {
  if (p === "day") {
    return report.byHour.map((h) => ({
      date: `${h.hour}:00`,
      tokens: h.tokens,
      cost: h.cost,
    }));
  }
  return buildPoints(report, p).map((pt) => ({
    date: pt.label,
    tokens: pt.tokens,
    cost: pt.cost,
  }));
}

/** Totals within the window implied by the selected period.
 *  tokens/cost are exact (from daily buckets). sessions/requests are
 *  proportionally estimated from the lifetime counts (the backend doesn't
 *  bucket sessions per day), which is accurate enough for a stat card. */
function periodTotals(report: UsageReport, p: Period) {
  const days = periodDaily(report, p);
  const tokens = days.reduce((s, d) => s + d.tokens, 0);
  const cost = days.reduce((s, d) => s + d.cost, 0);
  const lifetimeTokens =
    report.byDay.reduce((s, d) => s + d.tokens, 0) || 1;
  const ratio = tokens / lifetimeTokens;
  const label =
    p === "day"
      ? "今日"
      : p === "week"
        ? "近 7 天"
        : p === "month"
          ? "本月"
          : "全部";
  return {
    tokens,
    cost,
    sessions: Math.round(report.totalSessions * ratio),
    requests: Math.round(report.totalRequests * ratio),
    label,
  };
}

// Module-level cache so reopening the usage tab shows the previous report
// instantly (no spinner) while a fresh rescan runs in the background.
let cachedReport: UsageReport | null = null;

export function UsageDashboard() {
  const [report, setReport] = useState<UsageReport | null>(cachedReport);
  const [period, setPeriod] = useState<Period>("day");
  // not "loading" if we already have a cached report to show
  const [loading, setLoading] = useState(cachedReport === null);
  const [refreshing, setRefreshing] = useState(cachedReport !== null);
  const [err, setErr] = useState<string | null>(null);

  // Show cached report immediately, then fetch fresh data in the background.
  useEffect(() => {
    let cancelled = false;
    if (cachedReport) {
      setReport(cachedReport);
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    api
      .getUsage(null, null)
      .then((r) => {
        if (cancelled) return;
        cachedReport = r;
        setReport(r);
        setErr(null);
      })
      .catch((e) => !cancelled && setErr(String(e)))
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const points = useMemo(
    () => (report ? buildPoints(report, period) : []),
    [report, period],
  );
  const totals = useMemo(
    () =>
      report
        ? periodTotals(report, period)
        : { tokens: 0, cost: 0, sessions: 0, requests: 0, label: "" },
    [report, period],
  );

  /** Model-breakdown rows filtered to the selected period. For "day" we show
   *  the most-recent active day's per-model totals (hourly split not tracked). */
  const periodModels = useMemo(() => {
    if (!report) return [];
    const map = report.byModelDay ?? {};
    let inRange: (date: string) => boolean;
    if (period === "all") {
      inRange = () => true;
    } else if (period === "day") {
      const d = report.hourDate ?? "";
      inRange = (date) => (d ? date === d : true);
    } else if (period === "week") {
      const start = new Date(Date.now() - 6 * 86400_000).toISOString().slice(0, 10);
      inRange = (date) => date >= start;
    } else {
      // month
      const now = new Date();
      const prefix = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
      inRange = (date) => date.startsWith(prefix);
    }
    const rows = Object.entries(map).map(([model, days]) => {
      const picked = days.filter((d) => inRange(d.date));
      const tokens = picked.reduce((s, d) => s + d.tokens, 0);
      const cost = picked.reduce((s, d) => s + d.cost, 0);
      return { model, tokens, cost };
    });
    return rows
      .filter((r) => r.tokens > 0 || r.cost > 0)
      .sort((a, b) => b.cost - a.cost);
  }, [report, period]);

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* unified top control: 天 / 周 / 月 / 全部 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">使用量统计</h3>
        <div className="flex items-center gap-1.5">
          {(["day", "week", "month", "all"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                period === p
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-accent",
              )}
            >
              {p === "day" ? "天" : p === "week" ? "周" : p === "month" ? "月" : "全部"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">统计中…</p>
      ) : err ? (
        <p className="text-sm text-destructive">{err}</p>
      ) : !report || report.totalRequests === 0 ? (
        <div className="grid place-items-center rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          暂无用量数据
          <span className="mt-1 text-xs">
            数据来自 ~/.claude/projects 下的会话日志
          </span>
        </div>
      ) : (
        <>
          {/* heatmap — always 54 weeks, on top, independent of period */}
          <div className="rounded-xl border border-border p-4">
            <Heatmap data={report.byDay} />
          </div>

          {/* stat cards — all four follow the selected period */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              icon={<Activity className="h-4 w-4" />}
              label="Token 用量"
              value={formatTokens(totals.tokens)}
            />
            <Stat
              icon={<FileText className="h-4 w-4" />}
              label="会话数量"
              value={String(totals.sessions)}
            />
            <Stat
              icon={<MessagesSquare className="h-4 w-4" />}
              label="消息用量"
              value={String(totals.requests)}
            />
            <Stat
              icon={<Coins className="h-4 w-4" />}
              label="预估费用"
              value={formatCNY(totals.cost)}
            />
          </div>

          {/* trend bar chart — driven by period */}
          <div className="rounded-xl border border-border p-4">
            <BarChart data={points} caption="Token 趋势" />
          </div>

          {/* model table — driven by period */}
          <div className="rounded-xl border border-border">
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <span className="text-sm font-semibold">各模型明细</span>
              <span className="text-[11px] text-muted-foreground">
                {totals.label} {formatTokens(totals.tokens)} tokens
              </span>
            </div>
            <div className="divide-y divide-border">
              <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-2 text-xs text-muted-foreground">
                <span>模型</span>
                <span className="w-24 text-right">Token</span>
                <span className="w-24 text-right">费用</span>
              </div>
              {periodModels.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                  {totals.label} 无用量数据
                </div>
              ) : (
                periodModels.map((m) => (
                  <div
                    key={m.model}
                    className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-2 text-sm"
                  >
                    <span className="truncate font-mono text-xs">{m.model}</span>
                    <span className="w-24 text-right tabular-nums">
                      {formatTokens(m.tokens)}
                    </span>
                    <span className="w-24 text-right tabular-nums">
                      {formatCNY(m.cost)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
