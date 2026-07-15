/**
 * One thin wrapper per backend endpoint.
 *
 * Keeping these in a single file (rather than spread across services/*.ts)
 * makes it trivial to swap the API client (axios → fetch / orval / etc.)
 * without touching the rest of the app.
 */

import { api, cleanParams, API_BASE_URL } from "./api";
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
import type {
  FieldsResponse,
  QueryExplainResponse,
  QueryRequest,
} from "@/types/query";
import type {
  ArgentinaAggregate,
  ArgentinaFilters,
  ArgentinaStats,
  PaginatedArgentina,
} from "@/types/argentina";
import type { AgBioFilters, AgBioStats, PaginatedAgBio } from "@/types/agbio";
import type {
  AuthUser,
  CreateUserInput,
  UpdateUserInput,
} from "@/types/auth";

export async function getStats(): Promise<DatasetStats> {
  const { data } = await api.get<DatasetStats>("/stats");
  return data;
}

// ---------------------------------------------------------------------------
// Auth + user management
// ---------------------------------------------------------------------------

export async function login(email: string, password: string): Promise<AuthUser> {
  const { data } = await api.post<AuthUser>("/auth/login", { email, password });
  return data;
}

export async function logout(): Promise<void> {
  await api.post("/auth/logout");
}

export async function getMe(): Promise<AuthUser> {
  const { data } = await api.get<AuthUser>("/auth/me");
  return data;
}

export async function changePassword(
  current_password: string,
  new_password: string
): Promise<AuthUser> {
  const { data } = await api.post<AuthUser>("/auth/change-password", {
    current_password,
    new_password,
  });
  return data;
}

export async function listUsers(): Promise<AuthUser[]> {
  const { data } = await api.get<AuthUser[]>("/admin/users");
  return data;
}

export async function createUser(body: CreateUserInput): Promise<AuthUser> {
  const { data } = await api.post<AuthUser>("/admin/users", body);
  return data;
}

export async function updateUser(id: number, body: UpdateUserInput): Promise<AuthUser> {
  const { data } = await api.patch<AuthUser>(`/admin/users/${id}`, body);
  return data;
}

export async function deleteUser(id: number): Promise<void> {
  await api.delete(`/admin/users/${id}`);
}

export async function getHealth(): Promise<{ status: string; rows?: number }> {
  const { data } = await api.get("/health");
  return data;
}

/**
 * Build a direct download URL for the full filtered export (server streams the
 * ENTIRE result set as CSV — not just the current page). Pagination/sort params
 * are dropped since the export returns everything matching the filters.
 */
export function buildExportUrl(filters: FilterParams): string {
  const { page: _p, page_size: _ps, sort_by: _sb, sort_order: _so, ...rest } =
    filters as Record<string, unknown>;
  const clean = cleanParams(rest);
  const qs = new URLSearchParams(clean as Record<string, string>).toString();
  return `${API_BASE_URL}/export${qs ? `?${qs}` : ""}`;
}

/**
 * Totals (count, quantity, value, avg unit price) over the ENTIRE filtered set
 * — powers the row-selection "select all matching" summary. Pagination/sort
 * params are dropped since the aggregate covers everything matching.
 */
export async function getShipmentAggregate(
  filters: FilterParams
): Promise<ShipmentAggregate> {
  const { page: _p, page_size: _ps, sort_by: _sb, sort_order: _so, ...rest } =
    filters as Record<string, unknown>;
  const { data } = await api.get<ShipmentAggregate>("/aggregate", {
    params: cleanParams(rest),
  });
  return data;
}

export async function searchShipments(
  filters: FilterParams
): Promise<PaginatedShipments> {
  const { data } = await api.get<PaginatedShipments>("/search", {
    params: cleanParams(filters),
  });
  return data;
}

export async function listShipments(
  filters: FilterParams
): Promise<PaginatedShipments> {
  const { data } = await api.get<PaginatedShipments>("/shipments", {
    params: cleanParams(filters),
  });
  return data;
}

export async function topEntities(
  kind: "importers" | "exporters" | "suppliers" | "buyers",
  filters: FilterParams & { limit?: number } = {},
): Promise<TopEntitiesResponse> {
  const { data } = await api.get<TopEntitiesResponse>(`/top-${kind}`, {
    params: cleanParams(filters),
  });
  return data;
}

export async function monthlyTrends(
  filters: FilterParams & { group_by?: string[] } = {},
): Promise<MonthlyTrendResponse> {
  const { data } = await api.get<MonthlyTrendResponse>("/trends/monthly", {
    params: cleanParams(filters),
    // Axios serialises arrays as `?group_by=A&group_by=B` which matches the
    // FastAPI Query(list) shape exactly.
    paramsSerializer: { indexes: null },
  });
  return data;
}

export async function countryAnalysis(
  filters: FilterParams & { limit?: number } = {},
): Promise<CountryAnalysisResponse> {
  const { data } = await api.get<CountryAnalysisResponse>("/country-analysis", {
    params: cleanParams(filters),
  });
  return data;
}

export async function hsnAnalysis(
  filters: FilterParams & { limit?: number } = {},
): Promise<HSNAnalysisResponse> {
  const { data } = await api.get<HSNAnalysisResponse>("/hsn-analysis", {
    params: cleanParams(filters),
  });
  return data;
}

export async function suggest(
  field: "Importer" | "Exporter" | "Supplier" | "Buyer",
  q: string,
  limit = 10,
): Promise<SuggestionResponse> {
  const { data } = await api.get<SuggestionResponse>("/suggest", {
    params: { field, q, limit },
  });
  return data;
}

export async function similar(
  name: string,
  field: "Importer" | "Exporter" | "Supplier" | "Buyer" = "Importer",
  limit = 10,
  min_score = 70,
): Promise<SimilarResponse> {
  const { data } = await api.get<SimilarResponse>("/similar", {
    params: { name, field, limit, min_score },
  });
  return data;
}

export async function duplicates(
  filters: FilterParams & { min_occurrences?: number; limit?: number } = {},
): Promise<DuplicateResponse> {
  const { data } = await api.get<DuplicateResponse>("/duplicates", {
    params: cleanParams(filters),
  });
  return data;
}

export async function keywords(
  filters: FilterParams & { limit?: number; sample_size?: number } = {},
): Promise<KeywordResponse> {
  const { data } = await api.get<KeywordResponse>("/keywords", {
    params: cleanParams(filters),
  });
  return data;
}

export async function supplierConcentration(
  importer: string,
  top_n = 10,
): Promise<SupplierConcentrationResponse> {
  const { data } = await api.get<SupplierConcentrationResponse>(
    "/supplier-concentration",
    { params: { importer, top_n } }
  );
  return data;
}

// ---------------------------------------------------------------------------
// Argentina imports (separate dataset)
// ---------------------------------------------------------------------------

export async function getArgentinaStats(): Promise<ArgentinaStats> {
  const { data } = await api.get<ArgentinaStats>("/argentina/stats");
  return data;
}

export async function listArgentinaImports(
  filters: ArgentinaFilters
): Promise<PaginatedArgentina> {
  const { data } = await api.get<PaginatedArgentina>("/argentina/shipments", {
    params: cleanParams(filters),
  });
  return data;
}

/** Direct download URL for the full filtered Argentina export (streamed CSV). */
export function buildArgentinaExportUrl(filters: ArgentinaFilters): string {
  const { page: _p, page_size: _ps, ...rest } = filters as Record<string, unknown>;
  const clean = cleanParams(rest);
  const qs = new URLSearchParams(clean as Record<string, string>).toString();
  return `${API_BASE_URL}/argentina/export${qs ? `?${qs}` : ""}`;
}

/** Totals over the ENTIRE filtered Argentina set (row-selection "all matching"). */
export async function getArgentinaAggregate(
  filters: ArgentinaFilters
): Promise<ArgentinaAggregate> {
  const { page: _p, page_size: _ps, ...rest } = filters as Record<string, unknown>;
  const { data } = await api.get<ArgentinaAggregate>("/argentina/aggregate", {
    params: cleanParams(rest),
  });
  return data;
}

// ---------------------------------------------------------------------------
// AG-Bio market (separate dataset — crop-protection market values)
// ---------------------------------------------------------------------------

export async function getAgBioStats(): Promise<AgBioStats> {
  const { data } = await api.get<AgBioStats>("/agbio/stats");
  return data;
}

export async function searchAgBio(filters: AgBioFilters): Promise<PaginatedAgBio> {
  const { data } = await api.get<PaginatedAgBio>("/agbio/search", {
    params: cleanParams(filters),
  });
  return data;
}

/** Direct download URL for the full filtered AG-Bio export (streamed CSV). */
export function buildAgBioExportUrl(filters: AgBioFilters): string {
  const { page: _p, page_size: _ps, ...rest } = filters as Record<string, unknown>;
  const clean = cleanParams(rest);
  const qs = new URLSearchParams(clean as Record<string, string>).toString();
  return `${API_BASE_URL}/agbio/export${qs ? `?${qs}` : ""}`;
}

// ---------------------------------------------------------------------------
// Query-builder endpoints (advanced slicer)
// ---------------------------------------------------------------------------

export async function getQueryFields(): Promise<FieldsResponse> {
  const { data } = await api.get<FieldsResponse>("/query/fields");
  return data;
}

export async function runQuery(req: QueryRequest): Promise<PaginatedShipments> {
  const { data } = await api.post<PaginatedShipments>("/query", req);
  return data;
}

export async function explainQuery(req: QueryRequest): Promise<QueryExplainResponse> {
  const { data } = await api.post<QueryExplainResponse>("/query/explain", req);
  return data;
}
