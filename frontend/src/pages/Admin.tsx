import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus, KeyRound, Trash2, ShieldCheck, User as UserIcon } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import { useMe, useUsers } from "@/hooks/queries";
import { createUser, updateUser, deleteUser } from "@/services/endpoints";
import { ApiError } from "@/services/api";
import { formatDate } from "@/utils/format";
import type { AuthUser, Role } from "@/types/auth";

export function AdminPage() {
  const { data: me } = useMe();
  const { data: users, isLoading } = useUsers(me?.role === "admin");
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-users"] });

  // Admins only.
  if (me && me.role !== "admin") return <Navigate to="/" replace />;

  const toggleActive = useMutation({
    mutationFn: (u: AuthUser) => updateUser(u.id, { is_active: !u.is_active }),
    onSuccess: refresh,
  });
  const changeRole = useMutation({
    mutationFn: ({ u, role }: { u: AuthUser; role: Role }) => updateUser(u.id, { role }),
    onSuccess: refresh,
  });
  const resetPw = useMutation({
    mutationFn: ({ id, pw }: { id: number; pw: string }) =>
      updateUser(id, { new_password: pw }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: number) => deleteUser(id),
    onSuccess: refresh,
  });

  const onReset = (u: AuthUser) => {
    const pw = window.prompt(`Set a new temporary password for ${u.email}:`);
    if (pw && pw.length >= 6) resetPw.mutate({ id: u.id, pw });
    else if (pw) window.alert("Password must be at least 6 characters.");
  };
  const onDelete = (u: AuthUser) => {
    if (window.confirm(`Delete ${u.email}? This cannot be undone.`)) remove.mutate(u.id);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="User Management"
        description="Add teammates and manage their access. New users get a temporary password they change on first login."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <UserPlus className="mr-1.5 h-4 w-4" /> Add user
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Email</th>
                  <th className="px-4 py-2.5">Role</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Last login</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
                )}
                {(users ?? []).map((u) => (
                  <tr key={u.id} className="border-b border-border/60">
                    <td className="px-4 py-2.5">
                      {u.name}
                      {u.id === me?.id && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}
                    </td>
                    <td className="px-4 py-2.5">{u.email}</td>
                    <td className="px-4 py-2.5">
                      <Select
                        value={u.role}
                        onValueChange={(v) => changeRole.mutate({ u, role: v as Role })}
                        disabled={u.id === me?.id}
                      >
                        <SelectTrigger className="h-8 w-[110px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">
                            <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> Admin</span>
                          </SelectItem>
                          <SelectItem value="user">
                            <span className="inline-flex items-center gap-1"><UserIcon className="h-3 w-3" /> User</span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-4 py-2.5">
                      {u.is_active
                        ? <Badge variant="secondary">Active</Badge>
                        : <Badge variant="outline">Disabled</Badge>}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {u.last_login ? formatDate(u.last_login) : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => onReset(u)} title="Reset password">
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => toggleActive.mutate(u)}
                          disabled={u.id === me?.id} title={u.is_active ? "Deactivate" : "Activate"}>
                          {u.is_active ? "Disable" : "Enable"}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => onDelete(u)}
                          disabled={u.id === me?.id} title="Delete user">
                          <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <AddUserDialog open={addOpen} onOpenChange={setAddOpen} onDone={refresh} />
    </div>
  );
}

function AddUserDialog({
  open, onOpenChange, onDone,
}: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [err, setErr] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => createUser({ name, email: email.trim(), password, role }),
    onSuccess: () => {
      onDone();
      setName(""); setEmail(""); setPassword(""); setRole("user"); setErr(null);
      onOpenChange(false);
    },
    onError: (e) => setErr(e instanceof ApiError ? e.detail || e.message : "Failed to create user"),
  });

  const submit = () => {
    setErr(null);
    if (!name.trim() || !email.trim()) return setErr("Name and email are required.");
    if (password.length < 6) return setErr("Temporary password must be at least 6 characters.");
    mut.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>
            They'll sign in with this email and temporary password, then set their own password.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Full name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya Sharma" />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="priya@atomgrid.in" />
          </div>
          <div className="space-y-1.5">
            <Label>Temporary password</Label>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min 6 characters" />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {err && <p className="text-sm text-rose-500">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={mut.isPending}>
              {mut.isPending ? "Creating…" : "Create user"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
