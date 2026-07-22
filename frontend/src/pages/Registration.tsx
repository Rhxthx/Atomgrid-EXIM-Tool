import { useMemo, useState } from "react";
import { FlaskConical, Globe2, FileCheck2 } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { DataTable } from "@/components/table/DataTable";
import { registrationColumns, RegistrationDetails } from "@/components/table/registrationColumns";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import { useRegistrationStats, useRegistrationSearch } from "@/hooks/queries";
import { useDebounce } from "@/hooks/useDebounce";
import { formatInt } from "@/utils/format";

const ALL = "__all";

export function RegistrationPage() {
  const { data: stats, isLoading: statsLoading } = useRegistrationStats();

  const [activeIngredient, setActiveIngredient] = useState("");
  const [product, setProduct] = useState("");
  const [company, setCompany] = useState("");
  const [country, setCountry] = useState<string>(ALL);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<{ by?: string; order?: "asc" | "desc" }>({
    by: "country", order: "asc",
  });

  const aiD = useDebounce(activeIngredient, 300);
  const productD = useDebounce(product, 300);
  const companyD = useDebounce(company, 300);

  const filters = useMemo(
    () => ({
      active_ingredient: aiD || undefined,
      product: productD || undefined,
      company: companyD || undefined,
      country: country === ALL ? undefined : country,
      sort_by: sort.by,
      sort_order: sort.order,
      page,
      page_size: pageSize,
    }),
    [aiD, productD, companyD, country, sort, page, pageSize]
  );

  const { data, isLoading, isFetching } = useRegistrationSearch(filters);

  return (
    <div className="space-y-4">
      <PageHeader title="Global Registration" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KpiCard label="Registrations" value={formatInt(stats?.total_rows)} loading={statsLoading}
          icon={FileCheck2} />
        <KpiCard label="Countries" value={formatInt(stats?.distinct_countries)} loading={statsLoading}
          icon={Globe2} />
        <KpiCard label="Active Ingredients" value={formatInt(stats?.distinct_active_ingredients)} loading={statsLoading}
          icon={FlaskConical} />
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label>Active ingredient</Label>
          <Input placeholder="e.g. abamectin"
            value={activeIngredient} onChange={(e) => { setActiveIngredient(e.target.value); setPage(1); }} />
        </div>
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
          <Label>Country</Label>
          <Select value={country} onValueChange={(v) => { setCountry(v); setPage(1); }}>
            <SelectTrigger><SelectValue placeholder="All countries" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All countries</SelectItem>
              {(stats?.countries ?? []).map((c) => (
                <SelectItem key={c.name} value={c.name}>
                  {c.name} ({formatInt(c.count)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

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
