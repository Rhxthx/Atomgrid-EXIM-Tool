import { useEffect, useMemo, useState } from "react";
import { Save, Sparkles, Plus, X } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { FilterPanel } from "@/components/filters/FilterPanel";
import { DataTable } from "@/components/table/DataTable";
import { shipmentColumns, ShipmentDetails } from "@/components/table/shipmentColumns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import {
  useSearchShipments,
  useSimilar,
  useStats,
  useExportRowLimit,
  useExportQuota,
  useShipmentAggregate,
} from "@/hooks/queries";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { useDebounce } from "@/hooks/useDebounce";
import { useSavedStore } from "@/store/savedSearches";
import { buildExportUrl } from "@/services/endpoints";
import {
  SummaryStats,
  shipmentSelectionStats,
  shipmentAggregateStats,
} from "@/components/table/SelectionSummary";

const COLS = shipmentColumns();

type PdOp = "contains" | "notcontains" | "equals" | "notequals";
interface PdCond { op: PdOp; value: string }
const OP_LABELS: { value: PdOp; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "notcontains", label: "not contains" },
  { value: "equals", label: "equals" },
  { value: "notequals", label: "not equals" },
];
const EMPTY: PdCond[] = [{ op: "contains", value: "" }];

/** "contains|glyphosate;;notcontains|acid" -> conditions */
function decodePd(pd?: string): PdCond[] {
  if (!pd) return EMPTY;
  const out = pd.split(";;").map((s) => {
    const i = s.indexOf("|");
    if (i < 0) return null;
    return { op: s.slice(0, i) as PdOp, value: s.slice(i + 1) };
  }).filter(Boolean) as PdCond[];
  return out.length ? out : EMPTY;
}
function encodePd(conds: PdCond[]): string | undefined {
  const parts = conds.filter((c) => c.value.trim()).map((c) => `${c.op}|${c.value.trim()}`);
  return parts.length ? parts.join(";;") : undefined;
}

export function GlobalSearchPage() {
  const [filters, setFilters] = useUrlFilters({ page: 1, page_size: 50 });
  const { data, isLoading, isFetching } = useSearchShipments(filters);
  const { data: stats } = useStats();
  const markets = Object.keys(stats?.reporting_countries ?? {});
  const exportRowLimit = useExportRowLimit();
  const quota = useExportQuota();
  const saveSearch = useSavedStore((s) => s.saveSearch);

  const [allMatching, setAllMatching] = useState(false);
  const agg = useShipmentAggregate(filters, { enabled: allMatching });

  // Product-description builder. Seed from ?pd, or convert an incoming top-bar
  // ?q= into a first "contains" condition so that entry point keeps working.
  const [conds, setConds] = useState<PdCond[]>(() =>
    filters.pd ? decodePd(filters.pd) : filters.q ? [{ op: "contains", value: filters.q }] : EMPTY
  );
  const [join, setJoin] = useState<"and" | "or">(filters.pd_join === "or" ? "or" : "and");
  const debouncedConds = useDebounce(conds, 350);

  // Builder -> URL. Clears any seeded `q` once folded into a condition.
  useEffect(() => {
    const pd = encodePd(debouncedConds);
    if (pd !== (filters.pd ?? undefined) || filters.q) {
      setFilters({ ...filters, pd, pd_join: pd ? join : undefined, q: undefined, page: 1 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedConds, join]);

  // URL -> builder (back button / a loaded saved search).
  useEffect(() => {
    if ((filters.pd ?? undefined) !== encodePd(conds)) setConds(decodePd(filters.pd));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.pd]);

  const firstTerm = useMemo(
    () => debouncedConds.find((c) => c.value.trim())?.value.trim() ?? "",
    [debouncedConds]
  );
  const { data: similar } = useSimilar(firstTerm, "Importer", { enabled: firstTerm.length >= 3 });

  const setCond = (i: number, patch: Partial<PdCond>) =>
    setConds((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const addCond = () => setConds((prev) => [...prev, { op: "contains", value: "" }]);
  const removeCond = (i: number) =>
    setConds((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : EMPTY));

  const hasQuery = !!filters.pd;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Global Search"
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={!data || data.meta.total === 0}
            onClick={() =>
              saveSearch({
                name: firstTerm || `Search · ${new Date().toLocaleString()}`,
                pathname: "/search",
                filters,
              })
            }
          >
            <Save className="mr-1.5 h-4 w-4" />
            Save search
          </Button>
        }
      />

      <FilterPanel
        value={filters}
        onChange={setFilters}
        reportingCountries={markets}
        marketCoverage={stats?.market_coverage}
        fields={[
          "reporting_country",
          "trade_type",
          "hs_chapter",
          "hsn",
          "date_from",
          "date_to",
          "origin_country",
          "destination_country",
          "importer",
          "supplier",
          "min_value",
          "max_value",
        ]}
      />

      {/* Product builder — multiple conditions with AND/OR + contains/equals/not */}
      <Card>
        <CardContent className="space-y-2 p-4">
          <div className="flex items-center gap-3">
            <Label className="text-sm">Product / description</Label>
            {conds.length > 1 && (
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">match</span>
                <Button size="sm" variant={join === "and" ? "default" : "outline"}
                  className="h-6 px-2 text-xs" onClick={() => setJoin("and")}>ALL (AND)</Button>
                <Button size="sm" variant={join === "or" ? "default" : "outline"}
                  className="h-6 px-2 text-xs" onClick={() => setJoin("or")}>ANY (OR)</Button>
              </div>
            )}
          </div>
          {conds.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select value={c.op} onValueChange={(v) => setCond(i, { op: v as PdOp })}>
                <SelectTrigger className="h-9 w-[150px] shrink-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OP_LABELS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input className="flex-1" placeholder="e.g. glyphosate"
                value={c.value} onChange={(e) => setCond(i, { value: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") setConds((p) => [...p]); }} />
              <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0"
                onClick={() => removeCond(i)} disabled={conds.length === 1} title="Remove condition">
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addCond}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add product condition
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
        <DataTable
          columns={COLS}
          data={data?.data ?? []}
          loading={isLoading || isFetching}
          emptyMessage={
            hasQuery
              ? "No results — try fewer conditions or check spelling."
              : "Showing the most recent shipments. Add a product condition above to narrow down."
          }
          csvFilename={`search-${(firstTerm || "all").slice(0, 24)}.csv`}
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

        {/* Side panel: query stats + "did you mean" */}
        <div className="space-y-3">
          {data && (
            <Card>
              <CardContent className="p-4 text-xs">
                <div className="text-muted-foreground">Server query</div>
                <div className="mt-1 text-base font-medium">
                  {data.meta.query_ms.toFixed(0)} ms
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(Object.entries(data.meta.filters_applied) as [string, unknown][]).map(
                    ([k, v]) => (
                      <Badge key={k} variant="secondary" className="text-[10px]">
                        {k}: {String(v as string | number | boolean)}
                      </Badge>
                    )
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {similar && similar.matches.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Sparkles className="h-3 w-3" />
                  Did you mean…
                </div>
                <ul className="space-y-1">
                  {similar.matches.slice(0, 6).map((m) => (
                    <li key={m.name}>
                      <button
                        onClick={() => setCond(0, { value: m.name })}
                        className="block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-accent"
                        title={m.name}
                      >
                        <span className="font-medium">{m.name}</span>
                        <span className="ml-2 text-muted-foreground">
                          {m.score}% · {m.shipments} shipments
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
