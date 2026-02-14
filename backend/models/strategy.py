from pydantic import BaseModel
from typing import Optional
from enum import Enum


class Timeframe(str, Enum):
    M1 = "1m"
    M5 = "5m"
    M15 = "15m"
    M30 = "30m"
    H1 = "1h"
    H4 = "4h"
    D1 = "1d"
    W1 = "1w"


class Operator(str, Enum):
    GREATER_THAN = ">"
    LESS_THAN = "<"
    CROSSES_ABOVE = "crosses_above"
    CROSSES_BELOW = "crosses_below"
    EQUALS = "=="


class IndicatorCondition(BaseModel):
    indicator: str          # e.g., "RSI", "MACD", "EMA_50"
    parameter: str          # e.g., "value", "histogram", "signal_line"
    operator: Operator
    value: float | str      # numeric threshold or another indicator reference
    description: str        # human-readable description


class StrategyRule(BaseModel):
    name: str
    timeframe: Timeframe
    entry_conditions: list[IndicatorCondition]
    exit_conditions: list[IndicatorCondition]
    stop_loss_pips: Optional[float] = None
    take_profit_pips: Optional[float] = None
    stop_loss_atr_multiplier: Optional[float] = None   # e.g. 1.5 → SL = ATR × 1.5
    take_profit_atr_multiplier: Optional[float] = None  # e.g. 3.75 → TP = ATR × 3.75
    min_bars_in_trade: Optional[int] = None             # exit gated until N candles
    additional_timeframes: Optional[list[str]] = None    # e.g. ["4h"] for multi-TF
    risk_percent: float = 1.0  # risk per trade as % of balance
    description: str = ""


class Strategy(BaseModel):
    id: Optional[str] = None
    name: str
    symbol: str             # e.g., "EURUSD", "Volatility 75 Index"
    rules: list[StrategyRule]
    raw_description: str    # original natural language from user
    ai_explanation: str = ""
    created_at: Optional[str] = None
