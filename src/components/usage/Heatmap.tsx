import type { DayUsage } from "@/lib/types";
import { formatTokens, utc8Ymd, utc8Weekday } from "@/lib/utils";

// Each level: (fill, opacity). Level 0 = no activity.
const LEVELS: { fill: string; opacity: number }[] = [
  { fill: "hsl(var(--muted))", opacity: 0.4 },
  { fill: "hsl(var(--primary))", opacity: 0.28 },
  { fill: "hsl(var(--primary))", opacity: 0.5 },
  { fill: "hsl(var(--primary))", opacity: 0.75 },
  { fill: "hsl(var(--primary))", opacity: 1 },
];

const WEEKS = 53; // full year, GitHub-style
const ROWS = 7;

/** GitHub-style daily activity heatmap. Rendered as a width-filling SVG.
 *  Date keys are Beijing (UTC+8) calendar dates to match the backend's
 *  `byDay` keys — otherwise today's cell is blank at 00:00–08:00 Beijing. */
export function Heatmap({ data }: { data: DayUsage[] }) {
  const map = new Map(data.map((d) => [d.date, d.tokens]));

  const totalDays = WEEKS * ROWS;
  const days: { date: string; tokens: number }[] = [];
  for (let i = totalDays - 1; i >= 0; i--) {
    // utc8Ymd offsets by pure ms — no DST, exact day arithmetic.
    const date = utc8Ymd(Date.now() - i * 86400_000);
    days.push({ date, tokens: map.get(date) ?? 0 });
  }

  // pad the start so the first day lands on its weekday column
  const lead = utc8Weekday(days[0].date);
  const cells: ({ date: string; tokens: number } | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  cells.push(...days);

  const cols = Math.ceil(cells.length / ROWS);
  const nonzero = days.filter((d) => d.tokens > 0).map((d) => d.tokens);
  const max = Math.max(1, ...nonzero);
  const level = (t: number) => {
    if (t === 0) return 0;
    const r = t / max;
    if (r > 0.75) return 4;
    if (r > 0.5) return 3;
    if (r > 0.25) return 2;
    return 1;
  };

  const inset = 0.08;
  const activeDays = nonzero.length;

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>活跃热力图（近 {WEEKS} 周）</span>
        <span>{activeDays} 天活跃</span>
      </div>

      <svg
        viewBox={`0 0 ${cols} ${ROWS}`}
        width="100%"
        className="block h-auto w-full"
        preserveAspectRatio="none"
        role="img"
      >
        {cells.map((c, i) => {
          const col = Math.floor(i / ROWS);
          const row = i % ROWS;
          if (!c) return null;
          const lv = LEVELS[level(c.tokens)];
          return (
            <rect
              key={c.date}
              x={col + inset / 2}
              y={row + inset / 2}
              width={1 - inset}
              height={1 - inset}
              rx={0.16}
              fill={lv.fill}
              fillOpacity={lv.opacity}
            >
              <title>{`${c.date}：${formatTokens(c.tokens)} tokens`}</title>
            </rect>
          );
        })}
      </svg>

      <div className="flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
        <span>少</span>
        {LEVELS.map((lv, i) => (
          <span
            key={i}
            className="inline-block h-2.5 w-2.5 rounded-[2px]"
            style={{ background: lv.fill, opacity: lv.opacity }}
          />
        ))}
        <span>多</span>
      </div>
    </div>
  );
}
