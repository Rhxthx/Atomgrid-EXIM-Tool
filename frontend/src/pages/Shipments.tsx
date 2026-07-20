import { useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { FilterPanel } from "@/components/filters/FilterPanel";
import { DataTable } from "@/components/table/DataTable";
import { shipmentColumns, ShipmentDetails } from "@/components/table/shipmentColumns";

import {
  useShipments,
  useStats,
  useExportRowLimit,
  useExportQuota,
  useShipmentAggregate,
} from "@/hooks/queries";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { buildExportUrl } from "@/services/endpoints";
import {
  SummaryStats,
  shipmentSelectionStats,
  shipmentAggregateStats,
} from "@/components/table/SelectionSummary";

const COLS = shipmentColumns();

export function ShipmentsPage() {
  const [filters, setFilters] = useUrlFilters({ page: 1, page_size: 50 });
  const { data, isLoading, isFetching } = useShipments(filters);
  const { data: stats } = useStats();
  const markets = Object.keys(stats?.reporting_countries ?? {});
  const exportRowLimit = useExportRowLimit();
  const quota = useExportQuota();
  const [allMatching, setAllMatching] = useState(false);
  const agg = useShipmentAggregate(filters, { enabled: allMatching });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Shipment Explorer"
        description="Drill into individual shipments with the full filter surface."
      />

      <FilterPanel
        value={filters}
        onChange={setFilters}
        reportingCountries={markets}
        marketCoverage={stats?.market_coverage}
        fields={[
          "q",
          "reporting_country",
          "trade_type",
          "hs_chapter",
          "hsn",
          "date_from",
          "date_to",
          "origin_country",
          "destination_country",
          "port",
          "importer",
          "exporter",
          "supplier",
          "buyer",
          "min_value",
          "max_value",
          "min_quantity",
          "max_quantity",
        ]}
      />

      <DataTable
        columns={COLS}
        data={data?.data ?? []}
        loading={isLoading || isFetching}
        csvFilename="shipments.csv"
        serverExportUrl={buildExportUrl(filters)}
        exportRowLimit={exportRowLimit}
        downloadsLeft={quota.data?.unlimited ? null : quota.data?.remaining ?? null}
        onExported={() => window.setTimeout(() => quota.refetch(), 1500)}
        selectable
        totalMatching={data?.meta.total ?? 0}
        allMatching={allMatching}
        onAllMatchingChange={setAllMatching}
        selectionResetKey={filters}
        renderSelectionSummary={({ selectedRows, allMatching: all }) => (
          <SummaryStats
            stats={
              all
                ? shipmentAggregateStats(agg.data, agg.isLoading)
                : shipmentSelectionStats(selectedRows)
            }
          />
        )}
        renderExpanded={(row) => <ShipmentDetails row={row} />}
        serverPagination={{
          page: filters.page ?? 1,
          pageSize: filters.page_size ?? 50,
          total: data?.meta.total ?? 0,
          onChange: ({ page, pageSize }) =>
            setFilters({ ...filters, page, page_size: pageSize }),
        }}
        serverSort={{
          sortBy: filters.sort_by,
          sortOrder: filters.sort_order,
          onChange: ({ sortBy, sortOrder }) =>
            setFilters({ ...filters, sort_by: sortBy, sort_order: sortOrder, page: 1 }),
        }}
      />
    </div>
  );
}
