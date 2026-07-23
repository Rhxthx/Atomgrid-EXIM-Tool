import type { ColumnDef } from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";
import { truncate } from "@/utils/format";
import type { RegistrationRecord } from "@/types/registration";

export const registrationColumns: ColumnDef<RegistrationRecord, unknown>[] = [
  {
    id: "country",
    accessorKey: "country",
    header: "Country",
    size: 130,
    cell: ({ getValue }) => <Badge variant="secondary">{getValue() as string}</Badge>,
  },
  {
    id: "product",
    accessorKey: "product",
    header: "Product / Trade name",
    size: 240,
    cell: ({ getValue }) => (
      <span className="font-medium" title={(getValue() as string) ?? undefined}>
        {truncate(getValue() as string | null, 42)}
      </span>
    ),
  },
  {
    id: "active_ingredient",
    accessorKey: "active_ingredient",
    header: "Active Ingredient",
    size: 220,
    // Show the English-normalised name; fall back to the original when we
    // couldn't map it. Original is always available on hover + in the expand.
    cell: ({ row }) => {
      const en = row.original.active_ingredient_en;
      const orig = row.original.active_ingredient;
      return (
        <span title={orig ?? undefined}>
          {truncate(en || orig, 40)}
        </span>
      );
    },
  },
  {
    id: "concentration",
    accessorKey: "concentration",
    header: "Concentration",
    size: 130,
    cell: ({ getValue }) => truncate(getValue() as string | null, 20) || "—",
  },
  {
    id: "company",
    accessorKey: "company",
    header: "Company / Registrant",
    size: 220,
    cell: ({ getValue }) => (
      <span className="text-muted-foreground" title={(getValue() as string) ?? undefined}>
        {truncate(getValue() as string | null, 38)}
      </span>
    ),
  },
  {
    id: "status",
    accessorKey: "status",
    header: "Status",
    size: 110,
    cell: ({ getValue }) => (getValue() as string | null) ?? "—",
  },
  {
    id: "registration_no",
    accessorKey: "registration_no",
    header: "Reg. No.",
    size: 130,
    cell: ({ getValue }) => (
      <span className="font-mono text-xs">{(getValue() as string | null) ?? "—"}</span>
    ),
  },
  {
    id: "formulation_type",
    accessorKey: "formulation_type",
    header: "Type / Form.",
    size: 130,
    cell: ({ getValue }) => truncate(getValue() as string | null, 20) || "—",
  },
  {
    id: "category",
    accessorKey: "category",
    header: "Category",
    size: 120,
    cell: ({ getValue }) => {
      const v = (getValue() as string | null) ?? "Unknown";
      const variant =
        v === "Technical" ? "default" : v === "Formulation" ? "secondary" : "outline";
      return <Badge variant={variant}>{v}</Badge>;
    },
  },
  {
    id: "origin",
    accessorKey: "origin",
    header: "Origin",
    size: 130,
    cell: ({ getValue }) => truncate(getValue() as string | null, 20) || "—",
  },
];

/** Expandable panel — the row's FULL original country-specific fields, parsed
 * from raw_json. Used by DataTable's renderExpanded prop. */
export function RegistrationDetails({ row }: { row: RegistrationRecord }) {
  let fields: [string, string][] = [];
  try {
    const obj = JSON.parse(row.raw_json ?? "{}") as Record<string, unknown>;
    fields = Object.entries(obj)
      .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
      .map(([k, v]) => [k, String(v)]);
  } catch {
    fields = [];
  }
  return (
    <div>
      <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        Original registry fields — {row.country}
      </div>
      {fields.length === 0 ? (
        <div className="text-xs text-muted-foreground">No additional detail.</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 text-xs">
          {fields.map(([k, v]) => (
            <div key={k}>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</div>
              <div className="mt-0.5 break-words">{v}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
