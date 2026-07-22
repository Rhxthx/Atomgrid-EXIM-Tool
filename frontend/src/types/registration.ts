/** Types for the Global Registration dataset (`global_registration` table). */

export interface RegistrationCountry {
  name: string;
  count: number;
}

export interface RegistrationStats {
  available: boolean;
  total_rows: number;
  distinct_countries?: number;
  distinct_active_ingredients?: number;
  countries?: RegistrationCountry[];
  query_ms?: number;
}

/** Filter-aware totals for the dynamic KPIs (from /registration/breakdown). */
export interface RegistrationBreakdown {
  available: boolean;
  total: number;
  distinct_countries: number;
  countries: RegistrationCountry[];
  query_ms?: number;
}

/** Operators for the active-ingredient logical builder. */
export type AiOp = "contains" | "notcontains" | "equals" | "notequals";
export interface AiCondition {
  op: AiOp;
  value: string;
}

export interface RegistrationRecord {
  country: string;
  product: string | null;
  active_ingredient: string | null;
  concentration: string | null;
  company: string | null;
  status: string | null;
  registration_no: string | null;
  formulation_type: string | null;
  category: string | null;
  origin: string | null;
  /** JSON string of the row's full original (country-specific) fields. */
  raw_json: string;
}

export interface RegistrationFilters {
  q?: string;
  active_ingredient?: string;
  product?: string;
  company?: string;
  country?: string;
  category?: string;
  /** Active-ingredient conditions as "op|value" strings. */
  ai?: string[];
  ai_join?: "and" | "or";
  sort_by?: string;
  sort_order?: "asc" | "desc";
  page?: number;
  page_size?: number;
}

export interface PaginatedRegistration {
  meta: {
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
    query_ms?: number;
    available: boolean;
  };
  data: RegistrationRecord[];
}
