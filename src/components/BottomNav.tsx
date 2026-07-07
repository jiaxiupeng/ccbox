import { Activity, BarChart3, LayoutGrid, Plus, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  tab: string;
  onTab: (t: "providers" | "usage" | "statusbar" | "settings") => void;
  onAdd: () => void;
}

/** Floating bottom controls. Left: switch between 供应商 / 使用量.
 *  Right: 设置 icon. Above the right corner: a prominent ➕ FAB (providers only). */
export function BottomNav({ tab, onTab, onAdd }: Props) {
  return (
    <>
      {/* prominent add FAB — only on the providers tab */}
      {tab === "providers" && (
        <button
          onClick={onAdd}
          aria-label="添加供应商"
          className={cn(
            "absolute bottom-20 right-5 z-20 grid h-12 w-12 place-items-center rounded-full",
            "bg-gray-600 text-white shadow-lg",
            "dark:bg-gray-500",
            "transition-transform hover:scale-105 hover:bg-gray-700 active:scale-95",
          )}
        >
          <Plus className="h-6 w-6" strokeWidth={2.5} />
        </button>
      )}

      {/* bottom bar */}
      <div className="flex items-center justify-between border-t border-border/60 bg-background/80 px-3 py-2 backdrop-blur">
        {/* left: provider / usage switch */}
        <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-0.5">
          <NavBtn
            active={tab === "providers"}
            onClick={() => onTab("providers")}
            icon={<LayoutGrid className="h-4 w-4" />}
            label="供应商"
          />
          <NavBtn
            active={tab === "usage"}
            onClick={() => onTab("usage")}
            icon={<BarChart3 className="h-4 w-4" />}
            label="使用量"
          />
          <NavBtn
            active={tab === "statusbar"}
            onClick={() => onTab("statusbar")}
            icon={<Activity className="h-4 w-4" />}
            label="状态栏"
          />
        </div>

        {/* right: settings */}
        <button
          onClick={() => onTab("settings")}
          aria-label="设置"
          className={cn(
            "grid h-9 w-9 place-items-center rounded-lg transition-colors",
            tab === "settings"
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <Settings className="h-[18px] w-[18px]" />
        </button>
      </div>
    </>
  );
}

function NavBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
