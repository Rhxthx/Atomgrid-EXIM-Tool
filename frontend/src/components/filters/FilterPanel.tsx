import { useState } from "react";
import { ChevronDown, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/utils/cn";
import { formatMonth } from "@/utils/format";
import type { FilterParams, MarketCoverage } from "@/types/api";

interface FilterPanelProps {
  value: FilterParams;
  onChange: (next: FilterParams) => void;
  /** Which filters to render — keep the panel focused per page. */
  fields?: FilterField[];
  /** Options for the Reporting Country dropdown (e.g. from dataset stats). */
  reportingCountries?: string[];
  /** Per-market available date span, shown beside each market option. */
  marketCoverage?: Record<string, MarketCoverage>;
  className?: string;
}

/** "Apr 2023 – Aug 2025" style range for a market's available data. */
function coverageLabel(c?: MarketCoverage): string {
  if (!c || (!c.date_min && !c.date_max)) return "";
  return `${formatMonth(c.date_min)} – ${formatMonth(c.date_max)}`;
}

export type FilterField =
  | "q"
  | "reporting_country"
  | "importer"
  | "exporter"
  | "supplier"
  | "buyer"
  | "hsn"
  | "hs_chapter"
  | "country"
  | "origin_country"
  | "destination_country"
  | "port"
  | "trade_type"
  | "date_from"
  | "date_to"
  | "min_value"
  | "max_value"
  | "min_quantity"
  | "max_quantity";

const DEFAULT_FIELDS: FilterField[] = [
  "q",
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
];

/**
 * Collapsible filter panel.  Renders only the fields requested via `fields`
 * so each page shows a focused set.  The active-filter chip row at the top
 * reflects the currently set filters at a glance.
 */
export function FilterPanel({
  value,
  onChange,
  fields = DEFAULT_FIELDS,
  reportingCountries = [],
  marketCoverage = {},
  className,
}: FilterPanelProps) {
  const [open, setOpen] = useState(true);

  const update = <K extends keyof FilterParams>(key: K, v: FilterParams[K]) => {
    // Empty string → undefined so it drops out of API params.
    if (typeof v === "string" && v.trim() === "") {
      const next = { ...value };
      delete next[key];
      onChange(next);
    } else {
      onChange({ ...value, [key]: v, page: 1 });
    }
  };

  const clearAll = () => onChange({ page: 1, page_size: value.page_size });

  const activeChips = activeFilters(value);

  return (
    <div className={cn("rounded-lg border bg-card/60", className)}>
      {/* div (not button): contains nested interactive chips / Clear-all,
          and <button> inside <button> is invalid HTML. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setOpen((o) => !o);
        }}
        className="flex w-full cursor-pointer items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Filters</span>
          {activeChips.length > 0 && (
            <span className="text-xs text-muted-foreground">
              · {activeChips.length} active
            </span>
          )}
          {activeChips.slice(0, 4).map((c) => (
            <Badge key={c.key} variant="secondary" className="gap-1">
              {c.label}: <span className="font-medium">{String(c.value)}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  update(c.key, undefined);
                }}
                className="ml-1 rounded-sm opacity-70 hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {activeChips.length > 4 && (
            <Badge variant="outline">+{activeChips.length - 4} more</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {activeChips.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                clearAll();
              }}
            >
              Clear all
            </Button>
          )}
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              open && "rotate-180"
            )}
          />
        </div>
      </div>

      {open && (
        <div className="grid gap-4 border-t border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
          {fields.includes("q") && (
            <Field label="Search (any field)">
              <Input
                value={value.q ?? ""}
                onChange={(e) => update("q", e.target.value)}
                placeholder="bayer, syngenta, melamine…"
              />
            </Field>
          )}

          {fields.includes("reporting_country") && (
            <Field label="Market (reporting country)">
              <Select
                value={value.reporting_country ?? "all"}
                onValueChange={(v) =>
                  update("reporting_country", v === "all" ? undefined : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="All markets" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All markets</SelectItem>
                  {reportingCountries.map((c) => {
                    const range = coverageLabel(marketCoverage[c]);
                    const name = c.charAt(0) + c.slice(1).toLowerCase();
                    return (
                      <SelectItem key={c} value={c}>
                        {name}
                        {range && (
                          <span className="ml-1 text-muted-foreground">· {range}</span>
                        )}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {value.reporting_country && coverageLabel(marketCoverage[value.reporting_country]) && (
                <p className="text-xs text-muted-foreground">
                  Data available: {coverageLabel(marketCoverage[value.reporting_country])}
                </p>
              )}
            </Field>
          )}

          {fields.includes("trade_type") && (
            <Field label="Trade type">
              <Select
                value={value.trade_type ?? "all"}
                onValueChange={(v) =>
                  update("trade_type", v === "all" ? undefined : (v as "IMPORT" | "EXPORT"))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="IMPORT">Imports</SelectItem>
                  <SelectItem value="EXPORT">Exports</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}

          {fields.includes("hs_chapter") && (
            <Field label="HS chapter (exact)">
              <Input
                value={value.hs_chapter ?? ""}
                onChange={(e) => update("hs_chapter", e.target.value)}
                placeholder="29 / 3402 / 3808"
              />
            </Field>
          )}

          {fields.includes("hsn") && (
            <Field label="HSN (prefix)">
              <Input
                value={value.hsn ?? ""}
                onChange={(e) => update("hsn", e.target.value)}
                placeholder="2901 → 2901*"
              />
            </Field>
          )}

          {fields.includes("date_from") && (
            <Field label="From">
              <Input
                type="date"
                value={value.date_from ?? ""}
                onChange={(e) => update("date_from", e.target.value)}
              />
            </Field>
          )}

          {fields.includes("date_to") && (
            <Field label="To">
              <Input
                type="date"
                value={value.date_to ?? ""}
                onChange={(e) => update("date_to", e.target.value)}
              />
            </Field>
          )}

          {fields.includes("country") && (
            <Field label="Country (origin OR destination)">
              <Input
                value={value.country ?? ""}
                onChange={(e) => update("country", e.target.value)}
                placeholder="germany"
              />
            </Field>
          )}

          {fields.includes("origin_country") && (
            <Field label="Origin country">
              <Input
                value={value.origin_country ?? ""}
                onChange={(e) => update("origin_country", e.target.value)}
                placeholder="china"
              />
            </Field>
          )}

          {fields.includes("destination_country") && (
            <Field label="Destination country">
              <Input
                value={value.destination_country ?? ""}
                onChange={(e) => update("destination_country", e.target.value)}
                placeholder="brazil"
              />
            </Field>
          )}

          {fields.includes("port") && (
            <Field label="Port">
              <Input
                value={value.port ?? ""}
                onChange={(e) => update("port", e.target.value)}
                placeholder="nhava sheva"
              />
            </Field>
          )}

          {fields.includes("importer") && (
            <Field label="Importer">
              <Input
                value={value.importer ?? ""}
                onChange={(e) => update("importer", e.target.value)}
                placeholder="reliance"
              />
            </Field>
          )}

          {fields.includes("exporter") && (
            <Field label="Exporter">
              <Input
                value={value.exporter ?? ""}
                onChange={(e) => update("exporter", e.target.value)}
                placeholder="basf"
              />
            </Field>
          )}

          {fields.includes("supplier") && (
            <Field label="Supplier">
              <Input
                value={value.supplier ?? ""}
                onChange={(e) => update("supplier", e.target.value)}
                placeholder="evonik"
              />
            </Field>
          )}

          {fields.includes("buyer") && (
            <Field label="Buyer">
              <Input
                value={value.buyer ?? ""}
                onChange={(e) => update("buyer", e.target.value)}
                placeholder="asian paints"
              />
            </Field>
          )}

          {fields.includes("min_value") && (
            <Field label="Min value (₹)">
              <Input
                type="number"
                min={0}
                value={value.min_value ?? ""}
                onChange={(e) =>
                  update(
                    "min_value",
                    e.target.value === "" ? undefined : Number(e.target.value)
                  )
                }
              />
            </Field>
          )}

          {fields.includes("max_value") && (
            <Field label="Max value (₹)">
              <Input
                type="number"
                min={0}
                value={value.max_value ?? ""}
                onChange={(e) =>
                  update(
                    "max_value",
                    e.target.value === "" ? undefined : Number(e.target.value)
                  )
                }
              />
            </Field>
          )}

          {fields.includes("min_quantity") && (
            <Field label="Min quantity">
              <Input
                type="number"
                min={0}
                value={value.min_quantity ?? ""}
                onChange={(e) =>
                  update(
                    "min_quantity",
                    e.target.value === "" ? undefined : Number(e.target.value)
                  )
                }
              />
            </Field>
          )}

          {fields.includes("max_quantity") && (
            <Field label="Max quantity">
              <Input
                type="number"
                min={0}
                value={value.max_quantity ?? ""}
                onChange={(e) =>
                  update(
                    "max_quantity",
                    e.target.value === "" ? undefined : Number(e.target.value)
                  )
                }
              />
            </Field>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

/** Flatten the filter object to a list of (key, label, value) chip descriptors. */
function activeFilters(value: FilterParams) {
  const skip = new Set<keyof FilterParams>(["page", "page_size", "sort_by", "sort_order"]);
  const labelMap: Partial<Record<keyof FilterParams, string>> = {
    q: "Search",
    importer: "Importer",
    exporter: "Exporter",
    supplier: "Supplier",
    buyer: "Buyer",
    hsn: "HSN",
    hs_chapter: "Chapter",
    country: "Country",
    origin_country: "Origin",
    destination_country: "Destination",
    port: "Port",
    trade_type: "Trade",
    reporting_country: "Market",
    date_from: "From",
    date_to: "To",
    min_value: "Min value",
    max_value: "Max value",
    min_quantity: "Min qty",
    max_quantity: "Max qty",
  };
  return (Object.entries(value) as [keyof FilterParams, unknown][])
    .filter(([k, v]) => !skip.has(k) && v !== undefined && v !== null && v !== "")
    .map(([k, v]) => ({ key: k, label: labelMap[k] ?? k, value: v }));
}
