"""Tests for the risk calculator - the code that decides how much real money
is exposed on every trade. Per FeatureRequirements.md S6 these rules are
"non-negotiable" and "the LLM cannot override" them, so they are tested directly.

Before this file existed none of these paths had ever executed: agent_trades is
empty, so no drawdown halt or circuit breaker had ever actually fired.
"""
import pytest

from backend.agent.config import AgentConfig
from backend.agent.nodes import risk_calculator


def _signal(direction="BUY", confidence=80.0, entry=2000.0, sl=1990.0, tp=2020.0):
    """A signal that passes every rule by default (R:R = 2.0, confidence 80%)."""
    return {
        "direction": direction,
        "confidence": confidence,
        "entry_price": entry,
        "stop_loss": sl,
        "take_profit": tp,
        "reasoning": "test",
    }


def _state(**over):
    base = {
        "signals": {"XAUUSDm": _signal()},
        "account": {"balance": 10_000.0, "equity": 10_000.0},
        "open_positions": [],
        "daily_pnl": 0.0,
        "weekly_pnl": 0.0,
        "consecutive_losses": 0,
        "macro_context": {},
        "crypto_context": {},
        "indicators": {},
        "tf_entry": "M5",
    }
    base.update(over)
    return base


def _orders(**over):
    return risk_calculator.run(_state(**over)).get("orders", {})


# ── Global kill switches ────────────────────────────────────────────────

def test_zero_balance_halts_all_trading():
    assert _orders(account={"balance": 0.0, "equity": 0.0}) == {}


def test_negative_balance_halts_all_trading():
    assert _orders(account={"balance": -50.0, "equity": -50.0}) == {}


@pytest.mark.parametrize("loss_pct,should_halt", [
    (2.9, False),   # just under the 3% daily limit
    (3.0, True),    # exactly at the limit - spec says halt AT the limit
    (5.0, True),
])
def test_daily_drawdown_kill_switch(loss_pct, should_halt):
    balance = 10_000.0
    orders = _orders(daily_pnl=-(balance * loss_pct / 100))
    assert (orders == {}) is should_halt, (
        f"{loss_pct}% daily loss vs {AgentConfig.DAILY_DRAWDOWN_LIMIT}% limit"
    )


@pytest.mark.parametrize("loss_pct,should_halt", [
    (7.9, False),
    (8.0, True),
    (12.0, True),
])
def test_weekly_drawdown_kill_switch(loss_pct, should_halt):
    balance = 10_000.0
    orders = _orders(weekly_pnl=-(balance * loss_pct / 100))
    assert (orders == {}) is should_halt


def test_profit_does_not_trigger_drawdown_halt():
    """A positive daily P&L must never be read as drawdown."""
    orders = _orders(daily_pnl=+5_000.0)
    assert orders != {}


def test_max_open_positions_blocks_new_orders():
    positions = [{"symbol": f"SYM{i}"} for i in range(AgentConfig.MAX_OPEN_POSITIONS)]
    assert _orders(open_positions=positions) == {}


# ── Per-signal rules ────────────────────────────────────────────────────

def test_none_signal_is_rejected():
    orders = _orders(signals={"XAUUSDm": _signal(direction="NONE")})
    assert orders["XAUUSDm"]["rejected"] is True


def test_confidence_below_threshold_is_rejected():
    low = AgentConfig.CONFIDENCE_THRESHOLD - 1
    orders = _orders(signals={"XAUUSDm": _signal(confidence=low)})
    assert orders["XAUUSDm"]["rejected"] is True
    assert "Confidence" in orders["XAUUSDm"]["reject_reason"]


def test_three_consecutive_losses_raises_confidence_bar():
    """At 3 losses the required confidence jumps to 75%, so 70% must be refused."""
    sig = _signal(confidence=70.0)
    assert _orders(signals={"XAUUSDm": sig})["XAUUSDm"]["rejected"] is False
    hardened = _orders(signals={"XAUUSDm": sig}, consecutive_losses=3)
    assert hardened["XAUUSDm"]["rejected"] is True


def test_same_symbol_position_blocks_a_second_entry():
    orders = _orders(open_positions=[{"symbol": "XAUUSDm"}])
    assert orders["XAUUSDm"]["rejected"] is True
    assert "already" in orders["XAUUSDm"]["reject_reason"].lower()


def test_reward_to_risk_below_minimum_is_rejected():
    # SL 10 away, TP 10 away -> R:R 1.0, under the 1.5 minimum
    orders = _orders(signals={"XAUUSDm": _signal(entry=2000, sl=1990, tp=2010)})
    assert orders["XAUUSDm"]["rejected"] is True
    assert "R:R" in orders["XAUUSDm"]["reject_reason"]


def test_zero_stop_distance_is_rejected_not_divided_by():
    orders = _orders(signals={"XAUUSDm": _signal(entry=2000, sl=2000, tp=2020)})
    assert orders["XAUUSDm"]["rejected"] is True


def test_missing_prices_are_rejected():
    bad = _signal()
    bad["stop_loss"] = 0
    assert _orders(signals={"XAUUSDm": bad})["XAUUSDm"]["rejected"] is True


# ── Macro blocks ────────────────────────────────────────────────────────

def test_bullish_dxy_blocks_gold_longs():
    orders = _orders(macro_context={"dxy_trend": "bullish"})
    assert orders["XAUUSDm"]["rejected"] is True
    assert "DXY" in orders["XAUUSDm"]["reject_reason"]


def test_bullish_dxy_does_not_block_gold_shorts():
    orders = _orders(
        signals={"XAUUSDm": _signal(direction="SELL", entry=2000, sl=2010, tp=1980)},
        macro_context={"dxy_trend": "bullish"},
    )
    assert orders["XAUUSDm"]["rejected"] is False


def test_extreme_funding_blocks_btc_longs():
    orders = _orders(
        signals={"BTCUSDm": _signal(entry=60000, sl=59000, tp=62000)},
        crypto_context={"funding_rate": AgentConfig.FUNDING_RATE_BLOCK * 2},
    )
    assert orders["BTCUSDm"]["rejected"] is True
    assert "funding" in orders["BTCUSDm"]["reject_reason"].lower()


# ── Position sizing ─────────────────────────────────────────────────────

def test_risk_never_exceeds_the_configured_maximum():
    """The core money-safety property: risk% <= the per-symbol cap, always."""
    for symbol, entry, sl, tp in [
        ("XAUUSDm", 2000.0, 1990.0, 2020.0),
        ("BTCUSDm", 60000.0, 59000.0, 62000.0),
        ("EURUSDm", 1.1000, 1.0950, 1.1100),
    ]:
        orders = _orders(signals={symbol: _signal(entry=entry, sl=sl, tp=tp)})
        order = orders[symbol]
        if order.get("rejected"):
            continue
        cap = AgentConfig.max_risk_for_symbol(symbol)
        assert order["risk_percent"] <= cap + 1e-6, (
            f"{symbol} risked {order['risk_percent']}% > cap {cap}%"
        )


def test_two_consecutive_losses_reduce_size_by_25_percent():
    base = _orders()["XAUUSDm"]
    after = _orders(consecutive_losses=2)["XAUUSDm"]
    assert not base["rejected"] and not after["rejected"]
    expected = base["risk_amount"] * (1 - AgentConfig.CONSEC_LOSS_2_SIZE_REDUCTION)
    assert after["risk_amount"] == pytest.approx(expected, rel=1e-3)


def test_three_consecutive_losses_reduce_size_by_50_percent():
    base = _orders()["XAUUSDm"]
    # confidence must clear the raised 75% bar for the order to survive
    after = _orders(signals={"XAUUSDm": _signal(confidence=80.0)}, consecutive_losses=3)["XAUUSDm"]
    assert not after["rejected"]
    expected = base["risk_amount"] * (1 - AgentConfig.CONSEC_LOSS_3_SIZE_REDUCTION)
    assert after["risk_amount"] == pytest.approx(expected, rel=1e-3)


def test_high_volatility_reduces_size_by_30_percent():
    base = _orders()["XAUUSDm"]
    volatile = _orders(indicators={"XAUUSDm": {"M5": {
        "ATR_14": 10.0,
        "ATR_14_avg": 1.0,   # 10x average, well past the 1.5x threshold
    }}})["XAUUSDm"]
    expected = base["risk_amount"] * (1 - AgentConfig.VOLATILITY_SIZE_REDUCTION)
    assert volatile["risk_amount"] == pytest.approx(expected, rel=1e-3)


def test_approved_order_carries_the_expected_fields():
    order = _orders()["XAUUSDm"]
    assert order["rejected"] is False
    for field in ("volume", "entry_price", "stop_loss", "take_profit",
                  "risk_amount", "risk_percent", "rr_ratio"):
        assert field in order, f"missing {field}"
    assert order["volume"] > 0
    assert order["rr_ratio"] >= AgentConfig.MIN_RR_RATIO
