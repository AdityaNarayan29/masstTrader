"""
Node 4 — Signal Generator (LLM Brain)
The core decision-making node. Uses Groq/Llama3 to analyze all data
and generate trade signals. Phase 1: Rule-based stub. Phase 2: Full LLM.
"""
import json
import logging
from backend.agent.config import AgentConfig
from backend.agent.state import AgentState, Signal
from backend.agent import db

logger = logging.getLogger("agent.signal")


def run(state: AgentState) -> AgentState:
    """Generate signals for each cleared symbol that passed regime check."""
    cleared = state.get("cleared_symbols", [])
    regimes = state.get("regimes", {})
    indicators = state.get("indicators", {})
    signals: dict[str, Signal] = {}

    # Load recent trades for pattern awareness
    recent_trades = db.get_recent_agent_trades(limit=50)

    for symbol in cleared:
        regime = regimes.get(symbol, "RANGING")

        # Skip symbols with AVOID regime
        if regime == "AVOID":
            signals[symbol] = Signal(
                direction="NONE", confidence=0,
                reasoning=f"Regime is AVOID for {symbol}"
            )
            continue

        tf_entry = state.get("tf_entry", "M5")
        sym_indicators = indicators.get(symbol, {})
        entry_ind = sym_indicators.get(tf_entry, {})

        current_price = state.get("current_prices", {}).get(symbol, {})
        bid = current_price.get("bid", 0)
        ask = current_price.get("ask", 0)
        mid = (bid + ask) / 2 if bid and ask else 0

        if not mid:
            signals[symbol] = Signal(
                direction="NONE", confidence=0,
                reasoning=f"No price data for {symbol}"
            )
            continue

        signal = _generate_signal_rules(
            symbol, regime, entry_ind, mid, state, recent_trades
        )

        # Devil's advocate filter for marginal signals
        low, high = AgentConfig.DEVIL_ADVOCATE_RANGE
        if low <= signal.get("confidence", 0) <= high:
            signal = _devil_advocate(signal, state)

        signals[symbol] = signal
        logger.info(
            f"SIGNAL: {symbol} = {signal.get('direction')} "
            f"@ {signal.get('confidence', 0):.0f}% — {signal.get('reasoning', '')[:100]}"
        )

    return {
        **state,
        "signals": signals,
        "recent_trades": recent_trades,
    }


def _generate_signal_rules(
    symbol: str,
    regime: str,
    entry_ind: dict,
    price: float,
    state: AgentState,
    recent_trades: list,
) -> Signal:
    """Phase 1: Rule-based signal generation.
    Phase 2 will replace this with full LLM prompt.

    Rules:
    - TRENDING_UP + RSI not overbought + MACD positive → BUY
    - TRENDING_DOWN + RSI not oversold + MACD negative → SELL
    - RANGING + RSI oversold at BB lower → BUY (mean reversion)
    - RANGING + RSI overbought at BB upper → SELL (mean reversion)
    """
    rsi = entry_ind.get("RSI_14", 50)
    macd_hist = entry_ind.get("MACD_histogram", 0)
    macd_hist_prev = entry_ind.get("MACD_histogram_prev", 0)
    adx = entry_ind.get("ADX_14", 0)
    atr = entry_ind.get("ATR_14", 0)
    bb_upper = entry_ind.get("BB_upper", price * 1.01)
    bb_lower = entry_ind.get("BB_lower", price * 0.99)
    bb_middle = entry_ind.get("BB_middle", price)
    ema_9 = entry_ind.get("EMA_9", price)
    ema_21 = entry_ind.get("EMA_21", price)
    stoch_k = entry_ind.get("Stoch_K", 50)
    stoch_d = entry_ind.get("Stoch_D", 50)

    direction = "NONE"
    confidence = 0
    reasons = []

    sl_mult = AgentConfig.SL_ATR_MULTIPLIER
    tp_mult = AgentConfig.TP_ATR_MULTIPLIER

    if regime in ("TRENDING_UP",):
        # Look for pullback entries in uptrend
        if rsi < 70 and macd_hist > 0:
            confidence += 30
            reasons.append(f"Uptrend, RSI={rsi:.0f} not overbought, MACD positive")

        if macd_hist > 0 and macd_hist_prev <= 0:
            confidence += 20
            reasons.append("MACD histogram crossed above zero")

        if price > ema_9 > ema_21:
            confidence += 15
            reasons.append("Price > EMA9 > EMA21 (aligned)")

        if stoch_k < 80 and stoch_k > stoch_d:
            confidence += 10
            reasons.append(f"Stoch K={stoch_k:.0f} > D={stoch_d:.0f}, not overbought")

        if adx > 25:
            confidence += 10
            reasons.append(f"Strong trend ADX={adx:.0f}")

        if confidence >= 50:
            direction = "BUY"

    elif regime in ("TRENDING_DOWN",):
        if rsi > 30 and macd_hist < 0:
            confidence += 30
            reasons.append(f"Downtrend, RSI={rsi:.0f} not oversold, MACD negative")

        if macd_hist < 0 and macd_hist_prev >= 0:
            confidence += 20
            reasons.append("MACD histogram crossed below zero")

        if price < ema_9 < ema_21:
            confidence += 15
            reasons.append("Price < EMA9 < EMA21 (aligned)")

        if stoch_k > 20 and stoch_k < stoch_d:
            confidence += 10
            reasons.append(f"Stoch K={stoch_k:.0f} < D={stoch_d:.0f}, not oversold")

        if adx > 25:
            confidence += 10
            reasons.append(f"Strong trend ADX={adx:.0f}")

        if confidence >= 50:
            direction = "SELL"

    elif regime in ("RANGING",):
        # Mean reversion at BB extremes
        if rsi < 30 and price <= bb_lower * 1.002:
            confidence += 40
            direction = "BUY"
            reasons.append(f"Ranging: RSI={rsi:.0f} oversold at BB lower")

        elif rsi > 70 and price >= bb_upper * 0.998:
            confidence += 40
            direction = "SELL"
            reasons.append(f"Ranging: RSI={rsi:.0f} overbought at BB upper")

        if direction != "NONE" and stoch_k < 20 and direction == "BUY":
            confidence += 15
            reasons.append("Stoch oversold confirms")
        elif direction != "NONE" and stoch_k > 80 and direction == "SELL":
            confidence += 15
            reasons.append("Stoch overbought confirms")

    elif regime == "VOLATILE":
        # Only take high-confidence setups in volatile markets
        reasons.append("Volatile regime — requiring extra confluence")
        # Tighter criteria: need strong momentum + clear direction
        if rsi < 25 and macd_hist > 0 and macd_hist_prev <= 0:
            confidence += 50
            direction = "BUY"
            reasons.append("Extreme oversold + MACD reversal")
        elif rsi > 75 and macd_hist < 0 and macd_hist_prev >= 0:
            confidence += 50
            direction = "SELL"
            reasons.append("Extreme overbought + MACD reversal")

    # Compute entry/SL/TP
    if direction == "NONE" or confidence < AgentConfig.CONFIDENCE_THRESHOLD:
        return Signal(
            direction="NONE",
            confidence=confidence,
            reasoning="; ".join(reasons) or "No setup found",
            prompt_version=AgentConfig.PROMPT_VERSION,
            devil_advocate_ran=False,
        )

    if atr <= 0:
        atr = price * 0.005  # fallback: 0.5% of price

    if direction == "BUY":
        entry = price
        sl = entry - (atr * sl_mult)
        tp = entry + (atr * tp_mult)
    else:  # SELL
        entry = price
        sl = entry + (atr * sl_mult)
        tp = entry - (atr * tp_mult)

    return Signal(
        direction=direction,
        confidence=min(confidence, 100),
        reasoning="; ".join(reasons),
        entry_price=round(entry, 5),
        stop_loss=round(sl, 5),
        take_profit=round(tp, 5),
        rag_passages=[],
        prompt_version=AgentConfig.PROMPT_VERSION,
        devil_advocate_ran=False,
    )


def _devil_advocate(signal: Signal, state: AgentState) -> Signal:
    """Run a devil's advocate check for marginal signals (65-75% confidence).
    Phase 1: Rule-based counter-arguments. Phase 2: Second LLM call.
    """
    counter_args = []
    entry_ind = state.get("indicators", {}).get(
        signal.get("symbol", ""), {}
    ).get(state.get("tf_entry", "M5"), {})

    rsi = entry_ind.get("RSI_14", 50)
    direction = signal.get("direction", "NONE")

    # Check for divergences / counter-signals
    if direction == "BUY" and rsi > 65:
        counter_args.append(f"RSI already at {rsi:.0f} — limited upside before overbought")

    if direction == "SELL" and rsi < 35:
        counter_args.append(f"RSI already at {rsi:.0f} — limited downside before oversold")

    # Check macro headwinds
    macro = state.get("macro_context", {})
    if direction == "BUY" and "XAU" in signal.get("symbol", "").upper():
        if macro.get("dxy_trend") == "bullish":
            counter_args.append("DXY trending bullish — headwind for Gold longs")

    if counter_args:
        # Downgrade confidence
        old_conf = signal.get("confidence", 0)
        new_conf = max(old_conf - 15, 0)
        logger.info(
            f"DEVIL'S ADVOCATE: {signal.get('symbol')} downgraded "
            f"{old_conf:.0f}% → {new_conf:.0f}%: {'; '.join(counter_args)}"
        )
        return {
            **signal,
            "confidence": new_conf,
            "devil_advocate_ran": True,
            "devil_advocate_result": "; ".join(counter_args),
            "direction": "NONE" if new_conf < AgentConfig.CONFIDENCE_THRESHOLD else signal.get("direction"),
        }

    return {**signal, "devil_advocate_ran": True, "devil_advocate_result": "No counter-arguments found"}
