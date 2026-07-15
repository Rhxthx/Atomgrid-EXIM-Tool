import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Boxes, Building2, Globe, DollarSign } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { DataTable } from "@/components/table/DataTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";

import {
  useArgentinaStats,
  useArgentinaImports,
  useExportRowLimit,
  useArgentinaAggregate,
} from "@/hooks/queries";
import { buildArgentinaExportUrl } from "@/services/endpoints";
import {
  SummaryStats,
  argentinaSelectionStats,
  argentinaAggregateStats,
} from "@/components/table/SelectionSummary";
import { useDebounce } from "@/hooks/useDebounce";
import { formatInt, formatNumber, formatDate, truncate } from "@/utils/format";
import type { ArgentinaRecord } from "@/types/argentina";

/** Compact USD formatter (K / M / B) — the India L/Cr formatter would mislead here. */
function usd(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

/** Product type: TECNICO = technical active ingredient, FORMULADO = formulation. */
const TYPE_LABELS: Record<string, string> = {
  TECNICO: "Technical",
  FORMULADO: "Formulation",
};
const typeLabel = (v: string | null | undefined) =>
  v ? TYPE_LABELS[v] ?? v : "—";

const COLS: ColumnDef<ArgentinaRecord, unknown>[] = [
  { id: "date", accessorKey: "date", header: "Date", size: 110,
    cell: ({ getValue }) => formatDate(getValue() as string | null) },
  { id: "importer", accessorKey: "importer", header: "Importer", size: 220,
    cell: ({ getValue }) => (
      <span title={(getValue() as string) ?? undefined}>{truncate(getValue() as string | null, 38)}</span>
    ) },
  { id: "origin_country", accessorKey: "origin_country", header: "Origin", size: 120 },
  { id: "type", accessorKey: "type", header: "Type", size: 110,
    cell: ({ getValue }) => typeLabel(getValue() as string | null) },
  { id: "active_ingredient_en", accessorKey: "active_ingredient_en", header: "Active Ingredient", size: 180,
    cell: ({ getValue }) => truncate(getValue() as string | null, 30) },
  { id: "brand", accessorKey: "brand", header: "Brand", size: 140,
    cell: ({ getValue }) => truncate(getValue() as string | null, 24) },
  { id: "formulation", accessorKey: "formulation", header: "Form.", size: 80 },
  { id: "segment", accessorKey: "segment", header: "Segment", size: 90 },
  { id: "quantity", accessorKey: "quantity", header: "Quantity", size: 110,
    cell: ({ getValue }) => formatNumber(getValue() as number | null) },
  { id: "unit", accessorKey: "unit", header: "Unit", size: 90 },
  { id: "fob_unit_usd", accessorKey: "fob_unit_usd", header: "FOB / Unit (USD)", size: 130,
    cell: ({ getValue }) => formatNumber(getValue() as number | null) },
  { id: "fob_total_usd", accessorKey: "fob_total_usd", header: "FOB Total (USD)", size: 130,
    cell: ({ getValue }) => formatNumber(getValue() as number | null) },
  { id: "cif_unit_usd", accessorKey: "cif_unit_usd", header: "CIF / Unit (USD)", size: 130,
    cell: ({ getValue }) => formatNumber(getValue() as number | null) },
  { id: "cif_total_usd", accessorKey: "cif_total_usd", header: "CIF Total (USD)", size: 130,
    cell: ({ getValue }) => formatNumber(getValue() as number | null) },
];

function RankCard({ title, items }: { title: string; items?: { name: string; count: number }[] }) {
  const max = items && items.length ? items[0].count : 1;
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
              <span className="shrink-0 text-muted-foreground">{formatInt(it.count)}</span>
            </div>
            <div className="mt-0.5 h-1 rounded bg-muted">
              <div className="h-1 rounded bg-primary" style={{ width: `${(it.count / max) * 100}%` }} />
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

export function ArgentinaPage() {
  const { data: stats, isLoading: statsLoading } = useArgentinaStats();
  const exportRowLimit = useExportRowLimit();

  const [search, setSearch] = useState("");
  const [origin, setOrigin] = useState("");
  const [ingredient, setIngredient] = useState("");
  const [importer, setImporter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [ptype, setPtype] = useState<string>(""); // "" = all, else TECNICO / FORMULADO
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<{ by?: string; order?: "asc" | "desc" }>({
    by: "date", order: "desc",
  });

  const q = useDebounce(search, 300);
  const originD = useDebounce(origin, 300);
  const ingredientD = useDebounce(ingredient, 300);
  const importerD = useDebounce(importer, 300);

  const filters = useMemo(
    () => ({
      q: q || undefined,
      type: ptype || undefined,
      importer: importerD || undefined,
      origin_country: originD || undefined,
      active_ingredient: ingredientD || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      sort_by: sort.by,
      sort_order: sort.order,
      page,
      page_size: pageSize,
    }),
    [q, ptype, importerD, originD, ingredientD, dateFrom, dateTo, sort, page, pageSize]
  );

  const typeCounts = useMemo(() => {
    const m: Record<string, number> = {};
    (stats?.type_breakdown ?? []).forEach((t) => {
      if (t.code) m[t.code] = t.count;
    });
    return m;
  }, [stats]);

  const TYPE_OPTS: { value: string; label: string }[] = [
    { value: "", label: "All types" },
    { value: "TECNICO", label: "Technical" },
    { value: "FORMULADO", label: "Formulation" },
  ];

  const { data, isLoading, isFetching } = useArgentinaImports(filters);

  // Row-selection summary: "select all matching" totals the whole filtered set.
  const [allMatching, setAllMatching] = useState(false);
  const agg = useArgentinaAggregate(filters, { enabled: allMatching });

  const dateSpan =
    stats?.date_min && stats?.date_max
      ? `${formatDate(stats.date_min)} → ${formatDate(stats.date_max)}`
      : undefined;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Argentina Imports"
        description="Argentine customs import data (agrochemicals) — a separate dataset from the India trade tables."
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Shipments" value={formatInt(stats?.total_rows)} loading={statsLoading}
          icon={Boxes} hint={dateSpan} />
        <KpiCard label="Importers" value={formatInt(stats?.distinct_importers)} loading={statsLoading}
          icon={Building2} />
        <KpiCard label="Origin Countries" value={formatInt(stats?.distinct_origin_countries)} loading={statsLoading}
          icon={Globe} />
        <KpiCard label="Total CIF Value" value={usd(stats?.total_cif_usd)} loading={statsLoading}
          icon={DollarSign} />
      </div>

      {/* Rankings */}
      <div className="grid gap-4 md:grid-cols-2">
        <RankCard title="Top origin countries" items={stats?.top_origins} />
        <RankCard title="Top active ingredients" items={stats?.top_ingredients} />
      </div>

      {/* Type filter (TECNICO = technical, FORMULADO = formulation) */}
      <div className="flex flex-wrap items-center gap-2">
        {TYPE_OPTS.map((opt) => {
          const active = ptype === opt.value;
          const count = opt.value ? typeCounts[opt.value] : undefined;
          return (
            <Button
              key={opt.value || "all"}
              variant={active ? "default" : "outline"}
              size="sm"
              onClick={() => { setPtype(opt.value); setPage(1); }}
            >
              {opt.label}
              {count !== undefined && (
                <span className={cn("ml-1.5 text-xs", active ? "opacity-80" : "text-muted-foreground")}>
                  {formatInt(count)}
                </span>
              )}
            </Button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div>
          <Input placeholder="Search… e.g. glyphosate AND china"
            value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          <p className="mt-1 text-xs text-muted-foreground">
            Tip: combine terms with <span className="font-medium">AND</span> / <span className="font-medium">OR</span> —
            e.g. <code>glyphosate AND china</code> or <code>atrazine OR paraquat</code>.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1.5">
            <Label>Importer</Label>
            <Input placeholder="tecnomyl"
              value={importer} onChange={(e) => { setImporter(e.target.value); setPage(1); }} />
          </div>
          <div className="space-y-1.5">
            <Label>Origin country</Label>
            <Input placeholder="china"
              value={origin} onChange={(e) => { setOrigin(e.target.value); setPage(1); }} />
          </div>
          <div className="space-y-1.5">
            <Label>Active ingredient</Label>
            <Input placeholder="glyphosate"
              value={ingredient} onChange={(e) => { setIngredient(e.target.value); setPage(1); }} />
          </div>
          <div className="space-y-1.5">
            <Label>From</Label>
            <Input type="date"
              value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
          </div>
          <div className="space-y-1.5">
            <Label>To</Label>
            <Input type="date"
              value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
          </div>
        </div>
      </div>

      <DataTable
        columns={COLS}
        data={data?.data ?? []}
        loading={isLoading || isFetching}
        csvFilename="argentina_imports.csv"
        serverExportUrl={buildArgentinaExportUrl(filters)}
        exportRowLimit={exportRowLimit}
        selectable
        totalMatching={data?.meta.total ?? 0}
        allMatching={allMatching}
        onAllMatchingChange={setAllMatching}
        selectionResetKey={filters}
        renderSelectionSummary={({ selectedRows, allMatching: all }) => (
          <SummaryStats
            stats={
              all
                ? argentinaAggregateStats(agg.data, agg.isLoading)
                : argentinaSelectionStats(selectedRows)
            }
          />
        )}
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
