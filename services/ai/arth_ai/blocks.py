from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, TypeAdapter


class LineSeries(BaseModel):
    label: str
    points: list[tuple[str, float]]


class LineChart(BaseModel):
    kind: Literal["line_chart"]
    title: str
    series: list[LineSeries] = Field(min_length=1, max_length=3)


class Slice(BaseModel):
    key: str
    weight: float


class AllocationDonut(BaseModel):
    kind: Literal["allocation_donut"]
    title: str
    slices: list[Slice] = Field(min_length=1, max_length=12)


class HoldingRow(BaseModel):
    symbol: str
    qty: float
    value: float
    pnlPct: float
    weight: float


class HoldingsTable(BaseModel):
    kind: Literal["holdings_table"]
    title: str
    rows: list[HoldingRow] = Field(min_length=1, max_length=20)


class Chip(BaseModel):
    symbol: str
    ltp: float | None = None
    changePct: float | None = None


class StockChips(BaseModel):
    kind: Literal["stock_chips"]
    title: str
    chips: list[Chip] = Field(min_length=1, max_length=8)


RenderBlock = Annotated[LineChart | AllocationDonut | HoldingsTable | StockChips, Field(discriminator="kind")]
_adapter: TypeAdapter[RenderBlock] = TypeAdapter(RenderBlock)


def validate(block: dict[str, Any]) -> dict[str, Any]:
    return _adapter.validate_python(block).model_dump()


RENDER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["line_chart", "allocation_donut", "holdings_table", "stock_chips"]},
        "title": {"type": "string", "description": "Short caption shown above the block."},
        "range": {"type": "string", "enum": ["1w", "1m", "3m", "6m", "1y"], "description": "line_chart: time range."},
        "symbols": {
            "type": "array",
            "items": {"type": "string"},
            "description": "line_chart: one symbol to chart its price, or empty to chart portfolio vs NIFTY 50. stock_chips: symbols to show.",
        },
        "dimension": {"type": "string", "enum": ["sector", "mcap", "asset"], "description": "allocation_donut: grouping."},
        "sort_by": {"type": "string", "enum": ["weight", "pnl", "day_change"], "description": "holdings_table: ordering."},
        "limit": {"type": "integer", "minimum": 1, "maximum": 20},
    },
    "required": ["kind", "title"],
    "additionalProperties": False,
}
