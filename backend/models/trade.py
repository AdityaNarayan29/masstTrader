from pydantic import BaseModel
from typing import Optional
from enum import Enum


class TradeType(str, Enum):
    BUY = "buy"
    SELL = "sell"


class TradeSource(str, Enum):
    MANUAL = "manual"
    BOT = "bot"


class Trade(BaseModel):
    id: str
    symbol: str
    trade_type: TradeType
    entry_price: float
    exit_price: Optional[float] = None
    lot_size: float
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None
    profit: Optional[float] = None
    open_time: str
    close_time: Optional[str] = None
    source: TradeSource = TradeSource.MANUAL
    # Indicator snapshot at time of entry
    indicators_at_entry: Optional[dict] = None
    # AI analysis
    ai_analysis: Optional[str] = None
    strategy_alignment_score: Optional[float] = None  # 0-100
