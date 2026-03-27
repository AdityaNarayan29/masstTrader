"""
Agent state — the single TypedDict that flows through every LangGraph node.
Each node reads what it needs, writes what it produces.
"""
from __future__ import annotations

from typing import TypedDict, Literal, TYPE_CHECKING

if TYPE_CHECKING:
    import pandas as pd


# ── Enums ────────────────────────────────────────────────────────

RegimeTag = Literal[
    "TRENDING_UP", "TRENDING_DOWN", "RANGING", "VOLATILE", "AVOID"
]
Direction = Literal["BUY", "SELL", "NONE"]
Session = Literal["SYDNEY", "TOKYO", "LONDON", "NEW_YORK", "CLOSED"]
TimeframeMode = Literal["scalping", "intraday", "swing", "daily"]


# ── Sub-structures ──────────────────────────────────────────────

class MacroContext(TypedDict, total=False):
    dxy_trend: str               # "bullish" | "bearish" | "neutral"
    dxy_momentum: float          # rate of change
    vix: float
    us_real_yield: float
    btc_dominance: float
    fed_funds_sentiment: str


class CryptoContext(TypedDict, total=False):
    funding_rate: float          # per 8h
    open_interest: float
    oi_change_pct: float         # % change in OI
    exchange_netflow: float      # negative = accumulation
    liquidation_levels: list     # [{price, volume, side}]
    fear_greed_index: int        # 0-100


class GoldContext(TypedDict, total=False):
    cot_commercial_net: float    # net long/short from COT report
    central_bank_buying: bool
    geopolitical_risk_index: float


class SentimentContext(TypedDict, total=False):
    reddit_score: float          # -1.0 to 1.0
    twitter_score: float         # -1.0 to 1.0
    fear_greed: int              # 0-100


class Signal(TypedDict, total=False):
    direction: Direction
    confidence: float            # 0-100
    reasoning: str
    entry_price: float
    stop_loss: float
    take_profit: float
    rag_passages: list[str]      # IDs of retrieved RAG passages
    prompt_version: str
    devil_advocate_ran: bool
    devil_advocate_result: str


class ValidatedOrder(TypedDict, total=False):
    symbol: str
    direction: Direction
    volume: float                # lot size
    entry_price: float
    stop_loss: float
    take_profit: float
    risk_amount: float           # $ at risk
    risk_percent: float          # % of balance
    rr_ratio: float              # reward:risk
    rejected: bool
    reject_reason: str


class ExecutionResult(TypedDict, total=False):
    ticket: int
    fill_price: float
    slippage: float              # fill_price - entry_price
    fill_type: str               # "market" | "limit" | "simulated"
    success: bool
    error: str


# ── Main Agent State ────────────────────────────────────────────

class AgentState(TypedDict, total=False):
    # Config
    cycle_id: str                # unique per loop iteration
    timestamp: str               # ISO format
    timeframe_mode: TimeframeMode
    tf_entry: str                # e.g. "M5"
    tf_trend: str                # e.g. "M15"
    tf_bias: str                 # e.g. "H1"
    loop_interval: int           # seconds between cycles

    # Node 1 — Market Scanner
    watchlist: list[str]         # all symbols to consider
    cleared_symbols: list[str]   # symbols that passed scanner filters
    scanner_skips: list[dict]    # [{symbol, reason}]

    # Node 2 — Context Enricher
    macro_context: MacroContext
    crypto_context: CryptoContext
    gold_context: GoldContext
    sentiment_context: SentimentContext

    # Node 3 — Regime Detector (per symbol)
    regimes: dict[str, RegimeTag]  # {symbol: regime}
    regime_reasons: dict[str, str]

    # Market data (per symbol)
    ohlcv: dict[str, dict[str, pd.DataFrame]]  # {symbol: {tf: DataFrame}}
    indicators: dict[str, dict[str, dict]]      # {symbol: {tf: {indicator: value}}}
    current_prices: dict[str, dict]              # {symbol: {bid, ask, spread}}

    # Node 4 — Signal Generator
    signals: dict[str, Signal]   # {symbol: Signal}

    # Node 5 — Risk Calculator
    orders: dict[str, ValidatedOrder]  # {symbol: ValidatedOrder}
    account: dict                # {balance, equity, margin, free_margin}
    daily_pnl: float
    weekly_pnl: float
    consecutive_losses: int
    open_positions: list[dict]

    # Node 6 — Execution
    executions: dict[str, ExecutionResult]  # {symbol: ExecutionResult}

    # Node 7 — Monitor
    monitor_actions: list[dict]  # [{ticket, action, reason}]

    # Session
    current_session: Session
    news_blackout: bool
    blackout_events: list[dict]  # [{event, time, symbol}]

    # Trade History
    recent_trades: list[dict]    # last 50 trades for context

    # Errors
    errors: list[dict]           # [{node, error, action_taken}]
