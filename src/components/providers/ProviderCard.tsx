import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, GripVertical, MoreVertical, Pencil, RefreshCw, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BrandIcon } from "@/components/BrandIcon";
import { api } from "@/lib/api";
import type { Provider, ProviderQuota, TestResult } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  provider: Provider;
  isActive: boolean;
  onSwitch: (id: string) => void;
  onEdit: (p: Provider) => void;
  onDelete: (p: Provider) => void;
  /** stable list index, used as the pointer-drop target id */
  listIndex?: number;
  /** begin a drag from the handle (from useReorder) */
  onDragStart?: (e: React.PointerEvent, index: number) => void;
  isDragging?: boolean;
  isDragOver?: boolean;
}

/** What kind of live quota (if any) this provider supports. */
function quotaKind(p: Provider): "glm" | "deepseek" | null {
  if (p.brand === "glm" || p.baseUrl.includes("bigmodel") || p.baseUrl.includes("z.ai"))
    return "glm";
  if (p.brand === "deepseek" || p.baseUrl.includes("deepseek")) return "deepseek";
  return null;
}

/** Color an amount of remaining % — green/yellow/red by threshold. */
function remainingColor(pct: number): string {
  if (pct <= 20) return "text-red-500";
  if (pct <= 50) return "text-yellow-600 dark:text-yellow-400";
  return "text-emerald-600 dark:text-emerald-400";
}

/** Format an epoch-ms reset timestamp as a short countdown like "2h14m" or
 *  "2d14h". No clock time — keeps the card compact. */
function formatReset(ms: number): string {
  const diffMs = ms - Date.now();
  if (diffMs <= 0) return "即将刷新";
  const totalMins = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMins / 1440);
  const hours = Math.floor((totalMins % 1440) / 60);
  const mins = totalMins % 60;
  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${mins}m`;
  return `${mins}m`;
}

export function ProviderCard({
  provider,
  isActive,
  onSwitch,
  onEdit,
  onDelete,
  listIndex,
  onDragStart,
  isDragging,
  isDragOver,
}: Props) {
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  // Live quota/balance for this provider (GLM windows / DeepSeek balance).
  const [quota, setQuota] = useState<ProviderQuota | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const kind = quotaKind(provider);

  // Fetch live quota for supported providers. Best-effort: failures
  // (network/auth/shape) just leave quota null and we show nothing.
  const loadQuota = async () => {
    if (!kind) return;
    setQuotaLoading(true);
    try {
      const q = await api.getProviderQuota(provider);
      setQuota(q);
    } catch {
      /* leave previous value */
    } finally {
      setQuotaLoading(false);
    }
  };

  // Fetch on mount for supported providers.
  useEffect(() => {
    if (!kind) return;
    let cancelled = false;
    api
      .getProviderQuota(provider)
      .then((q) => !cancelled && setQuota(q))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.id]);

  const runTest = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      const r: TestResult = await api.testProvider(
        provider.baseUrl,
        provider.authToken,
      );
      setTestMsg(`${r.ok ? "✓" : "✗"} ${r.message} (${r.latencyMs}ms)`);
    } catch (e) {
      setTestMsg(`✗ ${String(e)}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div
      data-ridx={listIndex}
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-card p-4 pl-5 transition-all",
        isActive
          ? "border-primary/60 ring-1 ring-primary/40"
          : "border-border hover:border-primary/30",
        isDragging && "opacity-40",
        isDragOver && "border-primary ring-1 ring-primary/40",
      )}
    >
      {/* active accent bar pinned to the left edge */}
      {isActive && (
        <span className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden />
      )}
      <div className="flex items-start gap-3">
        {/* drag handle — only when reordering is wired up */}
        {onDragStart && listIndex !== undefined && (
          <button
            type="button"
            onPointerDown={(e) => onDragStart(e, listIndex)}
            aria-label="拖拽排序"
            className="mt-1 shrink-0 cursor-grab touch-none text-muted-foreground/40 opacity-0 transition-opacity hover:text-muted-foreground group-hover:opacity-100 active:cursor-grabbing"
          >
            <GripVertical className="h-5 w-5" />
          </button>
        )}

        <BrandIcon
          brand={provider.brand}
          color={provider.iconColor}
          name={provider.name}
          size={36}
          className="mt-0.5"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="truncate font-semibold">{provider.name}</h3>
          </div>
          {/* Live quota/balance line (GLM 5h+weekly windows / DeepSeek balance).
              Falls back to the API host when unsupported, or to a loading hint. */}
          <QuotaLine kind={kind} quota={quota} baseUrl={provider.baseUrl} />
          {testMsg && (
            <p
              className={cn(
                "mt-1 text-xs",
                testMsg.startsWith("✓") ? "text-success" : "text-destructive",
              )}
            >
              {testMsg}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isActive ? (
            <Button
              size="sm"
              disabled
              className="border border-primary/50 bg-primary text-primary-foreground hover:bg-primary dark:bg-primary"
            >
              <Check className="h-3.5 w-3.5" />
              已启用
            </Button>
          ) : (
            <Button
              size="sm"
              className="bg-gray-600 text-white hover:bg-gray-700 dark:bg-gray-500 dark:hover:bg-gray-600"
              onClick={() => onSwitch(provider.id)}
            >
              启用
            </Button>
          )}
          {/* refresh quota/balance — only for providers with live data */}
          {kind && (
            <Button
              variant="ghost"
              size="icon"
              onClick={loadQuota}
              disabled={quotaLoading}
              aria-label="刷新余额"
              title="刷新余额"
              className="h-8 w-8"
            >
              <RefreshCw className={cn("h-4 w-4", quotaLoading && "animate-spin")} />
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  navigator.clipboard.writeText(provider.baseUrl);
                  toast.success("已复制 API 地址");
                }}
              >
                <Copy className="h-4 w-4" />
                复制地址
              </DropdownMenuItem>
              <DropdownMenuItem onClick={runTest} disabled={testing}>
                <Zap className="h-4 w-4" />
                {testing ? "测速中…" : "测速"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit(provider)}>
                <Pencil className="h-4 w-4" />
                编辑
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                destructive
                onClick={() => onDelete(provider)}
                disabled={isActive}
              >
                <Trash2 className="h-4 w-4" />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

/** The secondary line under the provider name: live quota for GLM/DeepSeek,
 *  or the API host for unsupported providers. */
function QuotaLine({
  kind,
  quota,
  baseUrl,
}: {
  kind: "glm" | "deepseek" | null;
  quota: ProviderQuota | null;
  baseUrl: string;
}) {
  if (kind === "glm") return <GlmQuota quota={quota} />;
  if (kind === "deepseek") return <DeepseekQuota quota={quota} />;
  // unsupported — show the host as a muted hint
  const host = baseUrl.replace(/^https?:\/\//, "").split("/")[0];
  return <p className="mt-0.5 truncate text-xs text-muted-foreground">{host}</p>;
}

/** GLM: compact single line — "5小时：100%  2h14m   7天：100%  2d14h".
 *  Remaining % is threshold-colored. Loading shows a hint until data arrives. */
function GlmQuota({ quota }: { quota: ProviderQuota | null }) {
  if (!quota) {
    return <p className="mt-0.5 text-xs text-muted-foreground">套餐信息加载中…</p>;
  }
  const Chip = ({ label, pct, resetMs }: { label: string; pct?: number; resetMs?: number }) => (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      {pct !== undefined ? (
        <span className={cn("font-medium tabular-nums", remainingColor(pct))}>{pct}%</span>
      ) : (
        <span className="text-muted-foreground">--</span>
      )}
      {resetMs !== undefined && (
        <span className="text-muted-foreground/70 tabular-nums">{formatReset(resetMs)}</span>
      )}
    </span>
  );
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
      <Chip label="5小时" pct={quota.fiveHourRemainingPct} resetMs={quota.fiveHourResetMs} />
      <Chip label="每周" pct={quota.weeklyRemainingPct} resetMs={quota.weeklyResetMs} />
    </div>
  );
}

/** DeepSeek: account balance + currency, threshold-colored. */
function DeepseekQuota({ quota }: { quota: ProviderQuota | null }) {
  if (!quota) {
    return <p className="mt-0.5 text-xs text-muted-foreground">余额加载中…</p>;
  }
  if (quota.balance === undefined) {
    return <p className="mt-0.5 text-xs text-muted-foreground">余额暂不可用</p>;
  }
  const cur = quota.currency === "USD" ? "$" : quota.currency === "CNY" ? "¥" : "";
  const color = quota.balance <= 0 ? "text-red-500" : "text-emerald-600 dark:text-emerald-400";
  return (
    <p className="mt-0.5 inline-flex items-center gap-1 text-xs">
      <span className="text-muted-foreground">余额</span>
      <span className={cn("font-medium tabular-nums", color)}>
        {cur}
        {quota.balance.toFixed(2)}
      </span>
    </p>
  );
}
