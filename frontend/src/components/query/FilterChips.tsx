import { X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type {
  ConditionNode,
  FieldInfo,
  GroupNode,
  Operator,
} from "@/types/query";
import { OPERATOR_LABELS } from "@/types/query";

interface Props {
  root: GroupNode;
  fields: FieldInfo[];
  /** Called when the user clicks the chip's × — supplies the path so the
   * parent can remove the condition at that location. */
  onRemove?: (path: number[]) => void;
}

/**
 * Flatten the query tree into a horizontal row of chips.  Read-only-ish:
 * each chip just shows "Field op value" and (optionally) an × button.
 */
export function FilterChips({ root, fields, onRemove }: Props) {
  const chips: Array<{ path: number[]; label: string; logic?: string }> = [];

  const walk = (node: GroupNode | ConditionNode, path: number[]) => {
    if (node.type === "condition") {
      chips.push({ path, label: describe(node, fields) });
      return;
    }
    if (node.conditions.length === 0) return;
    if (path.length > 0) {
      // Open a "(" marker chip
      chips.push({ path, label: "(", logic: node.logic });
    }
    node.conditions.forEach((c, i) => {
      if (i > 0) chips.push({ path: [], label: node.logic, logic: node.logic });
      walk(c, [...path, i]);
    });
    if (path.length > 0) chips.push({ path: [], label: ")" });
  };

  walk(root, []);

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c, i) =>
        c.label === "AND" || c.label === "OR" ? (
          <span
            key={i}
            className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            {c.label}
          </span>
        ) : c.label === "(" || c.label === ")" ? (
          <span key={i} className="font-mono text-muted-foreground">
            {c.label}
          </span>
        ) : (
          <Badge key={i} variant="secondary" className="gap-1">
            <span className="truncate max-w-[280px]">{c.label}</span>
            {onRemove && c.path.length > 0 && (
              <button
                onClick={() => onRemove(c.path)}
                className="ml-1 rounded-sm opacity-70 hover:opacity-100"
                aria-label="Remove condition"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </Badge>
        )
      )}
    </div>
  );
}

function describe(c: ConditionNode, fields: FieldInfo[]): string {
  const label = fields.find((f) => f.name === c.field)?.label ?? c.field;
  const op = OPERATOR_LABELS[c.operator as Operator] ?? c.operator;
  const not = c.negate ? "NOT " : "";

  if (c.operator === "is_empty" || c.operator === "is_not_empty") {
    return `${not}${label} ${op}`;
  }
  if (c.operator === "between") {
    const [a, b] = c.values ?? [];
    return `${not}${label} between ${a} and ${b}`;
  }
  if (c.operator === "in_list" || c.operator === "not_in_list") {
    return `${not}${label} ${op} [${(c.values ?? []).join(", ")}]`;
  }
  return `${not}${label} ${op} ${formatValue(c.value)}`;
}

function formatValue(v: unknown): string {
  if (v === undefined || v === null || v === "") return "?";
  if (typeof v === "string") return `"${v}"`;
  return String(v);
}
