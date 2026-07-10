import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/utils/cn";

interface ChartCardProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  loading?: boolean;
  empty?: boolean;
  height?: number;
  children: ReactNode;
  className?: string;
}

export function ChartCard({
  title,
  description,
  actions,
  loading,
  empty,
  height = 300,
  children,
  className,
}: ChartCardProps) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          {description && (
            <CardDescription className="mt-1">{description}</CardDescription>
          )}
        </div>
        {actions}
      </CardHeader>
      <CardContent className="flex-1 pt-0" style={{ minHeight: height }}>
        {loading ? (
          <Skeleton className="h-full w-full" style={{ height }} />
        ) : empty ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground" style={{ height }}>
            No data for the current filters.
          </div>
        ) : (
          <div style={{ height }}>{children}</div>
        )}
      </CardContent>
    </Card>
  );
}
