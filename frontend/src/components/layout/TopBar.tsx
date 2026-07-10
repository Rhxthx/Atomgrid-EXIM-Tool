import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Moon, Search, Sun, RefreshCw, LogOut, KeyRound, UserCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ChangePasswordDialog } from "@/components/auth/ChangePasswordDialog";
import { useDebounce } from "@/hooks/useDebounce";
import { useSuggest, useStats, useMe } from "@/hooks/queries";
import { logout as apiLogout } from "@/services/endpoints";
import { useThemeStore } from "@/store/theme";
import { cn } from "@/utils/cn";
import { formatInt } from "@/utils/format";

/**
 * Top bar — title + universal search + dark-mode toggle + dataset health
 * pill.  The search popover hits /suggest with debounced input and pushes
 * the user to /search?q=... on Enter or pick.
 */
export function TopBar() {
  const [q, setQ] = useState("");
  const debounced = useDebounce(q, 200);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);
  const { data: stats } = useStats();
  const { data: me } = useMe();
  const [pwOpen, setPwOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const forced = !!me?.must_change_password;

  const doLogout = async () => {
    try { await apiLogout(); } catch { /* ignore */ }
    qc.clear();
    window.location.assign("/login");
  };
  const { data: suggestData, isFetching } = useSuggest("Importer", debounced, {
    enabled: open && debounced.length >= 2,
  });

  const pick = (value?: string) => {
    const final = (value ?? q).trim();
    if (!final) return;
    setOpen(false);
    navigate(`/search?q=${encodeURIComponent(final)}`);
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md md:px-6">
      {/* Search */}
      <div className="relative flex-1 max-w-2xl">
        <Popover open={open && q.length >= 2} onOpenChange={setOpen}>
          <PopoverAnchor asChild>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setOpen(true);
                }}
                onFocus={() => q.length >= 2 && setOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") pick();
                  if (e.key === "Escape") setOpen(false);
                }}
                placeholder="Search importers, exporters, suppliers, HSN, products…"
                className="h-10 pl-9 pr-3 text-sm"
              />
            </div>
          </PopoverAnchor>
          <PopoverContent
            className="w-[min(560px,calc(100vw-2rem))] p-2"
            align="start"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="px-2 pb-1 pt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              {isFetching ? "Searching…" : "Importers matching"}
            </div>
            <ul className="max-h-72 overflow-y-auto">
              {(suggestData?.suggestions ?? []).map((s) => (
                <li key={s}>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(s)}
                    className="block w-full truncate rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    {s}
                  </button>
                </li>
              ))}
              {!isFetching && (suggestData?.suggestions ?? []).length === 0 && (
                <li className="px-2 py-1.5 text-sm text-muted-foreground">
                  No matches — press Enter to search anyway.
                </li>
              )}
            </ul>
          </PopoverContent>
        </Popover>
      </div>

      {/* Right side */}
      <div className="ml-auto flex items-center gap-2">
        {stats && (
          <div className="hidden items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-xs text-muted-foreground md:flex">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            <span>
              <span className="font-medium text-foreground">{formatInt(stats.total_rows)}</span> rows ·{" "}
              <span className="font-medium text-foreground">{formatInt(stats.distinct_importers)}</span> importers
            </span>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => window.location.reload()}
          title="Refresh"
        >
          <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
        </Button>
        <Button variant="ghost" size="icon" onClick={toggle} title="Toggle theme">
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        {/* User menu */}
        {me && (
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5" title={me.email}>
                <UserCircle className="h-4 w-4" />
                <span className="hidden max-w-[140px] truncate sm:inline">{me.name}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-1.5">
              <div className="border-b border-border px-2 pb-2 pt-1">
                <div className="truncate text-sm font-medium">{me.name}</div>
                <div className="truncate text-xs text-muted-foreground">{me.email}</div>
                <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {me.role === "admin" ? "Administrator" : "User"}
                </div>
              </div>
              <button
                onClick={() => { setMenuOpen(false); setPwOpen(true); }}
                className="mt-1 flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <KeyRound className="h-4 w-4" /> Change password
              </button>
              <button
                onClick={doLogout}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-rose-500 hover:bg-accent"
              >
                <LogOut className="h-4 w-4" /> Log out
              </button>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {/* Voluntary change; also forced on first login (can't dismiss). */}
      <ChangePasswordDialog
        open={pwOpen || forced}
        forced={forced}
        onOpenChange={setPwOpen}
      />
    </header>
  );
}
