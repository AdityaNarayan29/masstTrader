"""Regression tests for the volume-profile value-area expansion.

The original loop set `expand_up = 0` when hi_idx was already at the top level,
then compared `expand_up >= expand_down`. When the level below was ALSO empty,
`0 >= 0` was True, so it took the "expand up" branch anyway and indexed one past
the end of the array -> IndexError. Guarding the *value* was not the same as
guarding the *move*.

Triggering it requires all three of:
  1. POC lands on the highest price level (hi_idx == num_levels - 1)
  2. the level directly below POC has zero volume
  3. POC volume < value_area_pct of window volume, so the loop actually runs
"""
import numpy as np
import pandas as pd
import pytest

from backend.core.indicators import add_volume_profile

LOOKBACK = 100
NUM_LEVELS = 50


def _bug_trigger_frame():
    """100 low bars carrying 60% of volume, one isolated high bar carrying 40%.

    Range is 100.0 -> 110.0 across 50 levels (0.2 wide each).
      level 49 = [109.8, 110.0] -> the single high bar   -> POC, 40 units
      level 48 = [109.6, 109.8] -> EMPTY                 -> the trap
      levels 0-4 = [100.0, 101.0] -> 100 bars, 12 units each
    POC (40) < 70% of total (70), so the value area must expand -> hits the bug.
    """
    lows = [100.0] * LOOKBACK + [109.9]
    highs = [101.0] * LOOKBACK + [110.0]
    vols = [0.6] * LOOKBACK + [40.0]
    closes = [100.5] * LOOKBACK + [109.95]
    n = len(lows)
    idx = pd.date_range("2024-01-01", periods=n, freq="15min")
    return pd.DataFrame(
        {"open": closes, "high": highs, "low": lows, "close": closes, "volume": vols},
        index=idx,
    )


def test_value_area_does_not_index_past_the_end():
    """The exact shape that raised IndexError before the fix."""
    df = _bug_trigger_frame()
    out = add_volume_profile(df.copy(), lookback=LOOKBACK, num_levels=NUM_LEVELS)

    row = out.iloc[LOOKBACK]
    assert not np.isnan(row["VP_POC"]), "POC should be computed for the trigger row"
    # POC sits in the topmost level, which is what drove hi_idx to the boundary.
    assert row["VP_POC"] > 109.0
    # And the value area must stay inside the observed price range.
    assert row["VP_VAH"] <= 110.0 + 1e-9
    assert row["VP_VAL"] >= 100.0 - 1e-9


def test_value_area_bounds_are_ordered_and_within_range():
    n = 150
    rng = np.random.default_rng(7)
    closes = 100 + np.cumsum(rng.normal(0, 0.2, n))
    highs = closes + rng.uniform(0.05, 0.4, n)
    lows = closes - rng.uniform(0.05, 0.4, n)
    volumes = rng.uniform(100, 1000, n)
    idx = pd.date_range("2024-01-01", periods=n, freq="15min")
    df = pd.DataFrame(
        {"open": closes, "high": highs, "low": lows, "close": closes, "volume": volumes},
        index=idx,
    )
    out = add_volume_profile(df.copy())

    tail = out.dropna(subset=["VP_VAH", "VP_VAL", "VP_POC"])
    assert len(tail) > 0
    assert (tail["VP_VAH"] >= tail["VP_VAL"]).all()
    assert (tail["VP_POC"] <= tail["VP_VAH"] + 1e-9).all()
    assert (tail["VP_POC"] >= tail["VP_VAL"] - 1e-9).all()


def test_zero_volume_window_is_handled():
    """All-zero volume must not divide by zero or raise."""
    n = 120
    closes = np.full(n, 50.0)
    idx = pd.date_range("2024-01-01", periods=n, freq="15min")
    df = pd.DataFrame(
        {"open": closes, "high": closes + 1, "low": closes - 1,
         "close": closes, "volume": np.zeros(n)},
        index=idx,
    )
    out = add_volume_profile(df.copy())
    assert "VP_POC" in out.columns
