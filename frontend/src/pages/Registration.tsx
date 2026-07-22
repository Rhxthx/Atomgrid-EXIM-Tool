import { useMemo, useState } from "react";
import { Globe2, FileCheck2, Plus, X } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { DataTable } from "@/components/table/DataTable";
import { registrationColumns, RegistrationDetails } from "@/components/table/registrationColumns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import {
  useRegistrationStats, useRegistrationSearch, useRegistrationBreakdown,
} from "@/hooks/queries";
import { useDebounce } from "@/hooks/useDebounce";
import { formatInt } from "@/utils/format";
import type { AiCondition, AiOp } from "@/types/registration";

const ALL = "__all";
const OP_LABELS: { value: AiOp; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "notcontains", label: "not contains" },
  { value: "equals", label: "equals" },
  { value: "notequals", label: "not equals" },
];
const CATEGORIES = ["Technical", "Formulation", "Unknown"];

export function RegistrationPage() {
  const { data: stats } = useRegistrationStats();

  const [aiConds, setAiConds] = useState<AiCondition[]>([{ op: "contains", value: "" }]);
  const [aiJoin, setAiJoin] = useState<"and" | "or">("and");
  const [product, setProduct] = useState("");
  const [company, setCompany] = useState("");
  const [country, setCountry] = useState<string>(ALL);
  const [category, setCategory] = useState<string>(ALL);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<{ by?: string; order?: "asc" | "desc" }>({
    by: "country", order: "asc",
  });

  const productD = useDebounce(product, 300);
  const companyD = useDebounce(company, 300);
  const aiD = useDebounce(aiConds, 350);

  const aiParams = useMemo(
    () => aiD.filter((c) => c.value.trim()).map((c) => `${c.op}|${c.value.trim()}`),
    [aiD]
  );

  // Content filters drive both the table and the dynamic KPIs (KPIs must not
  // refetch on pagination/sort, so those live only in `filters`).
  const contentFilters = useMemo(
    () => ({
      product: productD || undefined,
      company: companyD || undefined,
      country: country === ALL ? undefined : country,
      category: category === ALL ? undefined : category,
      ai: aiParams.length ? aiParams : undefined,
      ai_join: aiJoin,
    }),
    [productD, companyD, country, category, aiParams, aiJoin]
  );

  const filters = useMemo(
    () => ({ ...contentFilters, sort_by: sort.by, sort_order: sort.order, page, page_size: pageSize }),
    [contentFilters, sort, page, pageSize]
  );

  const { data, isLoading, isFetching } = useRegistrationSearch(filters);
  const bd = useRegistrationBreakdown(contentFilters);

  const setCond = (i: number, patch: Partial<AiCondition>) => {
    setAiConds((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
    setPage(1);
  };
  const addCond = () => setAiConds((prev) => [...prev, { op: "contains", value: "" }]);
  const removeCond = (i: number) => {
    setAiConds((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Global Registration" />

      {/* Dynamic KPIs — reflect the current search */}
      <div className="grid grid-cols-2 gap-4">
        <KpiCard label="Registrations" value={formatInt(bd.data?.total)} loading={bd.isLoading} icon={FileCheck2} />
        <KpiCard label="Countries" value={formatInt(bd.data?.distinct_countries)} loading={bd.isLoading} icon={Globe2} />
      </div>
      {(bd.data?.countries?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {bd.data!.countries.map((c) => (
            <Badge key={c.name} variant="secondary" className="font-normal">
              {c.name} <span className="ml-1 text-muted-foreground">{formatInt(c.count)}</span>
            </Badge>
          ))}
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="space-y-3 p-4">
          {/* Active-ingredient logical builder */}
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Label className="text-sm">Active ingredient</Label>
              {aiConds.length > 1 && (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">match</span>
                  <Button size="sm" variant={aiJoin === "and" ? "default" : "outline"}
                    className="h-6 px-2 text-xs" onClick={() => { setAiJoin("and"); setPage(1); }}>ALL (AND)</Button>
                  <Button size="sm" variant={aiJoin === "or" ? "default" : "outline"}
                    className="h-6 px-2 text-xs" onClick={() => { setAiJoin("or"); setPage(1); }}>ANY (OR)</Button>
                </div>
              )}
            </div>
            {aiConds.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select value={c.op} onValueChange={(v) => setCond(i, { op: v as AiOp })}>
                  <SelectTrigger className="h-9 w-[150px] shrink-0"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OP_LABELS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input className="flex-1" placeholder="e.g. abamectin"
                  value={c.value} onChange={(e) => setCond(i, { value: e.target.value })} />
                <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0"
                  onClick={() => removeCond(i)} disabled={aiConds.length === 1} title="Remove condition">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addCond}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add ingredient condition
            </Button>
          </div>

          {/* Other filters */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Product / trade name</Label>
              <Input placeholder="e.g. Pilarmec"
                value={product} onChange={(e) => { setProduct(e.target.value); setPage(1); }} />
            </div>
            <div className="space-y-1.5">
              <Label>Company / registrant</Label>
              <Input placeholder="e.g. Syngenta"
                value={company} onChange={(e) => { setCompany(e.target.value); setPage(1); }} />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={(v) => { setCategory(v); setPage(1); }}>
                <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All</SelectItem>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Country</Label>
              <Select value={country} onValueChange={(v) => { setCountry(v); setPage(1); }}>
                <SelectTrigger><SelectValue placeholder="All countries" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All countries</SelectItem>
                  {(stats?.countries ?? []).map((c) => (
                    <SelectItem key={c.name} value={c.name}>{c.name} ({formatInt(c.count)})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <DataTable
        columns={registrationColumns}
        data={data?.data ?? []}
        loading={isLoading || isFetching}
        emptyMessage="No matching registrations — try fewer filters or check spelling."
        hideExport
        renderExpanded={(row) => <RegistrationDetails row={row} />}
        selectionResetKey={filters}
        serverPagination={{
          page,
          pageSize,
          total: data?.meta.total ?? 0,
          onChange: ({ page: p, pageSize: ps }) => { setPage(p); setPageSize(ps); },
        }}
        serverSort={{
          sortBy: sort.by,
          sortOrder: sort.order,
          onChange: ({ sortBy, sortOrder }) => { setSort({ by: sortBy, order: sortOrder }); setPage(1); },
        }}
      />
    </div>
  );
}
