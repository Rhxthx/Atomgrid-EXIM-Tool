import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import type { FilterParams } from "@/types/api";

const NUMERIC_KEYS = new Set<keyof FilterParams>([
  "min_value",
  "max_value",
  "min_quantity",
  "max_quantity",
  "page",
  "page_size",
]);

/**
 * Sync filter state with the URL.  Lets users bookmark / share results and
 * makes the Saved Searches feature trivial — just persist the path + query.
 */
export function useUrlFilters(defaults: FilterParams = {}): [
  FilterParams,
  (next: FilterParams) => void,
] {
  const [params, setParams] = useSearchParams();

  const value = useMemo<FilterParams>(() => {
    const out: FilterParams = { ...defaults };
    for (const [k, v] of params.entries()) {
      if (v === "") continue;
      const key = k as keyof FilterParams;
      if (NUMERIC_KEYS.has(key)) {
        const n = Number(v);
        if (!Number.isNaN(n)) (out as Record<string, unknown>)[key] = n;
      } else {
        (out as Record<string, unknown>)[key] = v;
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const setValue = useCallback(
    (next: FilterParams) => {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(next)) {
        if (v === undefined || v === null || v === "") continue;
        sp.set(k, String(v));
      }
      setParams(sp, { replace: true });
    },
    [setParams]
  );

  return [value, setValue];
}
