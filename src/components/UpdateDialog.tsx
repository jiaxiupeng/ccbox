import { useState } from "react";
import { Download, RefreshCw, CheckCircle2, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { UpdateInfo } from "@/lib/useUpdateChecker";

interface UpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  updateInfo: UpdateInfo | null;
  downloading: boolean;
  progress: number;
  /** Human-readable download stats from the hook, e.g. "1.2 / 3.4 MB · 580 KB/s". */
  downloadStats?: string;
  onDownloadAndInstall: () => Promise<void>;
}

/** Minimal markdown renderer for changelog text. Handles just the subset our
 *  CHANGELOG.md uses: headings (## ###), list items (-), bold (**), and inline
 *  code (`). Avoids pulling in a full markdown lib for ~10 lines of content. */
function renderMarkdown(md: string) {
  const lines = md.split(/\r?\n/);
  const out: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = (key: number) => {
    if (listItems.length === 0) return;
    out.push(
      <ul key={`ul-${key}`} className="grid gap-1">
        {listItems.map((li, i) => (
          <li key={i} className="flex gap-1.5">
            <span className="text-muted-foreground">·</span>
            <span>{renderInline(li)}</span>
          </li>
        ))}
      </ul>,
    );
    listItems = [];
  };

  const renderInline = (text: string): React.ReactNode => {
    // Split on **bold** and `code`, preserving the delimiters.
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return parts.map((p, i) => {
      if (p.startsWith("**") && p.endsWith("**")) {
        return (
          <strong key={i} className="font-semibold text-foreground">
            {p.slice(2, -2)}
          </strong>
        );
      }
      if (p.startsWith("`") && p.endsWith("`")) {
        return (
          <code
            key={i}
            className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]"
          >
            {p.slice(1, -1)}
          </code>
        );
      }
      return <span key={i}>{p}</span>;
    });
  };

  lines.forEach((line, i) => {
    const h3 = line.match(/^###\s+(.*)/);
    const h2 = line.match(/^##\s+(.*)/);
    const li = line.match(/^[-*]\s+(.*)/);
    if (h3) {
      flushList(i);
      out.push(
        <p key={i} className="text-xs font-semibold text-foreground">
          {renderInline(h3[1])}
        </p>,
      );
    } else if (h2) {
      flushList(i);
      out.push(
        <p key={i} className="text-sm font-bold text-foreground">
          {renderInline(h2[1])}
        </p>,
      );
    } else if (li) {
      listItems.push(li[1]);
    } else if (line.trim() === "") {
      flushList(i);
    } else {
      flushList(i);
      out.push(
        <p key={i} className="text-xs">
          {renderInline(line)}
        </p>,
      );
    }
  });
  flushList(lines.length);
  return out;
}

/** Modal showing a new version's changelog with a one-click download+install.
 *  During download it shows a progress bar + speed and disables dismissal. */
export function UpdateDialog({
  open,
  onOpenChange,
  updateInfo,
  downloading,
  progress,
  downloadStats,
  onDownloadAndInstall,
}: UpdateDialogProps) {
  const [err, setErr] = useState<string | null>(null);

  const handleUpdate = async () => {
    setErr(null);
    try {
      await onDownloadAndInstall();
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5 text-primary" />
            发现新版本
          </DialogTitle>
          <DialogDescription>
            CCBox {updateInfo?.version} 已发布，建议立即更新。
          </DialogDescription>
        </DialogHeader>

        {updateInfo?.body && (
          <div className="max-h-44 overflow-auto rounded-lg bg-muted/50 p-3">
            <div className="grid gap-1.5 text-xs leading-relaxed text-muted-foreground">
              {renderMarkdown(updateInfo.body)}
            </div>
          </div>
        )}

        {downloading && (
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>正在下载更新…</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            {downloadStats && (
              <p className="text-center text-[11px] text-muted-foreground/70">
                {downloadStats}
              </p>
            )}
            <p className="text-center text-[11px] text-muted-foreground/60">
              下载较慢？GitHub 服务器在海外，请耐心等待或
              <a
                href="https://github.com/jiaxiupeng/ccbox/releases/latest"
                target="_blank"
                rel="noreferrer"
                className="ml-1 inline-flex items-center gap-0.5 text-primary hover:underline"
              >
                从浏览器下载
                <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          </div>
        )}

        {progress === 100 && !downloading && (
          <div className="flex items-center gap-2 text-sm text-primary">
            <CheckCircle2 className="h-4 w-4" />
            下载完成，正在安装并重启…
          </div>
        )}

        {err && <p className="text-xs text-destructive">更新失败：{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (downloading) {
                // Confirm before cancelling an in-progress download — closing
                // the dialog aborts it and the user must restart next time.
                if (!window.confirm("关闭将取消正在进行的下载，确定吗？")) return;
              }
              onOpenChange(false);
            }}
          >
            {downloading ? "取消下载" : "稍后"}
          </Button>
          <Button size="sm" disabled={downloading} onClick={handleUpdate}>
            {downloading ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                更新中…
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                立即更新
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
