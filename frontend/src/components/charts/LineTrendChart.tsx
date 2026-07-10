import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";

import { chartColor } from "./palette";
import { formatCompactMoney, formatInt, formatMonth } from "@/utils/format";

interface Props {
  /** Permissive — see note in AreaTrendChart Props. */
  data: object[];
  xKey: string;
  series: { key: string; label: string }[];
  /** "money" → compact ₹ formatter, otherwise integer count. */
  yKind?: "money" | "count";
}

export function LineTrendChart({ data, xKey, series, yKind = "money" }: Props) {
  const fmt = yKind === "money" ? formatCompactMoney : formatInt;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
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
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={chartColor(i)}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
