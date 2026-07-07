import { Monitor, Moon, Sun, RefreshCw, DownloadCloud } from "lucide-react";
import { useTheme } from "@/lib/theme";
import type { Theme } from "@/lib/types";
import { cn } from "@/lib/utils";
import { version } from "@/../package.json";

interface SettingsPageProps {
  hasUpdate?: boolean;
  updateChecking?: boolean;
  onManualCheck?: () => void;
  onUpdateClick?: () => void;
}

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
