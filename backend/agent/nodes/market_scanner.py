"""
Node 1 — Market Scanner
Scans the watchlist and filters out symbols that shouldn't be traded this cycle.
"""
import logging
from datetime import datetime, timezone

from backend.agent.config import AgentConfig
from backend.agent.state import AgentState
from backend.agent.sessions import should_skip_symbol, get_current_session, is_btc_weekend

logger = logging.getLogger("agent.scanner")


def run(state: AgentState) -> AgentState:
    """Filter watchlist → cleared_symbols."""
    utc_now = datetime.now(timezone.utc)
    session = get_current_session(utc_now)
    watchlist = state.get("watchlist", AgentConfig.WATCHLIST)

    cleared = []
    skips = []

    for symbol in watchlist:
        skip, reason = should_skip_symbol(symbol, utc_now)
        if skip:
            skips.append({"symbol": symbol, "reason": reason})
            logger.info(f"SCANNER: Skip {symbol} — {reason}")
        else:
            cleared.append(symbol)
            logger.info(f"SCANNER: {symbol} cleared for analysis")

    # Check if BTC is in low-liquidity weekend (still trade, but flag it)
    for sym in cleared:
        if "BTC" in sym.upper() and is_btc_weekend(utc_now):
            logger.info(f"SCANNER: {sym} in weekend mode — position size will be reduced")

    return {
        **state,
        "current_session": session,
        "cleared_symbols": cleared,
        "scanner_skips": skips,
        "timestamp": utc_now.isoformat(),
    }
