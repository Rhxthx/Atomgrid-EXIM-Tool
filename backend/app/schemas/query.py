"""Pydantic schemas for the advanced query builder.

The query is a recursive tree of Conditions and Groups, very similar in
shape to the JSON the popular react-querybuilder library emits — so a
future swap to a richer UI library is one prop change away.
"""

from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Annotated, Any, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Logic(str, Enum):
    AND = "AND"
    OR = "OR"


# Every operator we expose.  The actual SQL translation lives in
# services/query_builder.py; this enum is only for input validation.
class Operator(str, Enum):
    contains = "contains"
    not_contains = "not_contains"
    equals = "equals"
    not_equals = "not_equals"
    starts_with = "starts_with"
    ends_with = "ends_with"
    in_list = "in_list"
    not_in_list = "not_in_list"
    greater_than = "greater_than"
    less_than = "less_than"
    greater_or_equal = "greater_or_equal"
    less_or_equal = "less_or_equal"
    between = "between"
    is_empty = "is_empty"
    is_not_empty = "is_not_empty"


class Condition(BaseModel):
    """A single column-level predicate.

    ``value`` is used for the unary operators (contains / equals / etc.);
    ``values`` carries the array for ``in_list`` / ``not_in_list`` /
    ``between``.  Empty-check operators use neither.  ``negate`` wraps the
    final expression with NOT — handy for "NOT (HSN starts with 3808)".
    """

    model_config = ConfigDict(extra="forbid")

    type: Literal["condition"] = "condition"
    field: str = Field(min_length=1)
    operator: Operator
    value: Optional[Union[str, float, int, bool, date]] = None
    values: Optional[list[Union[str, float, int, bool, date]]] = None
    negate: bool = False


# Forward reference — Group can contain Groups.
class Group(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["group"] = "group"
    logic: Logic = Logic.AND
    negate: bool = False
    conditions: list[Annotated[Union["Group", Condition], Field(discriminator="type")]] = Field(
        default_factory=list
    )

    @model_validator(mode="after")
    def _at_least_one(self) -> "Group":
        # Empty groups would emit empty SQL fragments and either match
        # everything or nothing depending on parent logic — reject early.
        # An empty *root* group is fine (means "no filter") and handled at
        # the endpoint layer.
        return self


Group.model_rebuild()


class QueryRequest(BaseModel):
    """Top-level request — root group plus pagination + sort + format."""

    model_config = ConfigDict(extra="forbid")

    where: Optional[Group] = None
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=1000)
    sort_by: Optional[str] = None
    sort_order: Literal["asc", "desc"] = "desc"


class FieldType(str, Enum):
    text = "text"
    number = "number"
    date = "date"
    enum = "enum"


class FieldInfo(BaseModel):
    """Metadata for one queryable column — fed to the frontend so the UI
    can build correct operator dropdowns and value inputs.
    """
    name: str               # API-facing identifier (snake_case)
    label: str              # Human-readable label
    type: FieldType
    operators: list[Operator]
    enum_values: Optional[list[str]] = None    # for FieldType.enum


class FieldsResponse(BaseModel):
    fields: list[FieldInfo]


class QueryExplainResponse(BaseModel):
    sql: str
    params: list[Any]
