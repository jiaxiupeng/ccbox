import { useEffect, useId, useRef, useState } from "react";
import { ChevronsUpDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  options: string[];
  placeholder?: string;
  /** label for an optional trailing 1M toggle (only rendered when true) */
  show1m?: boolean;
  /** 1M toggle checked state */
  oneMillion?: boolean;
  /** 1M toggle handler */
  onToggle1m?: () => void;
  onChange: (v: string) => void;
}

/** Custom model picker: a button showing the current value, opening a plain
 *  dropdown (no search) of the available models. */
export function ModelSelect({
  value,
  options,
  placeholder = "选填",
  show1m = false,
  oneMillion = false,
  onToggle1m,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  // unique id per instance so multiple popovers don't collide on document lookups
  const popId = useId();

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return; // toggle handled by button
      const pop = document.getElementById(popId);
      if (pop && !pop.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, popId]);

  const pick = (m: string) => {
    onChange(m);
    setOpen(false);
  };

  return (
    <div className="relative flex flex-1 items-center gap-1.5">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-8 flex-1 items-center justify-between gap-1.5 rounded-md border border-input bg-background px-2.5 text-left text-xs transition-colors hover:bg-accent/50",
          !value && "text-muted-foreground",
        )}
      >
        <span className="truncate">{value || placeholder}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
      </button>

      {open && (
        <div
          id={popId}
          className="absolute left-0 top-[calc(100%+4px)] z-50 w-full min-w-[14rem] overflow-hidden rounded-md border border-border bg-popover p-1 shadow-lg"
        >
          <div className="max-h-48 overflow-y-auto py-0.5">
            {options.length === 0 ? (
              <div className="px-2.5 py-2 text-xs text-muted-foreground">
                暂无模型
              </div>
            ) : (
              options.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => pick(m)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-sm px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent",
                    value === m && "bg-accent/60",
                  )}
                >
                  <span className="truncate">{m}</span>
                  {value === m && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {show1m && (
        <label
          className="flex shrink-0 cursor-pointer select-none items-center gap-1 rounded-md border border-border bg-secondary px-1.5 py-1 text-[11px] text-secondary-foreground"
          title="智谱 1M 上下文：追加 [1m] 后缀"
        >
          <input
            type="checkbox"
            checked={oneMillion}
            onChange={onToggle1m}
            className="h-3.5 w-3.5 accent-primary"
          />
          1M
        </label>
      )}
    </div>
  );
}
