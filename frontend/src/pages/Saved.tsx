import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Bookmark, BookmarkX, Search, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSavedStore, type BookmarkedEntity } from "@/store/savedSearches";
import type { FilterParams } from "@/types/api";
import { formatDate, truncate } from "@/utils/format";

export function SavedPage() {
  const searches = useSavedStore((s) => s.searches);
  const bookmarks = useSavedStore((s) => s.bookmarks);
  const removeSearch = useSavedStore((s) => s.removeSearch);
  const toggleBookmark = useSavedStore((s) => s.toggleBookmark);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Saved Searches & Bookmarks"
        description="Re-run common queries and revisit bookmarked counterparties."
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4" />
            Saved searches
            <Badge variant="secondary">{searches.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {searches.length === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              No saved searches yet — use the “Save search” button on the
              Global Search page.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {searches.map((s) => {
                const sp = useSearchParamsFromFilters(s.filters);
                const target = `${s.pathname}?${sp.toString()}`;
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                    <Link
                      to={target}
                      className="flex-1 min-w-0"
                    >
                      <div className="font-medium hover:underline">
                        {truncate(s.name, 80)}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {s.pathname} · {formatDate(new Date(s.createdAt))}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(Object.entries(s.filters) as [string, unknown][])
                          .filter(([k, v]) => v !== undefined && v !== null && v !== "" && !["page", "page_size"].includes(k))
                          .slice(0, 6)
                          .map(([k, v]) => (
                            <Badge key={k} variant="outline" className="text-[10px]">
                              {k}: {String(v as string | number | boolean)}
                            </Badge>
                          ))}
                      </div>
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeSearch(s.id)}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Bookmark className="h-4 w-4" />
            Bookmarked counterparties
            <Badge variant="secondary">{bookmarks.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {bookmarks.length === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              Click the bookmark icon on any importer/exporter/supplier/buyer
              card to add it here.
            </div>
          ) : (
            <BookmarkGrid
              bookmarks={bookmarks}
              onRemove={(b) => toggleBookmark({ kind: b.kind, name: b.name })}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BookmarkGrid({
  bookmarks,
  onRemove,
}: {
  bookmarks: BookmarkedEntity[];
  onRemove: (b: { kind: BookmarkedEntity["kind"]; name: string }) => void;
}) {
  const byKind = useMemo(() => {
    const out: Record<string, typeof bookmarks> = {};
    for (const b of bookmarks) {
      out[b.kind] ??= [];
      out[b.kind].push(b);
    }
    return out;
  }, [bookmarks]);

  const filterParamFor = (kind: string): string => {
    switch (kind) {
      case "Importer": return "importer";
      case "Exporter": return "exporter";
      case "Supplier": return "supplier";
      case "Buyer":    return "buyer";
      default:         return "q";
    }
  };

  return (
    <div className="space-y-4">
      {Object.entries(byKind).map(([kind, items]) => (
        <div key={kind}>
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {kind}s ({items.length})
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((b) => (
              <div
                key={b.id}
                className="flex items-center gap-2 rounded-md border bg-card/40 p-2"
              >
                <Link
                  to={`/shipments?${filterParamFor(b.kind)}=${encodeURIComponent(b.name)}`}
                  className="min-w-0 flex-1 truncate text-sm hover:underline"
                  title={b.name}
                >
                  {b.name}
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onRemove(b)}
                  title="Remove bookmark"
                >
                  <BookmarkX className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function useSearchParamsFromFilters(filters: FilterParams): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(filters) as [string, unknown][]) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v as string | number | boolean));
  }
  return sp;
}
