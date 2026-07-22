import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { login } from "@/services/endpoints";
import { ApiError } from "@/services/api";

export function LoginPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => login(email.trim(), password),
    onSuccess: async (user) => {
      qc.setQueryData(["me"], user);
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate("/", { replace: true });
    },
    onError: (e) =>
      setErr(e instanceof ApiError ? e.detail || e.message : "Login failed"),
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <BarChart3 className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Atomgrid Data Tool</h1>
          <p className="text-sm text-muted-foreground">Sign in to continue</p>
        </div>
        <Card>
          <CardContent className="p-6">
            <form
              onSubmit={(e) => { e.preventDefault(); setErr(null); mut.mutate(); }}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  autoFocus
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@atomgrid.in"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Password</Label>
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {err && <p className="text-sm text-rose-500">{err}</p>}
              <Button type="submit" className="w-full" disabled={mut.isPending}>
                {mut.isPending ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Access is managed by your administrator.
        </p>
      </div>
    </div>
  );
}
