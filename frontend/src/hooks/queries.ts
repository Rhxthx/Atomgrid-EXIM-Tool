/**
 * Centralised React Query hooks — one per backend endpoint.
 *
 * Pattern:
 *   - keys live in `qk` so cache invalidation is grep-able
 *   - all hooks accept a single object that's also their cache key
 *   - long-running queries (top-N, trends, country/HSN) are cached longer
 *     than search queries (which are typically unique)
 */

import { useMutation, useQuery, type UseQueryOptions } from "@tanstack/react-query";

import * as ep from "@/services/endpoints";
import type { QueryRequest } from "@/types/query";
import type {
  ArgentinaFilters,
  ArgentinaStats,
  PaginatedArgentina,
} from "@/types/argentina";
import type {
  CountryAnalysisResponse,
  DatasetStats,
  DuplicateResponse,
  FilterParams,
  HSNAnalysisResponse,
  KeywordResponse,
  MonthlyTrendResponse,
  PaginatedShipments,
  SimilarResponse,
  SuggestionResponse,
  SupplierConcentrationResponse,
  TopEntitiesResponse,
} from "@/types/api";

export const qk = {
  stats: ["stats"] as const,
  search: (f: FilterParams) => ["search", f] as const,
  shipments: (f: FilterParams) => ["shipments", f] as const,
  topEntities: (kind: string, f: object) => ["top-entities", kind, f] as const,
  trends: (f: object) => ["trends-monthly", f] as const,
  country: (f: object) => ["country-analysis", f] as const,
  hsn: (f: object) => ["hsn-analysis", f] as const,
  suggest: (field: string, q: string) => ["suggest", field, q] as const,
  similar: (name: string, field: string) => ["similar", field, name] as const,
  duplicates: (f: object) => ["duplicates", f] as const,
  keywords: (f: object) => ["keywords", f] as const,
  concentration: (importer: string) => ["supplier-concentration", importer] as const,
};

export function useStats(opts?: Partial<UseQueryOptions<DatasetStats>>) {
  return useQuery({
    queryKey: qk.stats,
    queryFn: ep.getStats,
    staleTime: 5 * 60 * 1000,
    ...opts,
  });
}

// --- Auth ------------------------------------------------------------------

export function useMe() {
  return useQuery({
    queryKey: ["me"] as const,
    queryFn: ep.getMe,
    retry: false,            // a 401 means "not logged in" — don't retry
    staleTime: 5 * 60 * 1000,
  });
}

export function useUsers(enabled = true) {
  return useQuery({
    queryKey: ["admin-users"] as const,
    queryFn: ep.listUsers,
    enabled,
  });
}

export function useSearchShipments(
  filters: FilterParams,
  opts?: { enabled?: boolean }
) {
  return useQuery<PaginatedShipments>({
    queryKey: qk.search(filters),
    queryFn: () => ep.searchShipments(filters),
    enabled: opts?.enabled ?? true,
  });
}

export function useShipments(filters: FilterParams) {
  return useQuery<PaginatedShipments>({
    queryKey: qk.shipments(filters),
    queryFn: () => ep.listShipments(filters),
  });
}

export function useTopEntities(
  kind: "importers" | "exporters" | "suppliers" | "buyers",
  filters: FilterParams & { limit?: number } = {}
) {
  return useQuery<TopEntitiesResponse>({
    queryKey: qk.topEntities(kind, filters),
    queryFn: () => ep.topEntities(kind, filters),
    staleTime: 2 * 60 * 1000,
  });
}

export function useMonthlyTrends(
  filters: FilterParams & { group_by?: string[] } = {}
) {
  return useQuery<MonthlyTrendResponse>({
    queryKey: qk.trends(filters),
    queryFn: () => ep.monthlyTrends(filters),
    staleTime: 5 * 60 * 1000,
  });
}

export function useCountryAnalysis(
  filters: FilterParams & { limit?: number } = {}
) {
  return useQuery<CountryAnalysisResponse>({
    queryKey: qk.country(filters),
    queryFn: () => ep.countryAnalysis(filters),
    staleTime: 5 * 60 * 1000,
  });
}

export function useHsnAnalysis(filters: FilterParams & { limit?: number } = {}) {
  return useQuery<HSNAnalysisResponse>({
    queryKey: qk.hsn(filters),
    queryFn: () => ep.hsnAnalysis(filters),
    staleTime: 5 * 60 * 1000,
  });
}

export function useSuggest(
  field: "Importer" | "Exporter" | "Supplier" | "Buyer",
  q: string,
  opts?: { enabled?: boolean }
) {
  return useQuery<SuggestionResponse>({
    queryKey: qk.suggest(field, q),
    queryFn: () => ep.suggest(field, q),
    enabled: (opts?.enabled ?? true) && q.length >= 2,
    staleTime: 60 * 1000,
  });
}

export function useSimilar(
  name: string,
  field: "Importer" | "Exporter" | "Supplier" | "Buyer" = "Importer",
  opts?: { enabled?: boolean }
) {
  return useQuery<SimilarResponse>({
    queryKey: qk.similar(name, field),
    queryFn: () => ep.similar(name, field),
    enabled: (opts?.enabled ?? true) && name.length >= 2,
    staleTime: 60 * 1000,
  });
}

export function useDuplicates(
  filters: FilterParams & { min_occurrences?: number; limit?: number } = {}
) {
  return useQuery<DuplicateResponse>({
    queryKey: qk.duplicates(filters),
    queryFn: () => ep.duplicates(filters),
  });
}

export function useKeywords(
  filters: FilterParams & { limit?: number; sample_size?: number } = {}
) {
  return useQuery<KeywordResponse>({
    queryKey: qk.keywords(filters),
    queryFn: () => ep.keywords(filters),
    staleTime: 5 * 60 * 1000,
  });
}

export function useSupplierConcentration(
  importer: string,
  opts?: { enabled?: boolean }
) {
  return useQuery<SupplierConcentrationResponse>({
    queryKey: qk.concentration(importer),
    queryFn: () => ep.supplierConcentration(importer),
    enabled: (opts?.enabled ?? true) && importer.length >= 2,
  });
}

// ---------------------------------------------------------------------------
// Argentina imports hooks
// ---------------------------------------------------------------------------

export function useArgentinaStats() {
  return useQuery<ArgentinaStats>({
    queryKey: ["argentina-stats"] as const,
    queryFn: ep.getArgentinaStats,
    staleTime: 5 * 60 * 1000,
  });
}

export function useArgentinaImports(filters: ArgentinaFilters) {
  return useQuery<PaginatedArgentina>({
    queryKey: ["argentina-shipments", filters] as const,
    queryFn: () => ep.listArgentinaImports(filters),
    placeholderData: (prev) => prev,
  });
}

// ---------------------------------------------------------------------------
// Query-builder hooks
// ---------------------------------------------------------------------------

export function useQueryFields() {
  return useQuery({
    queryKey: ["query-fields"] as const,
    queryFn: ep.getQueryFields,
    staleTime: Infinity,    // schema only changes on backend restart
  });
}

/** Runs the advanced query whenever the tree changes.  Disabled until the
 * caller flips `enabled` (typically after the user hits Apply). */
export function useRunQuery(req: QueryRequest, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["run-query", req] as const,
    queryFn: () => ep.runQuery(req),
    enabled: opts?.enabled ?? true,
    placeholderData: (prev) => prev,    // keep previous results visible while refetching
  });
}

/** On-demand SQL preview — fires manually via .mutate(req). */
export function useExplainQuery() {
  return useMutation({
    mutationFn: ep.explainQuery,
  });
}
