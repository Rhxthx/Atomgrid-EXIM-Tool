import axios, { type AxiosError } from "axios";

/**
 * Axios client.
 *
 *   In dev (vite dev):       VITE_API_BASE_URL undefined ⇒ "/api" (Vite proxy)
 *   In production:           set VITE_API_BASE_URL to e.g. "https://api.example.com"
 *
 * The Phase 2 backend is read-only so we don't need request signing,
 * CSRF tokens, or auth headers — just a thin wrapper for timeouts and
 * unified error shape.
 */
export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "/api";

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30_000,
  headers: { Accept: "application/json" },
  // Send the HttpOnly session cookie with every request.
  withCredentials: true,
});

export class ApiError extends Error {
  status?: number;
  detail?: string;
  constructor(message: string, status?: number, detail?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

api.interceptors.response.use(
  (r) => r,
  (err: AxiosError<{ detail?: string }>) => {
    const status = err.response?.status;
    const url = err.config?.url ?? "";
    // Session expired / not authenticated on a data call → bounce to login.
    // Skip auth endpoints (the login page + RequireAuth handle those without
    // a hard redirect, avoiding loops).
    if (
      status === 401 &&
      !url.includes("/auth/") &&
      typeof window !== "undefined" &&
      window.location.pathname !== "/login"
    ) {
      window.location.assign("/login");
    }
    const detail = err.response?.data?.detail;
    throw new ApiError(detail || err.message || "Request failed", status, detail);
  }
);

/**
 * Drop undefined / null / empty-string keys before sending — the FastAPI
 * dependency forbids extras + treats explicit nulls as validation errors.
 */
export function cleanParams<T extends object>(p: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.length === 0) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}
