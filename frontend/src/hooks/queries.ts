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
  ArgentinaAggregate,
  ArgentinaFilters,
  ArgentinaStats,
  PaginatedArgentina,
} from "@/types/argentina";
import type {
  AgBioBreakdown,
  AgBioFilters,
  AgBioStats,
  PaginatedAgBio,
} from "@/types/agbio";
import type { ExportQuota } from "@/types/auth";
import type {
  PaginatedRegistration,
  RegistrationBreakdown,
  RegistrationFilters,
  RegistrationStats,
} from "@/types/registration";
import type {
  CountryAnalysisResponse,
  DatasetStats,
  DuplicateResponse,
  FilterParams,
  HSNAnalysisResponse,
  KeywordResponse,
  MonthlyTrendResponse,
  PaginatedShipments,
  ShipmentAggregate,
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

/**
 * How many rows the current user may export at once. Admins get `undefined`
 * (unlimited — full filtered result set); everyone else gets the server-
 * configured cap (default 50). The backend enforces the same limit; this is
 * just for showing it in the UI. Falls back to 50 until /me and /stats load.
 */
export function useExportRowLimit(): number | undefined {
  const { data: me } = useMe();
  const { data: stats } = useStats();
  if (me?.role === "admin") return undefined;
  return stats?.user_export_cap ?? 50;
}

/**
 * The current user's daily download quota (used + remaining, reset time).
 * Admins come back `unlimited`. Short staleTime so the count updates soon
 * after a download.
 */
export function useExportQuota() {
  return useQuery<ExportQuota>({
    queryKey: ["export-quota"] as const,
    queryFn: ep.getExportQuota,
    staleTime: 30 * 1000,
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

/**
 * Totals over the ENTIRE filtered set (row-selection "select all matching").
 * Disabled by default — only fires once the user opts into the whole-set view.
 */
export function useShipmentAggregate(
  filters: FilterParams,
  opts?: { enabled?: boolean }
) {
  return useQuery<ShipmentAggregate>({
    queryKey: ["aggregate", filters] as const,
    queryFn: () => ep.getShipmentAggregate(filters),
    enabled: opts?.enabled ?? false,
    staleTime: 60 * 1000,
  });
}

export function useArgentinaAggregate(
  filters: ArgentinaFilters,
  opts?: { enabled?: boolean }
) {
  return useQuery<ArgentinaAggregate>({
    queryKey: ["argentina-aggregate", filters] as const,
    queryFn: () => ep.getArgentinaAggregate(filters),
    enabled: opts?.enabled ?? false,
    staleTime: 60 * 1000,
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
// AG-Bio market hooks (separate dataset)
// ---------------------------------------------------------------------------

export function useAgBioStats() {
  return useQuery<AgBioStats>({
    queryKey: ["agbio-stats"] as const,
    queryFn: ep.getAgBioStats,
    staleTime: 5 * 60 * 1000,
  });
}

export function useAgBioSearch(filters: AgBioFilters) {
  return useQuery<PaginatedAgBio>({
    queryKey: ["agbio-search", filters] as const,
    queryFn: () => ep.searchAgBio(filters),
    placeholderData: (prev) => prev,
  });
}

/** Dynamic Top-products / Top-countries rankings for the current search. */
export function useAgBioBreakdown(filters: AgBioFilters) {
  return useQuery<AgBioBreakdown>({
    queryKey: ["agbio-breakdown", filters] as const,
    queryFn: () => ep.getAgBioBreakdown(filters),
    placeholderData: (prev) => prev,
    staleTime: 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// Global Registration hooks (separate dataset)
// ---------------------------------------------------------------------------

export function useRegistrationStats() {
  return useQuery<RegistrationStats>({
    queryKey: ["registration-stats"] as const,
    queryFn: ep.getRegistrationStats,
    staleTime: 5 * 60 * 1000,
  });
}

export function useRegistrationSearch(filters: RegistrationFilters) {
  return useQuery<PaginatedRegistration>({
    queryKey: ["registration-search", filters] as const,
    queryFn: () => ep.searchRegistration(filters),
    placeholderData: (prev) => prev,
  });
}

/** Filter-aware totals (registrations + countries) for the dynamic KPIs. */
export function useRegistrationBreakdown(filters: RegistrationFilters) {
  return useQuery<RegistrationBreakdown>({
    queryKey: ["registration-breakdown", filters] as const,
    queryFn: () => ep.getRegistrationBreakdown(filters),
    placeholderData: (prev) => prev,
    staleTime: 60 * 1000,
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
