import { useMemo } from "react";

import { GroupCondition } from "./GroupCondition";
import { newGroup } from "./queryHelpers";

import type { FieldInfo, GroupNode } from "@/types/query";

interface Props {
  value: GroupNode;
  fields: FieldInfo[];
  onChange: (next: GroupNode) => void;
}

/**
 * Top-level wrapper around the recursive GroupCondition tree.
 *
 * Pulled out as a separate component because:
 *   1. It guarantees the root is always a group (never bare condition)
 *   2. It hands `fields` down once; children just consume the array
 *   3. The page that owns the state stays small + readable
 */
export function QueryBuilder({ value, fields, onChange }: Props) {
  // Ensure we never render an undefined root — show an empty group instead.
  const root = useMemo(() => value ?? newGroup(), [value]);

  return (
    <GroupCondition
      value={root}
      fields={fields}
      onChange={onChange}
    />
  );
}
