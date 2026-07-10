import type { ColumnDef } from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";
import { formatCompactMoney, formatDate, formatInt, truncate } from "@/utils/format";
import type { ShipmentRecord } from "@/types/api";

/**
 * Standard column set for any shipments table.  Returned by a factory so
 * pages can omit / reorder / extend without forking the definition.
 */
export function shipmentColumns(opts?: {
  exclude?: (keyof ShipmentRecord)[];
}): ColumnDef<ShipmentRecord, unknown>[] {
  const exclude = new Set<keyof ShipmentRecord>(opts?.exclude ?? []);

  const cols: ColumnDef<ShipmentRecord, unknown>[] = [
    {
      id: "Date",
      accessorKey: "Date",
      header: "Date",
      size: 110,
      cell: ({ getValue }) => formatDate(getValue() as string | null),
    },
    {
      id: "Trade Type",
      accessorKey: "Trade Type",
      header: "Type",
      size: 90,
      cell: ({ getValue }) => {
        const v = getValue() as string | null;
        if (!v) return "—";
        return (
          <Badge variant={v === "IMPORT" ? "secondary" : "outline"}>{v}</Badge>
        );
      },
    },
    {
      id: "Reporting Country",
      accessorKey: "Reporting Country",
      header: "Market",
      size: 110,
      cell: ({ getValue }) => {
        const v = getValue() as string | null;
        return v ? v.charAt(0) + v.slice(1).toLowerCase() : "—";
      },
    },
    {
      id: "Importer",
      // Imports carry the domestic importer; exports carry the foreign buyer.
      accessorFn: (row) => row.Importer ?? row.Buyer ?? null,
      header: "Importer / Buyer",
      size: 220,
      cell: ({ getValue }) => (
        <span title={(getValue() as string) ?? undefined}>
          {truncate(getValue() as string | null, 40)}
        </span>
      ),
    },
    {
      id: "Supplier",
      // Coalesce so the value is correct in the cell AND in CSV export:
      // imports carry the foreign seller in Supplier, exports carry the
      // Indian seller in Exporter.
      accessorFn: (row) => row.Supplier ?? row.Exporter ?? null,
      header: "Supplier / Exporter",
      size: 220,
      cell: ({ getValue }) => {
        const v = getValue() as string | null;
        return <span title={v ?? undefined}>{truncate(v, 40)}</span>;
      },
    },
    {
      id: "Origin Country",
      accessorKey: "Origin Country",
      header: "Origin",
      size: 140,
    },
    {
      id: "Destination Country",
      accessorKey: "Destination Country",
      header: "Destination",
      size: 140,
    },
    {
      id: "HSN",
      accessorKey: "HSN",
      header: "HSN",
      size: 110,
      cell: ({ getValue }) => (
        <span className="font-mono text-xs">{(getValue() as string | null) ?? "—"}</span>
      ),
    },
    {
      id: "Product Description",
      accessorKey: "Product Description",
      header: "Product",
      size: 280,
      cell: ({ getValue }) => (
        <span
          className="text-muted-foreground"
          title={(getValue() as string) ?? undefined}
        >
          {truncate(getValue() as string | null, 90)}
        </span>
      ),
    },
    {
      id: "Quantity",
      accessorKey: "Quantity",
      header: "Quantity",
      size: 120,
      cell: ({ row }) => {
        const q = row.original.Quantity;
        const u = row.original.Unit;
        return (
          <span className="font-mono text-xs">
            {formatInt(q)}
            {u ? <span className="ml-1 text-muted-foreground">{u}</span> : null}
          </span>
        );
      },
    },
    {
      id: "Value",
      accessorKey: "Value",
      header: "Value",
      size: 130,
      cell: ({ row }) => {
        const v = row.original.Value;
        const c = row.original.Currency;
        return (
          <span className="font-mono text-xs">
            {formatCompactMoney(v)}
            {c ? <span className="ml-1 text-muted-foreground">{c}</span> : null}
          </span>
        );
      },
    },
    {
      id: "Unit Price USD",
      accessorKey: "Unit Price USD",
      header: "Unit Price (USD)",
      size: 130,
      cell: ({ getValue }) => {
        const v = getValue() as number | null;
        return (
          <span className="font-mono text-xs">
            {v === null || v === undefined || Number.isNaN(v)
              ? "—"
              : "$" + v.toLocaleString("en-US", { maximumFractionDigits: 3 })}
          </span>
        );
      },
    },
    {
      id: "Port",
      accessorKey: "Port",
      header: "Port",
      size: 160,
    },
  ];

  return cols.filter((c) => !exclude.has(c.id as keyof ShipmentRecord));
}

/** Expandable details panel — used by DataTable's renderExpanded prop. */
export function ShipmentDetails({ row }: { row: ShipmentRecord }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 text-xs">
      <Detail label="BE/SB Number" value={row["BE/SB Number"]} />
      <Detail label="IEC" value={row.IEC} />
      <Detail label="CHA Name" value={row["CHA Name"]} />
      <Detail label="Mode" value={row.Mode} />
      <Detail label="City / State" value={[row.City, row.State].filter(Boolean).join(", ") || null} />
      <Detail label="Source File" value={row["Source File"]} mono />
      <Detail label="Importer Address" value={row["Importer Address"]} span />
      <Detail label="Supplier Address" value={row["Supplier Address"]} span />
      <Detail label="Exporter Address" value={row["Exporter Address"]} span />
      <Detail label="Buyer Address" value={row["Buyer Address"]} span />
    </div>
  );
}

function Detail({
  label,
  value,
  span,
  mono,
}: {
  label: string;
  value: string | number | null | undefined;
  span?: boolean;
  mono?: boolean;
}) {
  return (
    <div className={span ? "sm:col-span-2 lg:col-span-3" : undefined}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={mono ? "mt-0.5 font-mono text-xs" : "mt-0.5"}>
        {value === null || value === undefined || value === "" ? "—" : String(value)}
      </div>
    </div>
  );
}
