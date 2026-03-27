"""
MasstTrader V2 — LangGraph Agent
The main agent graph with 7 sequential nodes forming a continuous loop.

[Market Scanner] -> [Context Enricher] -> [Regime Detector] -> [Signal Generator]
       -> [Risk Calculator] -> [Execution Node] -> [Monitor Node]
                    loops back to Market Scanner
"""
import uuid
import time
import logging
import threading
from datetime import datetime, timezone

from backend.agent.config import AgentConfig
from backend.agent.state import AgentState
from backend.agent import db
from backend.agent.nodes import (
    market_scanner,
    context_enricher,
    regime_detector,
    signal_generator,
    risk_calculator,
    execution,
    monitor,
)
from backend.core.indicators import add_all_indicators, get_indicator_snapshot

logger = logging.getLogger("agent.graph")


class TradingAgent:
    """The autonomous trading agent. Runs a continuous loop through all 7 nodes."""

    def __init__(self):
        self._running = False
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._state: AgentState = {}
        self._cycle_count = 0
        self._last_error: str | None = None
        self._halted = False
        self._halt_reason: str | None = None

        # Initialize DB tables
        db.init_agent_tables()

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def status(self) -> dict:
        return {
            "running": self._running,
            "halted": self._halted,
            "halt_reason": self._halt_reason,
            "cycle_count": self._cycle_count,
            "last_error": self._last_error,
            "env": AgentConfig.ENV,
            "timeframe_mode": AgentConfig.TIMEFRAME_MODE,
            "watchlist": AgentConfig.WATCHLIST,
            "loop_interval": AgentConfig.LOOP_INTERVAL_SECONDS,
            "open_trades": len(db.get_open_agent_trades()),
            "consecutive_losses": db.get_consecutive_losses(),
        }

    def start(self):
        """Start the agent loop in a background thread."""
        if self._running:
            logger.warning("Agent already running")
            return

        self._stop_event.clear()
        self._running = True
        self._halted = False
        self._halt_reason = None
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        logger.info("Agent started")

    def stop(self):
        """Stop the agent loop gracefully."""
        self._stop_event.set()
        self._running = False
        if self._thread:
            self._thread.join(timeout=30)
        logger.info("Agent stopped")

    def halt(self, reason: str):
        """Emergency halt — stops trading but keeps loop alive for monitoring."""
        self._halted = True
        self._halt_reason = reason
        logger.warning(f"Agent HALTED: {reason}")

    def resume(self):
        """Resume after a halt."""
        self._halted = False
        self._halt_reason = None
        logger.info("Agent resumed from halt")

    def run_single_cycle(self) -> dict:
        """Run a single cycle synchronously. Useful for testing."""
        return self._run_cycle()

    def _run_loop(self):
        """Main agent loop — runs until stopped."""
        logger.info(
            f"Agent loop started — mode={AgentConfig.TIMEFRAME_MODE}, "
            f"interval={AgentConfig.LOOP_INTERVAL_SECONDS}s, env={AgentConfig.ENV}"
        )

        while not self._stop_event.is_set():
            try:
                if not self._halted:
                    self._run_cycle()
                else:
                    logger.debug(f"Agent halted: {self._halt_reason}")
            except Exception as e:
                self._last_error = str(e)
                logger.error(f"Agent cycle error: {e}", exc_info=True)

            # Wait for next cycle
            self._stop_event.wait(timeout=AgentConfig.LOOP_INTERVAL_SECONDS)

        self._running = False
        logger.info("Agent loop exited")

    def _run_cycle(self) -> dict:
        """Execute one full cycle through all 7 nodes."""
        cycle_start = time.time()
        cycle_id = str(uuid.uuid4())[:8]
        self._cycle_count += 1

        logger.info(f"=== Cycle {self._cycle_count} ({cycle_id}) ===")

        tfs = AgentConfig.get_timeframes()

        # Initialize state for this cycle
        state: AgentState = {
            "cycle_id": cycle_id,
            "timeframe_mode": AgentConfig.TIMEFRAME_MODE,
            "tf_entry": tfs["entry"],
            "tf_trend": tfs["trend"],
            "tf_bias": tfs["bias"],
            "loop_interval": AgentConfig.LOOP_INTERVAL_SECONDS,
            "watchlist": AgentConfig.WATCHLIST,
            "errors": [],
        }

        try:
            # Node 1 — Market Scanner
            state = market_scanner.run(state)

            if not state.get("cleared_symbols"):
                logger.info("No symbols cleared — skipping cycle")
                self._log_cycle(state, cycle_start)
                return state

            # Fetch market data for cleared symbols
            state = self._fetch_market_data(state)

            # Node 2 — Context Enricher
            state = context_enricher.run(state)

            # Node 3 — Regime Detector
            state = regime_detector.run(state)

            # Load account state
            state = self._load_account_state(state)

            # Node 4 — Signal Generator
            state = signal_generator.run(state)

            # Check if any signals are actionable
            has_signals = any(
                s.get("direction") != "NONE"
                for s in state.get("signals", {}).values()
            )

            if has_signals:
                # Node 5 — Risk Calculator
                state = risk_calculator.run(state)

                # Node 6 — Execution
                has_orders = any(
                    not o.get("rejected")
                    for o in state.get("orders", {}).values()
                )
                if has_orders:
                    state = execution.run(state)

            # Node 7 — Monitor (always runs — manages open positions)
            state = monitor.run(state)

        except Exception as e:
            logger.error(f"Cycle error: {e}", exc_info=True)
            state.setdefault("errors", []).append({
                "node": "graph", "error": str(e),
            })
            self._last_error = str(e)

        self._log_cycle(state, cycle_start)
        self._state = state
        return state

    def _fetch_market_data(self, state: AgentState) -> AgentState:
        """Fetch OHLCV + indicators for all cleared symbols across all timeframes."""
        cleared = state.get("cleared_symbols", [])
        tfs = [state["tf_entry"], state["tf_trend"], state["tf_bias"]]
        ohlcv_data = {}
        indicators_data = {}
        current_prices = {}

        for symbol in cleared:
            ohlcv_data[symbol] = {}
            indicators_data[symbol] = {}

            for tf in tfs:
                try:
                    df = self._fetch_symbol_data(symbol, tf)
                    if df is not None and len(df) > 0:
                        # Add all indicators
                        df = add_all_indicators(df)
                        ohlcv_data[symbol][tf] = df
                        indicators_data[symbol][tf] = get_indicator_snapshot(df)
                except Exception as e:
                    logger.warning(f"Failed to fetch {symbol} {tf}: {e}")
                    state.setdefault("errors", []).append({
                        "node": "data_fetch", "symbol": symbol, "tf": tf, "error": str(e),
                    })

            # Current price
            try:
                price = self._fetch_current_price(symbol)
                current_prices[symbol] = price
            except Exception as e:
                logger.warning(f"Failed to get price for {symbol}: {e}")

        return {
            **state,
            "ohlcv": ohlcv_data,
            "indicators": indicators_data,
            "current_prices": current_prices,
        }

    def _get_mt5_connector(self):
        """Get the global MT5 connector from the API module (same instance)."""
        try:
            import backend.api.main as api_main
            c = getattr(api_main, "connector", None)
            if c and c.is_connected:
                return c
        except Exception:
            pass
        # Fallback: try creating a fresh connection with env creds
        try:
            from backend.services.mt5_connector import MT5Connector
            from config.settings import settings
            mt5 = MT5Connector()
            if settings.MT5_LOGIN and settings.MT5_PASSWORD:
                mt5.connect(
                    login=int(settings.MT5_LOGIN),
                    password=settings.MT5_PASSWORD,
                    server=settings.MT5_SERVER,
                )
                return mt5
        except Exception as e:
            logger.warning(f"MT5 auto-connect failed: {e}")
        return None

    def _fetch_symbol_data(self, symbol: str, timeframe: str):
        """Fetch OHLCV data from MT5 or CCXT depending on symbol."""
        sym = symbol.upper()

        # Pure crypto (BTC/USDT without broker suffix) — use CCXT
        if "BTC" in sym and "USD" in sym and not symbol.endswith("m"):
            from backend.agent.feeds.crypto_feed import fetch_ohlcv
            return fetch_ohlcv("BTC/USDT", timeframe)

        # MT5 symbol (Gold, Forex, or Exness crypto like BTCUSDm)
        mt5 = self._get_mt5_connector()
        if mt5:
            try:
                return mt5.get_history(symbol, timeframe, bars=500)
            except Exception as e:
                logger.warning(f"MT5 fetch error for {symbol} {timeframe}: {e}")
        else:
            logger.warning(f"MT5 not available — cannot fetch {symbol}")

        # Fallback for BTC symbols — try CCXT
        if "BTC" in sym:
            try:
                from backend.agent.feeds.crypto_feed import fetch_ohlcv
                return fetch_ohlcv("BTC/USDT", timeframe)
            except Exception as e:
                logger.warning(f"CCXT fallback failed for {symbol}: {e}")

        return None

    def _fetch_current_price(self, symbol: str) -> dict:
        """Get current bid/ask."""
        sym = symbol.upper()

        if "BTC" in sym and "USD" in sym and not symbol.endswith("m"):
            from backend.agent.feeds.crypto_feed import fetch_ticker
            ticker = fetch_ticker("BTC/USDT")
            return {
                "bid": ticker.get("bid", 0),
                "ask": ticker.get("ask", 0),
                "spread": (ticker.get("ask", 0) - ticker.get("bid", 0)),
            }

        mt5 = self._get_mt5_connector()
        if mt5:
            try:
                price = mt5.get_symbol_price(symbol)
                return {
                    "bid": price["bid"],
                    "ask": price["ask"],
                    "spread": price["ask"] - price["bid"],
                }
            except Exception as e:
                logger.warning(f"MT5 price error for {symbol}: {e}")

        # Fallback for BTC
        if "BTC" in sym:
            try:
                from backend.agent.feeds.crypto_feed import fetch_ticker
                ticker = fetch_ticker("BTC/USDT")
                return {
                    "bid": ticker.get("bid", 0),
                    "ask": ticker.get("ask", 0),
                    "spread": (ticker.get("ask", 0) or 0) - (ticker.get("bid", 0) or 0),
                }
            except Exception:
                pass

        return {"bid": 0, "ask": 0, "spread": 0}

    def _load_account_state(self, state: AgentState) -> AgentState:
        """Load account balance, equity, open positions, PnL."""
        account = {"balance": 10000, "equity": 10000, "margin": 0, "free_margin": 10000}

        try:
            from backend.services.mt5_connector import MT5Connector
            mt5 = MT5Connector()
            if mt5.is_connected:
                info = mt5.get_account_info()
                account = {
                    "balance": info["balance"],
                    "equity": info["equity"],
                    "margin": info["margin"],
                    "free_margin": info["free_margin"],
                }
        except Exception:
            pass  # Use demo defaults

        open_positions = db.get_open_agent_trades()
        daily_pnl = db.get_daily_pnl()
        weekly_pnl = db.get_weekly_pnl()
        consecutive_losses = db.get_consecutive_losses()

        # Check drawdown kill switches
        if account["balance"] > 0:
            daily_dd = abs(daily_pnl / account["balance"] * 100) if daily_pnl < 0 else 0
            weekly_dd = abs(weekly_pnl / account["balance"] * 100) if weekly_pnl < 0 else 0

            if daily_dd >= AgentConfig.DAILY_DRAWDOWN_LIMIT:
                self.halt(f"Daily drawdown {daily_dd:.1f}% hit limit {AgentConfig.DAILY_DRAWDOWN_LIMIT}%")

            if weekly_dd >= AgentConfig.WEEKLY_DRAWDOWN_LIMIT:
                self.halt(f"Weekly drawdown {weekly_dd:.1f}% hit limit {AgentConfig.WEEKLY_DRAWDOWN_LIMIT}%")

        return {
            **state,
            "account": account,
            "open_positions": [{"symbol": t["symbol"], "direction": t["direction"]} for t in open_positions],
            "daily_pnl": daily_pnl,
            "weekly_pnl": weekly_pnl,
            "consecutive_losses": consecutive_losses,
        }

    def _log_cycle(self, state: AgentState, start_time: float):
        """Log this cycle to the database."""
        duration_ms = int((time.time() - start_time) * 1000)

        # Serialize signals for logging (remove non-serializable data)
        signals_log = {}
        for sym, sig in state.get("signals", {}).items():
            signals_log[sym] = {
                "direction": sig.get("direction"),
                "confidence": sig.get("confidence"),
                "reasoning": sig.get("reasoning", "")[:500],
            }

        orders_log = {}
        for sym, order in state.get("orders", {}).items():
            orders_log[sym] = {
                "direction": order.get("direction"),
                "volume": order.get("volume"),
                "rejected": order.get("rejected"),
                "reject_reason": order.get("reject_reason"),
                "risk_percent": order.get("risk_percent"),
                "rr_ratio": order.get("rr_ratio"),
            }

        executions_log = {}
        for sym, ex in state.get("executions", {}).items():
            executions_log[sym] = {
                "success": ex.get("success"),
                "fill_price": ex.get("fill_price"),
                "slippage": ex.get("slippage"),
            }

        cycle_data = {
            "id": state.get("cycle_id"),
            "timestamp": state.get("timestamp"),
            "timeframe_mode": state.get("timeframe_mode"),
            "symbols_scanned": state.get("watchlist", []),
            "symbols_cleared": state.get("cleared_symbols", []),
            "symbols_skipped": state.get("scanner_skips", []),
            "regimes": state.get("regimes", {}),
            "signals": signals_log,
            "orders": orders_log,
            "executions": executions_log,
            "monitor_actions": state.get("monitor_actions", []),
            "errors": state.get("errors", []),
            "session": state.get("current_session"),
            "news_blackout": state.get("news_blackout", False),
            "duration_ms": duration_ms,
        }

        try:
            db.save_agent_cycle(cycle_data)
        except Exception as e:
            logger.error(f"Failed to log cycle: {e}")

        logger.info(
            f"Cycle {state.get('cycle_id')} completed in {duration_ms}ms — "
            f"cleared={len(state.get('cleared_symbols', []))}, "
            f"signals={len([s for s in signals_log.values() if s.get('direction') != 'NONE'])}, "
            f"executions={len([e for e in executions_log.values() if e.get('success')])}, "
            f"monitor_actions={len(state.get('monitor_actions', []))}"
        )


# ── Singleton agent instance ────────────────────────────────────

_agent: TradingAgent | None = None


def get_agent() -> TradingAgent:
    """Get or create the singleton agent instance."""
    global _agent
    if _agent is None:
        _agent = TradingAgent()
    return _agent
