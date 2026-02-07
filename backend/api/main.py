"""
FastAPI backend — REST API for MasstTrader.
"""
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
import asyncio
from concurrent.futures import ThreadPoolExecutor
import json
import math
import sys
import os
import threading

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))


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

# Algo trading state
algo_state = {
    "running": False,
    "symbol": None,
    "timeframe": "5m",
    "strategy_name": None,
    "volume": 0.01,
    "signals": [],       # recent signal log
    "trades_placed": 0,
    "in_position": False,
    "position_ticket": None,
    # Live market data (updated each loop iteration)
    "current_price": None,           # {bid, ask, spread}
    "indicators": {},                # latest indicator snapshot
    "entry_conditions": [],          # conditions with pass/fail status
    "exit_conditions": [],           # conditions with pass/fail status
    "last_check": None,              # ISO timestamp of last evaluation
    "strategy_rules": None,          # the rule being used
}
algo_thread = None
algo_stop_event = threading.Event()


# ── Request/Response Models ──
class MT5LoginRequest(BaseModel):
    login: int
    password: str
    server: str
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
    volume: float
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None


class AlgoStartRequest(BaseModel):
    symbol: str = "EURUSDm"
    timeframe: str = "5m"
    volume: float = 0.01
    strategy_id: Optional[str] = None


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


# ──────────────────────────────────────
# ALGO TRADING ENGINE
# ──────────────────────────────────────

def _add_signal(action: str, detail: str):
    """Append a signal entry to algo_state (keep last 50)."""
    from datetime import datetime, timezone
    algo_state["signals"].append({
        "time": datetime.now(timezone.utc).isoformat(),
        "action": action,
        "detail": detail,
    })
    if len(algo_state["signals"]) > 50:
        algo_state["signals"] = algo_state["signals"][-50:]


def _algo_loop(strategy: dict, symbol: str, timeframe: str, volume: float):
    """Background thread: monitors market and trades based on strategy rules."""
    from backend.core.indicators import add_all_indicators, get_indicator_snapshot
    from backend.core.backtester import evaluate_condition
    from datetime import datetime, timezone

    rules = strategy.get("rules", [])
    if not rules:
        _add_signal("error", "Strategy has no rules")
        algo_state["running"] = False
        return

    rule = rules[0]
    entry_conditions = rule.get("entry_conditions", [])
    exit_conditions = rule.get("exit_conditions", [])
    sl_pips = rule.get("stop_loss_pips")
    tp_pips = rule.get("take_profit_pips")
    algo_state["strategy_rules"] = rule

    connector.select_symbol(symbol)
    _add_signal("start", f"Algo started: {symbol} / {timeframe} / vol={volume}")

    price_info = None
    check_count = 0

    while not algo_stop_event.is_set():
        try:
            check_count += 1

            # Get current price
            try:
                price_info = connector.get_symbol_price(symbol)
                algo_state["current_price"] = sanitize_for_json({
                    "bid": price_info["bid"],
                    "ask": price_info["ask"],
                    "spread": price_info["ask"] - price_info["bid"],
                })
            except Exception as e:
                _add_signal("error", f"Price fetch failed: {e}")
                algo_stop_event.wait(15)
                continue

            # Fetch latest candles + indicators
            df = connector.get_history(symbol, timeframe, 100)
            df = add_all_indicators(df)
            df = df.dropna().reset_index()

            if len(df) < 2:
                algo_stop_event.wait(10)
                continue

            row = df.iloc[-1]
            prev_row = df.iloc[-2]

            # Update indicator snapshot
            algo_state["indicators"] = sanitize_for_json(
                get_indicator_snapshot(df, -1)
            )
            algo_state["last_check"] = datetime.now(timezone.utc).isoformat()

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
            algo_state["entry_conditions"] = entry_results

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
            algo_state["exit_conditions"] = exit_results

            # Log periodic check so user sees the algo is alive
            entry_pass = sum(1 for r in entry_results if r["passed"])
            entry_total = len(entry_results)
            bid = price_info["bid"]
            if check_count % 4 == 1:  # every ~60s
                pos_status = "IN_POSITION" if algo_state["in_position"] else "WATCHING"
                _add_signal("check", f"{pos_status} | bid={bid:.5f} | entry {entry_pass}/{entry_total}")

            if not algo_state["in_position"]:
                # Check if ALL entry conditions are met
                all_entry = all(r["passed"] for r in entry_results)
                if all_entry and len(entry_conditions) > 0:
                    try:
                        result = connector.place_trade(
                            symbol=symbol,
                            trade_type="buy",
                            volume=volume,
                            stop_loss=price_info["ask"] - sl_pips * 0.0001 if sl_pips else None,
                            take_profit=price_info["ask"] + tp_pips * 0.0001 if tp_pips else None,
                        )
                        if result.get("success"):
                            algo_state["in_position"] = True
                            algo_state["position_ticket"] = result.get("order_id")
                            algo_state["trades_placed"] += 1
                            _add_signal("buy", f"Entry at {price_info['ask']:.5f} | ticket={result.get('order_id')}")
                        else:
                            _add_signal("error", f"Trade failed: {result.get('message', 'unknown')}")
                    except Exception as e:
                        _add_signal("error", f"Trade error: {str(e)}")
            else:
                # Check exit conditions
                all_exit = exit_results and all(r["passed"] for r in exit_results)
                if all_exit:
                    try:
                        ticket = algo_state["position_ticket"]
                        if ticket:
                            connector.close_position(ticket)
                            _add_signal("close", f"Exit signal — closed ticket {ticket}")
                        algo_state["in_position"] = False
                        algo_state["position_ticket"] = None
                    except Exception as e:
                        _add_signal("error", f"Close error: {str(e)}")

                # Check if position was closed externally (SL/TP hit)
                if algo_state["in_position"]:
                    positions = connector.get_positions()
                    ticket = algo_state["position_ticket"]
                    still_open = any(p["ticket"] == ticket for p in positions)
                    if not still_open:
                        _add_signal("closed", f"Position {ticket} closed (SL/TP or manual)")
                        algo_state["in_position"] = False
                        algo_state["position_ticket"] = None

        except Exception as e:
            _add_signal("error", str(e))

        # Wait before next check
        algo_stop_event.wait(15)

    _add_signal("stop", "Algo stopped")
    algo_state["running"] = False


@app.post("/api/algo/start")
def algo_start(req: AlgoStartRequest):
    global algo_thread, current_strategy

    if algo_state["running"]:
        raise HTTPException(status_code=400, detail="Algo already running")
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

    algo_stop_event.clear()
    algo_state["running"] = True
    algo_state["symbol"] = req.symbol
    algo_state["timeframe"] = req.timeframe
    algo_state["volume"] = req.volume
    algo_state["strategy_name"] = current_strategy.get("name", "Unknown")
    algo_state["signals"] = []
    algo_state["trades_placed"] = 0
    algo_state["in_position"] = False
    algo_state["position_ticket"] = None

    algo_thread = threading.Thread(
        target=_algo_loop,
        args=(current_strategy, req.symbol, req.timeframe, req.volume),
        daemon=True,
    )
    algo_thread.start()

    return {"success": True, "message": f"Algo started on {req.symbol}"}


@app.post("/api/algo/stop")
def algo_stop():
    if not algo_state["running"]:
        raise HTTPException(status_code=400, detail="Algo not running")
    algo_stop_event.set()
    algo_state["running"] = False
    return {"success": True, "message": "Algo stop requested"}


@app.get("/api/algo/status")
def algo_status():
    data = {
        "running": algo_state["running"],
        "symbol": algo_state["symbol"],
        "timeframe": algo_state["timeframe"],
        "strategy_name": algo_state["strategy_name"],
        "volume": algo_state["volume"],
        "in_position": algo_state["in_position"],
        "position_ticket": algo_state["position_ticket"],
        "trades_placed": algo_state["trades_placed"],
        "signals": algo_state["signals"][-20:],
        "current_price": algo_state["current_price"],
        "indicators": algo_state["indicators"],
        "entry_conditions": algo_state["entry_conditions"],
        "exit_conditions": algo_state["exit_conditions"],
        "last_check": algo_state["last_check"],
    }
    return JSONResponse(content=sanitize_for_json(data))


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "mt5_connected": connector is not None and connector.is_connected if connector else False,
        "has_data": historical_data is not None,
        "has_strategy": current_strategy is not None,
        "algo_running": algo_state["running"],
    }


# ──────────────────────────────────────
# LIVE STREAMING (WebSocket)
# ──────────────────────────────────────

mt5_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="mt5ws")


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

        await loop.run_in_executor(mt5_executor, connector.select_symbol, subscribed_symbol)

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
                    await loop.run_in_executor(mt5_executor, connector.select_symbol, subscribed_symbol)
                if msg.get("timeframe"):
                    subscribed_timeframe = msg["timeframe"]
            except asyncio.TimeoutError:
                pass

            # Price tick — every iteration (~500ms)
            try:
                price = await loop.run_in_executor(
                    mt5_executor, connector.get_symbol_price, subscribed_symbol
                )
                await ws.send_json({"type": "price", **sanitize_for_json(price)})
            except Exception:
                pass

            # Positions — every 2nd tick (~1s)
            if tick_counter % 2 == 0:
                try:
                    positions = await loop.run_in_executor(
                        mt5_executor, connector.get_positions
                    )
                    await ws.send_json({"type": "positions", "data": sanitize_for_json(positions)})
                except Exception:
                    pass

            # Account info — every 4th tick (~2s)
            if tick_counter % 4 == 0:
                try:
                    account = await loop.run_in_executor(
                        mt5_executor, connector.get_account_info
                    )
                    await ws.send_json({"type": "account", **sanitize_for_json(account)})
                except Exception:
                    pass

            # Candle + indicators — every 10th tick (~5s)
            if tick_counter % 10 == 0:
                try:
                    from backend.core.indicators import add_all_indicators, get_indicator_snapshot
                    df = await loop.run_in_executor(
                        mt5_executor, connector.get_history,
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
