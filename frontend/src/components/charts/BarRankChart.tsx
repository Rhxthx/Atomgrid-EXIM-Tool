import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { chartColor } from "./palette";
import { formatCompactMoney, formatInt, truncate } from "@/utils/format";

interface Props {
  data: Array<{ name: string; value: number }>;
  /** Horizontal bars work better for long category names. */
  orientation?: "horizontal" | "vertical";
  valueKind?: "money" | "count";
  colorIndex?: number;
}

export function BarRankChart({
  data,
  orientation = "horizontal",
  valueKind = "money",
  colorIndex = 0,
}: Props) {
  const fmt = valueKind === "money" ? formatCompactMoney : formatInt;
  const isHorizontal = orientation === "horizontal";

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout={isHorizontal ? "vertical" : "horizontal"}
        margin={{ top: 4, right: 16, left: 0, bottom: isHorizontal ? 0 : 24 }}
      >
        <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
        {isHorizontal ? (
          <>
            <XAxis type="number" tickFormatter={(v) => fmt(v as number)} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis
              dataKey="name"
              type="category"
              width={170}
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => truncate(v as string, 24)}
            />
          </>
        ) : (
          <>
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11 }}
              angle={-30}
              textAnchor="end"
              height={50}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => truncate(v as string, 14)}
            />
            <YAxis tickFormatter={(v) => fmt(v as number)} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={70} />
          </>
        )}
        <Tooltip
          formatter={(v: number) => fmt(v)}
          contentStyle={{ fontSize: 12 }}
          cursor={{ fill: "hsl(var(--accent) / 0.5)" }}
        />
        <Bar dataKey="value" fill={chartColor(colorIndex)} radius={[4, 4, 4, 4]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
