import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { Fragment, useMemo, useState } from "react";
import { Download, ArrowUpDown, ArrowDown, ArrowUp, Copy, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination } from "@/components/table/Pagination";
import { downloadCsv, toCsv } from "@/utils/csv";
import { cn } from "@/utils/cn";

export interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  /** When provided, the table is server-paginated. */
  serverPagination?: {
    page: number;
    pageSize: number;
    total: number;
    onChange: (next: { page: number; pageSize: number }) => void;
  };
  /** When provided, sort changes are propagated to the server. */
  serverSort?: {
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    onChange: (sort: { sortBy?: string; sortOrder?: "asc" | "desc" }) => void;
  };
  loading?: boolean;
  emptyMessage?: string;
  csvFilename?: string;
  /**
   * When set, the export button downloads the FULL filtered result set from
   * this server URL (streamed CSV), instead of just the current page.
   */
  serverExportUrl?: string;
  /**
   * Optional row expander.  When provided, each row gets a chevron that
   * toggles a details panel rendered via this function.
   */
  renderExpanded?: (row: TData) => React.ReactNode;
  /** Default min width for each column (resizable). */
  minColumnWidth?: number;
  className?: string;
}

/**
 * Wrapper around TanStack Table.
 *
 *   - sticky header
 *   - column resizing
 *   - CSV export of current page (server pagination) or full dataset
 *     (client pagination)
 *   - row copy to clipboard
 *   - expandable rows
 */
export function DataTable<TData>({
  columns,
  data,
  serverPagination,
  serverSort,
  loading = false,
  emptyMessage = "No data.",
  csvFilename = "export.csv",
  serverExportUrl,
  renderExpanded,
  className,
}: DataTableProps<TData>) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [clientSort, setClientSort] = useState<SortingState>([]);

  // When the server controls sorting, lift sort state out of TanStack so it
  // doesn't fight the URL/query params.
  const sorting: SortingState = serverSort?.sortBy
    ? [{ id: serverSort.sortBy, desc: serverSort.sortOrder !== "asc" }]
    : clientSort;

  const handleSortChange = (next: SortingState | ((s: SortingState) => SortingState)) => {
    const resolved = typeof next === "function" ? next(sorting) : next;
    if (serverSort) {
      const head = resolved[0];
      serverSort.onChange(
        head ? { sortBy: head.id, sortOrder: head.desc ? "desc" : "asc" } : {}
      );
    } else {
      setClientSort(resolved);
    }
  };

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: handleSortChange,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: !!serverPagination,
    manualSorting: !!serverSort,
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    defaultColumn: { minSize: 80, size: 160 },
  });

  // Build CSV from the *visible* table — respects column order and headers.
  const exportCsv = useMemo(
    () => () => {
      const leaf = table
        .getVisibleLeafColumns()
        .filter((c) => c.id !== "_expander");
      const cols = leaf.map((c) => ({
        key: c.id,
        header: typeof c.columnDef.header === "string" ? c.columnDef.header : c.id,
      }));
      // Read each cell's resolved value (respects accessorFn coalescing, e.g.
      // Supplier/Exporter and Importer/Buyer) rather than the raw record field.
      const rows = table.getRowModel().rows.map((r) => {
        const obj: Record<string, unknown> = {};
        for (const cell of r.getVisibleCells()) {
          if (cell.column.id === "_expander") continue;
          obj[cell.column.id] = cell.getValue();
        }
        return obj;
      });
      downloadCsv(csvFilename, toCsv(rows, cols));
    },
    [table, csvFilename]
  );

  const exportAll = () => {
    if (!serverExportUrl) return;
    const a = document.createElement("a");
    a.href = serverExportUrl;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const copyRow = async (row: TData) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(row, null, 2));
    } catch {
      /* clipboard not available */
      void 0;
    }
  };

  return (
    <div className={cn("flex flex-col rounded-lg border bg-card", className)}>
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="text-xs text-muted-foreground">
          {loading
            ? "Loading…"
            : serverPagination
            ? `${serverPagination.total.toLocaleString()} total`
            : `${data.length.toLocaleString()} rows`}
        </div>
        <div className="flex items-center gap-1">
          {serverExportUrl ? (
            <Button
              variant="outline"
              size="sm"
              onClick={exportAll}
              disabled={loading || (serverPagination?.total ?? data.length) === 0}
              title="Download all rows matching the current filters (opens in Excel)"
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export to Excel
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={loading || data.length === 0}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              CSV
            </Button>
          )}
        </div>
      </div>

      <div className="relative max-h-[70vh] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {renderExpanded && (
                  <th className="w-8 border-b border-border" aria-label="" />
                )}
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sortDir = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      style={{ width: header.getSize() }}
                      className={cn(
                        "relative select-none border-b border-border bg-card px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground",
                        canSort && "cursor-pointer hover:text-foreground"
                      )}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort && (
                          sortDir === "asc" ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : sortDir === "desc" ? (
                            <ArrowDown className="h-3 w-3" />
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-40" />
                          )
                        )}
                      </span>
                      {header.column.getCanResize() && (
                        <div
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          className="absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none bg-transparent hover:bg-primary/60"
                        />
                      )}
                    </th>
                  );
                })}
                <th className="w-10 border-b border-border bg-card" aria-label="actions" />
              </tr>
            ))}
          </thead>

          <tbody>
            {loading && data.length === 0 && (
              <SkeletonRows columns={columns.length} />
            )}

            {!loading && data.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + (renderExpanded ? 2 : 1)}
                  className="px-3 py-12 text-center text-sm text-muted-foreground"
                >
                  {emptyMessage}
                </td>
              </tr>
            )}

            {table.getRowModel().rows.map((row) => {
              const id = row.id;
              const isExpanded = expanded[id];
              return (
                <Fragment key={id}>
                  <tr
                    className="group transition-colors hover:bg-accent/40"
                  >
                    {renderExpanded && (
                      <td className="border-b border-border/60 px-2 py-2 text-center">
                        <button
                          onClick={() => setExpanded((e) => ({ ...e, [id]: !e[id] }))}
                          className="rounded p-0.5 hover:bg-accent"
                          aria-label="Toggle row"
                        >
                          <ChevronRight
                            className={cn(
                              "h-4 w-4 text-muted-foreground transition-transform",
                              isExpanded && "rotate-90"
                            )}
                          />
                        </button>
                      </td>
                    )}
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className="border-b border-border/60 px-3 py-2 align-top"
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                    <td className="border-b border-border/60 px-2 py-2 text-right">
                      <button
                        onClick={() => copyRow(row.original)}
                        className="invisible rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground group-hover:visible"
                        aria-label="Copy row JSON"
                        title="Copy row JSON"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                  {renderExpanded && isExpanded && (
                    <tr key={`${id}-expand`}>
                      <td
                        colSpan={columns.length + 2}
                        className="border-b border-border bg-muted/30 px-6 py-3"
                      >
                        {renderExpanded(row.original)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {serverPagination && (
        <div className="border-t border-border">
          <Pagination
            page={serverPagination.page}
            pageSize={serverPagination.pageSize}
            total={serverPagination.total}
            onChange={serverPagination.onChange}
          />
        </div>
      )}
    </div>
  );
}

function SkeletonRows({ columns }: { columns: number }) {
  return (
    <>
      {Array.from({ length: 6 }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: columns + 1 }).map((_, c) => (
            <td key={c} className="border-b border-border/60 px-3 py-2">
              <Skeleton className="h-4 w-3/4" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
