import { useMemo, useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/table/DataTable";
import { agBioColumns, AgBioDetails } from "@/components/table/agbioColumns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/utils/cn";

import { useAgBioSearch, useAgBioBreakdown } from "@/hooks/queries";
import { useDebounce } from "@/hooks/useDebounce";
import { truncate } from "@/utils/format";
import type { AgBioRankItem } from "@/types/agbio";

/** Values are already in USD millions ("AI Value (m.)"). */
function usdM(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e3) return `$${(v / 1e3).toFixed(2)} B`;
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })} M`;
}

function RankCard({
  title,
  items,
  labelHeader,
  loading,
}: {
  title: string;
  items?: AgBioRankItem[];
  labelHeader: string;
  loading?: boolean;
}) {
  const max = items && items.length ? items[0].total_usd_m : 1;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>{labelHeader}</span>
          <span>AI Value</span>
        </div>
        {(items ?? []).map((it) => (
          <div key={it.name} className="text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate" title={it.name}>{truncate(it.name, 28)}</span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{usdM(it.total_usd_m)}</span>
            </div>
            <div className="mt-0.5 h-1.5 rounded bg-muted">
              <div className="h-1.5 rounded bg-primary" style={{ width: `${max ? (it.total_usd_m / max) * 100 : 0}%` }} />
            </div>
          </div>
        ))}
        {!loading && (!items || items.length === 0) && (
          <div className="py-2 text-sm text-muted-foreground">No data for this search.</div>
        )}
        {loading && (!items || items.length === 0) && (
          <div className="py-2 text-sm text-muted-foreground">Loading…</div>
        )}
      </CardContent>
    </Card>
  );
}

export function AgBioPage() {
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
  const { data: breakdown, isFetching: bdFetching } = useAgBioBreakdown(filters);

  // Contextual charts: a country search -> that country's Top products; a
  // product search -> that product's Top countries; nothing searched -> both.
  const hasProduct = !!productD;
  const hasCountry = !!countryD;
  const showProducts = hasCountry || (!hasProduct && !hasCountry);
  const showCountries = hasProduct || (!hasProduct && !hasCountry);

  const productsTitle = hasCountry
    ? `Top products in ${countryD}`
    : "Top products by value";
  const countriesTitle = hasProduct
    ? `Top countries for ${productD}`
    : "Top countries by value";

  return (
    <div className="space-y-4">
      <PageHeader title="AG-Bio Market" />

      {/* Search — front and centre */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Product (active ingredient)</Label>
          <Input
            placeholder="e.g. thiamethoxam"
            value={product}
            onChange={(e) => { setProduct(e.target.value); setPage(1); }}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Country</Label>
          <Input
            placeholder="e.g. india"
            value={country}
            onChange={(e) => { setCountry(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      {/* Dynamic rankings — follow the search */}
      <div className={cn("grid gap-4", showProducts && showCountries && "md:grid-cols-2")}>
        {showProducts && (
          <RankCard title={productsTitle} labelHeader="Product"
            items={breakdown?.top_products} loading={bdFetching} />
        )}
        {showCountries && (
          <RankCard title={countriesTitle} labelHeader="Country"
            items={breakdown?.top_countries} loading={bdFetching} />
        )}
      </div>

      <DataTable
        columns={agBioColumns}
        data={data?.data ?? []}
        loading={isLoading || isFetching}
        emptyMessage="No matching products/countries — try fewer filters or check spelling."
        hideExport
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
