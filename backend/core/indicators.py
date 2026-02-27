"""
Technical indicator calculations using the `ta` library.
All functions take a pandas DataFrame with OHLCV columns and return enriched DataFrames.
"""
import pandas as pd
import numpy as np
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
    df["Volume_ratio"] = vol / df["Volume_SMA_20"].replace(0, np.nan)
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


# ──────────────────────────────────────────────
# Smart Money Indicators
# ──────────────────────────────────────────────


def add_liquidity_sweep(df: pd.DataFrame, lookback: int = 20, wick_threshold: float = 0.3) -> pd.DataFrame:
    """Detect liquidity sweeps at swing highs/lows.

    Columns: Swing_high, Swing_low, Liq_sweep_bull (0/1), Liq_sweep_bear (0/1).
    A bullish sweep = price wicks below swing low then closes above it.
    A bearish sweep = price wicks above swing high then closes below it.
    """
    highs = df["high"].values
    lows = df["low"].values
    closes = df["close"].values

    n = len(df)
    swing_high = np.full(n, np.nan)
    swing_low = np.full(n, np.nan)
    liq_bull = np.zeros(n, dtype=int)
    liq_bear = np.zeros(n, dtype=int)

    atr_col = "ATR_14"
    has_atr = atr_col in df.columns
    atr_vals = df[atr_col].values if has_atr else np.full(n, 0.001)

    current_swing_high = np.nan
    current_swing_low = np.nan
    half = lookback // 2

    for i in range(lookback, n):
        window_high = highs[i - lookback:i]
        window_low = lows[i - lookback:i]

        # Swing high: local max must be near center of window (not at edges)
        local_max_idx = int(np.argmax(window_high))
        if half // 2 <= local_max_idx <= lookback - half // 2 - 1:
            current_swing_high = float(window_high[local_max_idx])

        # Swing low: local min must be near center of window
        local_min_idx = int(np.argmin(window_low))
        if half // 2 <= local_min_idx <= lookback - half // 2 - 1:
            current_swing_low = float(window_low[local_min_idx])

        swing_high[i] = current_swing_high
        swing_low[i] = current_swing_low

        atr = atr_vals[i] if not np.isnan(atr_vals[i]) else 0.001
        min_wick = wick_threshold * atr

        # Bullish sweep: low wicked below swing_low, closed above it
        if not np.isnan(current_swing_low):
            if lows[i] < current_swing_low - min_wick and closes[i] > current_swing_low:
                liq_bull[i] = 1

        # Bearish sweep: high wicked above swing_high, closed below it
        if not np.isnan(current_swing_high):
            if highs[i] > current_swing_high + min_wick and closes[i] < current_swing_high:
                liq_bear[i] = 1

    df["Swing_high"] = swing_high
    df["Swing_low"] = swing_low
    df["Liq_sweep_bull"] = liq_bull
    df["Liq_sweep_bear"] = liq_bear
    return df


def add_avwap(df: pd.DataFrame) -> pd.DataFrame:
    """Anchored VWAP — resets when a new swing high/low is detected.

    Columns: AVWAP_high (anchored from last swing high), AVWAP_low (anchored from last swing low).
    Requires Swing_high/Swing_low from add_liquidity_sweep (run LiqSweep first).
    """
    if "Swing_high" not in df.columns or "Swing_low" not in df.columns:
        df["AVWAP_high"] = np.nan
        df["AVWAP_low"] = np.nan
        return df

    typical_price = (df["high"] + df["low"] + df["close"]) / 3.0
    volume = df["volume"].astype(float).values
    tp = typical_price.values
    swing_h = df["Swing_high"].values
    swing_l = df["Swing_low"].values

    n = len(df)
    avwap_high = np.full(n, np.nan)
    avwap_low = np.full(n, np.nan)

    prev_swing_h = np.nan
    prev_swing_l = np.nan
    cum_tp_vol_h = 0.0
    cum_vol_h = 0.0
    cum_tp_vol_l = 0.0
    cum_vol_l = 0.0

    for i in range(n):
        # Reset anchor when swing level changes
        if not np.isnan(swing_h[i]) and swing_h[i] != prev_swing_h:
            prev_swing_h = swing_h[i]
            cum_tp_vol_h = 0.0
            cum_vol_h = 0.0

        if not np.isnan(swing_l[i]) and swing_l[i] != prev_swing_l:
            prev_swing_l = swing_l[i]
            cum_tp_vol_l = 0.0
            cum_vol_l = 0.0

        vol = max(volume[i], 1.0)

        if not np.isnan(prev_swing_h):
            cum_tp_vol_h += tp[i] * vol
            cum_vol_h += vol
            avwap_high[i] = cum_tp_vol_h / cum_vol_h

        if not np.isnan(prev_swing_l):
            cum_tp_vol_l += tp[i] * vol
            cum_vol_l += vol
            avwap_low[i] = cum_tp_vol_l / cum_vol_l

    df["AVWAP_high"] = avwap_high
    df["AVWAP_low"] = avwap_low
    return df


def add_volume_delta(df: pd.DataFrame, sma_period: int = 14) -> pd.DataFrame:
    """Approximate order flow from OHLCV — buy/sell volume split.

    Columns: Volume_delta (per-bar), Cumulative_delta (running sum), Delta_SMA_{period}.
    Bullish bar: buy_vol = vol * (close - low) / (high - low).
    Bearish bar: sell_vol = vol * (high - close) / (high - low).
    """
    high = df["high"]
    low = df["low"]
    close = df["close"]
    open_ = df["open"]
    volume = df["volume"].astype(float)

    bar_range = high - low
    bar_range_safe = bar_range.replace(0, np.nan)

    is_bullish = close >= open_

    buy_vol = pd.Series(np.nan, index=df.index)
    buy_vol[is_bullish] = volume[is_bullish] * (close[is_bullish] - low[is_bullish]) / bar_range_safe[is_bullish]
    buy_vol[~is_bullish] = volume[~is_bullish] - volume[~is_bullish] * (high[~is_bullish] - close[~is_bullish]) / bar_range_safe[~is_bullish]
    buy_vol = buy_vol.fillna(volume * 0.5)  # doji: split 50/50

    delta = buy_vol - (volume - buy_vol)

    df["Volume_delta"] = delta
    df["Cumulative_delta"] = delta.cumsum()
    df[f"Delta_SMA_{sma_period}"] = delta.rolling(window=sma_period).mean()
    return df


def add_volume_profile(df: pd.DataFrame, lookback: int = 100, num_levels: int = 50, value_area_pct: float = 0.70) -> pd.DataFrame:
    """Rolling Volume Profile — POC, Value Area High/Low.

    Columns: VP_POC, VP_VAH, VP_VAL, VP_position (normalized close vs POC).
    Distributes each bar's volume across price buckets proportionally.
    """
    high = df["high"].values
    low = df["low"].values
    close = df["close"].values
    volume = df["volume"].astype(float).values

    has_atr = "ATR_14" in df.columns
    atr_vals = df["ATR_14"].values if has_atr else np.full(len(df), 0.001)

    n = len(df)
    poc = np.full(n, np.nan)
    vah = np.full(n, np.nan)
    val_ = np.full(n, np.nan)
    vp_pos = np.full(n, np.nan)

    for i in range(lookback, n):
        start = i - lookback
        w_high = high[start:i + 1]
        w_low = low[start:i + 1]
        w_vol = volume[start:i + 1]

        price_min = w_low.min()
        price_max = w_high.max()
        if price_max - price_min < 1e-10:
            poc[i] = price_min
            vah[i] = price_max
            val_[i] = price_min
            atr = atr_vals[i] if not np.isnan(atr_vals[i]) and atr_vals[i] > 0 else 0.001
            vp_pos[i] = (close[i] - price_min) / atr
            continue

        # Create price buckets and distribute volume
        level_edges = np.linspace(price_min, price_max, num_levels + 1)
        level_mids = (level_edges[:-1] + level_edges[1:]) / 2
        vol_at_level = np.zeros(num_levels)

        for j in range(len(w_high)):
            bv = w_vol[j]
            if bv <= 0:
                continue
            bl = w_low[j]
            bh = w_high[j]
            br = bh - bl
            for k in range(num_levels):
                overlap_lo = max(bl, level_edges[k])
                overlap_hi = min(bh, level_edges[k + 1])
                if overlap_hi > overlap_lo:
                    frac = (overlap_hi - overlap_lo) / br if br > 0 else 1.0 / num_levels
                    vol_at_level[k] += bv * frac

        # POC: highest volume level
        poc_idx = int(np.argmax(vol_at_level))
        poc[i] = level_mids[poc_idx]

        # Value Area: expand from POC until value_area_pct of volume
        total_vol = vol_at_level.sum()
        if total_vol <= 0:
            vah[i] = price_max
            val_[i] = price_min
        else:
            target_vol = total_vol * value_area_pct
            accumulated = vol_at_level[poc_idx]
            lo_idx = poc_idx
            hi_idx = poc_idx
            while accumulated < target_vol and (lo_idx > 0 or hi_idx < num_levels - 1):
                expand_up = vol_at_level[hi_idx + 1] if hi_idx < num_levels - 1 else 0
                expand_down = vol_at_level[lo_idx - 1] if lo_idx > 0 else 0
                if expand_up >= expand_down:
                    hi_idx += 1
                    accumulated += vol_at_level[hi_idx]
                else:
                    lo_idx -= 1
                    accumulated += vol_at_level[lo_idx]
            vah[i] = level_mids[hi_idx]
            val_[i] = level_mids[lo_idx]

        atr = atr_vals[i] if not np.isnan(atr_vals[i]) and atr_vals[i] > 0 else 0.001
        vp_pos[i] = (close[i] - poc[i]) / atr

    df["VP_POC"] = poc
    df["VP_VAH"] = vah
    df["VP_VAL"] = val_
    df["VP_position"] = vp_pos
    return df


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
    # Smart Money (order matters: LiqSweep before AVWAP)
    "LiqSweep": add_liquidity_sweep,
    "AVWAP": add_avwap,
    "VolumeDelta": add_volume_delta,
    "VolumeProfile": add_volume_profile,
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
    # Smart Money
    "LiqSweep": {"lookback": 20, "wick_threshold": 0.3},
    "AVWAP": {},
    "VolumeDelta": {"sma_period": 14},
    "VolumeProfile": {"lookback": 100, "num_levels": 50, "value_area_pct": 0.70},
}

AVAILABLE_INDICATORS = list(INDICATOR_REGISTRY.keys())
