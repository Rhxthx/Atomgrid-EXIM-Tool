import { Navigate, Outlet } from "react-router-dom";
import { BarChart3 } from "lucide-react";

import { useMe } from "@/hooks/queries";

/**
 * Route guard: resolves the current session via /auth/me. While loading it
 * shows a splash; on failure (401 / not logged in) it redirects to /login;
 * otherwise it renders the protected routes.
 */
export function RequireAuth() {
  const { data: user, isLoading, isError } = useMe();

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-muted-foreground">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 animate-pulse text-primary" />
          <span className="text-sm">Loading…</span>
        </div>
      </div>
    );
  }

  if (isError || !user) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
