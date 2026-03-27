"""
Node 5 — Risk Calculator
Validates signals against hard risk rules. LLM cannot override these.
Produces a ValidatedOrder or REJECTED.
"""
import logging
from backend.agent.config import AgentConfig
from backend.agent.state import AgentState, ValidatedOrder, Signal
from backend.agent import db

logger = logging.getLogger("agent.risk")


def run(state: AgentState) -> AgentState:
    """Validate every signal and produce orders (or rejections)."""
    orders: dict[str, ValidatedOrder] = {}
    account = state.get("account", {})
    balance = account.get("balance", 0)
    equity = account.get("equity", 0)
    open_positions = state.get("open_positions", [])
    daily_pnl = state.get("daily_pnl", 0)
    weekly_pnl = state.get("weekly_pnl", 0)
    consecutive_losses = state.get("consecutive_losses", 0)

    # ── Global kill switches ─────────────────────────────────────
    if balance <= 0:
        logger.warning("RISK: Balance is 0, halting all trades")
        return {**state, "orders": {}}

    daily_dd_pct = abs(daily_pnl / balance * 100) if daily_pnl < 0 else 0
    weekly_dd_pct = abs(weekly_pnl / balance * 100) if weekly_pnl < 0 else 0

    if daily_dd_pct >= AgentConfig.DAILY_DRAWDOWN_LIMIT:
        logger.warning(f"RISK: Daily drawdown {daily_dd_pct:.1f}% >= {AgentConfig.DAILY_DRAWDOWN_LIMIT}% — HALTED")
        return {**state, "orders": {}}

    if weekly_dd_pct >= AgentConfig.WEEKLY_DRAWDOWN_LIMIT:
        logger.warning(f"RISK: Weekly drawdown {weekly_dd_pct:.1f}% >= {AgentConfig.WEEKLY_DRAWDOWN_LIMIT}% — HALTED")
        return {**state, "orders": {}}

    # ── Max open positions check ─────────────────────────────────
    if len(open_positions) >= AgentConfig.MAX_OPEN_POSITIONS:
        logger.info(f"RISK: Max positions ({AgentConfig.MAX_OPEN_POSITIONS}) reached")
        return {**state, "orders": {}}

    signals = state.get("signals", {})

    for symbol, signal in signals.items():
        order = _validate_signal(
            symbol, signal, balance, equity,
            open_positions, consecutive_losses, state
        )
        orders[symbol] = order
        if order.get("rejected"):
            logger.info(f"RISK: {symbol} REJECTED — {order.get('reject_reason')}")
        else:
            logger.info(
                f"RISK: {symbol} APPROVED — {order['direction']} "
                f"{order['volume']} lots, risk {order['risk_percent']:.2f}%, "
                f"RR {order['rr_ratio']:.2f}"
            )

    return {**state, "orders": orders}


def _validate_signal(
    symbol: str,
    signal: Signal,
    balance: float,
    equity: float,
    open_positions: list,
    consecutive_losses: int,
    state: AgentState,
) -> ValidatedOrder:
    """Apply all risk rules to a single signal."""

    direction = signal.get("direction", "NONE")
    confidence = signal.get("confidence", 0)

    # ── Direction check ──────────────────────────────────────────
    if direction == "NONE":
        return ValidatedOrder(
            symbol=symbol, direction="NONE", rejected=True,
            reject_reason="Signal is NONE"
        )

    # ── Confidence threshold ─────────────────────────────────────
    min_confidence = AgentConfig.CONFIDENCE_THRESHOLD
    if consecutive_losses >= 3:
        min_confidence = AgentConfig.CONSEC_LOSS_3_MIN_CONFIDENCE

    if confidence < min_confidence:
        return ValidatedOrder(
            symbol=symbol, direction=direction, rejected=True,
            reject_reason=f"Confidence {confidence:.0f}% < threshold {min_confidence:.0f}%"
        )

    # ── Same symbol already open ─────────────────────────────────
    symbol_positions = [p for p in open_positions if p.get("symbol") == symbol]
    if len(symbol_positions) >= AgentConfig.MAX_SAME_SYMBOL:
        return ValidatedOrder(
            symbol=symbol, direction=direction, rejected=True,
            reject_reason=f"Already {len(symbol_positions)} position(s) open on {symbol}"
        )

    # ── DXY block for Gold ───────────────────────────────────────
    sym = symbol.upper()
    if ("XAU" in sym or "GOLD" in sym) and direction == "BUY":
        macro = state.get("macro_context", {})
        dxy_trend = macro.get("dxy_trend", "neutral")
        if dxy_trend == "bullish":
            return ValidatedOrder(
                symbol=symbol, direction=direction, rejected=True,
                reject_reason="DXY strongly bullish — Gold longs blocked"
            )

    # ── Funding rate block for BTC ───────────────────────────────
    if "BTC" in sym and direction == "BUY":
        crypto = state.get("crypto_context", {})
        funding = crypto.get("funding_rate", 0)
        if funding > AgentConfig.FUNDING_RATE_BLOCK:
            return ValidatedOrder(
                symbol=symbol, direction=direction, rejected=True,
                reject_reason=f"BTC funding rate {funding:.4f} > {AgentConfig.FUNDING_RATE_BLOCK} — longs blocked"
            )

    # ── Calculate position size ──────────────────────────────────
    entry_price = signal.get("entry_price", 0)
    sl_price = signal.get("stop_loss", 0)
    tp_price = signal.get("take_profit", 0)

    if not entry_price or not sl_price or not tp_price:
        return ValidatedOrder(
            symbol=symbol, direction=direction, rejected=True,
            reject_reason="Missing entry/SL/TP prices"
        )

    sl_distance = abs(entry_price - sl_price)
    tp_distance = abs(tp_price - entry_price)

    if sl_distance == 0:
        return ValidatedOrder(
            symbol=symbol, direction=direction, rejected=True,
            reject_reason="SL distance is 0"
        )

    # ── R:R check ────────────────────────────────────────────────
    rr_ratio = tp_distance / sl_distance
    if rr_ratio < AgentConfig.MIN_RR_RATIO:
        return ValidatedOrder(
            symbol=symbol, direction=direction, rejected=True,
            reject_reason=f"R:R {rr_ratio:.2f} < min {AgentConfig.MIN_RR_RATIO}"
        )

    # ── Risk amount ──────────────────────────────────────────────
    max_risk_pct = AgentConfig.max_risk_for_symbol(symbol)
    risk_amount = balance * (max_risk_pct / 100)

    # ── Consecutive loss adjustment ──────────────────────────────
    if consecutive_losses >= 3:
        risk_amount *= (1 - AgentConfig.CONSEC_LOSS_3_SIZE_REDUCTION)
        logger.info(f"RISK: {consecutive_losses} consecutive losses — size reduced by {AgentConfig.CONSEC_LOSS_3_SIZE_REDUCTION*100:.0f}%")
    elif consecutive_losses >= 2:
        risk_amount *= (1 - AgentConfig.CONSEC_LOSS_2_SIZE_REDUCTION)
        logger.info(f"RISK: {consecutive_losses} consecutive losses — size reduced by {AgentConfig.CONSEC_LOSS_2_SIZE_REDUCTION*100:.0f}%")

    # ── Volatility adjustment ────────────────────────────────────
    indicators = state.get("indicators", {}).get(symbol, {})
    entry_tf = state.get("tf_entry", "M5")
    tf_indicators = indicators.get(entry_tf, {})
    atr = tf_indicators.get("ATR_14", 0)
    atr_avg = tf_indicators.get("ATR_14_avg", atr)  # 20-period average

    if atr_avg > 0 and atr > atr_avg * AgentConfig.ATR_VOLATILITY_THRESHOLD:
        risk_amount *= (1 - AgentConfig.VOLATILITY_SIZE_REDUCTION)
        logger.info(f"RISK: High volatility (ATR {atr:.4f} > {atr_avg * AgentConfig.ATR_VOLATILITY_THRESHOLD:.4f}) — size reduced 30%")

    # ── BTC weekend reduction ────────────────────────────────────
    from backend.agent.sessions import is_btc_weekend
    if "BTC" in sym and is_btc_weekend():
        risk_amount *= (1 - AgentConfig.BTC_WEEKEND_SIZE_REDUCTION)
        logger.info("RISK: BTC weekend — size reduced 30%")

    # ── Calculate lot size ───────────────────────────────────────
    # For Gold (XAU): 1 lot = 100 oz, pip = $0.01
    # For BTC: 1 lot = 1 BTC
    # For Forex: 1 lot = 100,000 units
    volume = _calc_lot_size(symbol, risk_amount, sl_distance, entry_price)

    if volume <= 0:
        return ValidatedOrder(
            symbol=symbol, direction=direction, rejected=True,
            reject_reason=f"Calculated volume is 0 (risk_amount={risk_amount:.2f}, sl_dist={sl_distance:.5f})"
        )

    actual_risk_pct = (risk_amount / balance * 100) if balance > 0 else 0

    return ValidatedOrder(
        symbol=symbol,
        direction=direction,
        volume=round(volume, 2),
        entry_price=entry_price,
        stop_loss=sl_price,
        take_profit=tp_price,
        risk_amount=round(risk_amount, 2),
        risk_percent=round(actual_risk_pct, 2),
        rr_ratio=round(rr_ratio, 2),
        rejected=False,
    )


def _calc_lot_size(symbol: str, risk_amount: float, sl_distance: float, entry_price: float) -> float:
    """Calculate lot size based on risk amount and SL distance.

    This is symbol-aware:
    - XAU (Gold): 1 standard lot = 100 oz. tick_value varies by broker.
      On Exness, XAUUSDm is micro — 1 lot = 1 oz.
    - BTC: 1 lot = 1 BTC typically, but varies. We use contract_size from symbol info.
    - Forex: 1 lot = 100,000 units of base currency.

    For demo, we use simplified calculation. Live should use MT5's order_calc_margin.
    """
    sym = symbol.upper()

    if "XAU" in sym or "GOLD" in sym:
        # Exness micro: 1 lot = 1 oz of Gold
        # Dollar per pip movement: 1 lot * $1/pip for XAUUSDm
        # SL distance is in price (e.g. $5 = 500 pips)
        # Risk = lots * sl_distance * tick_value_per_lot
        # For micro: tick_value ~ $0.01 per 0.01 move per lot
        # Simplified: profit = lots * sl_distance_in_dollars
        if sl_distance > 0:
            volume = risk_amount / sl_distance
        else:
            volume = 0
        # Clamp to Exness micro limits
        volume = max(0.01, min(volume, 100))

    elif "BTC" in sym:
        # BTCUSDm on Exness: 1 lot = 1 BTC
        # Risk = lots * sl_distance
        if sl_distance > 0:
            volume = risk_amount / sl_distance
        else:
            volume = 0
        volume = max(0.01, min(volume, 10))

    else:
        # Standard Forex: 1 lot = 100,000 units
        # For pairs quoted in USD (EURUSD, GBPUSD):
        # pip_value_per_lot = $10 for 4-digit pairs, $1 for 5-digit
        # SL in price: 0.0010 = 10 pips
        pip_value = 10.0  # $10 per pip per standard lot
        pips = sl_distance * 10000  # convert price to pips (4-digit)
        if "JPY" in sym:
            pips = sl_distance * 100
            pip_value = 1000 / entry_price if entry_price > 0 else 10

        if pips > 0:
            volume = risk_amount / (pips * pip_value)
        else:
            volume = 0
        volume = max(0.01, min(volume, 100))

    return volume
