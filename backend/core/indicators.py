"""
Technical indicator calculations using the `ta` library.
All functions take a pandas DataFrame with OHLCV columns and return enriched DataFrames.
"""
import pandas as pd
import ta


def add_all_indicators(df: pd.DataFrame, config: dict = None) -> pd.DataFrame:
    """Add all configured indicators to the dataframe."""
    config = config or DEFAULT_CONFIG
    result = df.copy()

    for indicator_name, params in config.items():
        func = INDICATOR_REGISTRY.get(indicator_name)
        if func:
            # Support list of param dicts for multi-period indicators (e.g., EMA)
            if isinstance(params, list):
                for p in params:
                    result = func(result, **p)
            else:
                result = func(result, **params)

    return result


def add_rsi(df: pd.DataFrame, period: int = 14) -> pd.DataFrame:
    df[f"RSI_{period}"] = ta.momentum.RSIIndicator(
        close=df["close"], window=period
    ).rsi()
    return df


def add_macd(
    df: pd.DataFrame,
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> pd.DataFrame:
    macd = ta.trend.MACD(
        close=df["close"],
        window_slow=slow,
        window_fast=fast,
        window_sign=signal,
    )
    df["MACD_line"] = macd.macd()
    df["MACD_signal"] = macd.macd_signal()
    df["MACD_histogram"] = macd.macd_diff()
    df["MACD_histogram_prev"] = df["MACD_histogram"].shift(1)
    return df


def add_ema(df: pd.DataFrame, period: int = 20) -> pd.DataFrame:
    df[f"EMA_{period}"] = ta.trend.EMAIndicator(
        close=df["close"], window=period
    ).ema_indicator()
    return df


def add_sma(df: pd.DataFrame, period: int = 20) -> pd.DataFrame:
    df[f"SMA_{period}"] = ta.trend.SMAIndicator(
        close=df["close"], window=period
    ).sma_indicator()
    return df


def add_bollinger_bands(df: pd.DataFrame, period: int = 20, std: int = 2) -> pd.DataFrame:
    bb = ta.volatility.BollingerBands(
        close=df["close"], window=period, window_dev=std
    )
    df["BB_upper"] = bb.bollinger_hband()
    df["BB_middle"] = bb.bollinger_mavg()
    df["BB_lower"] = bb.bollinger_lband()
    df["BB_width"] = bb.bollinger_wband()
    return df


def add_atr(df: pd.DataFrame, period: int = 14) -> pd.DataFrame:
    df[f"ATR_{period}"] = ta.volatility.AverageTrueRange(
        high=df["high"], low=df["low"], close=df["close"], window=period
    ).average_true_range()
    return df


def add_stochastic(df: pd.DataFrame, period: int = 14, smooth: int = 3) -> pd.DataFrame:
    stoch = ta.momentum.StochasticOscillator(
        high=df["high"],
        low=df["low"],
        close=df["close"],
        window=period,
        smooth_window=smooth,
    )
    df["Stoch_K"] = stoch.stoch()
    df["Stoch_D"] = stoch.stoch_signal()
    return df


def add_adx(df: pd.DataFrame, period: int = 14) -> pd.DataFrame:
    adx = ta.trend.ADXIndicator(
        high=df["high"], low=df["low"], close=df["close"], window=period
    )
    df[f"ADX_{period}"] = adx.adx()
    df["DI_plus"] = adx.adx_pos()
    df["DI_minus"] = adx.adx_neg()
    return df


def add_volume_indicators(df: pd.DataFrame) -> pd.DataFrame:
    vol = df["volume"].astype(float)
    df["OBV"] = ta.volume.OnBalanceVolumeIndicator(
        close=df["close"], volume=vol
    ).on_balance_volume()
    df["Volume_SMA_20"] = vol.rolling(window=20).mean()
    df["Volume_ratio"] = vol / df["Volume_SMA_20"]
    return df


def get_indicator_snapshot(df: pd.DataFrame, index: int = -1) -> dict:
    """Get all indicator values at a specific candle index. Useful for trade analysis."""
    row = df.iloc[index]
    snapshot = {}
    indicator_cols = [
        c for c in df.columns if c not in ["open", "high", "low", "close", "volume", "datetime", "index"]
    ]
    for col in indicator_cols:
        val = row[col]
        if pd.notna(val):
            snapshot[col] = round(float(val), 5)
    return snapshot


# Registry of available indicators
INDICATOR_REGISTRY = {
    "RSI": add_rsi,
    "MACD": add_macd,
    "EMA": add_ema,
    "SMA": add_sma,
    "Bollinger": add_bollinger_bands,
    "ATR": add_atr,
    "Stochastic": add_stochastic,
    "ADX": add_adx,
    "Volume": add_volume_indicators,
}

# Default indicator config
DEFAULT_CONFIG = {
    "RSI": {"period": 14},
    "MACD": {"fast": 12, "slow": 26, "signal": 9},
    "EMA": [
        {"period": 8},
        {"period": 9},
        {"period": 14},
        {"period": 21},
        {"period": 34},
        {"period": 50},
        {"period": 100},
    ],
    "SMA": {"period": 20},
    "Bollinger": {"period": 20, "std": 2},
    "ATR": {"period": 14},
    "Stochastic": {"period": 14, "smooth": 3},
    "ADX": {"period": 14},
    "Volume": {},
}

AVAILABLE_INDICATORS = list(INDICATOR_REGISTRY.keys())
