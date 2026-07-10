import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { chartColor } from "./palette";
import { formatCompactMoney, formatInt, formatMonth } from "@/utils/format";

interface Props {
  // Permissive on purpose — Recharts itself is `any`-typed and our callers
  // pass back-end-shaped objects (TrendBucket etc.) that don't satisfy a
  // strict Record<string, unknown> index signature in TS strict mode.
  data: object[];
  xKey: string;
  yKey: string;
  yKind?: "money" | "count";
  colorIndex?: number;
}

export function AreaTrendChart({ data, xKey, yKey, yKind = "money", colorIndex = 0 }: Props) {
  const fmt = yKind === "money" ? formatCompactMoney : formatInt;
  const color = chartColor(colorIndex);
  const gradientId = `area-grad-${colorIndex}`;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
        <XAxis
          dataKey={xKey}
          tickFormatter={(v) => (xKey === "month" ? formatMonth(v as string) : String(v))}
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tickFormatter={(v) => fmt(v as number)}
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={70}
        />
        <Tooltip
          formatter={(v: number) => fmt(v)}
          labelFormatter={(v) => (xKey === "month" ? formatMonth(v as string) : String(v))}
          contentStyle={{ fontSize: 12 }}
        />
        <Area type="monotone" dataKey={yKey} stroke={color} fill={`url(#${gradientId})`} strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
