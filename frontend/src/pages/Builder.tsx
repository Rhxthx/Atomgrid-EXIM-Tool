import { useMemo, useState } from "react";
import { Code2, Play, RotateCcw, Save, Sparkles } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/table/DataTable";
import {
  shipmentColumns,
  ShipmentDetails,
} from "@/components/table/shipmentColumns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { QueryBuilder } from "@/components/query/QueryBuilder";
import { FilterChips } from "@/components/query/FilterChips";
import { newCondition, newGroup, removeAt, sanitize } from "@/components/query/queryHelpers";

import {
  useExplainQuery,
  useQueryFields,
  useRunQuery,
} from "@/hooks/queries";
import { useSavedStore } from "@/store/savedSearches";
import type { GroupNode, QueryRequest } from "@/types/query";

const COLS = shipmentColumns();

const PAGE_SIZE = 50;

/**
 * Advanced Query Builder page.  Lets users compose nested AND/OR/NOT trees
 * over any column in the dataset.  Output goes to the same DataTable used
 * everywhere else, so the UX matches /search.
 */
export function BuilderPage() {
  const { data: fieldsResp, isLoading: fieldsLoading } = useQueryFields();
  const fields = fieldsResp?.fields ?? [];

  // Start with an empty AND group plus one starter condition once fields load.
  const [tree, setTree] = useState<GroupNode>(() => newGroup());

  // Re-seed the empty tree once fields are available so the user sees a
  // useful starting condition instead of an empty group.
  useMemo(() => {
    if (fields.length > 0 && tree.conditions.length === 0) {
      setTree(newGroup([newCondition(fields[0])]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields.length]);

  // Last-applied query — only this triggers a server fetch.
  const [applied, setApplied] = useState<QueryRequest | null>(null);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ sort_by?: string; sort_order?: "asc" | "desc" }>({});

  const reqForRun: QueryRequest = useMemo(() => {
    if (!applied) return { page, page_size: PAGE_SIZE, ...sort };
    return { ...applied, page, page_size: PAGE_SIZE, ...sort };
  }, [applied, page, sort]);

  const { data, isLoading, isFetching, error } = useRunQuery(reqForRun, {
    enabled: !!applied,
  });

  const explainMut = useExplainQuery();
  const [showSql, setShowSql] = useState(false);

  const templates = useSavedStore((s) => s.templates);
  const saveTemplate = useSavedStore((s) => s.saveTemplate);
  const removeTemplate = useSavedStore((s) => s.removeTemplate);

  const apply = () => {
    const sanitized = sanitize(tree);
    if (!sanitized) {
      setApplied({ where: undefined, page: 1, page_size: PAGE_SIZE });
    } else {
      setApplied({ where: sanitized, page: 1, page_size: PAGE_SIZE });
    }
    setPage(1);
  };

  const showSqlPreview = () => {
    const sanitized = sanitize(tree);
    explainMut.mutate(
      { where: sanitized ?? undefined },
      { onSuccess: () => setShowSql(true) }
    );
  };

  const onSaveTemplate = () => {
    const sanitized = sanitize(tree);
    if (!sanitized) return;
    const name = window.prompt("Template name") ?? "";
    if (!name.trim()) return;
    saveTemplate({ name: name.trim(), where: sanitized });
  };

  const onLoadTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (t) setTree(t.where);
  };

  const reset = () => {
    setTree(newGroup(fields.length > 0 ? [newCondition(fields[0])] : []));
    setApplied(null);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Query Builder"
        description="Compose AND / OR / NOT trees over any column — Power-BI-style logical filtering."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={showSqlPreview} disabled={explainMut.isPending}>
              <Code2 className="mr-1.5 h-4 w-4" />
              SQL preview
            </Button>
            <Button variant="outline" size="sm" onClick={onSaveTemplate} disabled={tree.conditions.length === 0}>
              <Save className="mr-1.5 h-4 w-4" />
              Save template
            </Button>
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="mr-1.5 h-4 w-4" />
              Reset
            </Button>
            <Button size="sm" onClick={apply}>
              <Play className="mr-1.5 h-4 w-4" />
              Apply
            </Button>
          </div>
        }
      />

      {/* Builder */}
      {fieldsLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <QueryBuilder value={tree} fields={fields} onChange={setTree} />
      )}

      {/* Templates row */}
      {templates.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Sparkles className="h-4 w-4" />
              Saved templates
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 pt-0">
            {templates.map((t) => (
              <div
                key={t.id}
                className="group flex items-center gap-1 rounded-md border bg-card/40 px-2 py-1"
              >
                <button
                  onClick={() => onLoadTemplate(t.id)}
                  className="text-xs font-medium hover:underline"
                >
                  {t.name}
                </button>
                <button
                  onClick={() => removeTemplate(t.id)}
                  className="opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  aria-label="Delete template"
                >
                  ×
                </button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Chips strip (read-only summary of the live tree) */}
      {tree.conditions.length > 0 && (
        <Card>
          <CardContent className="p-3">
            <FilterChips
              root={tree}
              fields={fields}
              onRemove={(path) => setTree(removeAt(tree, path))}
            />
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {applied ? (
        <div className="space-y-3">
          {data && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary">
                {data.meta.total.toLocaleString()} matches
              </Badge>
              <Badge variant="outline">{data.meta.query_ms.toFixed(0)} ms</Badge>
              {data.meta.filters_applied && (
                <span>
                  {(data.meta.filters_applied as { conditions?: number; groups?: number })
                    .conditions ?? 0}{" "}
                  conditions ·{" "}
                  {(data.meta.filters_applied as { conditions?: number; groups?: number })
                    .groups ?? 0}{" "}
                  groups
                </span>
              )}
            </div>
          )}
          <DataTable
            columns={COLS}
            data={data?.data ?? []}
            loading={isLoading || isFetching}
            emptyMessage="No shipments match — try relaxing a condition."
            csvFilename="query-results.csv"
            renderExpanded={(row) => <ShipmentDetails row={row} />}
            serverPagination={{
              page,
              pageSize: PAGE_SIZE,
              total: data?.meta.total ?? 0,
              onChange: ({ page: p }) => setPage(p),
            }}
            serverSort={{
              sortBy: sort.sort_by,
              sortOrder: sort.sort_order,
              onChange: ({ sortBy, sortOrder }) =>
                setSort({ sort_by: sortBy, sort_order: sortOrder }),
            }}
          />
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              {String((error as Error).message)}
            </div>
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="p-12 text-center text-sm text-muted-foreground">
            Click <strong>Apply</strong> to run the query.
          </CardContent>
        </Card>
      )}

      {/* SQL preview dialog */}
      <Dialog open={showSql} onOpenChange={setShowSql}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Generated SQL</DialogTitle>
          </DialogHeader>
          <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs">
            <code>{explainMut.data?.sql ?? "—"}</code>
          </pre>
          {explainMut.data?.params && explainMut.data.params.length > 0 && (
            <>
              <div className="mt-2 text-xs font-medium">Bound parameters</div>
              <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs">
                <code>{JSON.stringify(explainMut.data.params, null, 2)}</code>
              </pre>
            </>
          )}
          <p className="text-[11px] text-muted-foreground">
            Values are passed as bound parameters (DuckDB <code>?</code>
            placeholders) — never interpolated into the SQL string.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
