import { useState } from "react";
import { Bookmark, BookmarkCheck, Building2, Factory, Truck, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { PageHeader } from "@/components/PageHeader";
import { FilterPanel } from "@/components/filters/FilterPanel";
import { DataTable } from "@/components/table/DataTable";
import { ChartCard } from "@/components/charts/ChartCard";
import { BarRankChart } from "@/components/charts/BarRankChart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { useTopEntities, useSupplierConcentration } from "@/hooks/queries";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { useSavedStore } from "@/store/savedSearches";
import { formatCompactMoney, formatInt, truncate } from "@/utils/format";

type EntityKind = "Importer" | "Exporter" | "Supplier" | "Buyer";

const KIND_TO_ENDPOINT: Record<EntityKind, "importers" | "exporters" | "suppliers" | "buyers"> = {
  Importer: "importers",
  Exporter: "exporters",
  Supplier: "suppliers",
  Buyer: "buyers",
};

const ICONS: Record<EntityKind, LucideIcon> = {
  Importer: Building2,
  Exporter: Truck,
  Supplier: Factory,
  Buyer: Users,
};

/**
 * Shared 4-in-1 page: Importer / Exporter / Supplier / Buyer intelligence.
 * Each page just sets `kind` — the rest is identical.
 */
export function EntityIntelligencePage({ kind }: { kind: EntityKind }) {
  const Icon = ICONS[kind];
  const [filters, setFilters] = useUrlFilters({ page: 1, page_size: 25 });
  const limit = filters.page_size ?? 25;
  const { data, isLoading } = useTopEntities(KIND_TO_ENDPOINT[kind], { ...filters, limit });
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${kind} Intelligence`}
        description={`Largest ${kind.toLowerCase()}s ranked by total declared value, with click-through to shipments.`}
      />

      <FilterPanel
        value={filters}
        onChange={setFilters}
        fields={[
          "q",
          "trade_type",
          "hs_chapter",
          "hsn",
          "date_from",
          "date_to",
          "origin_country",
          "destination_country",
          "min_value",
          "max_value",
        ]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <ChartCard
            title={`Top ${kind.toLowerCase()}s by value`}
            loading={isLoading}
            empty={!data?.data?.length}
            height={Math.max(280, Math.min(700, (data?.data?.length ?? 0) * 28))}
          >
            <BarRankChart
              data={(data?.data ?? []).map((d) => ({ name: d.name, value: d.total_value ?? 0 }))}
              colorIndex={0}
            />
          </ChartCard>

          <DataTable
            columns={[
              {
                id: "name",
                accessorKey: "name",
                header: kind,
                size: 260,
                cell: ({ row }) => (
                  <button
                    onClick={() => setSelected(row.original.name)}
                    className="text-left font-medium hover:underline"
                  >
                    {truncate(row.original.name, 60)}
                  </button>
                ),
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
                header: "Total quantity",
                size: 140,
                cell: ({ getValue }) => formatInt(getValue() as number | null),
              },
              {
                id: "_drill",
                header: "",
                size: 110,
                cell: ({ row }) => (
                  <Link
                    to={`/shipments?${shipQueryFor(kind, row.original.name)}`}
                    className="text-xs text-primary hover:underline"
                  >
                    See shipments →
                  </Link>
                ),
              },
            ]}
            data={data?.data ?? []}
            loading={isLoading}
            csvFilename={`top-${KIND_TO_ENDPOINT[kind]}.csv`}
          />
        </div>

        <div className="space-y-4">
          {selected ? (
            <SelectedEntityPanel kind={kind} name={selected} icon={Icon} />
          ) : (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                <Icon className="mx-auto mb-2 h-6 w-6 opacity-60" />
                Click a row to inspect this {kind.toLowerCase()}.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function shipQueryFor(kind: EntityKind, name: string): string {
  // Map party kind → the corresponding filter param accepted by /shipments.
  const filterKey: Record<EntityKind, string> = {
    Importer: "importer",
    Exporter: "exporter",
    Supplier: "supplier",
    Buyer: "buyer",
  };
  const sp = new URLSearchParams();
  sp.set(filterKey[kind], name);
  return sp.toString();
}

function SelectedEntityPanel({
  kind,
  name,
  icon: Icon,
}: {
  kind: EntityKind;
  name: string;
  icon: LucideIcon;
}) {
  const toggle = useSavedStore((s) => s.toggleBookmark);
  const isBookmarked = useSavedStore((s) => s.isBookmarked(kind, name));

  // Supplier concentration is only meaningful for Importer view, but expose
  // the panel for everything else with the basic stats.
  const { data: conc } = useSupplierConcentration(name, { enabled: kind === "Importer" });

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm leading-tight" title={name}>
            <Icon className="mr-1.5 inline h-4 w-4" />
            {truncate(name, 50)}
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => toggle({ kind, name })}
            title={isBookmarked ? "Remove bookmark" : "Bookmark"}
          >
            {isBookmarked ? <BookmarkCheck className="h-4 w-4 text-primary" /> : <Bookmark className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <Link
          to={`/shipments?${shipQueryFor(kind, name)}`}
          className="block w-full rounded-md border bg-background px-3 py-2 text-center text-xs font-medium hover:bg-accent"
        >
          Open shipments →
        </Link>

        {kind === "Importer" && conc && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Metric label="Suppliers" value={formatInt(conc.total_suppliers)} />
              <Metric label="HHI" value={conc.hhi.toFixed(0)} hint={conc.hhi > 2500 ? "high concentration" : conc.hhi > 1500 ? "moderate" : "diffuse"} />
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Top suppliers
            </div>
            <ul className="space-y-1">
              {conc.top_suppliers.slice(0, 5).map((s, i) => (
                <li key={`${s.supplier}-${i}`} className="flex items-center justify-between gap-2">
                  <span className="truncate" title={s.supplier ?? undefined}>
                    {truncate(s.supplier, 28)}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {s.share_pct.toFixed(1)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border bg-background/40 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-base font-semibold">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
