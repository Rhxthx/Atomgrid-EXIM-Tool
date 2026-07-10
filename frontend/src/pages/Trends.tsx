import { useMemo, useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { FilterPanel } from "@/components/filters/FilterPanel";
import { ChartCard } from "@/components/charts/ChartCard";
import { LineTrendChart } from "@/components/charts/LineTrendChart";
import { AreaTrendChart } from "@/components/charts/AreaTrendChart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useMonthlyTrends } from "@/hooks/queries";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import type { TrendBucket } from "@/types/api";

type GroupKey = "" | "Trade Type" | "HS Chapter" | "Origin Country" | "Destination Country";

export function TrendsPage() {
  const [filters, setFilters] = useUrlFilters();
  const [groupKey, setGroupKey] = useState<GroupKey>("Trade Type");

  const { data: total, isLoading: tLoading } = useMonthlyTrends(filters);
  const { data: grouped, isLoading: gLoading } = useMonthlyTrends({
    ...filters,
    group_by: groupKey ? [groupKey] : undefined,
  });

  // Pivot the long-format response into one row per month with one column per
  // group bucket so Recharts LineChart can plot multiple series.
  const { pivoted, series } = useMemo(() => {
    if (!grouped || !groupKey) return { pivoted: [], series: [] };
    const byMonth: Record<string, Record<string, unknown>> = {};
    const seriesSet = new Set<string>();
    for (const r of grouped.data) {
      const m = r.month;
      const k = String((r as unknown as Record<string, unknown>)[groupKey] ?? "—");
      seriesSet.add(k);
      byMonth[m] ??= { month: m };
      byMonth[m][k] = r.total_value;
    }
    return {
      pivoted: Object.values(byMonth).sort((a, b) => String(a.month).localeCompare(String(b.month))),
      series: [...seriesSet].sort().map((k) => ({ key: k, label: k })),
    };
  }, [grouped, groupKey]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Trends & Analytics"
        description="Monthly trade trajectories, sliceable by trade type, HS chapter or country."
      />

      <FilterPanel
        value={filters}
        onChange={setFilters}
        fields={["q", "trade_type", "hs_chapter", "hsn", "origin_country", "destination_country", "importer", "supplier"]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Monthly value"
          description="Total declared value, all filtered shipments"
          loading={tLoading}
          empty={!total?.data?.length}
        >
          <AreaTrendChart
            data={total?.data ?? []}
            xKey="month"
            yKey="total_value"
            yKind="money"
          />
        </ChartCard>

        <ChartCard
          title="Monthly shipment count"
          description="Number of shipments per month"
          loading={tLoading}
          empty={!total?.data?.length}
        >
          <AreaTrendChart
            data={(total?.data ?? []) as unknown as Array<Record<string, unknown>>}
            xKey="month"
            yKey="shipments"
            yKind="count"
            colorIndex={1}
          />
        </ChartCard>
      </div>

      <ChartCard
        title="Trend split"
        description="Split monthly value by the selected dimension"
        loading={gLoading}
        empty={pivoted.length === 0 || series.length === 0}
        height={360}
        actions={
          <div className="w-44">
            <Select value={groupKey} onValueChange={(v) => setGroupKey(v as GroupKey)}>
              <SelectTrigger>
                <SelectValue placeholder="Group by…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Trade Type">Trade Type</SelectItem>
                <SelectItem value="HS Chapter">HS Chapter</SelectItem>
                <SelectItem value="Origin Country">Origin Country</SelectItem>
                <SelectItem value="Destination Country">Destination Country</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      >
        <LineTrendChart
          data={pivoted}
          xKey="month"
          series={series.slice(0, 6)} // cap legend noise
          yKind="money"
        />
      </ChartCard>

      {/* Raw table view */}
      <ChartCard
        title="Monthly breakdown"
        description="Top 12 months by total value"
        loading={tLoading}
        empty={!total?.data?.length}
        height={260}
      >
        <MiniMonthTable rows={total?.data ?? []} />
      </ChartCard>
    </div>
  );
}

function MiniMonthTable({ rows }: { rows: TrendBucket[] }) {
  const sorted = [...rows]
    .filter((r) => r.month)
    .sort((a, b) => String(b.month).localeCompare(String(a.month)))
    .slice(0, 12);
  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5">Month</th>
            <th className="px-2 py-1.5">Shipments</th>
            <th className="px-2 py-1.5">Total value</th>
            <th className="px-2 py-1.5">Total qty</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.month} className="border-t border-border/60">
              <td className="px-2 py-1.5 font-mono text-xs">{r.month}</td>
              <td className="px-2 py-1.5">{Intl.NumberFormat("en-IN").format(r.shipments)}</td>
              <td className="px-2 py-1.5">
                {r.total_value === null ? "—" : Intl.NumberFormat("en-IN").format(Math.round(r.total_value))}
              </td>
              <td className="px-2 py-1.5">
                {r.total_quantity === null ? "—" : Intl.NumberFormat("en-IN").format(Math.round(r.total_quantity))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
