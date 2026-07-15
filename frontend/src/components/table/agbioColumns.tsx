import type { ColumnDef } from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";
import { truncate } from "@/utils/format";
import type { AgBioRecord } from "@/types/agbio";

/** Compact USD-millions formatter — values in this dataset are already in
 * millions ("AI Value (m.)"), so we just format the number + unit suffix. */
function usdM(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 1 })} M`;
}

const CROP_FIELDS: { key: keyof AgBioRecord; label: string }[] = [
  { key: "cereals", label: "Cereals" },
  { key: "cotton", label: "Cotton" },
  { key: "maize", label: "Maize" },
  { key: "oilseed_rape", label: "Oilseed Rape" },
  { key: "other_crops", label: "Other Crops" },
  { key: "other_fv", label: "Other F&V" },
  { key: "pome_stone_fruit", label: "Pome / Stone Fruit" },
  { key: "potato", label: "Potato" },
  { key: "rice", label: "Rice" },
  { key: "soybean", label: "Soybean" },
  { key: "sugar_beet", label: "Sugar Beet" },
  { key: "sugarcane", label: "Sugarcane" },
  { key: "sunflower", label: "Sunflower" },
  { key: "vine", label: "Vine" },
];

export const agBioColumns: ColumnDef<AgBioRecord, unknown>[] = [
  {
    id: "product",
    accessorKey: "product",
    header: "Product",
    size: 220,
    cell: ({ getValue }) => (
      <span className="font-medium" title={(getValue() as string) ?? undefined}>
        {truncate(getValue() as string, 40)}
      </span>
    ),
  },
  {
    id: "type",
    accessorKey: "type",
    header: "Type",
    size: 140,
    cell: ({ getValue }) => {
      const v = getValue() as string | null;
      return v ? <Badge variant="secondary">{v}</Badge> : "—";
    },
  },
  {
    id: "country",
    accessorKey: "country",
    header: "Country",
    size: 180,
  },
  {
    id: "total_usd_m",
    accessorKey: "total_usd_m",
    header: "Total AI Value (USD m.)",
    size: 190,
    cell: ({ getValue }) => (
      <span className="font-mono text-xs font-semibold">
        {usdM(getValue() as number | null)}
      </span>
    ),
  },
];

/** Expandable details panel — the per-crop USD-millions breakdown behind the
 * headline Total. Used by DataTable's renderExpanded prop, same pattern as
 * ShipmentDetails. All fields are already in the row (no extra fetch). */
export function AgBioDetails({ row }: { row: AgBioRecord }) {
  const populated = CROP_FIELDS.filter(({ key }) => row[key] !== null && row[key] !== undefined);
  return (
    <div>
      <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        AI Value by crop segment (USD millions)
      </div>
      {populated.length === 0 ? (
        <div className="text-xs text-muted-foreground">No crop-level breakdown available.</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 text-xs">
          {populated.map(({ key, label }) => (
            <div key={key}>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {label}
              </div>
              <div className="mt-0.5 font-mono">{usdM(row[key] as number | null)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
