"""
FastAPI backend — REST API for MasstTrader.
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
import json
import math
import sys
import os
import threading

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))


def sanitize_for_json(obj):
    """Recursively replace NaN/Inf with None for JSON serialization."""
    if isinstance(obj, dict):
        return {k: sanitize_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [sanitize_for_json(v) for v in obj]
    elif isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    return obj

from backend.database import (
    init_db, save_strategy, list_strategies, get_strategy,
    update_strategy, delete_strategy, save_backtest, list_backtests, get_backtest,
)

app = FastAPI(title="MasstTrader API", version="1.0.0")

# Initialize SQLite database
init_db()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Global state ──
connector = None
historical_data = None
current_strategy = None
backtest_results = None
trade_history = None


# ── Request/Response Models ──
class MT5LoginRequest(BaseModel):
    login: int
    password: str
    server: str
    mt5_path: Optional[str] = None


class FetchDataRequest(BaseModel):
    symbol: str
    timeframe: str = "1h"
    bars: int = 500


class StrategyRequest(BaseModel):
    description: str
    symbol: str = "EURUSD"


class BacktestRequest(BaseModel):
    initial_balance: float = 10000.0
    risk_percent: float = 1.0
    strategy_id: Optional[str] = None


class TradeAnalyzeRequest(BaseModel):
    symbol: str
    trade_type: str
    entry_price: float
    exit_price: float
    profit: float
    open_time: str
    close_time: str
    indicators_at_entry: dict


class PlaceTradeRequest(BaseModel):
    symbol: str
    trade_type: str
    volume: float
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None


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
    result_box = [None]
    error_box = [None]

    def _connect():
        try:
            from backend.services.mt5_connector import MT5Connector
            c = MT5Connector()
            r = c.connect(
                login=req.login,
                password=req.password,
                server=req.server,
                mt5_path=req.mt5_path,
            )
            result_box[0] = (c, r)
        except Exception as e:
            error_box[0] = e

    thread = threading.Thread(target=_connect)
    thread.start()
    thread.join(timeout=20)

    if thread.is_alive():
        raise HTTPException(status_code=408, detail="MT5 connection timed out after 20s — make sure MT5 terminal is running")
    if error_box[0]:
        raise HTTPException(status_code=400, detail=str(error_box[0]))

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
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/mt5/positions")
def mt5_positions():
    if not connector or not connector.is_connected:
        raise HTTPException(status_code=400, detail="Not connected to MT5")
    try:
        return connector.get_positions()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/mt5/symbols")
def mt5_symbols(group: str = None):
    if not connector or not connector.is_connected:
        raise HTTPException(status_code=400, detail="Not connected to MT5")
    try:
        return connector.get_symbols(group=group)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/mt5/price/{symbol}")
def mt5_price(symbol: str):
    if not connector or not connector.is_connected:
        raise HTTPException(status_code=400, detail="Not connected to MT5")
    try:
        connector.select_symbol(symbol)
        return connector.get_symbol_price(symbol)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/mt5/close/{ticket}")
def mt5_close_position(ticket: int):
    if not connector or not connector.is_connected:
        raise HTTPException(status_code=400, detail="Not connected to MT5")
    try:
        return connector.close_position(ticket)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/data/demo")
def load_demo_data():
    global historical_data
    import numpy as np
    import pandas as pd
    from backend.core.indicators import add_all_indicators

    np.random.seed(42)
    dates = pd.date_range("2024-01-01", periods=500, freq="1h")
    close = 1.1000 + np.cumsum(np.random.randn(500) * 0.001)
    high = close + np.abs(np.random.randn(500) * 0.0005)
    low = close - np.abs(np.random.randn(500) * 0.0005)
    open_price = close + np.random.randn(500) * 0.0003
    volume = np.random.randint(100, 10000, 500).astype(float)

    df = pd.DataFrame({
        "datetime": dates,
        "open": open_price,
        "high": high,
        "low": low,
        "close": close,
        "volume": volume,
    }).set_index("datetime")

    df = add_all_indicators(df)
    historical_data = df

    df_reset = df.reset_index()
    df_reset["datetime"] = df_reset["datetime"].astype(str)
    data = {
        "candles": df_reset.to_dict(orient="records"),
        "count": len(df),
        "columns": list(df.columns),
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
        raise HTTPException(status_code=500, detail=str(e))


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
        raise HTTPException(status_code=500, detail=str(e))


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


@app.get("/api/strategies")
def list_strategies_endpoint():
    strategies = list_strategies()
    return [
        {
            "id": s["id"],
            "name": s["name"],
            "symbol": s["symbol"],
            "rule_count": len(s.get("rules", [])),
            "created_at": s["created_at"],
            "updated_at": s["updated_at"],
        }
        for s in strategies
    ]


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
# BACKTEST ENDPOINTS
# ──────────────────────────────────────

@app.post("/api/backtest/run")
def run_backtest_endpoint(req: BacktestRequest):
    global backtest_results, current_strategy

    # If strategy_id provided, load from DB
    if req.strategy_id:
        saved = get_strategy(req.strategy_id)
        if not saved:
            raise HTTPException(status_code=404, detail="Strategy not found")
        current_strategy = saved

    if not current_strategy:
        raise HTTPException(status_code=400, detail="No strategy loaded. Parse one first.")
    if historical_data is None:
        raise HTTPException(status_code=400, detail="No historical data. Fetch or load demo first.")

    try:
        from backend.core.backtester import run_backtest

        df = historical_data.copy()
        if "datetime" not in df.columns:
            df = df.reset_index()

        rules = current_strategy.get("rules", [])
        if not rules:
            raise HTTPException(status_code=400, detail="Strategy has no rules")

        result = run_backtest(
            df, rules[0],
            initial_balance=req.initial_balance,
            risk_per_trade=req.risk_percent,
        )
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
        raise HTTPException(status_code=500, detail=str(e))


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
        raise HTTPException(status_code=500, detail=str(e))


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
    if not current_strategy:
        raise HTTPException(status_code=400, detail="No strategy loaded")
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
        result = analyze_trade(current_strategy, trade, req.indicators_at_entry)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "mt5_connected": connector is not None and connector.is_connected if connector else False,
        "has_data": historical_data is not None,
        "has_strategy": current_strategy is not None,
    }
