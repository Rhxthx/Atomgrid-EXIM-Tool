import { Link } from "react-router-dom";

import { PageHeader } from "@/components/PageHeader";
import { FilterPanel } from "@/components/filters/FilterPanel";
import { DataTable } from "@/components/table/DataTable";
import { ChartCard } from "@/components/charts/ChartCard";
import { BarRankChart } from "@/components/charts/BarRankChart";

import { useHsnAnalysis, useKeywords } from "@/hooks/queries";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { formatCompactMoney, formatInt, truncate } from "@/utils/format";
import type { HSNAnalysisRow } from "@/types/api";

export function HsnPage() {
  const [filters, setFilters] = useUrlFilters({ page: 1, page_size: 50 });
  const { data, isLoading } = useHsnAnalysis({ ...filters, limit: 50 });
  const { data: keywords, isLoading: kwLoading } = useKeywords({
    ...filters,
    limit: 25,
    sample_size: 50_000,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="HSN Analysis"
        description="Aggregated view per HSN code with top counterparty per row."
      />

      <FilterPanel
        value={filters}
        onChange={setFilters}
        fields={["q", "trade_type", "hs_chapter", "hsn", "date_from", "date_to", "origin_country", "destination_country"]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Top HSN codes by value"
          loading={isLoading}
          empty={!data?.data?.length}
          height={360}
        >
          <BarRankChart
            data={(data?.data ?? []).slice(0, 15).map((d: HSNAnalysisRow) => ({
              name: d.hsn ?? "—",
              value: d.total_value ?? 0,
            }))}
            colorIndex={1}
          />
        </ChartCard>

        <ChartCard
          title="Top product keywords"
          description="Sampled from filtered shipment descriptions"
          loading={kwLoading}
          empty={!keywords?.keywords?.length}
          height={360}
        >
          <BarRankChart
            data={(keywords?.keywords ?? []).slice(0, 15).map((k) => ({
              name: k.keyword,
              value: k.occurrences,
            }))}
            valueKind="count"
            colorIndex={3}
          />
        </ChartCard>
      </div>

      <DataTable
        columns={[
          {
            id: "hsn",
            accessorKey: "hsn",
            header: "HSN",
            size: 120,
            cell: ({ getValue }) => (
              <span className="font-mono text-xs">{String(getValue() ?? "—")}</span>
            ),
          },
          { id: "hs_chapter", accessorKey: "hs_chapter", header: "Chapter", size: 100 },
          { id: "trade_type", accessorKey: "trade_type", header: "Type", size: 100 },
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
            id: "top_importer",
            accessorKey: "top_importer",
            header: "Top importer",
            size: 220,
            cell: ({ getValue }) => (
              <span title={(getValue() as string) ?? undefined}>
                {truncate(getValue() as string | null, 36)}
              </span>
            ),
          },
          {
            id: "top_exporter",
            accessorKey: "top_exporter",
            header: "Top exporter",
            size: 220,
            cell: ({ getValue }) => (
              <span title={(getValue() as string) ?? undefined}>
                {truncate(getValue() as string | null, 36)}
              </span>
            ),
          },
          {
            id: "_drill",
            header: "",
            size: 130,
            cell: ({ row }) => (
              <Link
                to={`/shipments?hsn=${encodeURIComponent(row.original.hsn ?? "")}`}
                className="text-xs text-primary hover:underline"
              >
                Open shipments →
              </Link>
            ),
          },
        ]}
        data={data?.data ?? []}
        loading={isLoading}
        csvFilename="hsn-analysis.csv"
      />
    </div>
  );
}
