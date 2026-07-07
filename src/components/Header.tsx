import { getCurrentWindow } from "@tauri-apps/api/window";
import { DownloadCloud } from "lucide-react";
import { AppLogo } from "@/components/AppLogo";
import { WindowControls } from "@/components/WindowControls";
import type { UpdateInfo } from "@/lib/useUpdateChecker";

interface HeaderProps {
  hasUpdate?: boolean;
  updateInfo?: UpdateInfo | null;
  onUpdateClick?: () => void;
}

/** Seamless top bar: logo + name on the left, window controls on the right.
 *  The whole bar is draggable to move the borderless window. No divider.
 *  When an update is available, a pulsing badge appears next to the name. */
export function Header({ hasUpdate, updateInfo, onUpdateClick }: HeaderProps) {
  const startDrag = () => getCurrentWindow().startDragging();
  return (
    <div className="flex items-center justify-between pl-4 pr-0 pt-2">
      {/* draggable spacer behind the title area */}
      <div
        onMouseDown={startDrag}
        className="flex flex-1 cursor-default items-center gap-2 py-1.5"
      >
        <AppLogo size={24} />
        <span className="text-[15px] font-semibold select-none">CCBox</span>
        {hasUpdate && (
          <button
            // Stop drag from firing when clicking the badge.
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onUpdateClick}
            className="relative ml-1 flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
            title={
              updateInfo
                ? `新版本 v${updateInfo.version} 可用，点击更新`
                : "新版本可用，点击更新"
            }
          >
            <DownloadCloud className="h-3.5 w-3.5" />
            新版本
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-red-500 ring-1 ring-background" />
          </button>
        )}
      </div>
      <WindowControls />
    </div>
  );
}
