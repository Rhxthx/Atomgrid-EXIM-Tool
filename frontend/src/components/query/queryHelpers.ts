/**
 * Immutable helpers for navigating + editing the query tree.
 *
 * The tree state is held in a single React useState in QueryBuilder; these
 * helpers do localised path-based updates so React Query's cache key (the
 * whole tree) only changes when the shape actually changes.
 */

import type {
  ConditionNode,
  FieldInfo,
  GroupNode,
  Operator,
  QueryNode,
} from "@/types/query";
import { NULLARY_OPERATORS, ARRAY_OPERATORS } from "@/types/query";

// A path is a list of child indices from the root.
export type Path = number[];

export function newCondition(field: FieldInfo): ConditionNode {
  // Pick the first operator the field supports as the default.
  const op: Operator = field.operators[0] ?? "contains";
  return { type: "condition", field: field.name, operator: op };
}

export function newGroup(children: QueryNode[] = []): GroupNode {
  return { type: "group", logic: "AND", conditions: children };
}

export function getAt(root: GroupNode, path: Path): QueryNode {
  let node: QueryNode = root;
  for (const idx of path) {
    if (node.type !== "group") {
      throw new Error("path crosses a non-group");
    }
    node = node.conditions[idx];
  }
  return node;
}

/** Replace the node at ``path`` with the result of ``fn(node)``.  Returns
 * a fresh root reference so React state updates trigger a render. */
export function updateAt(
  root: GroupNode,
  path: Path,
  fn: (node: QueryNode) => QueryNode,
): GroupNode {
  if (path.length === 0) {
    const replaced = fn(root);
    if (replaced.type !== "group") {
      throw new Error("root must remain a group");
    }
    return replaced;
  }
  const [head, ...rest] = path;
  const newConditions = root.conditions.slice();
  const child = newConditions[head];
  if (rest.length === 0) {
    newConditions[head] = fn(child);
  } else {
    if (child.type !== "group") {
      throw new Error("path crosses a non-group");
    }
    newConditions[head] = updateAt(child, rest, fn);
  }
  return { ...root, conditions: newConditions };
}

export function removeAt(root: GroupNode, path: Path): GroupNode {
  if (path.length === 0) return root;
  const [head, ...rest] = path;
  if (rest.length === 0) {
    const conds = root.conditions.slice();
    conds.splice(head, 1);
    return { ...root, conditions: conds };
  }
  const child = root.conditions[head];
  if (child.type !== "group") return root;
  return {
    ...root,
    conditions: root.conditions.map((c, i) =>
      i === head ? removeAt(child, rest) : c
    ),
  };
}

export function pushChild(
  root: GroupNode,
  path: Path,
  child: QueryNode,
): GroupNode {
  return updateAt(root, path, (node) => {
    if (node.type !== "group") throw new Error("cannot push into a condition");
    return { ...node, conditions: [...node.conditions, child] };
  });
}

/** True if an operator requires no value (is_empty / is_not_empty). */
export function isNullaryOperator(op: Operator): boolean {
  return NULLARY_OPERATORS.includes(op);
}

/** True if an operator takes an array of values. */
export function isArrayOperator(op: Operator): boolean {
  return ARRAY_OPERATORS.includes(op);
}

/** Strip empty-value conditions before sending — they confuse the backend. */
export function sanitize(root: GroupNode): GroupNode | null {
  const out = sanitizeGroup(root);
  if (!out || out.conditions.length === 0) return null;
  return out;
}

function sanitizeGroup(group: GroupNode): GroupNode | null {
  const cleaned: QueryNode[] = [];
  for (const c of group.conditions) {
    if (c.type === "group") {
      const sg = sanitizeGroup(c);
      if (sg && sg.conditions.length > 0) cleaned.push(sg);
    } else {
      if (isConditionValid(c)) cleaned.push(c);
    }
  }
  if (cleaned.length === 0) return null;
  return { ...group, conditions: cleaned };
}

function isConditionValid(c: ConditionNode): boolean {
  if (!c.field) return false;
  if (isNullaryOperator(c.operator)) return true;
  if (isArrayOperator(c.operator)) {
    if (c.operator === "between") {
      return Array.isArray(c.values) && c.values.length === 2 && c.values.every((v) => v !== "" && v !== undefined);
    }
    return Array.isArray(c.values) && c.values.length > 0;
  }
  return c.value !== undefined && c.value !== null && c.value !== "";
}
