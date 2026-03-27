"""
CCXT-based crypto feed for BTCUSDT.
Provides OHLCV data from Binance/Bybit with automatic failover.
"""
import os
import logging
from datetime import datetime, timezone

import pandas as pd

logger = logging.getLogger("agent.feeds.crypto")

# Lazy import — ccxt is optional, not needed for Gold-only trading
_ccxt = None


def _get_ccxt():
    global _ccxt
    if _ccxt is None:
        import ccxt
        _ccxt = ccxt
    return _ccxt


# ── Exchange connections ─────────────────────────────────────────

_exchanges: dict = {}


def _get_exchange(name: str = "binance"):
    """Get or create an exchange connection."""
    if name in _exchanges:
        return _exchanges[name]

    ccxt = _get_ccxt()
    testnet = os.getenv("CRYPTO_TESTNET", "true").lower() == "true"

    exchange_classes = {
        "binance": ccxt.binance,
        "bybit": ccxt.bybit,
    }

    if name not in exchange_classes:
        raise ValueError(f"Unsupported exchange: {name}")

    config = {
        "enableRateLimit": True,
        "options": {"defaultType": "swap"},  # perpetual futures
    }

    api_key = os.getenv(f"{name.upper()}_API_KEY", "")
    api_secret = os.getenv(f"{name.upper()}_API_SECRET", "")
    if api_key:
        config["apiKey"] = api_key
        config["secret"] = api_secret

    exchange = exchange_classes[name](config)

    if testnet:
        exchange.set_sandbox_mode(True)

    _exchanges[name] = exchange
    return exchange


# ── Timeframe mapping ────────────────────────────────────────────

TF_MAP = {
    "M1": "1m", "M5": "5m", "M15": "15m", "M30": "30m",
    "H1": "1h", "H4": "4h", "D1": "1d", "W1": "1w",
    # Also accept lowercase
    "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m",
    "1h": "1h", "4h": "4h", "1d": "1d", "1w": "1w",
}


# ── Public API ───────────────────────────────────────────────────

def fetch_ohlcv(
    symbol: str = "BTC/USDT",
    timeframe: str = "M5",
    limit: int = 500,
    exchange_name: str = "binance",
) -> pd.DataFrame:
    """Fetch OHLCV candles from exchange.

    Returns DataFrame with columns: open, high, low, close, volume
    indexed by datetime.
    """
    exchange = _get_exchange(exchange_name)
    ccxt_tf = TF_MAP.get(timeframe, "5m")

    try:
        ohlcv = exchange.fetch_ohlcv(symbol, ccxt_tf, limit=limit)
    except Exception as e:
        # Failover to bybit if binance fails
        if exchange_name == "binance":
            logger.warning(f"Binance failed ({e}), failing over to Bybit")
            return fetch_ohlcv(symbol, timeframe, limit, "bybit")
        raise

    if not ohlcv:
        raise RuntimeError(f"No OHLCV data for {symbol} on {exchange_name}")

    df = pd.DataFrame(ohlcv, columns=["timestamp", "open", "high", "low", "close", "volume"])
    df["datetime"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
    df = df.set_index("datetime")
    df = df[["open", "high", "low", "close", "volume"]]
    return df


def fetch_ticker(
    symbol: str = "BTC/USDT",
    exchange_name: str = "binance",
) -> dict:
    """Get current bid/ask/last price."""
    exchange = _get_exchange(exchange_name)
    try:
        ticker = exchange.fetch_ticker(symbol)
    except Exception as e:
        if exchange_name == "binance":
            logger.warning(f"Binance ticker failed ({e}), trying Bybit")
            return fetch_ticker(symbol, "bybit")
        raise

    return {
        "symbol": symbol,
        "bid": ticker.get("bid"),
        "ask": ticker.get("ask"),
        "last": ticker.get("last"),
        "volume": ticker.get("baseVolume"),
        "timestamp": ticker.get("timestamp"),
    }


def fetch_funding_rate(
    symbol: str = "BTC/USDT",
    exchange_name: str = "binance",
) -> dict:
    """Get current funding rate for perpetual futures."""
    exchange = _get_exchange(exchange_name)
    try:
        funding = exchange.fetch_funding_rate(symbol)
        return {
            "symbol": symbol,
            "funding_rate": funding.get("fundingRate", 0),
            "next_funding_time": funding.get("fundingTimestamp"),
            "timestamp": funding.get("timestamp"),
        }
    except Exception as e:
        logger.warning(f"Funding rate fetch failed: {e}")
        return {"symbol": symbol, "funding_rate": 0, "error": str(e)}


def fetch_open_interest(
    symbol: str = "BTC/USDT",
    exchange_name: str = "binance",
) -> dict:
    """Get open interest for a symbol."""
    exchange = _get_exchange(exchange_name)
    try:
        # Not all exchanges support this via ccxt — use raw API
        if exchange_name == "binance":
            response = exchange.fapiPublicGetOpenInterest({"symbol": symbol.replace("/", "")})
            return {
                "symbol": symbol,
                "open_interest": float(response.get("openInterest", 0)),
                "timestamp": response.get("time"),
            }
        else:
            return {"symbol": symbol, "open_interest": 0, "error": "Not supported"}
    except Exception as e:
        logger.warning(f"OI fetch failed: {e}")
        return {"symbol": symbol, "open_interest": 0, "error": str(e)}
