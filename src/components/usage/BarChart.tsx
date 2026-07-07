import { useRef, useState } from "react";
import { formatCNY, formatTokens } from "@/lib/utils";

interface ChartPoint {
  /** x-axis label, e.g. "2026-06-14" or "14:00" */
  label: string;
  tokens: number;
  cost: number;
}

interface Props {
  data: ChartPoint[];
  /** caption shown above the chart, e.g. "每小时 Token 用量" */
  caption?: string;
}

/** Width-filling SVG bar chart of token usage, with a hover tooltip. */
export function BarChart({ data, caption }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className="grid h-36 place-items-center text-sm text-muted-foreground">
        暂无趋势数据
      </div>
    );
  }

  const max = Math.max(1, ...data.map((d) => d.tokens));
  const n = data.length;
  const VB_W = 1000;
  const VB_H = 300;
  const pad = 14;
  const gap = n > 1 ? Math.min(3, 6 / n) : 0; // small gap between bars
  const barW = n > 1 ? (VB_W / n) - gap : VB_W * 0.6;
  const xOf = (i: number) => (n === 1 ? (VB_W - barW) / 2 : i * (barW + gap));
  const barH = (t: number) => Math.max(0.5, (t / max) * (VB_H - pad * 2));

  const onMove = (e: React.MouseEvent) => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const rx = (e.clientX - r.left) / r.width;
    const idx = Math.floor(rx * n);
    setHover(Math.max(0, Math.min(n - 1, idx)));
  };

  const hoverPt = hover != null ? data[hover] : null;
  // center of the hovered bar, in % of wrapper width
  const hoverXPct =
    hover != null
      ? (xOf(hover) + barW / 2) / VB_W * 100
      : 0;
  const hoverYPct = hoverPt
    ? (VB_H - barH(hoverPt.tokens)) / VB_H * 100
    : 0;

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{caption}</span>
        <span>峰值 {formatTokens(max)}</span>
      </div>

      <div
        ref={wrapRef}
        className="relative"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          width="100%"
          className="block h-36 w-full"
          preserveAspectRatio="none"
          role="img"
        >
          {data.map((d, i) => {
            const h = barH(d.tokens);
            const x = xOf(i);
            const y = VB_H - h;
            const active = hover === i;
            return (
              <rect
                key={i}
                x={x}
                y={y}
                width={barW}
                height={h}
                rx={Math.min(2, barW / 3)}
                fill="hsl(var(--primary))"
                fillOpacity={active ? 1 : 0.65}
              >
                <title>{`${d.label}：${formatTokens(d.tokens)} tokens`}</title>
              </rect>
            );
          })}
        </svg>

        {hoverPt && (
          <>
            {/* highlight the hovered bar (crisp HTML overlay) */}
            <div
              className="pointer-events-none absolute inset-y-0 w-px bg-foreground/20"
              style={{ left: `${hoverXPct}%` }}
            />
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover px-2 py-1 text-[11px] shadow-md"
              style={{
                left: `${hoverXPct}%`,
                top: `calc(${hoverYPct}% - 8px)`,
              }}
            >
              <div className="font-medium tabular-nums">{hoverPt.label}</div>
              <div className="text-muted-foreground tabular-nums">
                {formatTokens(hoverPt.tokens)} tokens
              </div>
              <div className="text-muted-foreground tabular-nums">
                {formatCNY(hoverPt.cost)}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{data[0].label}</span>
        <span>{data[n - 1].label}</span>
      </div>
    </div>
  );
}
