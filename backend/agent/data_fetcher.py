"""
Data fetcher — loads OHLCV + indicators for all symbols/timeframes.
Bridges between MT5/CCXT feeds and the agent state.
"""
import logging
import pandas as pd
from backend.agent.config import AgentConfig
from backend.core.indicators import add_all_indicators, get_indicator_snapshot

logger = logging.getLogger("agent.data")


def fetch_all_data(symbols: list[str], timeframes: dict) -> tuple[dict, dict, dict]:
    """Fetch OHLCV, compute indicators, and get current prices for all symbols.

    Args:
        symbols: List of symbol names
        timeframes: {"entry": "M5", "trend": "M15", "bias": "H1"}

    Returns:
        (ohlcv_dict, indicators_dict, prices_dict)
    """
    ohlcv_all = {}
    indicators_all = {}
    prices_all = {}

    for symbol in symbols:
        sym_ohlcv = {}
        sym_indicators = {}

        for tf_name, tf_value in timeframes.items():
            try:
                df = _fetch_symbol_tf(symbol, tf_value)
                if df is not None and len(df) > 0:
                    df = add_all_indicators(df)
                    sym_ohlcv[tf_value] = df
                    sym_indicators[tf_value] = get_indicator_snapshot(df, -1)
            except Exception as e:
                logger.warning(f"DATA: Failed to fetch {symbol} {tf_value}: {e}")

        ohlcv_all[symbol] = sym_ohlcv
        indicators_all[symbol] = sym_indicators

        # Current price
        try:
            prices_all[symbol] = _fetch_price(symbol)
        except Exception as e:
            logger.warning(f"DATA: Failed to get price for {symbol}: {e}")
            prices_all[symbol] = {}

    return ohlcv_all, indicators_all, prices_all


def _fetch_symbol_tf(symbol: str, timeframe: str, bars: int = 500) -> pd.DataFrame:
    """Fetch OHLCV for a symbol/timeframe from the appropriate feed."""
    sym = symbol.upper()

    if "BTC" in sym and "USD" in sym and "m" not in symbol:
        # Pure crypto symbol — use CCXT
        try:
            from backend.agent.feeds.crypto_feed import fetch_ohlcv
            return fetch_ohlcv(symbol="BTC/USDT", timeframe=timeframe, limit=bars)
        except Exception:
            pass

    # Everything else (including BTCUSDm) — use MT5
    try:
        from backend.services.mt5_connector import MT5Connector
        mt5 = MT5Connector()
        if mt5.is_connected:
            return mt5.get_history(symbol, timeframe, bars)
    except Exception as e:
        logger.warning(f"DATA: MT5 fetch failed for {symbol}/{timeframe}: {e}")

    return pd.DataFrame()


def _fetch_price(symbol: str) -> dict:
    """Get current bid/ask for a symbol."""
    sym = symbol.upper()

    if "BTC" in sym and "USD" in sym and "m" not in symbol:
        try:
            from backend.agent.feeds.crypto_feed import fetch_ticker
            ticker = fetch_ticker(symbol="BTC/USDT")
            return {
                "bid": ticker.get("bid", 0),
                "ask": ticker.get("ask", 0),
                "spread": (ticker.get("ask", 0) - ticker.get("bid", 0)) if ticker.get("ask") and ticker.get("bid") else 0,
            }
        except Exception:
            pass

    try:
        from backend.services.mt5_connector import MT5Connector
        mt5 = MT5Connector()
        if mt5.is_connected:
            price = mt5.get_symbol_price(symbol)
            return {
                "bid": price.get("bid", 0),
                "ask": price.get("ask", 0),
                "spread": price.get("ask", 0) - price.get("bid", 0),
            }
    except Exception as e:
        logger.warning(f"DATA: Price fetch failed for {symbol}: {e}")

    return {}
