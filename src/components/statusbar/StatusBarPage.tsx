import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ModuleCard } from "./ModuleCard";
import { StatusBarPreview } from "./StatusBarPreview";
import { api } from "@/lib/api";
import { defaultStatusBarConfig, normalizeStatusBarConfig } from "@/lib/statusbar";
import { move, useReorder } from "@/lib/useReorder";
import type { ActiveProviderInfo, StatusBarConfig, StatusBarModule } from "@/lib/types";
import { cn } from "@/lib/utils";

export function StatusBarPage() {
  const [config, setConfig] = useState<StatusBarConfig>(defaultStatusBarConfig());
  const [active, setActive] = useState<ActiveProviderInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  // Load config + active-provider info on mount.
  useEffect(() => {
    (async () => {
      try {
        const [settings, info] = await Promise.all([
          api.getSettings(),
          api.getActiveProviderInfo(),
        ]);
        setConfig(normalizeStatusBarConfig(settings.statusBar));
        setActive(info);
      } catch (e) {
        toast.error(`加载失败：${e}`);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Persist the whole statusBar config whenever it changes (after initial load).
  const persist = useCallback(async (next: StatusBarConfig) => {
    try {
      const cur = await api.getSettings();
      await api.setSettings({ ...cur, statusBar: next });
    } catch (e) {
      toast.error(`保存失败：${e}`);
    }
  }, []);

  const update = (next: StatusBarConfig) => {
    setConfig(next);
    void persist(next);
  };

  const setModules = (modules: StatusBarModule[]) =>
    update({ ...config, modules });

  const toggleModule = (type: string, enabled: boolean) =>
    setModules(config.modules.map((m) => (m.type === type ? { ...m, enabled } : m)));

  const patchModule = (type: string, patch: Partial<StatusBarModule>) =>
    setModules(config.modules.map((m) => (m.type === type ? { ...m, ...patch } : m)));

  // ---- pointer-based reordering ----
  const reorder = useReorder((toIdx, fromIdx) => {
    setModules(move(config.modules, fromIdx, toIdx));
  });

  const handleApply = async () => {
    setApplying(true);
    try {
      const name = await api.applyStatusBar();
      const info = await api.getActiveProviderInfo();
      setActive(info);
      toast.success(`已写入 ~/.claude/settings.json（${name}）。重启 Claude Code 生效。`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setApplying(false);
    }
  };

  const canApply = !!active?.isGlm;
  const enabledCount = config.modules.filter((m) => m.enabled).length;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      {/* GLM applicability banner */}
      <div
        className={cn(
          "flex items-start gap-2 rounded-lg border p-3 text-xs leading-relaxed",
          canApply
            ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
            : "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300",
        )}
      >
        {canApply ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        ) : (
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
        )}
        <div>
          {canApply ? (
            <>
              当前激活供应商「{active?.name}」为 GLM，可应用自定义状态栏到 Claude Code。
              {active?.statuslineActive
                ? " 状态栏已启用，修改后无需重新应用即可在 CLI 生效。"
                : " 点击下方「应用到 CLI」安装并启用。"}
            </>
          ) : active?.name ? (
            <>
              当前激活的是「{active?.name}」。状态栏自定义仅适用于 GLM 供应商，请先在「供应商」页切换到 GLM。
            </>
          ) : (
            <>当前没有激活的供应商。请先在「供应商」页切换到 GLM 后再应用。</>
          )}
        </div>
      </div>

      {/* master switch */}
      <section className="flex items-center justify-between rounded-lg border border-border p-3">
        <div>
          <div className="text-sm font-medium">启用自定义状态栏</div>
          <div className="text-[11px] text-muted-foreground">
            关闭后 CCBox 不写入 Claude Code 的 statusLine
          </div>
        </div>
        <Switch
          checked={config.enabled}
          onCheckedChange={(v) => update({ ...config, enabled: v })}
        />
      </section>

      {/* live preview */}
      <section>
        <h3 className="mb-2 text-sm font-semibold">实时预览</h3>
        <StatusBarPreview config={config} />
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          上方为模拟数据，展示排列与样式效果；实际数值由 Claude Code 运行时提供。各项之间以「|」分隔。
        </p>
      </section>

      {/* module list */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            状态项
            <span className="ml-2 text-[11px] font-normal text-muted-foreground">
              已启用 {enabledCount} / {config.modules.length} · 拖拽手柄排序
            </span>
          </h3>
        </div>
        {loading ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            加载中…
          </div>
        ) : (
          <div className="grid gap-2">
            {config.modules.map((m, i) => (
              <ModuleCard
                key={m.type}
                module={m}
                index={i}
                isDragging={reorder.state.dragging === i}
                isDragOver={reorder.state.over === i && reorder.state.dragging !== i}
                onToggle={(enabled) => toggleModule(m.type, enabled)}
                onChange={(patch) => patchModule(m.type, patch)}
                onDragStart={reorder.start}
              />
            ))}
          </div>
        )}
      </section>

      <p className="rounded-lg bg-muted/50 p-3 text-[11px] leading-relaxed text-muted-foreground">
        工作原理：CCBox 把一个自包含的 Node 脚本写入{" "}
        <code className="rounded bg-background px-1">~/.ccbox/statusline.cjs</code>，并在{" "}
        <code className="rounded bg-background px-1">~/.claude/settings.json</code> 注册{" "}
        <code className="rounded bg-background px-1">statusLine</code>。脚本运行时实时读取此处的排列，
        所以调整后无需重新应用。额度类数据通过 GLM 监控接口获取（失败时显示 --）。
      </p>

      {/* inline apply bar */}
      <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-3 border-t border-border bg-background/90 px-4 py-3 backdrop-blur">
        <div className="text-[11px] leading-tight text-muted-foreground">
          {canApply
            ? active?.statuslineActive
              ? "状态栏已应用 · 可随时调整"
              : "尚未应用到 CLI"
            : "需切换到 GLM 供应商"}
        </div>
        <Button
          onClick={handleApply}
          disabled={!canApply || applying}
          className="bg-gray-600 text-white hover:bg-gray-700 dark:bg-gray-500 dark:hover:bg-gray-600"
        >
          {applying ? "应用中…" : "应用到 CLI"}
        </Button>
      </div>
    </div>
  );
}
