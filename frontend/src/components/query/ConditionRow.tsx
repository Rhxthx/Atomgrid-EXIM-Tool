import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/utils/cn";

import type { ConditionNode, FieldInfo, Operator } from "@/types/query";
import { OPERATOR_LABELS } from "@/types/query";
import { isArrayOperator, isNullaryOperator } from "./queryHelpers";

interface Props {
  value: ConditionNode;
  fields: FieldInfo[];
  onChange: (next: ConditionNode) => void;
  onRemove: () => void;
}

/**
 * One filter row: field · operator · value · NOT · trash.
 *
 * The value input morphs based on the operator:
 *   - `is_empty` / `is_not_empty`  → no input
 *   - `between`                    → two inputs
 *   - `in_list` / `not_in_list`    → comma-separated string → split on input
 *   - everything else              → single input
 */
export function ConditionRow({ value, fields, onChange, onRemove }: Props) {
  const field = fields.find((f) => f.name === value.field) ?? fields[0];

  const update = (patch: Partial<ConditionNode>) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-background/40 px-2 py-2">
      {/* NOT toggle */}
      <button
        type="button"
        onClick={() => update({ negate: !value.negate })}
        className={cn(
          "rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors",
          value.negate
            ? "bg-destructive/15 text-destructive"
            : "border text-muted-foreground hover:text-foreground"
        )}
        title="Toggle NOT"
      >
        {value.negate ? "NOT" : "is"}
      </button>

      {/* Field */}
      <div className="w-48 shrink-0">
        <Select
          value={field?.name ?? ""}
          onValueChange={(name) => {
            const f = fields.find((x) => x.name === name);
            if (!f) return;
            // Reset operator + value when field type changes.
            const op = f.operators.includes(value.operator) ? value.operator : f.operators[0];
            update({
              field: name,
              operator: op,
              value: undefined,
              values: undefined,
            });
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {fields.map((f) => (
              <SelectItem key={f.name} value={f.name}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Operator */}
      <div className="w-40 shrink-0">
        <Select
          value={value.operator}
          onValueChange={(op) => {
            const next: Partial<ConditionNode> = { operator: op as Operator };
            // Switching to nullary clears the value.
            if (isNullaryOperator(op as Operator)) {
              next.value = undefined;
              next.values = undefined;
            }
            update(next);
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(field?.operators ?? []).map((op) => (
              <SelectItem key={op} value={op}>
                {OPERATOR_LABELS[op]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Value */}
      <ValueInput
        operator={value.operator}
        fieldType={field?.type ?? "text"}
        enumValues={field?.enum_values ?? undefined}
        value={value.value as string | undefined}
        values={value.values as (string | number)[] | undefined}
        onChange={(patch) => update(patch)}
      />

      <div className="ml-auto flex items-center gap-1">
        {field && <Badge variant="outline" className="text-[10px]">{field.type}</Badge>}
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemove}
          title="Remove condition"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

interface ValueInputProps {
  operator: Operator;
  fieldType: "text" | "number" | "date" | "enum";
  enumValues?: string[];
  value?: string;
  values?: (string | number)[];
  onChange: (patch: Partial<ConditionNode>) => void;
}

function ValueInput({
  operator,
  fieldType,
  enumValues,
  value,
  values,
  onChange,
}: ValueInputProps) {
  if (isNullaryOperator(operator)) {
    return (
      <span className="px-2 text-xs italic text-muted-foreground">
        (no value)
      </span>
    );
  }

  // BETWEEN — two value inputs
  if (operator === "between") {
    const [a, b] = values ?? [];
    const input = (which: 0 | 1, label: string) => (
      <Input
        type={fieldType === "number" ? "number" : fieldType === "date" ? "date" : "text"}
        placeholder={label}
        className="w-32"
        value={(which === 0 ? a : b) ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          const next: (string | number)[] = values ? [...values] : [];
          next[which] = fieldType === "number" ? Number(v) : v;
          onChange({ values: next });
        }}
      />
    );
    return (
      <div className="flex items-center gap-1">
        {input(0, "from")}
        <span className="text-xs text-muted-foreground">and</span>
        {input(1, "to")}
      </div>
    );
  }

  // IN_LIST / NOT_IN_LIST — comma-separated text → array
  if (isArrayOperator(operator)) {
    const text = (values ?? []).join(", ");
    return (
      <Input
        className="min-w-[16rem] flex-1"
        placeholder="Comma-separated values (e.g. China, India, Vietnam)"
        value={text}
        onChange={(e) => {
          const parts = e.target.value
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          const coerced =
            fieldType === "number" ? parts.map((p) => Number(p)) : parts;
          onChange({ values: coerced });
        }}
      />
    );
  }

  // Single value (with optional enum → dropdown)
  if (fieldType === "enum" && enumValues && enumValues.length > 0) {
    return (
      <div className="w-48">
        <Select
          value={(value as string) ?? ""}
          onValueChange={(v) => onChange({ value: v })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Pick…" />
          </SelectTrigger>
          <SelectContent>
            {enumValues.map((v) => (
              <SelectItem key={v} value={v}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <Input
      type={fieldType === "number" ? "number" : fieldType === "date" ? "date" : "text"}
      placeholder={operator === "contains" ? "substring…" : "value…"}
      className="min-w-[12rem] flex-1"
      value={(value as string | number | undefined) ?? ""}
      onChange={(e) =>
        onChange({
          value: fieldType === "number" ? Number(e.target.value) : e.target.value,
        })
      }
    />
  );
}
