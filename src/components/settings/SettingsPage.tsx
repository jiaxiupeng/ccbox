import { useEffect, useState } from "react";
import { Monitor, Moon, Sun, RefreshCw, DownloadCloud, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "@/lib/theme";
import { api } from "@/lib/api";
import type { Theme } from "@/lib/types";
import { cn } from "@/lib/utils";
import { version } from "@/../package.json";

interface SettingsPageProps {
  hasUpdate?: boolean;
  updateChecking?: boolean;
  onManualCheck?: () => void;
  onUpdateClick?: () => void;
}

/** The 6 Claude Code permission modes. Order = display order. The last one
 *  (bypassPermissions) is dangerous and gets a warning treatment in the UI. */
const PERMISSION_MODES: {
  value: string;
  label: string;
  desc: string;
  danger?: boolean;
}[] = [
  { value: "default", label: "默认", desc: "每次操作都询问授权" },
  { value: "acceptEdits", label: "自动接受编辑", desc: "文件编辑不再询问，其他仍询问" },
  { value: "plan", label: "计划模式", desc: "只读分析，不执行任何修改" },
  { value: "auto", label: "自动模式", desc: "自动接受大部分操作" },
  { value: "dontAsk", label: "不再询问", desc: "本次会话内不再弹出询问" },
  {
    value: "bypassPermissions",
    label: "跳过授权",
    desc: "⚠️ 完全跳过所有授权检查",
    danger: true,
  },
];

export function SettingsPage({
  hasUpdate,
  updateChecking,
  onManualCheck,
  onUpdateClick,
}: SettingsPageProps) {
  const { theme, setTheme } = useTheme();
  const opts: [Theme, typeof Sun, string][] = [
    ["light", Sun, "浅色"],
    ["dark", Moon, "深色"],
    ["system", Monitor, "跟随系统"],
  ];

  // Permission mode — loaded once on mount, written on click.
  const [permissionMode, setPermissionMode] = useState<string | null>(null);
  const [modeLoading, setModeLoading] = useState(false);

  useEffect(() => {
    api.getPermissionMode().then(setPermissionMode).catch(() => {});
  }, []);

  const handleModeChange = async (mode: string) => {
    if (mode === permissionMode) return;
    setModeLoading(true);
    try {
      await api.setPermissionMode(mode);
      setPermissionMode(mode);
      const matched = PERMISSION_MODES.find((m) => m.value === mode);
      toast.success(`权限模式已切换为「${matched?.label ?? mode}」`);
    } catch (e) {
      toast.error(`切换失败：${e}`);
    } finally {
      setModeLoading(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-xl gap-5 p-4">
      <section className="grid gap-2">
        <h3 className="text-sm font-semibold">外观主题</h3>
        <div className="flex gap-2">
          {opts.map(([v, Icon, label]) => (
            <button
              key={v}
              onClick={() => setTheme(v)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors",
                theme === v
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:bg-accent",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">权限模式</h3>
          <span className="text-xs text-muted-foreground">
            写入 ~/.claude/settings.json
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {PERMISSION_MODES.map((m) => (
            <button
              key={m.value}
              onClick={() => handleModeChange(m.value)}
              disabled={modeLoading}
              className={cn(
                "rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50",
                permissionMode === m.value
                  ? m.danger
                    ? "border-destructive bg-destructive/10 text-destructive"
                    : "border-primary bg-primary/10 text-primary"
                  : m.danger
                    ? "border-destructive/30 hover:bg-destructive/5"
                    : "border-border hover:bg-accent",
              )}
            >
              <div className="flex items-center gap-1.5 font-medium">
                {m.danger && <ShieldAlert className="h-3.5 w-3.5" />}
                {m.label}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{m.desc}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-1.5">
        <h3 className="text-sm font-semibold">关于</h3>
        <p className="text-sm">CCBox · Claude Code 配置切换与用量查看</p>
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">
            版本 {version} · 轻量本地工具
          </p>
          {/* Update status: badge → view update; otherwise → manual check */}
          {hasUpdate ? (
            <button
              onClick={onUpdateClick}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
            >
              <DownloadCloud className="h-3 w-3" />
              有新版本
            </button>
          ) : (
            <button
              onClick={onManualCheck}
              disabled={updateChecking}
              className="inline-flex items-center gap-1 text-xs text-primary transition-colors hover:underline disabled:opacity-50"
            >
              {updateChecking ? (
                <>
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  检查中…
                </>
              ) : (
                "检查更新"
              )}
            </button>
          )}
        </div>
        <div className="mt-2 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
          <div>供应商配置：~/.ccbox/providers.json</div>
          <div>切换写入：~/.claude/settings.json 的 env 字段</div>
          <div>用量数据源：~/.claude/projects/**/*.jsonl</div>
          <div className="mt-1.5 text-muted-foreground/70">
            所有操作均在本地完成，API Key 仅保存在本机，不上传。
          </div>
        </div>
      </section>
    </div>
  );
}
