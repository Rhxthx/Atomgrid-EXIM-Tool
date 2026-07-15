/** Types for the AG-Bio crop-protection market dataset (`ag_bio_market` table). */

export interface AgBioRankItem {
  name: string;
  total_usd_m: number;
}

export interface AgBioTypeBreakdownItem {
  code: string | null;
  count: number;
}

export interface AgBioStats {
  available: boolean;
  total_rows: number;
  distinct_products?: number;
  distinct_countries?: number;
  total_value_usd_m?: number;
  top_products?: AgBioRankItem[];
  top_countries?: AgBioRankItem[];
  type_breakdown?: AgBioTypeBreakdownItem[];
  query_ms?: number;
}

/** One row = one (product, country) pair, with the per-crop USD-millions
 * value breakdown and the Total. All fields are already present in the list
 * response, so "click to see details" needs no extra round trip. */
export interface AgBioRecord {
  product: string;
  type: string | null;
  country: string;
  cereals: number | null;
  cotton: number | null;
  maize: number | null;
  oilseed_rape: number | null;
  other_crops: number | null;
  other_fv: number | null;
  pome_stone_fruit: number | null;
  potato: number | null;
  rice: number | null;
  soybean: number | null;
  sugar_beet: number | null;
  sugarcane: number | null;
  sunflower: number | null;
  vine: number | null;
  total_usd_m: number | null;
}

export interface AgBioFilters {
  q?: string;
  product?: string;
  country?: string;
  type?: string;
  sort_by?: string;
  sort_order?: "asc" | "desc";
  page?: number;
  page_size?: number;
}

export interface PaginatedAgBio {
  meta: {
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
    query_ms?: number;
    available: boolean;
  };
  data: AgBioRecord[];
}
