import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/utils/cn";

interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  trend?: number | null;     // signed number for the delta indicator
  trendLabel?: string;
  icon?: LucideIcon;
  loading?: boolean;
  className?: string;
}

/**
 * Compact metric tile used across the dashboard.  Optional trend indicator
 * (positive → green up arrow, negative → red down arrow).
 */
export function KpiCard({
  label,
  value,
  hint,
  trend,
  trendLabel,
  icon: Icon,
  loading,
  className,
}: KpiCardProps) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
        </div>
        {loading ? (
          <Skeleton className="mt-2 h-8 w-32" />
        ) : (
          <div className="mt-1.5 text-2xl font-semibold tracking-tight">{value}</div>
        )}
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          {trend !== null && trend !== undefined && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5",
                trend >= 0
                  ? "bg-emerald-500/10 text-emerald-500"
                  : "bg-rose-500/10 text-rose-500"
              )}
            >
              {trend >= 0 ? (
                <ArrowUpRight className="h-3 w-3" />
              ) : (
                <ArrowDownRight className="h-3 w-3" />
              )}
              {Math.abs(trend).toFixed(1)}%
            </span>
          )}
          {trendLabel && <span>{trendLabel}</span>}
          {hint && <span>{hint}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
