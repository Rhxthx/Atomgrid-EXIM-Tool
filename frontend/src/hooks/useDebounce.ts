import { useEffect, useState } from "react";

/**
 * Returns a value that only updates after the caller has stopped changing
 * it for `delay` ms.  Used by the global search bar so we don't fire
 * suggest/search requests on every keystroke.
 */
export function useDebounce<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
