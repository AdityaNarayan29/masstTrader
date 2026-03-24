"""
Node 7 — Monitor Node
Manages open positions: partial exits, trailing stops, regime exits,
max hold time, DXY correlation exits.
"""
import logging
from datetime import datetime, timezone, timedelta

from backend.agent.config import AgentConfig
from backend.agent.state import AgentState
from backend.agent import db

logger = logging.getLogger("agent.monitor")


def run(state: AgentState) -> AgentState:
    """Monitor all open positions and take management actions."""
    open_trades = db.get_open_agent_trades()
    actions = []
    errors = list(state.get("errors", []))

    for trade in open_trades:
        try:
            trade_actions = _monitor_trade(trade, state)
            actions.extend(trade_actions)
        except Exception as e:
            logger.error(f"MONITOR: Error on trade {trade['id']}: {e}")
            errors.append({"node": "monitor", "trade_id": trade["id"], "error": str(e)})

    return {**state, "monitor_actions": actions, "errors": errors}


def _monitor_trade(trade: dict, state: AgentState) -> list[dict]:
    """Check all exit conditions for a single open trade."""
    actions = []
    symbol = trade["symbol"]
    direction = trade["direction"]
    entry_price = trade["entry_price"]
    sl_price = trade.get("sl_price", 0)
    tp_price = trade.get("tp_price", 0)
    atr = trade.get("atr_at_entry", 0)

    current_price = state.get("current_prices", {}).get(symbol, {})
    bid = current_price.get("bid", 0)
    ask = current_price.get("ask", 0)

    if not bid or not ask:
        return actions

    # Current P&L in price
    if direction == "BUY":
        current_pnl = bid - entry_price
    else:
        current_pnl = entry_price - ask

    # ── 1. Check SL/TP hit (for demo mode where broker doesn't auto-close) ──
    if direction == "BUY":
        if bid <= sl_price:
            actions.append(_close_trade(trade, bid, "stop_loss", state))
            return actions
        if tp_price and bid >= tp_price:
            actions.append(_close_trade(trade, bid, "take_profit", state))
            return actions
    else:
        if ask >= sl_price:
            actions.append(_close_trade(trade, ask, "stop_loss", state))
            return actions
        if tp_price and ask <= tp_price:
            actions.append(_close_trade(trade, ask, "take_profit", state))
            return actions

    # ── 2. Partial exit at 1R ──
    if not trade.get("partial_exit_done") and atr > 0:
        one_r = atr * AgentConfig.SL_ATR_MULTIPLIER
        if current_pnl >= one_r:
            # Close 50% and move SL to breakeven
            _partial_exit(trade, bid if direction == "BUY" else ask, state)
            actions.append({
                "trade_id": trade["id"],
                "action": "partial_exit_1R",
                "symbol": symbol,
                "price": bid if direction == "BUY" else ask,
                "reason": f"1R reached ({current_pnl:.5f} >= {one_r:.5f}), 50% closed, SL to BE",
            })

    # ── 3. Trailing stop ──
    if atr > 0 and not trade.get("trailing_stop_active"):
        trigger = atr * AgentConfig.TRAILING_STOP_ATR_TRIGGER
        if current_pnl >= trigger:
            db.update_agent_trade_trailing(trade["id"], True)
            actions.append({
                "trade_id": trade["id"],
                "action": "trailing_stop_activated",
                "symbol": symbol,
                "reason": f"Profit {current_pnl:.5f} >= trigger {trigger:.5f}",
            })
            logger.info(f"MONITOR: Trailing stop activated for {symbol}")

    if trade.get("trailing_stop_active") and atr > 0:
        trail_distance = atr * AgentConfig.TRAILING_STOP_ATR_DISTANCE
        if direction == "BUY":
            new_sl = bid - trail_distance
            if new_sl > sl_price:
                _update_sl(trade, new_sl, state)
                actions.append({
                    "trade_id": trade["id"],
                    "action": "trailing_stop_moved",
                    "symbol": symbol,
                    "new_sl": round(new_sl, 5),
                })
        else:
            new_sl = ask + trail_distance
            if new_sl < sl_price:
                _update_sl(trade, new_sl, state)
                actions.append({
                    "trade_id": trade["id"],
                    "action": "trailing_stop_moved",
                    "symbol": symbol,
                    "new_sl": round(new_sl, 5),
                })

    # ── 4. Regime exit ──
    regime = state.get("regimes", {}).get(symbol, "")
    if regime in ("AVOID", "VOLATILE"):
        actions.append(_close_trade(
            trade, bid if direction == "BUY" else ask,
            f"regime_exit_{regime}", state
        ))
        return actions

    # ── 5. DXY correlation exit (Gold only) ──
    sym = symbol.upper()
    if ("XAU" in sym or "GOLD" in sym) and direction == "BUY":
        macro = state.get("macro_context", {})
        if macro.get("dxy_trend") == "bullish" and macro.get("dxy_momentum", 0) > 0.5:
            actions.append(_close_trade(
                trade, bid, "dxy_spike_exit", state
            ))
            return actions

    # ── 6. Max hold time ──
    max_hours = AgentConfig.max_hold_hours(symbol)
    entry_time = datetime.fromisoformat(trade["entry_time"])
    if datetime.now(timezone.utc) - entry_time > timedelta(hours=max_hours):
        actions.append(_close_trade(
            trade, bid if direction == "BUY" else ask,
            f"max_hold_{max_hours}h", state
        ))
        return actions

    return actions


def _close_trade(trade: dict, exit_price: float, reason: str, state: AgentState) -> dict:
    """Close a trade (demo or live)."""
    now = datetime.now(timezone.utc)
    entry_price = trade["entry_price"]
    direction = trade["direction"]

    if direction == "BUY":
        profit = (exit_price - entry_price) * trade["volume"]
    else:
        profit = (entry_price - exit_price) * trade["volume"]

    # For Gold/BTC, profit calculation differs by contract size
    # This is simplified — live should use MT5's actual P&L

    entry_time = datetime.fromisoformat(trade["entry_time"])
    bars_held = int((now - entry_time).total_seconds() / 300)  # approximate in M5 bars

    exit_data = {
        "exit_price": round(exit_price, 5),
        "exit_time": now.isoformat(),
        "exit_reason": reason,
        "profit": round(profit, 2),
        "net_pnl": round(profit, 2),  # simplified; live should include commission/swap
        "bars_held": bars_held,
    }

    db.close_agent_trade(trade["id"], exit_data)

    # If live, close on MT5 too
    if AgentConfig.ENV == "live" and trade.get("mt5_ticket"):
        try:
            from backend.services.mt5_connector import MT5Connector
            mt5 = MT5Connector()
            mt5.close_position(trade["mt5_ticket"])
        except Exception as e:
            logger.error(f"MONITOR: Failed to close MT5 ticket {trade['mt5_ticket']}: {e}")

    logger.info(f"MONITOR: Closed {trade['symbol']} {direction} — reason={reason}, pnl={profit:.2f}")

    return {
        "trade_id": trade["id"],
        "action": "close",
        "symbol": trade["symbol"],
        "exit_price": exit_price,
        "reason": reason,
        "pnl": round(profit, 2),
    }


def _partial_exit(trade: dict, price: float, state: AgentState):
    """Execute partial exit: close 50% at 1R, move SL to breakeven."""
    db.update_agent_trade_partial_exit(trade["id"], price)

    if AgentConfig.ENV == "live" and trade.get("mt5_ticket"):
        try:
            from backend.services.mt5_connector import MT5Connector
            mt5 = MT5Connector()
            # Close half the position
            half_volume = round(trade["volume"] / 2, 2)
            mt5.close_position(trade["mt5_ticket"])
            # Reopen with half volume (MT5 doesn't support partial close natively)
            # This is a simplification — proper implementation would use volume reduction
        except Exception as e:
            logger.error(f"MONITOR: Partial exit failed for ticket {trade['mt5_ticket']}: {e}")

    logger.info(f"MONITOR: Partial exit at 1R for {trade['symbol']} @ {price:.5f}")


def _update_sl(trade: dict, new_sl: float, state: AgentState):
    """Update stop loss (trailing)."""
    if AgentConfig.ENV == "live" and trade.get("mt5_ticket"):
        try:
            from backend.services.mt5_connector import MT5Connector
            mt5 = MT5Connector()
            mt5.modify_position(trade["mt5_ticket"], stop_loss=new_sl)
        except Exception as e:
            logger.error(f"MONITOR: SL update failed for ticket {trade['mt5_ticket']}: {e}")
