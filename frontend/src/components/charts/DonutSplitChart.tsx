import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, Legend } from "recharts";

import { chartColor } from "./palette";
import { formatInt } from "@/utils/format";

interface Props {
  data: Array<{ name: string; value: number }>;
}

export function DonutSplitChart({ data }: Props) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius="60%"
          outerRadius="85%"
          paddingAngle={2}
          stroke="hsl(var(--background))"
        >
          {data.map((_, i) => (
            <Cell key={i} fill={chartColor(i)} />
          ))}
        </Pie>
        <Tooltip formatter={(v: number) => formatInt(v)} contentStyle={{ fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
