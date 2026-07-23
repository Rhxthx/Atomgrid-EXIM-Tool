/** Types for the Argentina imports dataset (separate `argentina_imports` table). */

export interface RankItem {
  name: string;
  count: number;
}

export interface ArgentinaImporterRank {
  name: string;
  cif_total_usd: number;
}

export interface TypeBreakdownItem {
  code: string | null;     // "TECNICO" | "FORMULADO" | null
  count: number;
}

export interface ArgentinaStats {
  available: boolean;
  total_rows: number;
  distinct_importers?: number;
  distinct_origin_countries?: number;
  date_min?: string | null;
  date_max?: string | null;
  total_cif_usd?: number;
  top_origins?: RankItem[];
  top_ingredients?: RankItem[];
  top_importers?: ArgentinaImporterRank[];
  type_breakdown?: TypeBreakdownItem[];
  query_ms?: number;
}

export interface ArgentinaRecord {
  date: string | null;
  importer: string | null;
  origin_country: string | null;
  destination_country: string | null;
  type: string | null;
  active_ingredient_en: string | null;
  brand: string | null;
  formulation: string | null;
  segment: string | null;
  presentation: string | null;
  quantity: number | null;
  unit: string | null;
  fob_unit_usd: number | null;
  fob_total_usd: number | null;
  cif_unit_usd: number | null;
  cif_total_usd: number | null;
}

export interface ArgentinaFilters {
  q?: string;
  type?: string;            // "TECNICO" | "FORMULADO"
  importer?: string;
  origin_country?: string;
  active_ingredient?: string;
  /** Active-ingredient conditions as "op|value" strings, joined by ai_join. */
  ai?: string[];
  ai_join?: "and" | "or";
  date_from?: string;
  date_to?: string;
  year?: number;
  sort_by?: string;
  sort_order?: "asc" | "desc";
  page?: number;
  page_size?: number;
}

export interface PaginatedArgentina {
  meta: {
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
    query_ms?: number;
    available: boolean;
  };
  data: ArgentinaRecord[];
}

/** Totals over the ENTIRE filtered Argentina set (row-selection "all matching"). */
export interface ArgentinaAggregate {
  available: boolean;
  count: number;
  total_quantity: number | null;
  total_fob_usd: number | null;
  total_cif_usd: number | null;
  avg_unit_fob_usd: number | null;
  avg_unit_cif_usd: number | null;
  query_ms?: number;
}
