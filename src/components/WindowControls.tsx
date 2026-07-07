import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** Custom window control buttons (minimize / maximize / close) for the
 *  borderless window. Placed in the top-right; the surrounding bar is draggable. */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onResized(() => {
      win.isMaximized().then(setMaximized).catch(() => {});
    });
    win.isMaximized().then(setMaximized).catch(() => {});
    return () => {
      unlisten.then((u) => u()).catch(() => {});
    };
  }, []);

  const minimize = () => getCurrentWindow().minimize();
  const toggleMax = () => getCurrentWindow().toggleMaximize();
  const close = () => getCurrentWindow().close();

  return (
    <div className="flex items-center">
      <CtrlBtn onClick={minimize} aria-label="最小化">
        <Minus className="h-3.5 w-3.5" />
      </CtrlBtn>
      <CtrlBtn onClick={toggleMax} aria-label="最大化">
        {maximized ? <Copy className="h-3 w-3" /> : <Square className="h-3 w-3" />}
      </CtrlBtn>
      <CtrlBtn
        onClick={close}
        aria-label="关闭"
        className="hover:bg-red-500 hover:text-white"
      >
        <X className="h-3.5 w-3.5" />
      </CtrlBtn>
    </div>
  );
}

function CtrlBtn({
  children,
  onClick,
  className,
  ...rest
}: {
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
  "aria-label": string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "grid h-8 w-9 place-items-center text-muted-foreground transition-colors",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
