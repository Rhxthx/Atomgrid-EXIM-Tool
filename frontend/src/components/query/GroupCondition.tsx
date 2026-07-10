import { Plus, FolderPlus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";

import type { FieldInfo, GroupNode, Logic, QueryNode } from "@/types/query";
import { ConditionRow } from "./ConditionRow";
import { newCondition, newGroup } from "./queryHelpers";

interface Props {
  value: GroupNode;
  fields: FieldInfo[];
  onChange: (next: GroupNode) => void;
  onRemove?: () => void;       // root has no remove
  depth?: number;
}

/**
 * Recursive group renderer.  Children are either ConditionRows or nested
 * GroupConditions.  Each group has its own AND/OR + NOT toggle.
 */
export function GroupCondition({
  value,
  fields,
  onChange,
  onRemove,
  depth = 0,
}: Props) {
  const update = (patch: Partial<GroupNode>) => onChange({ ...value, ...patch });

  const replaceChild = (i: number, next: QueryNode) => {
    const conds = value.conditions.slice();
    conds[i] = next;
    onChange({ ...value, conditions: conds });
  };

  const removeChild = (i: number) => {
    const conds = value.conditions.slice();
    conds.splice(i, 1);
    onChange({ ...value, conditions: conds });
  };

  const addCondition = () => {
    if (fields.length === 0) return;
    onChange({
      ...value,
      conditions: [...value.conditions, newCondition(fields[0])],
    });
  };

  const addGroup = () => {
    onChange({
      ...value,
      conditions: [
        ...value.conditions,
        newGroup(fields.length > 0 ? [newCondition(fields[0])] : []),
      ],
    });
  };

  // Tint nested groups slightly so the tree is readable.
  const tint = depth > 0 ? "bg-muted/30" : "bg-card";

  return (
    <div
      className={cn(
        "rounded-lg border p-3 space-y-2",
        tint,
        depth > 0 && "border-dashed"
      )}
    >
      {/* Group header */}
      <div className="flex items-center gap-2">
        <LogicToggle
          logic={value.logic}
          onChange={(logic) => update({ logic })}
        />

        <button
          type="button"
          onClick={() => update({ negate: !value.negate })}
          className={cn(
            "rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors",
            value.negate
              ? "bg-destructive/15 text-destructive"
              : "border text-muted-foreground hover:text-foreground"
          )}
          title="NOT the entire group"
        >
          {value.negate ? "NOT group" : "group"}
        </button>

        <span className="text-xs text-muted-foreground">
          {value.conditions.length} condition{value.conditions.length === 1 ? "" : "s"}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={addCondition}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Condition
          </Button>
          <Button variant="outline" size="sm" onClick={addGroup}>
            <FolderPlus className="mr-1.5 h-3.5 w-3.5" />
            Group
          </Button>
          {onRemove && (
            <Button variant="ghost" size="icon" onClick={onRemove} title="Remove group">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Children */}
      {value.conditions.length === 0 ? (
        <div className="rounded-md border border-dashed py-4 text-center text-xs text-muted-foreground">
          Empty — click <strong>Condition</strong> to add a filter.
        </div>
      ) : (
        <div className="space-y-2">
          {value.conditions.map((child, i) =>
            child.type === "condition" ? (
              <ConditionRow
                key={i}
                value={child}
                fields={fields}
                onChange={(next) => replaceChild(i, next)}
                onRemove={() => removeChild(i)}
              />
            ) : (
              <GroupCondition
                key={i}
                value={child}
                fields={fields}
                onChange={(next) => replaceChild(i, next)}
                onRemove={() => removeChild(i)}
                depth={depth + 1}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

function LogicToggle({
  logic,
  onChange,
}: {
  logic: Logic;
  onChange: (l: Logic) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border">
      {(["AND", "OR"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onChange(l)}
          className={cn(
            "px-2.5 py-1 text-xs font-medium transition-colors",
            logic === l
              ? "bg-primary text-primary-foreground"
              : "bg-background text-muted-foreground hover:text-foreground"
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
