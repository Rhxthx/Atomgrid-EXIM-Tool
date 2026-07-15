import { useMemo, useState } from "react";
import { FlaskConical, Globe2, Layers, DollarSign } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { DataTable } from "@/components/table/DataTable";
import { agBioColumns, AgBioDetails } from "@/components/table/agbioColumns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { useAgBioStats, useAgBioSearch, useExportRowLimit } from "@/hooks/queries";
import { buildAgBioExportUrl } from "@/services/endpoints";
import { useDebounce } from "@/hooks/useDebounce";
import { formatInt, truncate } from "@/utils/format";

function usdM(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e3) return `$${(v / 1e3).toFixed(2)} B`;
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })} M`;
}

function RankCard({ title, items }: { title: string; items?: { name: string; total_usd_m: number }[] }) {
  const max = items && items.length ? items[0].total_usd_m : 1;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {(items ?? []).slice(0, 8).map((it) => (
          <div key={it.name} className="text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate" title={it.name}>{truncate(it.name, 26)}</span>
              <span className="shrink-0 text-muted-foreground">{usdM(it.total_usd_m)}</span>
            </div>
            <div className="mt-0.5 h-1 rounded bg-muted">
              <div className="h-1 rounded bg-primary" style={{ width: `${(it.total_usd_m / max) * 100}%` }} />
            </div>
          </div>
        ))}
        {(!items || items.length === 0) && (
          <div className="text-sm text-muted-foreground">No data.</div>
        )}
      </CardContent>
    </Card>
  );
}

export function AgBioPage() {
  const { data: stats, isLoading: statsLoading } = useAgBioStats();
  const exportRowLimit = useExportRowLimit();

  const [product, setProduct] = useState("");
  const [country, setCountry] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<{ by?: string; order?: "asc" | "desc" }>({
    by: "total_usd_m", order: "desc",
  });

  const productD = useDebounce(product, 300);
  const countryD = useDebounce(country, 300);

  const filters = useMemo(
    () => ({
      product: productD || undefined,
      country: countryD || undefined,
      sort_by: sort.by,
      sort_order: sort.order,
      page,
      page_size: pageSize,
    }),
    [productD, countryD, sort, page, pageSize]
  );

  const { data, isLoading, isFetching } = useAgBioSearch(filters);

  return (
    <div className="space-y-4">
      <PageHeader
        title="AG-Bio Market"
        description="Crop-protection active-ingredient market values by country — a separate reference dataset from the EXIM shipment tables."
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Product × Country rows" value={formatInt(stats?.total_rows)} loading={statsLoading}
          icon={Layers} />
        <KpiCard label="Products" value={formatInt(stats?.distinct_products)} loading={statsLoading}
          icon={FlaskConical} />
        <KpiCard label="Countries" value={formatInt(stats?.distinct_countries)} loading={statsLoading}
          icon={Globe2} />
        <KpiCard label="Total Market Value" value={usdM(stats?.total_value_usd_m)} loading={statsLoading}
          icon={DollarSign} hint="USD millions" />
      </div>

      {/* Rankings */}
      <div className="grid gap-4 md:grid-cols-2">
        <RankCard title="Top products by value" items={stats?.top_products} />
        <RankCard title="Top countries by value" items={stats?.top_countries} />
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Product (active ingredient)</Label>
          <Input placeholder="glyphosate"
            value={product} onChange={(e) => { setProduct(e.target.value); setPage(1); }} />
        </div>
        <div className="space-y-1.5">
          <Label>Country</Label>
          <Input placeholder="brazil"
            value={country} onChange={(e) => { setCountry(e.target.value); setPage(1); }} />
        </div>
      </div>

      <DataTable
        columns={agBioColumns}
        data={data?.data ?? []}
        loading={isLoading || isFetching}
        emptyMessage="No matching products/countries — try fewer filters or check spelling."
        csvFilename="agbio_market.csv"
        serverExportUrl={buildAgBioExportUrl(filters)}
        exportRowLimit={exportRowLimit}
        renderExpanded={(row) => <AgBioDetails row={row} />}
        selectionResetKey={filters}
        serverPagination={{
          page,
          pageSize,
          total: data?.meta.total ?? 0,
          onChange: ({ page: p, pageSize: ps }) => { setPage(p); setPageSize(ps); },
        }}
        serverSort={{
          sortBy: sort.by,
          sortOrder: sort.order,
          onChange: ({ sortBy, sortOrder }) => { setSort({ by: sortBy, order: sortOrder }); setPage(1); },
        }}
      />
    </div>
  );
}
