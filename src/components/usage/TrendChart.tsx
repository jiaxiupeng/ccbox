import type { DayUsage } from "@/lib/types";
import { formatTokens } from "@/lib/utils";

interface Props {
  data: DayUsage[];
}

// Hand-rolled SVG bar chart (no charting dependency). Shows tokens/day.
export function TrendChart({ data }: Props) {
  const recent = data.slice(-30);
  if (recent.length === 0) {
    return (
      <div className="grid h-40 place-items-center text-sm text-muted-foreground">
        暂无趋势数据
      </div>
    );
  }
  const max = Math.max(1, ...recent.map((d) => d.tokens));
  const W = 100; // viewBox width units
  const H = 100;
  const barW = W / recent.length;

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>近 {recent.length} 天 Token 趋势</span>
        <span>峰值 {formatTokens(max)}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-40 w-full rounded-md border border-border bg-muted/30"
      >
        {recent.map((d, i) => {
          const h = (d.tokens / max) * (H - 4);
          const x = i * barW + barW * 0.15;
          const w = barW * 0.7;
          const y = H - h;
          return (
            <rect
              key={d.date}
              x={x}
              y={y}
              width={w}
              height={h}
              rx={0.6}
              className="fill-primary/70"
            >
              <title>{`${d.date}: ${formatTokens(d.tokens)} tokens`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{recent[0].date}</span>
        <span>{recent[recent.length - 1].date}</span>
      </div>
    </div>
  );
}
