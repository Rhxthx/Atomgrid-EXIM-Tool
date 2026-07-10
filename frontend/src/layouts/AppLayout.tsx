import { Outlet } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";

import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";

/**
 * Top-level shell: sidebar + (top bar + scrollable content).  The router
 * renders pages into the <Outlet/>.
 */
export function AppLayout() {
  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="flex-1 overflow-y-auto p-4 md:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
