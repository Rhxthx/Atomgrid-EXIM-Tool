import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
   * When set, the current user's server export is capped at this many rows
   * (non-admins). The backend enforces the same cap; this only adjusts the
   * button label/tooltip so the limit is clear. Leave undefined for admins
   * (full export).
   */
  exportRowLimit?: number;
  /** Hide the export/CSV button entirely (datasets where download is
   * intentionally not offered). */
  hideExport?: boolean;
  /** Remaining downloads today for the current user (null/undefined = unlimited
   * or not tracked). When 0, the export button is disabled. */
  downloadsLeft?: number | null;
  /** Called right after a server export is triggered, so the caller can refresh
   * the quota count. */
  onExported?: () => void;
  /**
   * Enable multi-row selection: adds a checkbox column and a summary bar that
   * totals the selected rows.  Pair with `totalMatching` + `allMatching` to
   * also total the ENTIRE filtered set (not just the current page).
   */
  selectable?: boolean;
  /**
   * Total rows matching the CURRENT server filters.  When more rows match than
   * are shown on the page, the summary bar offers "Select all N matching".
   */
  totalMatching?: number;
  /** Controlled flag: totals reflect the ENTIRE filtered set, not the page. */
  allMatching?: boolean;
  onAllMatchingChange?: (active: boolean) => void;
  /**
   * Opaque value that clears selection + expanded rows whenever its identity
   * changes. Pass the page's filter object so selection resets on any
   * filter/page/sort change — robust even when the list query keeps a stable
   * `data` reference via react-query `placeholderData`.
   */
  selectionResetKey?: unknown;
  /** Renders the summary content shown in the selection bar. */
  renderSelectionSummary?: (ctx: {
    selectedRows: TData[];
    allMatching: boolean;
  }) => React.ReactNode;
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
  exportRowLimit,
  hideExport = false,
  downloadsLeft,
  onExported,
  selectable = false,
  totalMatching,
  allMatching = false,
  onAllMatchingChange,
  selectionResetKey,
  renderSelectionSummary,
  renderExpanded,
  className,
}: DataTableProps<TData>) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [clientSort, setClientSort] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  // Keep the latest onAllMatchingChange callable without making the data-reset
  // effect depend on it (which would re-run on every parent render).
  const allMatchingCbRef = useRef(onAllMatchingChange);
  allMatchingCbRef.current = onAllMatchingChange;

  // Selection AND expanded rows are per-page and index-based (no getRowId), so
  // reset both whenever the underlying rows change (page / sort / filter /
  // refetch) — a stale index must not silently point at a different shipment.
  // Keyed on `data` AND `selectionResetKey`: the latter (the page's filters)
  // fires even when a list query keeps a stable `data` ref via placeholderData.
  // State updates are guarded so this can't loop on a fresh `[]` while loading.
  useEffect(() => {
    setRowSelection((prev) => (Object.keys(prev).length ? {} : prev));
    setExpanded((prev) => (Object.keys(prev).length ? {} : prev));
    allMatchingCbRef.current?.(false);
  }, [data, selectionResetKey]);

  // Prepend a checkbox column when selection is enabled.
  const tableColumns = useMemo<ColumnDef<TData, unknown>[]>(() => {
    if (!selectable) return columns;
    const selectCol: ColumnDef<TData, unknown> = {
      id: "_select",
      enableSorting: false,
      enableResizing: false,
      size: 36,
      header: ({ table }) => (
        <input
          type="checkbox"
          className="h-3.5 w-3.5 cursor-pointer accent-primary"
          aria-label="Select all rows on this page"
          checked={table.getIsAllPageRowsSelected()}
          ref={(el) => {
            if (el)
              el.indeterminate =
                table.getIsSomePageRowsSelected() &&
                !table.getIsAllPageRowsSelected();
          }}
          onChange={table.getToggleAllPageRowsSelectedHandler()}
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          className="h-3.5 w-3.5 cursor-pointer accent-primary"
          aria-label="Select row"
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
        />
      ),
    };
    return [selectCol, ...columns];
  }, [columns, selectable]);

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
    columns: tableColumns,
    state: { sorting, rowSelection },
    onSortingChange: handleSortChange,
    onRowSelectionChange: (updater) => {
      setRowSelection(updater);
      // Any manual checkbox toggle drops out of "all matching filters" mode.
      allMatchingCbRef.current?.(false);
    },
    enableRowSelection: selectable,
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

  const outOfDownloads = typeof downloadsLeft === "number" && downloadsLeft <= 0;

  const exportAll = () => {
    if (!serverExportUrl || outOfDownloads) return;
    const a = document.createElement("a");
    a.href = serverExportUrl;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    onExported?.();
  };

  const copyRow = async (row: TData) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(row, null, 2));
    } catch {
      /* clipboard not available */
      void 0;
    }
  };

  const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);
  const selectedCount = selectedRows.length;
  const pageRowCount = table.getRowModel().rows.length;
  const showSelectionBar = selectable && (allMatching || selectedCount > 0);
  const canSelectAllMatching =
    !allMatching &&
    selectedCount > 0 &&
    selectedCount === pageRowCount &&
    (totalMatching ?? 0) > selectedCount;
  const totalCols =
    table.getVisibleLeafColumns().length + (renderExpanded ? 1 : 0) + 1;
  const clearSelection = () => {
    setRowSelection({});
    onAllMatchingChange?.(false);
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
          {hideExport ? null : serverExportUrl ? (
            <Button
              variant="outline"
              size="sm"
              onClick={exportAll}
              disabled={
                loading ||
                (serverPagination?.total ?? data.length) === 0 ||
                outOfDownloads
              }
              title={
                outOfDownloads
                  ? "You've used all your downloads for today. Resets at midnight IST."
                  : exportRowLimit
                  ? `Download the first ${exportRowLimit.toLocaleString()} rows matching your filters (opens in Excel).${
                      typeof downloadsLeft === "number" ? ` ${downloadsLeft} download(s) left today.` : ""
                    } Full export is available to administrators.`
                  : "Download all rows matching the current filters (opens in Excel)"
              }
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {outOfDownloads
                ? "Daily limit reached"
                : (exportRowLimit
                    ? `Export to Excel (max ${exportRowLimit.toLocaleString()})`
                    : "Export to Excel") +
                  (typeof downloadsLeft === "number" ? ` · ${downloadsLeft} left` : "")}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={loading || data.length === 0}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              CSV
            </Button>
          )}
        </div>
      </div>

      {showSelectionBar && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border bg-primary/5 px-3 py-2 text-xs">
          <span className="font-medium text-foreground">
            {allMatching
              ? `All ${(totalMatching ?? 0).toLocaleString()} matching rows`
              : `${selectedCount.toLocaleString()} selected`}
          </span>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {renderSelectionSummary?.({ selectedRows, allMatching })}
          </div>
          <div className="ml-auto flex items-center gap-3">
            {canSelectAllMatching && (
              <button
                type="button"
                onClick={() => onAllMatchingChange?.(true)}
                className="font-medium text-primary hover:underline"
              >
                Select all {(totalMatching ?? 0).toLocaleString()} matching
              </button>
            )}
            <button
              type="button"
              onClick={clearSelection}
              className="text-muted-foreground hover:text-foreground hover:underline"
            >
              Clear
            </button>
          </div>
        </div>
      )}

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
              <SkeletonRows
                columns={
                  table.getVisibleLeafColumns().length + (renderExpanded ? 1 : 0)
                }
              />
            )}

            {!loading && data.length === 0 && (
              <tr>
                <td
                  colSpan={totalCols}
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
                        colSpan={totalCols}
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
