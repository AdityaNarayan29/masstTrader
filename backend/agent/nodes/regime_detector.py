"""
Node 3 — Regime Detector
Classifies each symbol's market regime from indicators + context.
Phase 1: Rule-based. Phase 2: LLM-assisted.
"""
import logging
import numpy as np
from backend.agent.config import AgentConfig
from backend.agent.state import AgentState, RegimeTag

logger = logging.getLogger("agent.regime")


def run(state: AgentState) -> AgentState:
    """Detect regime for each cleared symbol."""
    cleared = state.get("cleared_symbols", [])
    indicators = state.get("indicators", {})
    regimes: dict[str, RegimeTag] = {}
    regime_reasons: dict[str, str] = {}

    for symbol in cleared:
        # Use the bias timeframe for regime detection (highest TF)
        tf_bias = state.get("tf_bias", "H1")
        tf_trend = state.get("tf_trend", "M15")
        sym_indicators = indicators.get(symbol, {})
        bias_ind = sym_indicators.get(tf_bias, {})
        trend_ind = sym_indicators.get(tf_trend, {})

        regime, reason = _detect_regime(bias_ind, trend_ind)
        regimes[symbol] = regime
        regime_reasons[symbol] = reason
        logger.info(f"REGIME: {symbol} = {regime} — {reason}")

    return {
        **state,
        "regimes": regimes,
        "regime_reasons": regime_reasons,
    }


def _detect_regime(bias: dict, trend: dict) -> tuple[RegimeTag, str]:
    """Rule-based regime detection using ADX, EMA slope, BB width, ATR.

    Logic:
    - ADX > 25 + EMA slopes aligned → TRENDING_UP or TRENDING_DOWN
    - ADX < 20 + narrow BB → RANGING
    - ATR > 1.5x average + wide BB → VOLATILE
    - Mixed signals → AVOID
    """
    adx = bias.get("ADX_14", 0)
    ema_9_slope = bias.get("EMA_9_slope", 0)
    ema_21_slope = bias.get("EMA_21_slope", 0)
    ema_50_slope = bias.get("EMA_50_slope", 0)
    bb_width = bias.get("BB_width", 0)
    atr = bias.get("ATR_14", 0)
    atr_avg = bias.get("ATR_14_avg", atr)
    macd_hist = bias.get("MACD_histogram", 0)

    reasons = []

    # Strong trend
    if adx > 25:
        # Check EMA alignment for direction
        slopes = [ema_9_slope, ema_21_slope, ema_50_slope]
        slopes = [s for s in slopes if s != 0]

        if slopes and all(s > 0 for s in slopes) and macd_hist > 0:
            reasons.append(f"ADX={adx:.0f}, all EMAs up, MACD positive")
            return "TRENDING_UP", "; ".join(reasons)

        if slopes and all(s < 0 for s in slopes) and macd_hist < 0:
            reasons.append(f"ADX={adx:.0f}, all EMAs down, MACD negative")
            return "TRENDING_DOWN", "; ".join(reasons)

    # Volatile
    if atr_avg > 0 and atr > atr_avg * 1.5:
        if bb_width > 0.03:  # wide Bollinger bands
            reasons.append(f"ATR={atr:.5f} > 1.5x avg={atr_avg:.5f}, BB_width={bb_width:.4f}")
            return "VOLATILE", "; ".join(reasons)

    # Ranging
    if adx < 20:
        if bb_width < 0.02:  # narrow bands
            reasons.append(f"ADX={adx:.0f} (weak), narrow BB_width={bb_width:.4f}")
            return "RANGING", "; ".join(reasons)

    # Mixed / weak signal → check trend TF for tiebreaker
    trend_adx = trend.get("ADX_14", 0)
    trend_ema_slope = trend.get("EMA_21_slope", 0)

    if trend_adx > 25:
        if trend_ema_slope > 0:
            reasons.append(f"Bias unclear but trend TF: ADX={trend_adx:.0f}, EMA up")
            return "TRENDING_UP", "; ".join(reasons)
        elif trend_ema_slope < 0:
            reasons.append(f"Bias unclear but trend TF: ADX={trend_adx:.0f}, EMA down")
            return "TRENDING_DOWN", "; ".join(reasons)

    # Default: if nothing clear, mark as RANGING (conservative)
    reasons.append(f"ADX={adx:.0f}, mixed slopes, defaulting to RANGING")
    return "RANGING", "; ".join(reasons)
