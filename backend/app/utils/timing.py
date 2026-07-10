"""Tiny timing helpers."""

from __future__ import annotations

import time
from contextlib import contextmanager
from typing import Iterator


@contextmanager
def timer() -> Iterator[dict]:
    """Context manager that exposes ``ms`` after the block exits.

    Usage:
        with timer() as t:
            ...
        elapsed_ms = t["ms"]
    """
    state = {"ms": 0.0}
    t0 = time.perf_counter()
    try:
        yield state
    finally:
        state["ms"] = round((time.perf_counter() - t0) * 1000, 2)


def perf_ms(start: float) -> float:
    return round((time.perf_counter() - start) * 1000, 2)
