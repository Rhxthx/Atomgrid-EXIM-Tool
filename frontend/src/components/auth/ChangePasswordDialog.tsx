import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePassword } from "@/services/endpoints";
import { ApiError } from "@/services/api";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** When true the dialog can't be dismissed (first-login forced change). */
  forced?: boolean;
}

export function ChangePasswordDialog({ open, onOpenChange, forced }: Props) {
  const qc = useQueryClient();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => changePassword(current, next),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      setCurrent(""); setNext(""); setConfirm(""); setErr(null);
      onOpenChange(false);
    },
    onError: (e) => setErr(e instanceof ApiError ? e.detail || e.message : "Failed"),
  });

  const submit = () => {
    setErr(null);
    if (next.length < 6) return setErr("New password must be at least 6 characters.");
    if (next !== confirm) return setErr("New passwords do not match.");
    mut.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!forced) onOpenChange(v); }}>
      <DialogContent
        onEscapeKeyDown={(e) => forced && e.preventDefault()}
        onInteractOutside={(e) => forced && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            {forced
              ? "For security, please set a new password before continuing."
              : "Update the password for your account."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Current password</Label>
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>New password</Label>
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Confirm new password</Label>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()} />
          </div>
          {err && <p className="text-sm text-rose-500">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            {!forced && (
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            )}
            <Button onClick={submit} disabled={mut.isPending}>
              {mut.isPending ? "Saving…" : "Update password"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
