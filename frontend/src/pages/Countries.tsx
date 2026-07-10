import { Link } from "react-router-dom";

import { PageHeader } from "@/components/PageHeader";
import { FilterPanel } from "@/components/filters/FilterPanel";
import { DataTable } from "@/components/table/DataTable";
import { ChartCard } from "@/components/charts/ChartCard";
import { BarRankChart } from "@/components/charts/BarRankChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

import { useCountryAnalysis } from "@/hooks/queries";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { formatCompactMoney, formatInt, truncate } from "@/utils/format";
import type { CountryAnalysisRow } from "@/types/api";

export function CountriesPage() {
  const [filters, setFilters] = useUrlFilters({ page: 1, page_size: 50 });
  const { data, isLoading } = useCountryAnalysis({ ...filters, limit: 50 });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Country Trade Analysis"
        description="Counterparty countries ranked by total declared value."
      />

      <FilterPanel
        value={filters}
        onChange={setFilters}
        fields={["q", "trade_type", "hs_chapter", "hsn", "date_from", "date_to", "country"]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Top countries by value"
          loading={isLoading}
          empty={!data?.data?.length}
          height={420}
        >
          <BarRankChart
            data={(data?.data ?? []).slice(0, 15).map((d: CountryAnalysisRow) => ({
              name: d.country ?? "—",
              value: d.total_value ?? 0,
            }))}
            colorIndex={5}
          />
        </ChartCard>

        {/* Heatmap-style grid */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Geography heatmap</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {Array.from({ length: 12 }).map((_, i) => (
                  <Skeleton key={i} className="h-20" />
                ))}
              </div>
            ) : (
              <Heatmap rows={data?.data?.slice(0, 12) ?? []} />
            )}
          </CardContent>
        </Card>
      </div>

      <DataTable
        columns={[
          { id: "country", accessorKey: "country", header: "Country", size: 200 },
          {
            id: "trade_type",
            accessorKey: "trade_type",
            header: "Type",
            size: 100,
            cell: ({ getValue }) => {
              const v = getValue() as string | null;
              return v ? <Badge variant="outline">{v}</Badge> : "—";
            },
          },
          {
            id: "shipments",
            accessorKey: "shipments",
            header: "Shipments",
            size: 110,
            cell: ({ getValue }) => formatInt(getValue() as number),
          },
          {
            id: "total_value",
            accessorKey: "total_value",
            header: "Total value",
            size: 140,
            cell: ({ getValue }) => formatCompactMoney(getValue() as number | null),
          },
          {
            id: "total_quantity",
            accessorKey: "total_quantity",
            header: "Total qty",
            size: 130,
            cell: ({ getValue }) => formatInt(getValue() as number | null),
          },
          {
            id: "unique_importers",
            accessorKey: "unique_importers",
            header: "Importers",
            size: 110,
            cell: ({ getValue }) => formatInt(getValue() as number),
          },
          {
            id: "unique_exporters",
            accessorKey: "unique_exporters",
            header: "Exporters",
            size: 110,
            cell: ({ getValue }) => formatInt(getValue() as number),
          },
          {
            id: "_drill",
            header: "",
            size: 130,
            cell: ({ row }) => (
              <Link
                to={`/shipments?country=${encodeURIComponent(row.original.country ?? "")}`}
                className="text-xs text-primary hover:underline"
              >
                Open shipments →
              </Link>
            ),
          },
        ]}
        data={data?.data ?? []}
        loading={isLoading}
        csvFilename="country-analysis.csv"
      />
    </div>
  );
}

function Heatmap({ rows }: { rows: CountryAnalysisRow[] }) {
  if (rows.length === 0) {
    return <div className="text-sm text-muted-foreground">No data.</div>;
  }
  const max = Math.max(...rows.map((r) => r.total_value ?? 0));
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {rows.map((r, i) => {
        const intensity = Math.min(1, ((r.total_value ?? 0) / max) ** 0.7);
        return (
          <div
            key={`${r.country}-${i}`}
            className="rounded-md border p-2 transition-transform hover:scale-[1.02]"
            style={{
              background: `hsl(var(--primary) / ${intensity * 0.35 + 0.04})`,
            }}
            title={`${r.country} — ${formatCompactMoney(r.total_value)}`}
          >
            <div className="truncate text-xs font-medium">{truncate(r.country, 16)}</div>
            <div className="mt-1 text-sm font-semibold">{formatCompactMoney(r.total_value)}</div>
            <div className="text-[10px] text-muted-foreground">{formatInt(r.shipments)} shp</div>
          </div>
        );
      })}
    </div>
  );
}
