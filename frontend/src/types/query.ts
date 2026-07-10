/**
 * Query-builder types — mirror backend/app/schemas/query.py exactly.
 *
 * Tree shape is the same one Power-BI / Tableau / react-querybuilder emit,
 * so swapping in a richer library later is one prop change away.
 */

export type Logic = "AND" | "OR";

export type Operator =
  | "contains"
  | "not_contains"
  | "equals"
  | "not_equals"
  | "starts_with"
  | "ends_with"
  | "in_list"
  | "not_in_list"
  | "greater_than"
  | "less_than"
  | "greater_or_equal"
  | "less_or_equal"
  | "between"
  | "is_empty"
  | "is_not_empty";

export type FieldType = "text" | "number" | "date" | "enum";

export interface FieldInfo {
  name: string;
  label: string;
  type: FieldType;
  operators: Operator[];
  enum_values?: string[] | null;
}

export interface FieldsResponse {
  fields: FieldInfo[];
}

export interface ConditionNode {
  type: "condition";
  field: string;
  operator: Operator;
  value?: string | number | boolean | null;
  values?: Array<string | number | boolean>;
  negate?: boolean;
}

export interface GroupNode {
  type: "group";
  logic: Logic;
  negate?: boolean;
  conditions: Array<GroupNode | ConditionNode>;
}

export type QueryNode = GroupNode | ConditionNode;

export interface QueryRequest {
  where?: GroupNode | null;
  page?: number;
  page_size?: number;
  sort_by?: string;
  sort_order?: "asc" | "desc";
}

export interface QueryExplainResponse {
  sql: string;
  params: Array<string | number | boolean | null>;
}

/** Human-readable label per operator — used in the dropdown + chips. */
export const OPERATOR_LABELS: Record<Operator, string> = {
  contains: "contains",
  not_contains: "does not contain",
  equals: "equals",
  not_equals: "not equals",
  starts_with: "starts with",
  ends_with: "ends with",
  in_list: "in list",
  not_in_list: "not in list",
  greater_than: ">",
  less_than: "<",
  greater_or_equal: "≥",
  less_or_equal: "≤",
  between: "between",
  is_empty: "is empty",
  is_not_empty: "is not empty",
};

/** Operators that take no value at all. */
export const NULLARY_OPERATORS: Operator[] = ["is_empty", "is_not_empty"];

/** Operators that take an array (in/not-in/between). */
export const ARRAY_OPERATORS: Operator[] = ["in_list", "not_in_list", "between"];
