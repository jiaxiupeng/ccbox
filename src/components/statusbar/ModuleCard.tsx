import { GripVertical } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { MODULE_DEFS } from "@/lib/statusbar";
import type { StatusBarModule } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  module: StatusBarModule;
  /** stable index in the list, used as the pointer-drop target id */
  index: number;
  onToggle: (enabled: boolean) => void;
  onChange: (patch: Partial<StatusBarModule>) => void;
  /** begin a drag from this card's handle (from useReorder) */
  onDragStart: (e: React.PointerEvent, index: number) => void;
  isDragging: boolean;
  isDragOver: boolean;
}

const FORMAT_LABELS: Record<string, string> = {
  percent: "百分比",
  frac: "分数",
  bar: "进度条",
  text: "文本",
};
const COLOR_LABELS: Record<string, string> = {
  threshold: "阈值变色",
  static: "固定",
};

export function ModuleCard({
  module,
  index,
  onToggle,
  onChange,
  onDragStart,
  isDragging,
  isDragOver,
}: Props) {
  const def = MODULE_DEFS[module.type];
  if (!def) return null;

  return (
    <div
      data-ridx={index}
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-card p-3 pl-4 transition-all",
        module.enabled
          ? "border-primary/60 ring-1 ring-primary/40"
          : "border-border hover:border-primary/30",
        isDragging && "opacity-40",
        isDragOver && "border-primary ring-1 ring-primary/40",
      )}
    >
      {/* enabled accent bar pinned to the left edge (matches ProviderCard) */}
      {module.enabled && (
        <span className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden />
      )}

      <div className="flex items-center gap-2.5">
        {/* drag handle — matches the provider card: subtle, shows on hover */}
        <button
          type="button"
          onPointerDown={(e) => onDragStart(e, index)}
          aria-label="拖拽排序"
          className="shrink-0 cursor-grab touch-none text-muted-foreground/40 opacity-0 transition-opacity hover:text-muted-foreground group-hover:opacity-100 active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium leading-tight">{def.label}</div>
        </div>

        {/* inline option chips for enabled modules — kept compact & on one row */}
        {module.enabled && (
          <div className="hidden items-center gap-3 sm:flex">
            {def.formats.length > 1 && (
              <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <select
                  value={module.format}
                  onChange={(e) => onChange({ format: e.target.value })}
                  className="h-6 rounded-md border border-border bg-background px-1 text-[11px] text-foreground"
                >
                  {def.formats.map((f) => (
                    <option key={f} value={f}>
                      {FORMAT_LABELS[f] ?? f}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {def.supportsThreshold && (
              <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <select
                  value={module.colorMode}
                  onChange={(e) => onChange({ colorMode: e.target.value })}
                  className="h-6 rounded-md border border-border bg-background px-1 text-[11px] text-foreground"
                >
                  {["threshold", "static"].map((c) => (
                    <option key={c} value={c}>
                      {COLOR_LABELS[c] ?? c}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        <Switch checked={module.enabled} onCheckedChange={onToggle} />
      </div>

      {/* bar-width slider — only for bar-format modules, on its own slim row */}
      {module.enabled && module.format === "bar" && def.supportsBar && (
        <div className="mt-2 flex items-center gap-2 pl-6 text-[11px] text-muted-foreground">
          <span>宽度</span>
          <input
            type="range"
            min={4}
            max={20}
            value={module.barWidth}
            onChange={(e) => onChange({ barWidth: Number(e.target.value) })}
            className="h-4 w-24 accent-gray-500"
          />
          <span className="w-5 tabular-nums text-foreground">{module.barWidth}</span>
        </div>
      )}
    </div>
  );
}
