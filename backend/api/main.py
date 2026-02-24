"""
FastAPI backend — REST API for MasstTrader.
"""
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel, Field
from typing import Optional
import asyncio
from concurrent.futures import ThreadPoolExecutor
import json
import logging
import math
import sys
import os
import threading

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

logger = logging.getLogger("massttrader")


def sanitize_for_json(obj):
    """Recursively replace NaN/Inf with None and convert numpy types for JSON."""
    import numpy as np
    if isinstance(obj, dict):
        return {k: sanitize_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [sanitize_for_json(v) for v in obj]
    elif isinstance(obj, (np.bool_,)):
        return bool(obj)
    elif isinstance(obj, (np.integer,)):
        return int(obj)
    elif isinstance(obj, (np.floating,)):
        val = float(obj)
        return None if math.isnan(val) or math.isinf(val) else val
    elif isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    return obj

from backend.database import (
    init_db, save_strategy, list_strategies, get_strategy,
    update_strategy, delete_strategy, save_backtest, list_backtests, get_backtest,
    save_algo_trade, close_algo_trade, close_algo_trade_by_ticket,
    get_algo_trade, get_open_algo_trade, list_algo_trades, get_algo_trade_stats,
)
from backend.core.ml_filter import predict_confidence, get_model_status, reload_model, load_model as load_ml_model
from backend.core.lstm_predictor import (
    predict_direction as lstm_predict_direction,
    get_lstm_status,
    load_lstm_model,
    reload_lstm_model,
    train_lstm,
)
from backend.database import list_training_runs, save_training_run
from config.settings import settings

app = FastAPI(title="MasstTrader API", version="1.0.0")

# Initialize SQLite database
init_db()

# Pre-load ML models (if exist)
load_ml_model()
load_lstm_model()

# ── CORS — restrict to known origins ──
_cors_origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── API-key auth (single middleware for all routes) ──
_API_KEY = settings.API_KEY


class APIKeyMiddleware(BaseHTTPMiddleware):
    """Reject requests without a valid API key. Skips /api/health and when API_KEY is unset."""
    async def dispatch(self, request: Request, call_next):
        if _API_KEY and request.url.path != "/api/health":
            key = request.headers.get("x-api-key") or request.query_params.get("api_key")
            if key != _API_KEY:
                return JSONResponse({"detail": "Invalid or missing API key"}, status_code=401)
        return await call_next(request)


app.add_middleware(APIKeyMiddleware)

# ── Global state ──
connector = None
historical_data = None
current_strategy = None
backtest_results = None
trade_history = None


# ── Multi-instance algo trading ──

def _make_algo_state(symbol=None, timeframe="5m", strategy_name=None, strategy_id=None, volume=0.01):
    """Create a fresh per-instance algo state dict."""
    return {
        "running": True,
        "symbol": symbol,
        "timeframe": timeframe,
        "strategy_name": strategy_name,
        "strategy_id": strategy_id,
        "volume": volume,
        "signals": [],
        "trades_placed": 0,
        "in_position": False,
        "position_ticket": None,
        "current_price": None,
        "indicators": {},
        "entry_conditions": [],
        "exit_conditions": [],
        "last_check": None,
        "strategy_rules": None,
        "active_rule_index": 0,
        "trade_state": None,
        "current_algo_trade_id": None,
        "ml_confidence": None,
    }


class AlgoInstance:
    """One algo running on one symbol."""
    __slots__ = ("state", "thread", "stop_event")

    def __init__(self, symbol: str, timeframe: str, volume: float,
                 strategy_name: str, strategy_id: str | None):
        self.state = _make_algo_state(symbol, timeframe, strategy_name, strategy_id, volume)
        self.thread: threading.Thread | None = None
        self.stop_event = threading.Event()


# Registry: symbol → AlgoInstance (one algo per symbol)
algo_instances: dict[str, AlgoInstance] = {}
_instances_lock = threading.Lock()


# ── Request/Response Models ──
class MT5LoginRequest(BaseModel):
    login: Optional[int] = None
    password: Optional[str] = None
    server: Optional[str] = None
    mt5_path: Optional[str] = None


class FetchDataRequest(BaseModel):
    symbol: str
    timeframe: str = "5m"
    bars: int = 500


class StrategyRequest(BaseModel):
    description: str
    symbol: str = "EURUSD"


class BacktestRequest(BaseModel):
    initial_balance: float = 10000.0
    risk_percent: float = 1.0
    strategy_id: Optional[str] = None
    timeframe: str = "1h"
    bars: int = 2000


class TradeAnalyzeRequest(BaseModel):
    symbol: str
    trade_type: str
    entry_price: float
    exit_price: float
    profit: float
    open_time: str
    close_time: str
    indicators_at_entry: dict
    strategy_id: Optional[str] = None


class PlaceTradeRequest(BaseModel):
    symbol: str
    trade_type: str
    volume: float = Field(gt=0, le=1.0, description="Lot size (max 1.0)")
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None


class AlgoStartRequest(BaseModel):
    symbol: str = "EURUSDm"
    timeframe: str = "5m"
    volume: float = Field(default=0.01, gt=0, le=1.0, description="Lot size (max 1.0)")
    strategy_id: Optional[str] = None


class CreateStrategyRequest(BaseModel):
    name: str
    symbol: str
    rules: list
    raw_description: str = ""
    ai_explanation: str = ""


class LessonRequest(BaseModel):
    topic: str
    level: str = "intermediate"
    instruments: list[str] = ["EURUSD"]


# ──────────────────────────────────────
# MT5 CONNECTION ENDPOINTS
# ──────────────────────────────────────

@app.post("/api/mt5/connect")
def mt5_connect(req: MT5LoginRequest):
    global connector

    # Fall back to .env values when not provided
    login = req.login or (int(settings.MT5_LOGIN) if settings.MT5_LOGIN else None)
    password = req.password or settings.MT5_PASSWORD or None
    server = req.server or settings.MT5_SERVER or None
    mt5_path = req.mt5_path or settings.MT5_PATH or None

    if not login or not password or not server:
        raise HTTPException(status_code=400, detail="MT5 credentials not provided and not configured in .env")

    result_box = [None]
    error_box = [None]

    def _connect():
        try:
            from backend.services.mt5_connector import MT5Connector
            c = MT5Connector()
            r = c.connect(
                login=login,
                password=password,
                server=server,
                mt5_path=mt5_path,
            )
            result_box[0] = (c, r)
        except Exception as e:
            error_box[0] = e

    thread = threading.Thread(target=_connect)
    thread.start()
    thread.join(timeout=20)

    if thread.is_alive():
        raise HTTPException(status_code=408, detail="MT5 connection timed out — make sure MT5 terminal is running")
    if error_box[0]:
        logger.error("MT5 connect failed: %s", error_box[0])
        raise HTTPException(status_code=400, detail="MT5 connection failed")

    connector, result = result_box[0]
    return {"success": True, **result}


@app.post("/api/mt5/disconnect")
def mt5_disconnect():
    global connector
    if connector:
        connector.disconnect()
        connector = None
    return {"success": True}


@app.get("/api/mt5/account")
def mt5_account():
    if not connector or not connector.is_connected:
        raise HTTPException(status_code=400, detail="Not connected to MT5")
    try:
        return connector.get_account_info()
    except Exception as e:
        logger.error("Account info failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to get account info")


@app.get("/api/mt5/positions")
def mt5_positions():
    if not connector or not connector.is_connected:
        raise HTTPException(status_code=400, detail="Not connected to MT5")
    try:
        return connector.get_positions()
    except Exception as e:
        logger.error("Positions failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to get positions")


@app.get("/api/mt5/symbols")
def mt5_symbols(group: str = None):
    if not connector or not connector.is_connected:
        raise HTTPException(status_code=400, detail="Not connected to MT5")
    try:
        return connector.get_symbols(group=group)
    except Exception as e:
        logger.error("Symbols failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to get symbols")


@app.get("/api/mt5/price/{symbol}")
def mt5_price(symbol: str):
    if not connector or not connector.is_connected:
        raise HTTPException(status_code=400, detail="Not connected to MT5")
    try:
        connector.select_symbol(symbol)
        return connector.get_symbol_price(symbol)
    except Exception as e:
        logger.error("Price failed for %s: %s", symbol, e)
        raise HTTPException(status_code=500, detail="Failed to get price")


@app.post("/api/mt5/trade")
def mt5_place_trade(req: PlaceTradeRequest):
    if not connector or not connector.is_connected:
        raise HTTPException(status_code=400, detail="Not connected to MT5")
    try:
        return connector.place_trade(
            symbol=req.symbol,
            trade_type=req.trade_type,
            volume=req.volume,
            stop_loss=req.stop_loss,
            take_profit=req.take_profit,
        )
    except Exception as e:
        logger.error("Trade failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to place trade")


@app.post("/api/mt5/close/{ticket}")
def mt5_close_position(ticket: int):
    if not connector or not connector.is_connected:
        raise HTTPException(status_code=400, detail="Not connected to MT5")
    try:
        return connector.close_position(ticket)
    except Exception as e:
        logger.error("Close position failed for %s: %s", ticket, e)
        raise HTTPException(status_code=500, detail="Failed to close position")


# ──────────────────────────────────────
# DATA ENDPOINTS
# ──────────────────────────────────────

@app.post("/api/data/fetch")
def fetch_data(req: FetchDataRequest):
    global historical_data
    if not connector or not connector.is_connected:
        raise HTTPException(status_code=400, detail="Not connected to MT5")
    try:
        from backend.core.indicators import add_all_indicators
        connector.select_symbol(req.symbol)
        df = connector.get_history(req.symbol, req.timeframe, req.bars)
        df = add_all_indicators(df)
        historical_data = df

        # Convert to JSON-friendly format
        df_reset = df.reset_index()
        df_reset["datetime"] = df_reset["datetime"].astype(str)
        data = {
            "candles": df_reset.to_dict(orient="records"),
            "count": len(df),
            "columns": list(df.columns),
        }
        return JSONResponse(content=sanitize_for_json(data))
    except Exception as e:
        logger.error("Data fetch failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch data")


def _load_demo_data():
    """Generate demo EURUSD data and store in historical_data global."""
    global historical_data
    import numpy as np
    import pandas as pd
    from backend.core.indicators import add_all_indicators

    np.random.seed(42)
    n = 1000
    dates = pd.date_range("2024-01-01", periods=n, freq="5min")
    close = 1.1000 + np.cumsum(np.random.randn(n) * 0.0003)
    high = close + np.abs(np.random.randn(n) * 0.0002)
    low = close - np.abs(np.random.randn(n) * 0.0002)
    open_price = close + np.random.randn(n) * 0.0001
    volume = np.random.randint(100, 10000, n).astype(float)

    df = pd.DataFrame({
        "datetime": dates[:len(close)],
        "open": open_price,
        "high": high,
        "low": low,
        "close": close,
        "volume": volume,
    }).set_index("datetime")

    df = add_all_indicators(df)
    historical_data = df


@app.post("/api/data/demo")
def load_demo_data():
    _load_demo_data()
    df_reset = historical_data.reset_index()
    df_reset["datetime"] = df_reset["datetime"].astype(str)
    data = {
        "candles": df_reset.to_dict(orient="records"),
        "count": len(historical_data),
        "columns": list(historical_data.columns),
    }
    return JSONResponse(content=sanitize_for_json(data))


@app.get("/api/data/history")
def get_trade_history(days: int = 30):
    global trade_history
    if not connector or not connector.is_connected:
        raise HTTPException(status_code=400, detail="Not connected to MT5")
    try:
        trades = connector.get_trade_history(days=days)
        trade_history = trades
        return trades
    except Exception as e:
        logger.error("Trade history failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to get trade history")


@app.get("/api/data/trades")
def get_paired_trades(symbol: str = "", days: int = 30):
    """Return paired trades (entry + exit) for a symbol. Each trade has entry/exit price, P&L, times."""
    if not connector or not connector.is_connected:
        raise HTTPException(status_code=400, detail="Not connected to MT5")
    try:
        if symbol:
            deals = connector.get_trade_history_by_symbol(symbol, days=days)
        else:
            deals = connector.get_trade_history(days=days)

        # Group deals by position_id, then pair entry ("in") and exit ("out")
        from collections import defaultdict
        by_pos: dict[int, dict] = defaultdict(lambda: {"entry": None, "exit": None})
        for d in deals:
            pos_id = d.get("position_id")
            if not pos_id:
                continue
            if d["entry"] == "in":
                by_pos[pos_id]["entry"] = d
            elif d["entry"] == "out":
                by_pos[pos_id]["exit"] = d

        paired = []
        for pos_id, pair in sorted(by_pos.items()):
            entry_deal = pair["entry"]
            exit_deal = pair["exit"]
            if not entry_deal:
                continue  # skip orphan exits

            trade: dict = {
                "position_id": pos_id,
                "symbol": entry_deal["symbol"],
                "direction": entry_deal["type"],  # buy or sell
                "volume": entry_deal["volume"],
                "entry_price": entry_deal["price"],
                "entry_time": entry_deal["time"],
                "exit_price": exit_deal["price"] if exit_deal else None,
                "exit_time": exit_deal["time"] if exit_deal else None,
                "profit": exit_deal["profit"] if exit_deal else None,
                "commission": (entry_deal.get("commission", 0) or 0) + (exit_deal.get("commission", 0) or 0 if exit_deal else 0),
                "swap": exit_deal.get("swap", 0) if exit_deal else 0,
                "closed": exit_deal is not None,
                "comment": exit_deal.get("comment", "") if exit_deal else entry_deal.get("comment", ""),
            }
            # Net P&L = profit + commission + swap
            if trade["profit"] is not None:
                trade["net_pnl"] = round(trade["profit"] + trade["commission"] + trade["swap"], 2)
            else:
                trade["net_pnl"] = None
            paired.append(trade)

        # Sort by entry time descending (newest first)
        paired.sort(key=lambda t: t["entry_time"], reverse=True)
        return paired
    except Exception as e:
        logger.error("Paired trades failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to get paired trades")


# ──────────────────────────────────────
# STRATEGY ENDPOINTS
# ──────────────────────────────────────

@app.post("/api/strategy/parse")
def parse_strategy_endpoint(req: StrategyRequest):
    global current_strategy
    try:
        from backend.services.ai_service import parse_strategy
        result = parse_strategy(req.description, req.symbol)
        result["symbol"] = req.symbol
        result["raw_description"] = req.description
        current_strategy = result
        return result
    except Exception as e:
        logger.error("Strategy parse failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to parse strategy")


@app.get("/api/strategy/current")
def get_current_strategy():
    if not current_strategy:
        raise HTTPException(status_code=404, detail="No strategy loaded")
    return current_strategy


# ──────────────────────────────────────
# STRATEGY PERSISTENCE (CRUD)
# ──────────────────────────────────────

@app.post("/api/strategies")
def save_strategy_endpoint():
    if not current_strategy:
        raise HTTPException(status_code=400, detail="No strategy loaded. Parse one first.")
    saved = save_strategy(current_strategy)
    return saved


@app.post("/api/strategies/create")
def create_strategy_endpoint(req: CreateStrategyRequest):
    """Create a strategy directly from a JSON body (no AI parse needed)."""
    strategy_data = {
        "name": req.name,
        "symbol": req.symbol,
        "rules": req.rules,
        "raw_description": req.raw_description,
        "ai_explanation": req.ai_explanation,
    }
    saved = save_strategy(strategy_data)
    return saved


@app.get("/api/strategies")
def list_strategies_endpoint():
    strategies = list_strategies()
    result = []
    for s in strategies:
        rules = s.get("rules", [])
        first_rule = rules[0] if rules else {}
        result.append({
            "id": s["id"],
            "name": s["name"],
            "symbol": s["symbol"],
            "timeframe": first_rule.get("timeframe", ""),
            "direction": first_rule.get("direction", "buy"),
            "entry_conditions": first_rule.get("entry_conditions", []),
            "exit_conditions": first_rule.get("exit_conditions", []),
            "stop_loss_pips": first_rule.get("stop_loss_pips"),
            "take_profit_pips": first_rule.get("take_profit_pips"),
            "stop_loss_atr_multiplier": first_rule.get("stop_loss_atr_multiplier"),
            "take_profit_atr_multiplier": first_rule.get("take_profit_atr_multiplier"),
            "min_bars_in_trade": first_rule.get("min_bars_in_trade"),
            "additional_timeframes": first_rule.get("additional_timeframes"),
            "rule_count": len(rules),
            "created_at": s["created_at"],
            "updated_at": s["updated_at"],
        })
    return result


@app.get("/api/strategies/{strategy_id}")
def get_strategy_endpoint(strategy_id: str):
    s = get_strategy(strategy_id)
    if not s:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return s


@app.put("/api/strategies/{strategy_id}")
def update_strategy_endpoint(strategy_id: str):
    if not current_strategy:
        raise HTTPException(status_code=400, detail="No strategy loaded. Parse an updated version first.")
    updated = update_strategy(strategy_id, current_strategy)
    if not updated:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return updated


@app.delete("/api/strategies/{strategy_id}")
def delete_strategy_endpoint(strategy_id: str):
    deleted = delete_strategy(strategy_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return {"success": True}


@app.post("/api/strategies/{strategy_id}/load")
def load_strategy_endpoint(strategy_id: str):
    global current_strategy
    s = get_strategy(strategy_id)
    if not s:
        raise HTTPException(status_code=404, detail="Strategy not found")
    current_strategy = s
    return s


# ──────────────────────────────────────
# STRATEGY VALIDATION
# ──────────────────────────────────────

@app.post("/api/strategy/validate")
def validate_strategy_endpoint():
    """Check a strategy for common issues before going live."""
    warnings = []
    errors = []

    strategy = current_strategy
    if not strategy:
        errors.append("No strategy loaded")
        return {"errors": errors, "warnings": warnings, "valid": False}

    for i, rule in enumerate(strategy.get("rules", [])):
        prefix = f"Rule {i+1}"

        for ctype in ("entry_conditions", "exit_conditions"):
            for c in rule.get(ctype, []):
                ind = c.get("indicator", "")
                val = c.get("value")
                op = c.get("operator", "")
                # EMA/SMA > 0 is meaningless (always true for positive prices)
                if ind.startswith(("EMA", "SMA")) and val == 0 and op in (">", ">="):
                    errors.append(f"{prefix}: '{ind} {op} 0' is always true — use 'close {op} {ind}' instead")
                # ATR < 0 is impossible (ATR is always positive)
                if ind == "ATR" and op == "<" and isinstance(val, (int, float)) and val <= 0:
                    errors.append(f"{prefix}: 'ATR < {val}' is always false — ATR is always positive")

        # Missing exit conditions and no SL
        if not rule.get("exit_conditions") and not rule.get("stop_loss_pips") and not rule.get("stop_loss_atr_multiplier"):
            errors.append(f"{prefix}: No exit conditions and no stop loss — unlimited risk")

        # No SL at all
        if not rule.get("stop_loss_pips") and not rule.get("stop_loss_atr_multiplier"):
            warnings.append(f"{prefix}: No stop loss defined — relying only on exit conditions")

        # No TP
        if not rule.get("take_profit_pips") and not rule.get("take_profit_atr_multiplier"):
            warnings.append(f"{prefix}: No take profit defined")

    return {"errors": errors, "warnings": warnings, "valid": len(errors) == 0}


# ──────────────────────────────────────
# BACKTEST ENDPOINTS
# ──────────────────────────────────────

@app.post("/api/backtest/run")
def run_backtest_endpoint(req: BacktestRequest):
    global backtest_results, current_strategy, historical_data

    # If strategy_id provided, load from DB
    if req.strategy_id:
        saved = get_strategy(req.strategy_id)
        if not saved:
            raise HTTPException(status_code=404, detail="Strategy not found")
        current_strategy = saved

    if not current_strategy:
        raise HTTPException(status_code=400, detail="No strategy loaded. Parse one first.")

    # Fetch real MT5 data if connected, otherwise fall back to demo
    if connector and connector.is_connected:
        try:
            from backend.core.indicators import add_all_indicators
            bt_symbol = current_strategy.get("symbol", "EURUSDm")
            connector.select_symbol(bt_symbol)
            df_fresh = connector.get_history(bt_symbol, req.timeframe, req.bars)
            df_fresh = add_all_indicators(df_fresh)
            historical_data = df_fresh
        except Exception:
            if historical_data is None:
                _load_demo_data()
    elif historical_data is None:
        _load_demo_data()

    try:
        from backend.core.backtester import run_backtest

        df = historical_data.copy()
        if "datetime" not in df.columns:
            df = df.reset_index()

        rules = current_strategy.get("rules", [])
        if not rules:
            raise HTTPException(status_code=400, detail="Strategy has no rules")

        # Multi-TF: merge higher-timeframe indicator values into primary df
        additional_tfs = rules[0].get("additional_timeframes") or []
        if additional_tfs and connector and connector.is_connected:
            from backend.core.indicators import add_all_indicators as _add_ind
            for atf in additional_tfs:
                try:
                    df_atf = connector.get_history(bt_symbol, atf, req.bars)
                    df_atf = _add_ind(df_atf)
                    df_atf = df_atf.dropna()
                    if len(df_atf) > 0:
                        last_atf = df_atf.iloc[-1]
                        for col in df_atf.columns:
                            if col not in ("open", "high", "low", "close", "volume", "datetime", "index"):
                                df[f"{col}_{atf}"] = last_atf[col]
                except Exception:
                    pass

        result = run_backtest(
            df, rules[0],
            initial_balance=req.initial_balance,
            risk_per_trade=req.risk_percent,
        )

        # Include candle data for the chart
        candle_cols = ["datetime", "open", "high", "low", "close", "volume"]
        candles_for_chart = []
        for _, row in df.iterrows():
            candle = {}
            for col in candle_cols:
                if col in row.index:
                    candle[col] = row[col] if col == "datetime" else float(row[col])
                    if col == "datetime":
                        candle[col] = str(candle[col])
            candles_for_chart.append(candle)
        result["candles"] = candles_for_chart

        result = sanitize_for_json(result)
        backtest_results = result

        # Auto-save to DB if strategy has an id
        if current_strategy.get("id"):
            save_backtest(
                strategy_id=current_strategy["id"],
                strategy_name=current_strategy.get("name", ""),
                symbol=current_strategy.get("symbol", ""),
                initial_balance=req.initial_balance,
                risk_percent=req.risk_percent,
                result=result,
            )

        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Backtest run failed: %s", e)
        raise HTTPException(status_code=500, detail="Backtest failed")


@app.post("/api/backtest/explain")
def explain_backtest_endpoint():
    if not backtest_results or not current_strategy:
        raise HTTPException(status_code=400, detail="Run a backtest first")
    try:
        from backend.services.ai_service import explain_backtest
        explanation = explain_backtest(
            backtest_results["stats"],
            backtest_results["trades"],
            current_strategy,
        )
        return {"explanation": explanation}
    except Exception as e:
        logger.error("Backtest explain failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to explain backtest")


# ──────────────────────────────────────
# BACKTEST HISTORY ENDPOINTS
# ──────────────────────────────────────

@app.get("/api/backtests")
def list_backtests_endpoint(strategy_id: Optional[str] = None):
    return list_backtests(strategy_id)


@app.get("/api/backtests/{backtest_id}")
def get_backtest_endpoint(backtest_id: str):
    bt = get_backtest(backtest_id)
    if not bt:
        raise HTTPException(status_code=404, detail="Backtest not found")
    return bt


# ──────────────────────────────────────
# TRADE ANALYZER ENDPOINTS
# ──────────────────────────────────────

@app.post("/api/analyze/trade")
def analyze_trade_endpoint(req: TradeAnalyzeRequest):
    global current_strategy

    # Load strategy from DB if strategy_id provided
    strategy = current_strategy
    if req.strategy_id:
        saved = get_strategy(req.strategy_id)
        if not saved:
            raise HTTPException(status_code=404, detail="Strategy not found")
        strategy = saved
        current_strategy = saved

    if not strategy:
        raise HTTPException(
            status_code=400,
            detail="No strategy selected. Pick a saved strategy or parse one first."
        )
    try:
        from backend.services.ai_service import analyze_trade
        trade = {
            "symbol": req.symbol,
            "trade_type": req.trade_type,
            "entry_price": req.entry_price,
            "exit_price": req.exit_price,
            "profit": req.profit,
            "open_time": req.open_time,
            "close_time": req.close_time,
        }
        result = analyze_trade(strategy, trade, req.indicators_at_entry)
        return result
    except Exception as e:
        logger.error("Trade analysis failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to analyze trade")


# ──────────────────────────────────────
# AI TUTOR ENDPOINTS
# ──────────────────────────────────────

@app.post("/api/tutor/lesson")
def get_lesson_endpoint(req: LessonRequest):
    try:
        from backend.services.ai_service import get_lesson
        lesson = get_lesson(
            topic=req.topic,
            trader_level=req.level,
            instruments=req.instruments,
        )
        return {"lesson": lesson}
    except Exception as e:
        logger.error("Lesson generation failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to generate lesson")


# ──────────────────────────────────────
# ALGO TRADING ENGINE
# ──────────────────────────────────────

def _add_signal(state: dict, action: str, detail: str):
    """Append a signal entry to an algo instance state dict (keep last 50)."""
    from datetime import datetime, timezone
    state["signals"].append({
        "time": datetime.now(timezone.utc).isoformat(),
        "action": action,
        "detail": detail,
    })
    if len(state["signals"]) > 50:
        state["signals"] = state["signals"][-50:]


def _calculate_lot_size(equity, risk_percent, sl_distance, tick_value, tick_size, volume_min, volume_max, volume_step):
    """Calculate dynamic lot size based on equity, risk %, and SL distance."""
    if sl_distance <= 0 or tick_size <= 0 or tick_value <= 0:
        return volume_min
    risk_amount = equity * (risk_percent / 100.0)
    ticks_in_sl = sl_distance / tick_size
    value_per_lot = ticks_in_sl * tick_value
    lots = risk_amount / value_per_lot if value_per_lot > 0 else volume_min
    lots = round(lots / volume_step) * volume_step
    return max(volume_min, min(volume_max, round(lots, 8)))


def _get_mt5_exit_pnl(ticket, symbol):
    """Fetch exit price and P&L from MT5 deal history for a just-closed position."""
    try:
        deals = connector.get_trade_history_by_symbol(symbol, days=1)
        for d in deals:
            if d["entry"] == "out" and d.get("position_id") == ticket:
                profit = d.get("profit", 0) or 0
                commission = d.get("commission", 0) or 0
                swap = d.get("swap", 0) or 0
                return {
                    "exit_price": d["price"],
                    "profit": profit,
                    "commission": commission,
                    "swap": swap,
                    "net_pnl": round(profit + commission + swap, 2),
                }
    except Exception:
        pass
    return {"exit_price": None, "profit": None, "commission": None, "swap": None, "net_pnl": None}


def _determine_exit_reason(ticket, symbol, trade_state):
    """Determine whether a position was closed by SL, TP, or externally."""
    try:
        deals = connector.get_trade_history_by_symbol(symbol, days=1)
        for d in deals:
            if d["entry"] == "out" and d.get("position_id") == ticket:
                exit_price = d["price"]
                if trade_state:
                    sl = trade_state.get("sl_price")
                    tp = trade_state.get("tp_price")
                    # Absolute tolerance: scales with price magnitude
                    tol = max(abs(exit_price) * 1e-5, 1e-5)
                    if sl is not None and abs(exit_price - sl) <= tol:
                        return "stop_loss"
                    if tp is not None and abs(exit_price - tp) <= tol:
                        return "take_profit"
                return "external"
    except Exception:
        pass
    return "external"


def _record_algo_trade_exit(state: dict, exit_indicators, exit_reason, bars_held, symbol, ticket):
    """Close the current algo trade record in DB with exit data."""
    trade_id = state.get("current_algo_trade_id")
    if not trade_id:
        return
    pnl_data = _get_mt5_exit_pnl(ticket, symbol)
    from datetime import datetime, timezone
    close_algo_trade(trade_id, sanitize_for_json({
        "exit_price": pnl_data.get("exit_price"),
        "exit_time": datetime.now(timezone.utc).isoformat(),
        "exit_indicators": exit_indicators,
        "exit_reason": exit_reason,
        "bars_held": bars_held,
        "profit": pnl_data.get("profit"),
        "commission": pnl_data.get("commission"),
        "swap": pnl_data.get("swap"),
        "net_pnl": pnl_data.get("net_pnl"),
    }))
    state["current_algo_trade_id"] = None


def _algo_loop(instance: AlgoInstance, strategy: dict, symbol: str, timeframe: str, volume: float):
    """Background thread: monitors market and trades based on strategy rules."""
    from backend.core.indicators import add_all_indicators, get_indicator_snapshot
    from backend.core.backtester import evaluate_condition, _resolve_column
    from datetime import datetime, timezone

    state = instance.state
    stop_ev = instance.stop_event

    # Helper: call MT5 safely from algo thread using the global lock.
    # No executor needed — the lock serialises with SSE/WS calls.
    def _mt5(fn, *args, **kwargs):
        fname = getattr(fn, '__name__', str(fn))
        print(f"[ALGO] _mt5 calling {fname}...", flush=True)
        result = _safe_mt5_call(fn, *args, **kwargs)
        print(f"[ALGO] _mt5 {fname} done", flush=True)
        return result

    try:
        print(f"[ALGO] Thread started for {symbol}/{timeframe}", flush=True)
        rules = strategy.get("rules", [])
        if not rules:
            _add_signal(state, "error", "Strategy has no rules")
            return

        if len(rules) > 1:
            _add_signal(state, "info", f"Strategy has {len(rules)} rules — using first rule (multi-rule not yet supported)")
        rule = rules[0]
        entry_conditions = rule.get("entry_conditions", [])
        exit_conditions = rule.get("exit_conditions", [])
        sl_pips = rule.get("stop_loss_pips")
        tp_pips = rule.get("take_profit_pips")
        sl_atr_mult = rule.get("stop_loss_atr_multiplier")
        tp_atr_mult = rule.get("take_profit_atr_multiplier")
        min_bars = rule.get("min_bars_in_trade") or 0
        risk_percent = rule.get("risk_percent", 1.0)
        additional_tfs = rule.get("additional_timeframes") or []
        direction = rule.get("direction", "buy")  # "buy" or "sell"
        state["strategy_rules"] = rule

        # Strategy context for DB trade recording
        strategy_id = strategy.get("id")  # None for in-memory strategies
        strategy_name = strategy.get("name", "Unknown")
        rule_name = rule.get("name", "")
        rule_index = 0

        print(f"[ALGO] About to select_symbol {symbol}", flush=True)
        _mt5(connector.select_symbol, symbol)
        print(f"[ALGO] select_symbol done", flush=True)

        # Get pip value and symbol sizing info
        try:
            sym_info = _mt5(connector.get_symbol_info, symbol)
            pip_value = sym_info["point"] * 10
            tick_value = sym_info.get("trade_tick_value", 0.00001)
            tick_size = sym_info.get("trade_tick_size", 0.00001)
            vol_min = sym_info.get("volume_min", 0.01)
            vol_max = sym_info.get("volume_max", 100.0)
            vol_step = sym_info.get("volume_step", 0.01)
        except Exception:
            pip_value = 0.0001
            tick_value = 0.00001
            tick_size = 0.00001
            vol_min = 0.01
            vol_max = 100.0
            vol_step = 0.01

        sl_mode = "ATR" if sl_atr_mult else ("pips" if sl_pips else "none")
        tp_mode = "ATR" if tp_atr_mult else ("pips" if tp_pips else "none")
        _add_signal(state, "start", f"Algo started: {symbol} / {timeframe} / {direction} / SL={sl_mode} TP={tp_mode} / risk={risk_percent}%")
        if additional_tfs:
            _add_signal(state, "info", f"Multi-TF enabled: {', '.join(additional_tfs)}")

        price_info = None
        check_count = 0
        last_candle_time = None
        bars_in_trade = 0
        last_cond_state = None  # for signal dedup

        # Check for existing open positions on this symbol (prevents stacking)
        try:
            existing_positions = _mt5(connector.get_positions)
            for pos in existing_positions:
                if pos["symbol"] == symbol:
                    state["in_position"] = True
                    state["position_ticket"] = pos["ticket"]
                    _add_signal(state, "info", f"Found existing position #{pos['ticket']} for {symbol} — resuming tracking")
                    # Build a partial trade_state from MT5 position
                    state["trade_state"] = sanitize_for_json({
                        "ticket": pos["ticket"],
                        "entry_price": pos["open_price"],
                        "sl_price": pos.get("stop_loss") or None,
                        "tp_price": pos.get("take_profit") or None,
                        "direction": pos.get("type", direction),
                        "volume": pos.get("volume", volume),
                        "entry_time": pos.get("open_time", ""),
                        "bars_since_entry": 0,
                        "atr_at_entry": None,
                        "sl_atr_mult": sl_atr_mult,
                        "tp_atr_mult": tp_atr_mult,
                    })
                    # Resume DB trade record if one exists for this ticket
                    try:
                        existing_db_trade = get_open_algo_trade(symbol)
                        if existing_db_trade and existing_db_trade.get("mt5_ticket") == pos["ticket"]:
                            state["current_algo_trade_id"] = existing_db_trade["id"]
                            _add_signal(state, "info", f"Resumed DB trade record {existing_db_trade['id'][:8]}")
                    except Exception:
                        pass
                    break
        except Exception:
            pass

        print(f"[ALGO] Entering main loop", flush=True)
        while not stop_ev.is_set():
            try:
                check_count += 1
                print(f"[ALGO] Loop iteration #{check_count}", flush=True)

                # Check if MT5 connection is still alive
                if connector is None or not connector.is_connected:
                    _add_signal(state, "error", "MT5 connection lost — stopping algo")
                    return

                # Get current price
                try:
                    price_info = _mt5(connector.get_symbol_price, symbol)
                    state["current_price"] = sanitize_for_json({
                        "bid": price_info["bid"],
                        "ask": price_info["ask"],
                        "spread": price_info["ask"] - price_info["bid"],
                    })
                except Exception as e:
                    _add_signal(state, "error", f"Price fetch failed: {e}")
                    stop_ev.wait(5)
                    continue

                # Fetch latest candles + indicators
                df = _mt5(connector.get_history, symbol, timeframe, 100)
                print(f"[ALGO] got {len(df)} bars, columns: {list(df.columns)[:5]}...", flush=True)
                df = add_all_indicators(df)
                print(f"[ALGO] indicators added, {len(df)} rows, {len(df.columns)} cols", flush=True)
                df = df.dropna().reset_index()
                print(f"[ALGO] after dropna: {len(df)} rows", flush=True)

                if len(df) < 2:
                    print(f"[ALGO] not enough rows ({len(df)}), waiting 10s", flush=True)
                    stop_ev.wait(10)
                    continue

                # Multi-TF: merge higher-timeframe indicator values
                for atf in additional_tfs:
                    try:
                        df_atf = _mt5(connector.get_history, symbol, atf, 100)
                        df_atf = add_all_indicators(df_atf)
                        df_atf = df_atf.dropna()
                        if len(df_atf) < 1:
                            continue
                        last_row_atf = df_atf.iloc[-1]
                        for col in df_atf.columns:
                            if col not in ("open", "high", "low", "close", "volume", "datetime", "index"):
                                df[f"{col}_{atf}"] = last_row_atf[col]  # broadcast scalar
                    except Exception as e:
                        _add_signal(state, "warn", f"Multi-TF {atf} failed: {e}")

                row = df.iloc[-1]
                prev_row = df.iloc[-2]

                # Track candle changes for min_bars counting
                current_candle_time = str(row.get("datetime", ""))
                if current_candle_time != last_candle_time:
                    last_candle_time = current_candle_time
                    if state["in_position"]:
                        bars_in_trade += 1

                # Update indicator snapshot
                state["indicators"] = sanitize_for_json(
                    get_indicator_snapshot(df, -1)
                )
                state["last_check"] = datetime.now(timezone.utc).isoformat()
                print(f"[ALGO] ✓ Tick #{check_count} complete, last_check set", flush=True)

                # Evaluate each entry condition individually and store results
                entry_results = []
                for c in entry_conditions:
                    passed = bool(evaluate_condition(row, prev_row, c))
                    entry_results.append({
                        "description": c.get("description", ""),
                        "indicator": c.get("indicator", ""),
                        "parameter": c.get("parameter", ""),
                        "operator": c.get("operator", ""),
                        "value": c.get("value"),
                        "passed": passed,
                    })
                state["entry_conditions"] = entry_results

                # Evaluate each exit condition individually
                exit_results = []
                for c in exit_conditions:
                    passed = bool(evaluate_condition(row, prev_row, c))
                    exit_results.append({
                        "description": c.get("description", ""),
                        "indicator": c.get("indicator", ""),
                        "parameter": c.get("parameter", ""),
                        "operator": c.get("operator", ""),
                        "value": c.get("value"),
                        "passed": passed,
                    })
                state["exit_conditions"] = exit_results

                # Log when conditions change (deduped) or every ~2min as heartbeat
                entry_pass = sum(1 for r in entry_results if r["passed"])
                entry_total = len(entry_results)
                bid = price_info["bid"]
                current_cond_state = tuple(r["passed"] for r in entry_results) + tuple(r["passed"] for r in exit_results)
                cond_changed = current_cond_state != last_cond_state
                is_heartbeat = check_count % 24 == 1  # every ~2min
                last_cond_state = current_cond_state

                if cond_changed or is_heartbeat:
                    pos_status = "IN_POSITION" if state["in_position"] else "WATCHING"
                    # Build per-condition detail string
                    cond_details = []
                    active_results = exit_results if state["in_position"] else entry_results
                    for r in active_results:
                        ind = r["indicator"]
                        param = r["parameter"]
                        col = _resolve_column(ind, param)
                        val = row.get(col, "?") if col in row.index else "?"
                        mark = "+" if r["passed"] else "-"
                        if isinstance(val, float):
                            val = f"{val:.2f}"
                        cond_details.append(f"{ind}.{param}={val}{mark}")
                    detail_str = " | ".join(cond_details) if cond_details else ""
                    tag = "check" if is_heartbeat and not cond_changed else "flip"
                    if state["in_position"]:
                        exit_pass = sum(1 for r in exit_results if r["passed"])
                        exit_total = len(exit_results)
                        bars_str = f" | bars={bars_in_trade}/{min_bars}" if min_bars > 0 else ""
                        _add_signal(state, tag, f"{pos_status} | bid={bid:.5f} | {detail_str} | exit {exit_pass}/{exit_total}{bars_str}")
                    else:
                        _add_signal(state, tag, f"{pos_status} | bid={bid:.5f} | {detail_str} | entry {entry_pass}/{entry_total}")

                if not state["in_position"]:
                    # Check if ALL entry conditions are met
                    all_entry = all(r["passed"] for r in entry_results)
                    ml_pass = True  # default: allow trade if no ML model
                    if all_entry and len(entry_conditions) > 0:
                        # ── ML Confidence Gate ──
                        ml_price = price_info["ask"] if direction == "buy" else price_info["bid"]
                        ml_result = predict_confidence(state["indicators"], direction, ml_price)
                        state["ml_confidence"] = sanitize_for_json(ml_result)
                        ml_pass = ml_result["pass"]

                        if not ml_pass:
                            _add_signal(state, "ml_skip",
                                f"ML filter blocked — confidence {ml_result['score']:.0%} < {ml_result['threshold']:.0%} threshold")
                        elif ml_result["model_loaded"]:
                            _add_signal(state, "ml_pass",
                                f"ML confidence {ml_result['score']:.0%} — proceeding with entry")

                    # ── LSTM Direction Prediction (informational) ──
                    lstm_result = {"direction": "neutral", "confidence": 0.0, "model_loaded": False}
                    if all_entry and len(entry_conditions) > 0 and ml_pass:
                        try:
                            lstm_result = lstm_predict_direction(df)
                            if lstm_result.get("model_loaded"):
                                _add_signal(state, "lstm",
                                    f"LSTM prediction: {lstm_result['direction']} ({lstm_result['confidence']:.0%})")
                        except Exception as e:
                            _add_signal(state, "warn", f"LSTM prediction failed: {e}")

                    if all_entry and len(entry_conditions) > 0 and ml_pass:
                        try:
                            # Calculate ATR-based or pip-based SL/TP
                            import pandas as pd
                            atr_val = float(row["ATR_14"]) if "ATR_14" in row.index and not pd.isna(row.get("ATR_14")) else 0

                            if direction == "buy":
                                entry_price = price_info["ask"]
                                if sl_atr_mult and atr_val > 0:
                                    sl_price = entry_price - atr_val * sl_atr_mult
                                else:
                                    sl_price = entry_price - sl_pips * pip_value if sl_pips else None
                                if tp_atr_mult and atr_val > 0:
                                    tp_price = entry_price + atr_val * tp_atr_mult
                                else:
                                    tp_price = entry_price + tp_pips * pip_value if tp_pips else None
                            else:
                                entry_price = price_info["bid"]
                                if sl_atr_mult and atr_val > 0:
                                    sl_price = entry_price + atr_val * sl_atr_mult
                                else:
                                    sl_price = entry_price + sl_pips * pip_value if sl_pips else None
                                if tp_atr_mult and atr_val > 0:
                                    tp_price = entry_price - atr_val * tp_atr_mult
                                else:
                                    tp_price = entry_price - tp_pips * pip_value if tp_pips else None

                            # Dynamic position sizing
                            actual_volume = volume
                            if sl_price is not None:
                                try:
                                    acct = _mt5(connector.get_account_info)
                                    sl_dist = abs(entry_price - sl_price)
                                    actual_volume = _calculate_lot_size(
                                        acct["equity"], risk_percent, sl_dist,
                                        tick_value, tick_size, vol_min, vol_max, vol_step
                                    )
                                except Exception:
                                    actual_volume = volume

                            result = _mt5(connector.place_trade,
                                symbol=symbol,
                                trade_type=direction,
                                volume=actual_volume,
                                stop_loss=sl_price,
                                take_profit=tp_price,
                                comment=f"MT|{strategy_name[:20]}",
                            )
                            if result.get("success"):
                                state["in_position"] = True
                                state["position_ticket"] = result.get("order_id")
                                state["trades_placed"] += 1
                                bars_in_trade = 1  # entry candle counts as bar 1
                                entry_time_iso = datetime.now(timezone.utc).isoformat()
                                # Build TradeState
                                state["trade_state"] = sanitize_for_json({
                                    "ticket": result.get("order_id"),
                                    "entry_price": entry_price,
                                    "sl_price": sl_price,
                                    "tp_price": tp_price,
                                    "direction": direction,
                                    "volume": actual_volume,
                                    "entry_time": entry_time_iso,
                                    "bars_since_entry": 0,
                                    "atr_at_entry": atr_val if atr_val > 0 else None,
                                    "sl_atr_mult": sl_atr_mult,
                                    "tp_atr_mult": tp_atr_mult,
                                })
                                # Record algo trade in DB
                                try:
                                    entry_snapshot = sanitize_for_json(get_indicator_snapshot(df, -1))
                                    entry_cond_results = sanitize_for_json(entry_results)
                                    db_trade = save_algo_trade(sanitize_for_json({
                                        "strategy_id": strategy_id,
                                        "strategy_name": strategy_name,
                                        "rule_index": rule_index,
                                        "rule_name": rule_name,
                                        "symbol": symbol,
                                        "timeframe": timeframe,
                                        "direction": direction,
                                        "volume": actual_volume,
                                        "entry_price": entry_price,
                                        "entry_time": entry_time_iso,
                                        "sl_price": sl_price,
                                        "tp_price": tp_price,
                                        "sl_atr_mult": sl_atr_mult,
                                        "tp_atr_mult": tp_atr_mult,
                                        "atr_at_entry": atr_val if atr_val > 0 else None,
                                        "entry_indicators": entry_snapshot,
                                        "entry_conditions": entry_cond_results,
                                        "mt5_ticket": result.get("order_id"),
                                        "ml_confidence": ml_result.get("score") if ml_result.get("model_loaded") else None,
                                        "lstm_direction": lstm_result.get("direction") if lstm_result.get("model_loaded") else None,
                                        "lstm_confidence": lstm_result.get("confidence") if lstm_result.get("model_loaded") else None,
                                    }))
                                    state["current_algo_trade_id"] = db_trade["id"]
                                except Exception as e:
                                    _add_signal(state, "warn", f"DB trade record failed: {e}")
                                sl_str = f" SL={sl_price:.5f}" if sl_price else ""
                                tp_str = f" TP={tp_price:.5f}" if tp_price else ""
                                atr_str = f" ATR={atr_val:.5f}" if atr_val > 0 else ""
                                _add_signal(state, direction, f"Entry {direction.upper()} at {entry_price:.5f}{sl_str}{tp_str}{atr_str} | vol={actual_volume} | ticket={result.get('order_id')}")
                            else:
                                _add_signal(state, "error", f"Trade failed (rc={result.get('retcode')}): {result.get('message', 'unknown')} | SL={sl_price} TP={tp_price}")
                        except Exception as e:
                            _add_signal(state, "error", f"Trade error: {str(e)}")
                else:
                    # Update bars_since_entry in trade_state
                    if state.get("trade_state"):
                        state["trade_state"]["bars_since_entry"] = bars_in_trade

                    # Check exit conditions — gated behind min_bars
                    if bars_in_trade >= min_bars:
                        all_exit = exit_results and all(r["passed"] for r in exit_results)
                        if all_exit:
                            try:
                                ticket = state["position_ticket"]
                                if ticket:
                                    close_result = _mt5(connector.close_position, ticket)
                                    if close_result.get("success"):
                                        # Record strategy exit in DB
                                        try:
                                            exit_snap = sanitize_for_json(get_indicator_snapshot(df, -1))
                                            _record_algo_trade_exit(state, exit_snap, "strategy_exit", bars_in_trade, symbol, ticket)
                                        except Exception as e:
                                            _add_signal(state, "warn", f"DB exit record failed: {e}")
                                        _add_signal(state, "close", f"Exit signal — closed ticket {ticket} | bars_held={bars_in_trade}")
                                        state["in_position"] = False
                                        state["position_ticket"] = None
                                        state["trade_state"] = None
                                        bars_in_trade = 0
                                    else:
                                        _add_signal(state, "error", f"Close failed: {close_result.get('message', 'unknown')}")
                            except Exception as e:
                                _add_signal(state, "error", f"Close error: {str(e)}")

                    # Check if position was closed externally (SL/TP hit)
                    if state["in_position"]:
                        positions = _mt5(connector.get_positions)
                        ticket = state["position_ticket"]
                        still_open = any(p["ticket"] == ticket for p in positions)
                        if not still_open:
                            # Record external exit in DB
                            try:
                                exit_snap = sanitize_for_json(get_indicator_snapshot(df, -1))
                                exit_reason = _determine_exit_reason(ticket, symbol, state.get("trade_state"))
                                _record_algo_trade_exit(state, exit_snap, exit_reason, bars_in_trade, symbol, ticket)
                            except Exception as e:
                                _add_signal(state, "warn", f"DB exit record failed: {e}")
                            _add_signal(state, "closed", f"Position {ticket} closed ({exit_reason}) | bars_held={bars_in_trade}")
                            state["in_position"] = False
                            state["position_ticket"] = None
                            state["trade_state"] = None
                            bars_in_trade = 0

            except Exception as e:
                import traceback
                print(f"[ALGO] INNER ERROR: {e}\n{traceback.format_exc()}", flush=True)
                _add_signal(state, "error", str(e))

            # Wait before next check
            stop_ev.wait(5)

        _add_signal(state, "stop", "Algo stopped")

    except Exception as e:
        import traceback
        print(f"[ALGO] CRASHED: {e}\n{traceback.format_exc()}", flush=True)
        _add_signal(state, "error", f"Algo crashed: {str(e)}")
    finally:
        # If algo stopped while in position, close MT5 position and mark DB trade
        if state.get("in_position") and state.get("position_ticket"):
            ticket = state["position_ticket"]
            try:
                _add_signal(state, "info", f"Closing open position #{ticket} (algo stopped)")
                _mt5(connector.close_position, ticket)
            except Exception as e:
                _add_signal(state, "warn", f"Failed to close position #{ticket}: {e}")
        if state.get("current_algo_trade_id"):
            try:
                from datetime import datetime, timezone as tz
                close_algo_trade(state["current_algo_trade_id"], {
                    "exit_time": datetime.now(tz.utc).isoformat(),
                    "exit_reason": "algo_stopped",
                    "bars_held": bars_in_trade if "bars_in_trade" in dir() else 0,
                })
            except Exception:
                pass
            state["current_algo_trade_id"] = None
        state["in_position"] = False
        state["position_ticket"] = None
        state["trade_state"] = None
        state["running"] = False
        # Remove from registry
        with _instances_lock:
            algo_instances.pop(symbol, None)


def _instance_to_dict(inst: AlgoInstance) -> dict:
    """Convert an AlgoInstance to the status dict."""
    s = inst.state
    return {
        "running": s["running"],
        "symbol": s["symbol"],
        "timeframe": s["timeframe"],
        "strategy_name": s["strategy_name"],
        "strategy_id": s.get("strategy_id"),
        "volume": s["volume"],
        "in_position": s["in_position"],
        "position_ticket": s["position_ticket"],
        "trades_placed": s["trades_placed"],
        "signals": s["signals"][-20:],
        "current_price": s["current_price"],
        "indicators": s["indicators"],
        "entry_conditions": s["entry_conditions"],
        "exit_conditions": s["exit_conditions"],
        "last_check": s["last_check"],
        "trade_state": s.get("trade_state"),
        "active_rule_index": s.get("active_rule_index", 0),
        "ml_confidence": s.get("ml_confidence"),
    }


@app.post("/api/algo/start")
def algo_start(req: AlgoStartRequest):
    global current_strategy

    if not connector or not connector.is_connected:
        raise HTTPException(status_code=400, detail="MT5 not connected")

    # Load strategy if ID provided
    if req.strategy_id:
        saved = get_strategy(req.strategy_id)
        if not saved:
            raise HTTPException(status_code=404, detail="Strategy not found")
        current_strategy = saved

    if not current_strategy:
        raise HTTPException(status_code=400, detail="No strategy loaded")

    # Auto-derive symbol and timeframe from strategy (request values are fallbacks)
    strategy_symbol = current_strategy.get("symbol")
    effective_symbol = strategy_symbol if strategy_symbol else req.symbol

    rules = current_strategy.get("rules", [])
    effective_tf = req.timeframe
    if rules:
        rule_tf = rules[0].get("timeframe")
        if rule_tf:
            effective_tf = rule_tf

    # Re-check with effective symbol
    with _instances_lock:
        if effective_symbol in algo_instances:
            raise HTTPException(status_code=400, detail=f"Algo already running on {effective_symbol}")

    # Create instance
    instance = AlgoInstance(
        symbol=effective_symbol,
        timeframe=effective_tf,
        volume=req.volume,
        strategy_name=current_strategy.get("name", "Unknown"),
        strategy_id=current_strategy.get("id"),
    )

    # Register before starting thread
    with _instances_lock:
        algo_instances[effective_symbol] = instance

    instance.thread = threading.Thread(
        target=_algo_loop,
        args=(instance, current_strategy, effective_symbol, effective_tf, req.volume),
        daemon=True,
    )
    instance.thread.start()

    return {"success": True, "symbol": effective_symbol, "message": f"Algo started on {effective_symbol}"}


@app.post("/api/algo/stop")
def algo_stop(symbol: str = None):
    """Stop algo on a specific symbol, or stop all if no symbol given."""
    with _instances_lock:
        if symbol:
            instance = algo_instances.get(symbol)
            if not instance:
                raise HTTPException(status_code=400, detail=f"No algo running on {symbol}")
            instance.stop_event.set()
            instance.state["running"] = False
            return {"success": True, "message": f"Algo stop requested for {symbol}"}
        else:
            # Stop all
            if not algo_instances:
                raise HTTPException(status_code=400, detail="No algos running")
            count = len(algo_instances)
            for inst in algo_instances.values():
                inst.stop_event.set()
                inst.state["running"] = False
            return {"success": True, "message": f"Stop requested for {count} algo(s)"}


@app.get("/api/algo/status")
def algo_status(symbol: str = None):
    """Get algo status. If symbol given, return that instance. Otherwise return all."""
    if symbol:
        instance = algo_instances.get(symbol)
        if not instance:
            return JSONResponse(content=sanitize_for_json({
                "running": False, "symbol": symbol, "timeframe": "5m",
                "strategy_name": None, "strategy_id": None, "volume": 0.01,
                "in_position": False, "position_ticket": None, "trades_placed": 0,
                "signals": [], "current_price": None, "indicators": {},
                "entry_conditions": [], "exit_conditions": [], "last_check": None,
                "trade_state": None, "active_rule_index": 0,
            }))
        return JSONResponse(content=sanitize_for_json(_instance_to_dict(instance)))

    # Return all instances + backward-compatible top-level fields
    instances_dict = {}
    for sym, inst in algo_instances.items():
        instances_dict[sym] = _instance_to_dict(inst)

    first = next(iter(algo_instances.values()), None)
    result = {
        "running": len(algo_instances) > 0,
        "instances": instances_dict,
        # Legacy fields (first running instance) for backward compat
        "symbol": first.state["symbol"] if first else None,
        "timeframe": first.state["timeframe"] if first else "5m",
        "strategy_name": first.state["strategy_name"] if first else None,
        "strategy_id": first.state.get("strategy_id") if first else None,
        "volume": first.state["volume"] if first else 0.01,
        "in_position": first.state["in_position"] if first else False,
        "position_ticket": first.state["position_ticket"] if first else None,
        "trades_placed": first.state["trades_placed"] if first else 0,
        "signals": first.state["signals"][-20:] if first else [],
        "current_price": first.state["current_price"] if first else None,
        "indicators": first.state["indicators"] if first else {},
        "entry_conditions": first.state["entry_conditions"] if first else [],
        "exit_conditions": first.state["exit_conditions"] if first else [],
        "last_check": first.state["last_check"] if first else None,
        "trade_state": first.state.get("trade_state") if first else None,
        "active_rule_index": first.state.get("active_rule_index", 0) if first else 0,
    }
    return JSONResponse(content=sanitize_for_json(result))


@app.get("/api/algo/trades")
def get_algo_trades_endpoint(strategy_id: str = None, symbol: str = None, limit: int = 100):
    """Fetch recorded algo trades with full context."""
    return list_algo_trades(strategy_id=strategy_id, symbol=symbol, limit=limit)


@app.get("/api/algo/trades/stats")
def get_algo_trades_stats_endpoint(strategy_id: str = None, symbol: str = None):
    """Get summary stats for algo trades."""
    return get_algo_trade_stats(strategy_id=strategy_id, symbol=symbol)


@app.get("/api/algo/trades/{trade_id}")
def get_algo_trade_detail_endpoint(trade_id: str):
    """Get a single algo trade with full detail."""
    trade = get_algo_trade(trade_id)
    if not trade:
        raise HTTPException(status_code=404, detail="Algo trade not found")
    return trade


# ──────────────────────────────────────
# ML CONFIDENCE FILTER
# ──────────────────────────────────────

@app.get("/api/ml/status")
def ml_status():
    """Get ML model status and metadata."""
    return get_model_status()


@app.post("/api/ml/train")
def ml_train():
    """Train/retrain the ML confidence model from backtest + live trade data."""
    from backend.core.trainer import train_model
    result = train_model(connector=connector, bars=2000)
    return result


@app.post("/api/ml/reload")
def ml_reload():
    """Force reload the ML model from disk."""
    reload_model()
    return get_model_status()


class MLThresholdRequest(BaseModel):
    threshold: float = Field(ge=0.0, le=1.0)


@app.post("/api/ml/threshold")
def ml_set_threshold(req: MLThresholdRequest):
    """Adjust the ML confidence threshold at runtime."""
    from backend.core import ml_filter
    ml_filter.DEFAULT_THRESHOLD = req.threshold
    return {"threshold": req.threshold}


# ──────────────────────────────────────
# LSTM PRICE PREDICTOR
# ──────────────────────────────────────

class LSTMTrainRequest(BaseModel):
    symbol: str = "EURUSDm"
    timeframe: str = "1h"
    bars: int = 5000


class LSTMPredictRequest(BaseModel):
    symbol: str = "EURUSDm"
    timeframe: str = "1h"


@app.get("/api/ml/lstm-status")
def lstm_status_endpoint():
    """Get LSTM model status and metadata."""
    return get_lstm_status()


@app.post("/api/ml/train-lstm")
def train_lstm_endpoint(req: LSTMTrainRequest):
    """Train the LSTM price direction predictor."""
    result = train_lstm(
        connector=connector,
        symbol=req.symbol,
        timeframe=req.timeframe,
        bars=req.bars,
    )
    return result


@app.post("/api/ml/lstm-predict")
def lstm_predict_endpoint(req: LSTMPredictRequest):
    """Run LSTM prediction on current candle data."""
    if not connector or not connector.is_connected:
        raise HTTPException(status_code=400, detail="MT5 not connected")
    try:
        from backend.core.indicators import add_all_indicators
        connector.select_symbol(req.symbol)
        df = connector.get_history(req.symbol, req.timeframe, 100)
        df = add_all_indicators(df)
        df = df.dropna().reset_index()
        result = lstm_predict_direction(df)
        return result
    except Exception as e:
        logger.error("LSTM predict failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Prediction failed: {e}")


@app.post("/api/ml/lstm-reload")
def lstm_reload_endpoint():
    """Force reload LSTM model from disk."""
    reload_lstm_model()
    return get_lstm_status()


# ──────────────────────────────────────
# ML DASHBOARD DATA
# ──────────────────────────────────────

@app.get("/api/ml/training-history")
def ml_training_history(model_type: str = None, limit: int = 50):
    """Get training run history for dashboard charts."""
    return list_training_runs(model_type=model_type, limit=limit)


@app.get("/api/ml/trade-analysis")
def ml_trade_analysis():
    """Aggregated ML trade outcomes — win rates by confidence bucket, ML vs overall."""
    trades = list_algo_trades(limit=10000)
    closed = [t for t in trades if t["status"] == "closed" and t["net_pnl"] is not None]

    if not closed:
        return {
            "total_trades": 0,
            "ml_trades": 0,
            "overall_win_rate": 0.0,
            "ml_win_rate": 0.0,
            "confidence_buckets": [],
            "lstm_accuracy": None,
        }

    # Overall stats
    wins = [t for t in closed if t["net_pnl"] > 0]
    overall_win_rate = round(len(wins) / len(closed) * 100, 1) if closed else 0.0

    # ML-scored trades
    ml_trades = [t for t in closed if t.get("ml_confidence") is not None]
    ml_wins = [t for t in ml_trades if t["net_pnl"] > 0]
    ml_win_rate = round(len(ml_wins) / len(ml_trades) * 100, 1) if ml_trades else 0.0

    # Confidence distribution buckets
    buckets = [
        {"label": "0-20%", "min": 0.0, "max": 0.2},
        {"label": "20-40%", "min": 0.2, "max": 0.4},
        {"label": "40-60%", "min": 0.4, "max": 0.6},
        {"label": "60-80%", "min": 0.6, "max": 0.8},
        {"label": "80-100%", "min": 0.8, "max": 1.01},
    ]
    confidence_buckets = []
    for b in buckets:
        bucket_trades = [t for t in ml_trades if b["min"] <= (t["ml_confidence"] or 0) < b["max"]]
        bucket_wins = [t for t in bucket_trades if t["net_pnl"] > 0]
        confidence_buckets.append({
            "label": b["label"],
            "count": len(bucket_trades),
            "wins": len(bucket_wins),
            "win_rate": round(len(bucket_wins) / len(bucket_trades) * 100, 1) if bucket_trades else 0.0,
        })

    # LSTM accuracy (how often LSTM direction matched actual outcome)
    lstm_trades = [t for t in closed if t.get("lstm_direction") and t.get("lstm_direction") != "neutral"]
    lstm_correct = 0
    for t in lstm_trades:
        if t["lstm_direction"] == "up" and t["net_pnl"] > 0:
            lstm_correct += 1
        elif t["lstm_direction"] == "down" and t["net_pnl"] < 0:
            lstm_correct += 1
    lstm_accuracy = round(lstm_correct / len(lstm_trades) * 100, 1) if lstm_trades else None

    return {
        "total_trades": len(closed),
        "ml_trades": len(ml_trades),
        "overall_win_rate": overall_win_rate,
        "ml_win_rate": ml_win_rate,
        "confidence_buckets": confidence_buckets,
        "lstm_trades": len(lstm_trades),
        "lstm_accuracy": lstm_accuracy,
        "avg_ml_confidence": round(sum(t["ml_confidence"] for t in ml_trades) / len(ml_trades), 4) if ml_trades else None,
    }


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "mt5_connected": connector is not None and connector.is_connected if connector else False,
        "has_data": historical_data is not None,
        "has_strategy": current_strategy is not None,
        "algo_running": len(algo_instances) > 0,
        "algo_count": len(algo_instances),
        "has_env_creds": bool(settings.MT5_LOGIN and settings.MT5_PASSWORD and settings.MT5_SERVER),
    }


# ──────────────────────────────────────
# LIVE STREAMING (WebSocket)
# ──────────────────────────────────────

mt5_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mt5ws")

# Global lock for MT5 API — the Python MT5 library is not thread-safe.
# Both SSE/WS (via mt5_executor) and the algo thread acquire this lock.
import threading as _mt5_threading
_mt5_global_lock = _mt5_threading.Lock()


def _safe_mt5_call(fn, *args, **kwargs):
    """Acquire global MT5 lock, call fn, release. Used by SSE/WS executor AND algo thread."""
    with _mt5_global_lock:
        return fn(*args, **kwargs)


@app.websocket("/api/ws/live")
async def ws_live(ws: WebSocket):
    await ws.accept()
    loop = asyncio.get_event_loop()

    try:
        # Wait for subscription message
        init_msg = await asyncio.wait_for(ws.receive_json(), timeout=10)
        subscribed_symbol = init_msg.get("symbol", "EURUSDm")
        subscribed_timeframe = init_msg.get("timeframe", "1m")

        if not connector or not connector.is_connected:
            await ws.send_json({"type": "error", "message": "MT5 not connected"})
            await ws.close()
            return

        await loop.run_in_executor(mt5_executor, _safe_mt5_call, connector.select_symbol, subscribed_symbol)

        tick_counter = 0
        while True:
            tick_counter += 1

            # Check for incoming messages (non-blocking)
            try:
                msg = await asyncio.wait_for(ws.receive_json(), timeout=0.01)
                if msg.get("action") == "unsubscribe":
                    break
                if msg.get("symbol"):
                    subscribed_symbol = msg["symbol"]
                    await loop.run_in_executor(mt5_executor, _safe_mt5_call, connector.select_symbol, subscribed_symbol)
                if msg.get("timeframe"):
                    subscribed_timeframe = msg["timeframe"]
            except asyncio.TimeoutError:
                pass

            # Price tick — every iteration (~500ms)
            try:
                price = await loop.run_in_executor(
                    mt5_executor, _safe_mt5_call, connector.get_symbol_price, subscribed_symbol
                )
                await ws.send_json({"type": "price", **sanitize_for_json(price)})
            except Exception:
                pass

            # Positions — every 2nd tick (~1s)
            if tick_counter % 2 == 0:
                try:
                    positions = await loop.run_in_executor(
                        mt5_executor, _safe_mt5_call, connector.get_positions
                    )
                    await ws.send_json({"type": "positions", "data": sanitize_for_json(positions)})
                except Exception:
                    pass

            # Account info — every 4th tick (~2s)
            if tick_counter % 4 == 0:
                try:
                    account = await loop.run_in_executor(
                        mt5_executor, _safe_mt5_call, connector.get_account_info
                    )
                    await ws.send_json({"type": "account", **sanitize_for_json(account)})
                except Exception:
                    pass

            # Algo status — every 2nd tick (~1s), scoped to subscribed symbol
            if tick_counter % 2 == 0:
                try:
                    instance = algo_instances.get(subscribed_symbol)
                    if instance and instance.state["running"]:
                        algo_data = {"type": "algo", **_instance_to_dict(instance)}
                        await ws.send_json(sanitize_for_json(algo_data))
                except Exception:
                    pass

            # Candle + indicators — every 10th tick (~5s)
            if tick_counter % 10 == 0:
                try:
                    from backend.core.indicators import add_all_indicators, get_indicator_snapshot
                    df = await loop.run_in_executor(
                        mt5_executor, _safe_mt5_call, connector.get_history,
                        subscribed_symbol, subscribed_timeframe, 50
                    )
                    df = add_all_indicators(df)
                    last = df.iloc[-1]
                    candle_data = {
                        "time": str(df.index[-1]),
                        "open": float(last["open"]),
                        "high": float(last["high"]),
                        "low": float(last["low"]),
                        "close": float(last["close"]),
                        "volume": float(last["volume"]),
                    }
                    indicators = get_indicator_snapshot(df, -1)
                    await ws.send_json({
                        "type": "candle",
                        **sanitize_for_json(candle_data),
                        "indicators": sanitize_for_json(indicators),
                    })
                except Exception:
                    pass

            await asyncio.sleep(0.5)

    except WebSocketDisconnect:
        pass
    except Exception:
        pass


# ──────────────────────────────────────
# LIVE STREAMING (SSE)
# ──────────────────────────────────────

def _sse_event(event_type: str, data: dict) -> str:
    """Format a single SSE event string."""
    payload = json.dumps(sanitize_for_json(data))
    return f"event: {event_type}\ndata: {payload}\n\n"


async def _sse_live_generator(request: Request, symbol: str, timeframe: str):
    """Async generator yielding SSE events for live market data."""
    global connector
    loop = asyncio.get_event_loop()

    if not connector or not connector.is_connected:
        yield _sse_event("error", {"message": "MT5 not connected"})
        return

    await loop.run_in_executor(mt5_executor, _safe_mt5_call, connector.select_symbol, symbol)

    tick_counter = 0
    while True:
        if await request.is_disconnected():
            break

        tick_counter += 1

        # Price — every tick (~200ms = ~5 updates/sec)
        try:
            price = await loop.run_in_executor(
                mt5_executor, _safe_mt5_call, connector.get_symbol_price, symbol
            )
            yield _sse_event("price", price)
        except Exception:
            pass

        # Positions — every tick
        try:
            positions = await loop.run_in_executor(
                mt5_executor, _safe_mt5_call, connector.get_positions
            )
            yield _sse_event("positions", {"data": positions})
        except Exception:
            pass

        # Account — every tick
        try:
            account = await loop.run_in_executor(
                mt5_executor, _safe_mt5_call, connector.get_account_info
            )
            yield _sse_event("account", account)
        except Exception:
            pass

        # Algo status — every tick, scoped to this symbol's instance
        try:
            instance = algo_instances.get(symbol)
            if instance and instance.state["running"]:
                yield _sse_event("algo", _instance_to_dict(instance))
            else:
                yield _sse_event("algo", {"running": False, "symbol": symbol})
        except Exception:
            pass

        # Candle + indicators — every 5th tick (~1s, heavier computation)
        if tick_counter % 5 == 0:
            try:
                from backend.core.indicators import add_all_indicators, get_indicator_snapshot
                df = await loop.run_in_executor(
                    mt5_executor, _safe_mt5_call, connector.get_history,
                    symbol, timeframe, 50
                )
                df = add_all_indicators(df)
                last = df.iloc[-1]
                indicators = get_indicator_snapshot(df, -1)
                yield _sse_event("candle", {
                    "time": str(df.index[-1]),
                    "open": float(last["open"]),
                    "high": float(last["high"]),
                    "low": float(last["low"]),
                    "close": float(last["close"]),
                    "volume": float(last["volume"]),
                    "indicators": indicators,
                })
            except Exception:
                pass

        # Keepalive — every 150th tick (~30s)
        if tick_counter % 150 == 0:
            yield ": keepalive\n\n"

        await asyncio.sleep(0.2)


@app.get("/api/sse/live")
async def sse_live(request: Request, symbol: str = "EURUSDm", timeframe: str = "1m"):
    """SSE endpoint for live market data streaming."""
    return StreamingResponse(
        _sse_live_generator(request, symbol, timeframe),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def _sse_ticker_generator(request: Request, symbol: str):
    """Lightweight SSE: just price + account every ~1s for sidebar ticker."""
    global connector
    loop = asyncio.get_event_loop()

    if not connector or not connector.is_connected:
        yield _sse_event("error", {"message": "MT5 not connected"})
        return

    await loop.run_in_executor(mt5_executor, _safe_mt5_call, connector.select_symbol, symbol)

    tick_counter = 0
    while True:
        if await request.is_disconnected():
            break

        tick_counter += 1

        # Price — every tick (~500ms)
        try:
            price = await loop.run_in_executor(
                mt5_executor, _safe_mt5_call, connector.get_symbol_price, symbol
            )
            yield _sse_event("price", price)
        except Exception:
            pass

        # Account — every tick
        try:
            account = await loop.run_in_executor(
                mt5_executor, _safe_mt5_call, connector.get_account_info
            )
            yield _sse_event("account", account)
        except Exception:
            pass

        # Algo status — every tick (in-memory read, all instances)
        running_instances = [
            {
                "symbol": inst.state["symbol"],
                "strategy_name": inst.state["strategy_name"],
                "trades_placed": inst.state["trades_placed"],
                "in_position": inst.state["in_position"],
            }
            for inst in algo_instances.values()
            if inst.state["running"]
        ]
        first = running_instances[0] if running_instances else None
        yield _sse_event("algo_status", {
            "running": len(running_instances) > 0,
            "instances": running_instances,
            # Legacy flat fields (first instance)
            "symbol": first["symbol"] if first else None,
            "strategy_name": first["strategy_name"] if first else None,
            "trades_placed": sum(i["trades_placed"] for i in running_instances),
            "in_position": any(i["in_position"] for i in running_instances),
        })

        if tick_counter % 60 == 0:
            yield ": keepalive\n\n"

        await asyncio.sleep(0.5)


@app.get("/api/sse/ticker")
async def sse_ticker(request: Request, symbol: str = "EURUSDm"):
    """Lightweight SSE for sidebar price ticker."""
    return StreamingResponse(
        _sse_ticker_generator(request, symbol),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
