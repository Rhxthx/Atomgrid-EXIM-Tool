/**
 * Type definitions mirroring the FastAPI Phase 2 response shapes.
 *
 * Manually mirrored (rather than codegen'd from OpenAPI) so we can document
 * the columns inline and pick safer narrowed unions.  When the backend
 * evolves, run `curl /openapi.json` to regenerate.
 */

export type TradeType = "IMPORT" | "EXPORT";

export interface ShipmentRecord {
  Date: string | null;
  Importer: string | null;
  Exporter: string | null;
  Supplier: string | null;
  Buyer: string | null;
  HSN: string | null;
  Country: string | null;
  Port: string | null;
  Quantity: number | null;
  Unit: string | null;
  Value: number | null;
  "Unit Price USD": number | null;
  Currency: string | null;
  "Product Description": string | null;
  "Origin Country": string | null;
  "Destination Country": string | null;
  "Trade Type": TradeType | string | null;
  "Reporting Country": string | null;
  "HS Chapter": string | null;
  IEC: string | null;
  "BE/SB Number": string | null;
  "CHA Name": string | null;
  "Importer Address": string | null;
  "Exporter Address": string | null;
  "Supplier Address": string | null;
  "Buyer Address": string | null;
  City: string | null;
  State: string | null;
  Mode: string | null;
  "Source File": string | null;
}

export interface Meta {
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  query_ms: number;
  filters_applied: Record<string, unknown>;
}

export interface PaginatedShipments {
  meta: Meta;
  data: ShipmentRecord[];
}

/* ----- Analytics ----- */

export interface TopEntity {
  name: string;
  shipments: number;
  total_value: number | null;
  total_quantity: number | null;
}

export interface TopEntitiesResponse {
  meta: Meta;
  entity_type: "Importer" | "Exporter" | "Supplier" | "Buyer";
  data: TopEntity[];
}

export interface TrendBucket {
  month: string;
  shipments: number;
  total_value: number | null;
  total_quantity: number | null;
  // Optional secondary group keys
  "Trade Type"?: string | null;
  "HS Chapter"?: string | null;
  "Origin Country"?: string | null;
  "Destination Country"?: string | null;
}

export interface MonthlyTrendResponse {
  meta: Meta;
  group_by: string[];
  data: TrendBucket[];
}

export interface CountryAnalysisRow {
  country: string | null;
  trade_type: string | null;
  shipments: number;
  total_value: number | null;
  total_quantity: number | null;
  unique_importers: number;
  unique_exporters: number;
}

export interface CountryAnalysisResponse {
  meta: Meta;
  data: CountryAnalysisRow[];
}

export interface HSNAnalysisRow {
  hsn: string | null;
  hs_chapter: string | null;
  trade_type: string | null;
  shipments: number;
  total_value: number | null;
  total_quantity: number | null;
  top_importer: string | null;
  top_exporter: string | null;
}

export interface HSNAnalysisResponse {
  meta: Meta;
  data: HSNAnalysisRow[];
}

/* ----- Advanced ----- */

export interface SuggestionResponse {
  field: string;
  query: string;
  suggestions: string[];
  query_ms: number;
}

export interface SimilarMatch {
  name: string;
  score: number;
  shipments: number;
}

export interface SimilarResponse {
  field: string;
  query: string;
  matches: SimilarMatch[];
  query_ms: number;
}

export interface DuplicateGroup {
  key: Record<string, unknown>;
  occurrences: number;
  source_files: string[];
}

export interface DuplicateResponse {
  meta: Meta;
  data: DuplicateGroup[];
}

export interface KeywordRow {
  keyword: string;
  occurrences: number;
}

export interface KeywordResponse {
  meta: Meta;
  keywords: KeywordRow[];
}

export interface SupplierConcentrationRow {
  supplier: string | null;
  shipments: number;
  total_value: number | null;
  share_pct: number;
}

export interface SupplierConcentrationResponse {
  importer: string;
  total_suppliers: number;
  total_value: number | null;
  hhi: number;
  top_suppliers: SupplierConcentrationRow[];
  query_ms: number;
}

/* ----- Meta / Stats ----- */

export interface DatasetStats {
  total_rows: number;
  date_min: string | null;
  date_max: string | null;
  distinct_importers: number;
  distinct_exporters: number;
  distinct_suppliers: number;
  distinct_hsn: number;
  distinct_countries: number;
  trade_types: Record<string, number>;
  hs_chapters: Record<string, number>;
  reporting_countries: Record<string, number>;
  market_coverage: Record<string, MarketCoverage>;
  /** Rows a non-admin user may export at once (admins are unlimited). */
  user_export_cap: number;
  duckdb_path: string;
  query_ms: number;
}

export interface MarketCoverage {
  rows: number;
  date_min: string | null;
  date_max: string | null;
}

/* ----- Shared filter shape used everywhere ----- */

export type SortOrder = "asc" | "desc";

export interface FilterParams {
  q?: string;
  importer?: string;
  exporter?: string;
  supplier?: string;
  buyer?: string;
  hsn?: string;
  hs_chapter?: string;
  country?: string;
  origin_country?: string;
  destination_country?: string;
  port?: string;
  trade_type?: TradeType;
  reporting_country?: string;
  date_from?: string;
  date_to?: string;
  min_value?: number;
  max_value?: number;
  min_quantity?: number;
  max_quantity?: number;
  page?: number;
  page_size?: number;
  sort_by?: string;
  sort_order?: SortOrder;
}

export const SORTABLE_COLUMNS = [
  "Date",
  "Importer",
  "Exporter",
  "Supplier",
  "Buyer",
  "HSN",
  "Quantity",
  "Value",
  "Origin Country",
  "Destination Country",
  "Trade Type",
  "HS Chapter",
] as const;

export type SortableColumn = (typeof SORTABLE_COLUMNS)[number];
