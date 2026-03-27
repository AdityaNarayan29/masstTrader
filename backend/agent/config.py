"""
Agent configuration — all tunable parameters loaded from .env with sane defaults.
These are the knobs that control the agent's behavior.
"""
import os
from config.settings import settings


class AgentConfig:
    """All agent config in one place. Every value has a default."""

    # ── Timeframe modes ──────────────────────────────────────────
    TIMEFRAME_MODES = {
        "scalping": {"entry": "M1", "trend": "M5", "bias": "M15"},
        "intraday": {"entry": "M5", "trend": "M15", "bias": "H1"},
        "swing":    {"entry": "H1", "trend": "H4", "bias": "D1"},
        "daily":    {"entry": "H4", "trend": "D1", "bias": "W1"},
    }

    # Active mode
    TIMEFRAME_MODE: str = os.getenv("TF_MODE", "intraday")
    TF_ENTRY: str = os.getenv("TF_ENTRY", "")
    TF_TREND: str = os.getenv("TF_TREND", "")
    TF_BIAS: str = os.getenv("TF_BIAS", "")

    # ── Loop ─────────────────────────────────────────────────────
    LOOP_INTERVAL_SECONDS: int = int(os.getenv("LOOP_INTERVAL_SECONDS", "300"))

    # ── Watchlist ────────────────────────────────────────────────
    GOLD_SYMBOL: str = os.getenv("GOLD_SYMBOL", "XAUUSDm")
    BTC_SYMBOL: str = os.getenv("BTC_SYMBOL", "BTCUSDm")
    WATCHLIST: list[str] = os.getenv(
        "WATCHLIST", "XAUUSDm,BTCUSDm"
    ).split(",")

    # ── Risk management (non-negotiable) ─────────────────────────
    MAX_RISK_GOLD: float = float(os.getenv("MAX_RISK_GOLD", "0.75"))  # %
    MAX_RISK_BTC: float = float(os.getenv("MAX_RISK_BTC", "0.5"))     # %
    VOLATILITY_SIZE_REDUCTION: float = 0.30  # 30% reduction
    ATR_VOLATILITY_THRESHOLD: float = 1.5    # x average ATR
    DAILY_DRAWDOWN_LIMIT: float = float(os.getenv("DAILY_DD_LIMIT", "3.0"))  # %
    WEEKLY_DRAWDOWN_LIMIT: float = float(os.getenv("WEEKLY_DD_LIMIT", "8.0"))  # %
    MAX_OPEN_POSITIONS: int = int(os.getenv("MAX_OPEN_POSITIONS", "5"))
    MAX_SAME_SYMBOL: int = 1
    MIN_RR_RATIO: float = float(os.getenv("MIN_RR_RATIO", "1.5"))
    CONFIDENCE_THRESHOLD: float = float(os.getenv("CONFIDENCE_THRESHOLD", "65.0"))
    DEVIL_ADVOCATE_RANGE: tuple = (65.0, 75.0)

    # Consecutive loss circuit breaker
    CONSEC_LOSS_2_SIZE_REDUCTION: float = 0.25  # -25%
    CONSEC_LOSS_3_SIZE_REDUCTION: float = 0.50  # -50%
    CONSEC_LOSS_3_MIN_CONFIDENCE: float = 75.0
    CONSEC_LOSS_RESET_WINS: int = 2  # reset after N consecutive wins

    # ── Position management ──────────────────────────────────────
    SL_ATR_MULTIPLIER: float = float(os.getenv("SL_ATR_MULT", "1.5"))
    TP_ATR_MULTIPLIER: float = float(os.getenv("TP_ATR_MULT", "2.25"))  # 1.5 RR
    PARTIAL_EXIT_AT_1R: float = 0.50  # close 50% at 1R
    TRAILING_STOP_ATR_TRIGGER: float = 1.0   # activate trailing at 1x ATR profit
    TRAILING_STOP_ATR_DISTANCE: float = 0.5  # trail by 0.5x ATR
    MAX_HOLD_HOURS_GOLD: int = int(os.getenv("MAX_HOLD_HOURS_GOLD", "8"))
    MAX_HOLD_HOURS_BTC: int = int(os.getenv("MAX_HOLD_HOURS_BTC", "12"))

    # ── Execution ────────────────────────────────────────────────
    LIMIT_ORDER_OFFSET_PIPS: float = float(os.getenv("LIMIT_OFFSET_PIPS", "2.5"))
    LIMIT_ORDER_TIMEOUT_SECONDS: int = 60
    ORDER_RETRIES: int = 3
    MAGIC_NUMBER: int = 200000  # V2 agent uses different magic number

    # ── Session windows (UTC hours) ─────────────────────────────
    SESSIONS = {
        "SYDNEY":   (21, 6),   # 21:00 - 06:00 UTC
        "TOKYO":    (0, 9),    # 00:00 - 09:00 UTC
        "LONDON":   (7, 16),   # 07:00 - 16:00 UTC
        "NEW_YORK": (12, 21),  # 12:00 - 21:00 UTC
    }
    # Gold: only trade London open (08-10) and NY open (13-15)
    GOLD_TRADE_WINDOWS = [(8, 10), (13, 15)]  # UTC hours
    # BTC: reduce size on weekends
    BTC_WEEKEND_SIZE_REDUCTION: float = 0.30  # -30%

    # ── News blackout ────────────────────────────────────────────
    NEWS_BLACKOUT_MINUTES: int = int(os.getenv("NEWS_BLACKOUT_MINUTES", "15"))
    HIGH_IMPACT_EVENTS = ["NFP", "FOMC", "CPI", "GDP", "Powell"]

    # ── Macro correlation rules ──────────────────────────────────
    DXY_BLOCK_THRESHOLD: float = float(os.getenv("DXY_BLOCK_THRESHOLD", "0.5"))
    FUNDING_RATE_BLOCK: float = float(os.getenv("FUNDING_BLOCK", "0.001"))  # 0.1%
    VIX_HIGH_THRESHOLD: float = 30.0

    # ── Environment ──────────────────────────────────────────────
    ENV: str = os.getenv("AGENT_ENV", "demo")  # "demo" or "live"
    PROMPT_VERSION: str = os.getenv("PROMPT_VERSION", "v1.0")

    # ── Withdrawal ───────────────────────────────────────────────
    WITHDRAWAL_MULTIPLIER: float = 2.5
    WITHDRAWAL_KEEP_MULTIPLIER: float = 1.5

    @classmethod
    def get_timeframes(cls) -> dict:
        """Get active timeframe set based on mode or overrides."""
        mode_tfs = cls.TIMEFRAME_MODES.get(cls.TIMEFRAME_MODE, cls.TIMEFRAME_MODES["intraday"])
        return {
            "entry": cls.TF_ENTRY or mode_tfs["entry"],
            "trend": cls.TF_TREND or mode_tfs["trend"],
            "bias":  cls.TF_BIAS or mode_tfs["bias"],
        }

    @classmethod
    def max_risk_for_symbol(cls, symbol: str) -> float:
        """Get max risk % for a given symbol."""
        sym = symbol.upper()
        if "XAU" in sym or "GOLD" in sym:
            return cls.MAX_RISK_GOLD
        if "BTC" in sym:
            return cls.MAX_RISK_BTC
        return 0.5  # default conservative

    @classmethod
    def max_hold_hours(cls, symbol: str) -> int:
        """Get max hold time for a symbol."""
        sym = symbol.upper()
        if "XAU" in sym or "GOLD" in sym:
            return cls.MAX_HOLD_HOURS_GOLD
        if "BTC" in sym:
            return cls.MAX_HOLD_HOURS_BTC
        return 8  # default
