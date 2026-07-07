import { useState } from "react";
import { Download, RefreshCw, CheckCircle2 } from "lucide-react";
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
  onDownloadAndInstall: () => Promise<void>;
}

/** Modal showing a new version's changelog with a one-click download+install.
 *  During download it shows a progress bar and disables dismissal. */
export function UpdateDialog({
  open,
  onOpenChange,
  updateInfo,
  downloading,
  progress,
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
      onOpenChange={(o) => !downloading && onOpenChange(o)}
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
            <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-muted-foreground">
              {updateInfo.body}
            </pre>
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
          </div>
        )}

        {progress === 100 && !downloading && (
          <div className="flex items-center gap-2 text-sm text-primary">
            <CheckCircle2 className="h-4 w-4" />
            下载完成，正在安装并重启…
          </div>
        )}

        {err && (
          <p className="text-xs text-destructive">更新失败：{err}</p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            disabled={downloading}
            onClick={() => onOpenChange(false)}
          >
            稍后
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
