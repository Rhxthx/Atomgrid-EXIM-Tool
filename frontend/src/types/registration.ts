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

export interface RegistrationRecord {
  country: string;
  product: string | null;
  active_ingredient: string | null;
  concentration: string | null;
  company: string | null;
  status: string | null;
  registration_no: string | null;
  formulation_type: string | null;
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
