"""
Node 6 — Execution Node
Executes validated orders. Demo mode simulates fills; live mode uses MT5/CCXT.
"""
import logging
from datetime import datetime, timezone

from backend.agent.config import AgentConfig
from backend.agent.state import AgentState, ExecutionResult
from backend.agent import db

logger = logging.getLogger("agent.execution")


def run(state: AgentState) -> AgentState:
    """Execute all approved orders."""
    orders = state.get("orders", {})
    executions: dict[str, ExecutionResult] = {}
    errors = list(state.get("errors", []))

    for symbol, order in orders.items():
        if order.get("rejected"):
            continue

        try:
            if AgentConfig.ENV == "demo":
                result = _execute_demo(symbol, order, state)
            else:
                result = _execute_live(symbol, order, state)

            executions[symbol] = result

            if result.get("success"):
                # Save trade to DB
                trade_data = {
                    "cycle_id": state.get("cycle_id"),
                    "symbol": symbol,
                    "direction": order["direction"],
                    "volume": order["volume"],
                    "entry_price": result.get("fill_price", order["entry_price"]),
                    "entry_time": datetime.now(timezone.utc).isoformat(),
                    "sl_price": order["stop_loss"],
                    "tp_price": order["take_profit"],
                    "regime": state.get("regimes", {}).get(symbol),
                    "session": state.get("current_session"),
                    "timeframe_mode": state.get("timeframe_mode"),
                    "confidence": state.get("signals", {}).get(symbol, {}).get("confidence"),
                    "reasoning": state.get("signals", {}).get(symbol, {}).get("reasoning"),
                    "prompt_version": AgentConfig.PROMPT_VERSION,
                    "rag_passages": state.get("signals", {}).get(symbol, {}).get("rag_passages", []),
                    "devil_advocate": state.get("signals", {}).get(symbol, {}).get("devil_advocate_ran", False),
                    "devil_result": state.get("signals", {}).get(symbol, {}).get("devil_advocate_result"),
                    "macro_snapshot": state.get("macro_context", {}),
                    "crypto_snapshot": state.get("crypto_context", {}),
                    "sentiment_snapshot": state.get("sentiment_context", {}),
                    "indicators_snapshot": state.get("indicators", {}).get(symbol, {}).get(
                        state.get("tf_entry", "M5"), {}
                    ),
                    "risk_amount": order.get("risk_amount"),
                    "risk_percent": order.get("risk_percent"),
                    "rr_ratio": order.get("rr_ratio"),
                    "atr_at_entry": state.get("indicators", {}).get(symbol, {}).get(
                        state.get("tf_entry", "M5"), {}
                    ).get("ATR_14"),
                    "consecutive_losses": state.get("consecutive_losses", 0),
                    "mt5_ticket": result.get("ticket"),
                    "fill_type": result.get("fill_type"),
                    "slippage": result.get("slippage"),
                }
                saved = db.save_agent_trade(trade_data)
                logger.info(f"EXEC: {symbol} {order['direction']} filled @ {result.get('fill_price')}, trade_id={saved['id']}")
            else:
                logger.warning(f"EXEC: {symbol} execution failed — {result.get('error')}")

        except Exception as e:
            logger.error(f"EXEC: {symbol} exception — {e}")
            executions[symbol] = ExecutionResult(
                success=False, error=str(e), fill_type="error"
            )
            errors.append({"node": "execution", "symbol": symbol, "error": str(e)})

    return {**state, "executions": executions, "errors": errors}


def _execute_demo(symbol: str, order: dict, state: AgentState) -> ExecutionResult:
    """Simulate a fill at current price (paper trading)."""
    current_price = state.get("current_prices", {}).get(symbol, {})
    direction = order["direction"]

    if direction == "BUY":
        fill_price = current_price.get("ask", order["entry_price"])
    else:
        fill_price = current_price.get("bid", order["entry_price"])

    slippage = fill_price - order["entry_price"]

    return ExecutionResult(
        ticket=0,  # no real ticket in demo
        fill_price=round(fill_price, 5),
        slippage=round(slippage, 5),
        fill_type="simulated",
        success=True,
    )


def _execute_live(symbol: str, order: dict, state: AgentState) -> ExecutionResult:
    """Execute on MT5 with retries and slippage tracking."""
    from backend.services.mt5_connector import MT5Connector
    mt5 = MT5Connector()

    direction = order["direction"].lower()  # "buy" or "sell"
    last_error = ""

    for attempt in range(AgentConfig.ORDER_RETRIES):
        try:
            result = mt5.place_trade(
                symbol=symbol,
                trade_type=direction,
                volume=order["volume"],
                stop_loss=order["stop_loss"],
                take_profit=order["take_profit"],
                magic=AgentConfig.MAGIC_NUMBER,
                comment=f"MasstV2 {order.get('confidence', 0):.0f}%",
            )

            if result.get("success"):
                fill_price = result.get("price", order["entry_price"])
                slippage = fill_price - order["entry_price"]
                return ExecutionResult(
                    ticket=result.get("order_id", 0),
                    fill_price=round(fill_price, 5),
                    slippage=round(slippage, 5),
                    fill_type="market",
                    success=True,
                )
            else:
                last_error = result.get("message", "Unknown error")
                logger.warning(f"EXEC: Attempt {attempt+1} failed for {symbol}: {last_error}")

        except Exception as e:
            last_error = str(e)
            logger.warning(f"EXEC: Attempt {attempt+1} exception for {symbol}: {e}")

    return ExecutionResult(
        success=False, error=f"All {AgentConfig.ORDER_RETRIES} attempts failed: {last_error}",
        fill_type="failed",
    )
