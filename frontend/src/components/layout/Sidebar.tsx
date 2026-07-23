import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Search,
  BarChart3,
  Globe,
  Package,
  LineChart,
  Bookmark,
  Boxes,
  Sprout,
  FlaskConical,
  ClipboardCheck,
  Users,
} from "lucide-react";

import { cn } from "@/utils/cn";
import { useMe } from "@/hooks/queries";

const NAV = [
  { to: "/",                 label: "Dashboard",            icon: LayoutDashboard },
  { to: "/search",           label: "Global Search",        icon: Search },
  { to: "/argentina",        label: "Argentina Imports",    icon: Sprout },
  { to: "/agbio",            label: "AG-Bio Market",        icon: FlaskConical },
  { to: "/registration",     label: "Global Registration",  icon: ClipboardCheck },
  { to: "/shipments",        label: "Shipment Explorer",    icon: Package },
  { to: "/hsn",              label: "HSN Analysis",         icon: Boxes },
  { to: "/countries",        label: "Country Analysis",     icon: Globe },
  { to: "/trends",           label: "Trends & Analytics",   icon: LineChart },
  { to: "/saved",            label: "Saved & Bookmarks",    icon: Bookmark },
];

export function Sidebar() {
  const { data: me } = useMe();
  const nav = me?.role === "admin"
    ? [...NAV, { to: "/admin", label: "User Management", icon: Users }]
    : NAV;
  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-border bg-card/40 backdrop-blur-sm">
      {/* Brand */}
      <div className="flex h-16 items-center gap-2 border-b border-border px-5">
        <BarChart3 className="h-6 w-6 text-primary" />
        <div>
          <div className="text-sm font-semibold leading-none">Atomgrid Data Tool</div>
          <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Global EXIM Insights
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {nav.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-border px-5 py-3 text-[10px] text-muted-foreground">
        Phase 3 · v0.3 · Atomgrid
      </div>
    </aside>
  );
}
