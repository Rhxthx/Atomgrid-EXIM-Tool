import { useEffect, useRef, useState } from "react";
import { Save, Search, Sparkles, X } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { FilterPanel } from "@/components/filters/FilterPanel";
import { DataTable } from "@/components/table/DataTable";
import { shipmentColumns, ShipmentDetails } from "@/components/table/shipmentColumns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

import { useSearchShipments, useSimilar, useStats, useExportRowLimit } from "@/hooks/queries";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { useDebounce } from "@/hooks/useDebounce";
import { useSavedStore } from "@/store/savedSearches";
import { buildExportUrl } from "@/services/endpoints";

const COLS = shipmentColumns();

export function GlobalSearchPage() {
  const [filters, setFilters] = useUrlFilters({ page: 1, page_size: 50 });
  const { data, isLoading, isFetching } = useSearchShipments(filters);
  const { data: stats } = useStats();
  const markets = Object.keys(stats?.reporting_countries ?? {});
  const exportRowLimit = useExportRowLimit();
  const saveSearch = useSavedStore((s) => s.saveSearch);

  // Local input state so typing feels instant; we push to URL/filters on
  // Enter or after a brief debounce so the API isn't hit per keystroke.
  const [draft, setDraft] = useState(filters.q ?? "");
  const debouncedDraft = useDebounce(draft, 350);
  const searchRef = useRef<HTMLInputElement>(null);

  // Focus the search input on mount so it's obvious where to type.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Sync URL → input when the user navigates here from elsewhere.
  useEffect(() => {
    setDraft(filters.q ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q]);

  // Sync debounced input → URL so results update without explicit Enter.
  useEffect(() => {
    if (debouncedDraft !== (filters.q ?? "")) {
      setFilters({ ...filters, q: debouncedDraft || undefined, page: 1 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedDraft]);

  const { data: similar } = useSimilar(debouncedDraft, "Importer", {
    enabled: debouncedDraft.length >= 3,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Global Search"
        description="Free-text plus filters across the entire EXIM dataset."
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={!data || data.meta.total === 0}
            onClick={() =>
              saveSearch({
                name: filters.q?.trim() || `Search · ${new Date().toLocaleString()}`,
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
        // Don't repeat 'q' in the filter panel — the dedicated search box below owns it.
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

      {/* Prominent search bar — sits just above the results (below the filters)
          so the user always sees their current query and can edit it inline. */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setFilters({ ...filters, q: draft || undefined, page: 1 });
            }
            if (e.key === "Escape") setDraft("");
          }}
          placeholder="Search importers, exporters, suppliers, HSN, products, descriptions…"
          className="h-12 pl-10 pr-10 text-base"
        />
        {draft && (
          <button
            onClick={() => setDraft("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
        <DataTable
          columns={COLS}
          data={data?.data ?? []}
          loading={isLoading || isFetching}
          emptyMessage={
            filters.q
              ? "No results — try fewer filters or check spelling."
              : "Showing the most recent shipments. Type a query above to narrow down."
          }
          csvFilename={`search-${(filters.q || "all").slice(0, 24)}.csv`}
          serverExportUrl={buildExportUrl(filters)}
          exportRowLimit={exportRowLimit}
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
                        onClick={() => setDraft(m.name)}
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
