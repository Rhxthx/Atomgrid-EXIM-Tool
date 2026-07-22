import { useMemo } from "react";
import { Database, Building2, Truck, Factory, Boxes, Globe, Calendar } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { ChartCard } from "@/components/charts/ChartCard";
import { AreaTrendChart } from "@/components/charts/AreaTrendChart";
import { BarRankChart } from "@/components/charts/BarRankChart";
import { DonutSplitChart } from "@/components/charts/DonutSplitChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import {
  useCountryAnalysis,
  useMonthlyTrends,
  useStats,
  useTopEntities,
} from "@/hooks/queries";
import { formatCompactMoney, formatDate, formatInt, truncate } from "@/utils/format";

export function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useStats();
  const { data: trends, isLoading: trendsLoading } = useMonthlyTrends({});
  const { data: topImporters, isLoading: impLoading } = useTopEntities("importers", { limit: 8 });
  const { data: topSuppliers, isLoading: supLoading } = useTopEntities("suppliers", { limit: 8 });
  const { data: countries, isLoading: countriesLoading } = useCountryAnalysis({ limit: 8 });

  // Compute QoQ trend on total monthly value — last bucket vs. previous.
  const valueTrend = useMemo(() => {
    const series = trends?.data ?? [];
    if (series.length < 2) return null;
    const a = series[series.length - 2].total_value ?? 0;
    const b = series[series.length - 1].total_value ?? 0;
    if (!a) return null;
    return ((b - a) / a) * 100;
  }, [trends]);

  const tradeTypeBreakdown = useMemo(
    () =>
      Object.entries(stats?.trade_types ?? {}).map(([name, value]) => ({
        name,
        value,
      })),
    [stats]
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" />

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total shipments"
          value={stats ? formatInt(stats.total_rows) : "—"}
          icon={Database}
          loading={statsLoading}
          hint="post-dedupe"
        />
        <KpiCard
          label="Importers"
          value={stats ? formatInt(stats.distinct_importers) : "—"}
          icon={Building2}
          loading={statsLoading}
        />
        <KpiCard
          label="Suppliers"
          value={stats ? formatInt(stats.distinct_suppliers) : "—"}
          icon={Factory}
          loading={statsLoading}
        />
        <KpiCard
          label="HSN codes"
          value={stats ? formatInt(stats.distinct_hsn) : "—"}
          icon={Boxes}
          loading={statsLoading}
        />
        <KpiCard
          label="Exporters"
          value={stats ? formatInt(stats.distinct_exporters) : "—"}
          icon={Truck}
          loading={statsLoading}
        />
        <KpiCard
          label="Counterparty countries"
          value={stats ? formatInt(stats.distinct_countries) : "—"}
          icon={Globe}
          loading={statsLoading}
        />
        <KpiCard
          label="Coverage"
          value={
            stats
              ? `${formatDate(stats.date_min)} → ${formatDate(stats.date_max)}`
              : "—"
          }
          icon={Calendar}
          loading={statsLoading}
        />
        <KpiCard
          label="MoM value Δ"
          value={
            valueTrend === null ? "—" : `${valueTrend >= 0 ? "+" : ""}${valueTrend.toFixed(1)}%`
          }
          trend={valueTrend ?? null}
          trendLabel="vs prev month"
          loading={trendsLoading}
        />
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartCard
          title="Monthly trade value"
          description="All trade types, total declared value"
          loading={trendsLoading}
          empty={!trends?.data?.length}
          className="lg:col-span-2"
        >
          <AreaTrendChart
            data={trends?.data ?? []}
            xKey="month"
            yKey="total_value"
            yKind="money"
          />
        </ChartCard>

        <ChartCard
          title="Imports vs exports"
          description="Row split across trade types"
          loading={statsLoading}
          empty={tradeTypeBreakdown.length === 0}
        >
          <DonutSplitChart data={tradeTypeBreakdown} />
        </ChartCard>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Top importers by value"
          loading={impLoading}
          empty={!topImporters?.data?.length}
          height={340}
        >
          <BarRankChart
            data={(topImporters?.data ?? []).map((d) => ({
              name: d.name,
              value: d.total_value ?? 0,
            }))}
            colorIndex={0}
          />
        </ChartCard>

        <ChartCard
          title="Top suppliers by value"
          loading={supLoading}
          empty={!topSuppliers?.data?.length}
          height={340}
        >
          <BarRankChart
            data={(topSuppliers?.data ?? []).map((d) => ({
              name: d.name,
              value: d.total_value ?? 0,
            }))}
            colorIndex={2}
          />
        </ChartCard>
      </div>

      {/* Countries grid (heatmap-style cards) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Top counterparty countries</CardTitle>
        </CardHeader>
        <CardContent>
          {countriesLoading ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {(countries?.data ?? []).slice(0, 8).map((row, i) => (
                <CountryTile key={`${row.country}-${row.trade_type}-${i}`} row={row} index={i} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CountryTile({
  row,
  index,
}: {
  row: {
    country: string | null;
    trade_type: string | null;
    shipments: number;
    total_value: number | null;
  };
  index: number;
}) {
  // Intensity scales colour intensity-style across the 8-tile grid.
  const heat = Math.max(0, 1 - index * 0.1);
  return (
    <div
      className="rounded-md border bg-card p-3"
      style={{
        background: `linear-gradient(135deg, hsl(var(--primary) / ${heat * 0.18}), hsl(var(--card)))`,
      }}
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium" title={row.country ?? undefined}>
          {truncate(row.country, 18)}
        </div>
        {row.trade_type && (
          <Badge variant="outline" className="text-[10px]">
            {row.trade_type}
          </Badge>
        )}
      </div>
      <div className="mt-1.5 text-lg font-semibold">{formatCompactMoney(row.total_value)}</div>
      <div className="text-[11px] text-muted-foreground">{formatInt(row.shipments)} shipments</div>
    </div>
  );
}
