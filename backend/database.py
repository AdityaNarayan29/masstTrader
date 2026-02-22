"""
SQLite persistence layer for MasstTrader.
All database operations go through this module.
"""
import sqlite3
import json
import uuid
import os
from datetime import datetime, timezone

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "massttrader.db")


def _get_connection() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = _get_connection()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS strategies (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            symbol          TEXT NOT NULL,
            rules           TEXT NOT NULL,
            raw_description TEXT NOT NULL,
            ai_explanation  TEXT NOT NULL DEFAULT '',
            created_at      TEXT NOT NULL,
            updated_at      TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS backtests (
            id              TEXT PRIMARY KEY,
            strategy_id     TEXT NOT NULL,
            strategy_name   TEXT NOT NULL,
            symbol          TEXT NOT NULL,
            initial_balance REAL NOT NULL,
            risk_percent    REAL NOT NULL,
            stats           TEXT NOT NULL,
            trades          TEXT NOT NULL,
            equity_curve    TEXT NOT NULL,
            created_at      TEXT NOT NULL,
            FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS algo_trades (
            id                TEXT PRIMARY KEY,
            strategy_id       TEXT,
            strategy_name     TEXT NOT NULL,
            rule_index        INTEGER NOT NULL DEFAULT 0,
            rule_name         TEXT NOT NULL DEFAULT '',
            symbol            TEXT NOT NULL,
            timeframe         TEXT NOT NULL,
            direction         TEXT NOT NULL,
            volume            REAL NOT NULL,
            entry_price       REAL NOT NULL,
            entry_time        TEXT NOT NULL,
            sl_price          REAL,
            tp_price          REAL,
            sl_atr_mult       REAL,
            tp_atr_mult       REAL,
            atr_at_entry      REAL,
            entry_indicators  TEXT NOT NULL DEFAULT '{}',
            entry_conditions  TEXT NOT NULL DEFAULT '[]',
            exit_price        REAL,
            exit_time         TEXT,
            exit_indicators   TEXT DEFAULT '{}',
            exit_reason       TEXT,
            bars_held         INTEGER,
            profit            REAL,
            commission        REAL,
            swap              REAL,
            net_pnl           REAL,
            mt5_ticket        INTEGER,
            ml_confidence     REAL,
            status            TEXT NOT NULL DEFAULT 'open',
            created_at        TEXT NOT NULL,
            updated_at        TEXT NOT NULL
        );
    """)
        CREATE TABLE IF NOT EXISTS ml_training_runs (
            id                TEXT PRIMARY KEY,
            model_type        TEXT NOT NULL,
            trained_at        TEXT NOT NULL,
            total_samples     INTEGER NOT NULL DEFAULT 0,
            accuracy          REAL,
            precision_score   REAL,
            recall            REAL,
            f1_score          REAL,
            val_loss          REAL,
            epochs            INTEGER,
            feature_importance TEXT NOT NULL DEFAULT '{}',
            extra_metrics     TEXT NOT NULL DEFAULT '{}'
        );
    """)
    # Migrations: add columns to existing DBs (idempotent)
    migrations = [
        "ALTER TABLE algo_trades ADD COLUMN ml_confidence REAL",
        "ALTER TABLE algo_trades ADD COLUMN lstm_direction TEXT",
        "ALTER TABLE algo_trades ADD COLUMN lstm_confidence REAL",
    ]
    for sql in migrations:
        try:
            conn.execute(sql)
        except Exception:
            pass  # Column already exists
    conn.close()


# ── Strategy CRUD ──────────────────────────────────────────────


def _row_to_strategy(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "symbol": row["symbol"],
        "rules": json.loads(row["rules"]),
        "raw_description": row["raw_description"],
        "ai_explanation": row["ai_explanation"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def save_strategy(strategy: dict) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    strategy_id = str(uuid.uuid4())
    conn = _get_connection()
    conn.execute(
        """INSERT INTO strategies
           (id, name, symbol, rules, raw_description, ai_explanation, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            strategy_id,
            strategy["name"],
            strategy.get("symbol", ""),
            json.dumps(strategy["rules"]),
            strategy.get("raw_description", ""),
            strategy.get("ai_explanation", ""),
            now,
            now,
        ),
    )
    conn.commit()
    conn.close()
    return {**strategy, "id": strategy_id, "created_at": now, "updated_at": now}


def list_strategies() -> list[dict]:
    conn = _get_connection()
    rows = conn.execute(
        "SELECT * FROM strategies ORDER BY updated_at DESC"
    ).fetchall()
    conn.close()
    return [_row_to_strategy(r) for r in rows]


def get_strategy(strategy_id: str) -> dict | None:
    conn = _get_connection()
    row = conn.execute(
        "SELECT * FROM strategies WHERE id = ?", (strategy_id,)
    ).fetchone()
    conn.close()
    return _row_to_strategy(row) if row else None


def update_strategy(strategy_id: str, updates: dict) -> dict | None:
    existing = get_strategy(strategy_id)
    if not existing:
        return None
    now = datetime.now(timezone.utc).isoformat()
    conn = _get_connection()
    conn.execute(
        """UPDATE strategies
           SET name = ?, symbol = ?, rules = ?, raw_description = ?,
               ai_explanation = ?, updated_at = ?
           WHERE id = ?""",
        (
            updates.get("name", existing["name"]),
            updates.get("symbol", existing["symbol"]),
            json.dumps(updates.get("rules", existing["rules"])),
            updates.get("raw_description", existing["raw_description"]),
            updates.get("ai_explanation", existing["ai_explanation"]),
            now,
            strategy_id,
        ),
    )
    conn.commit()
    conn.close()
    return get_strategy(strategy_id)


def delete_strategy(strategy_id: str) -> bool:
    conn = _get_connection()
    cursor = conn.execute("DELETE FROM strategies WHERE id = ?", (strategy_id,))
    conn.commit()
    deleted = cursor.rowcount > 0
    conn.close()
    return deleted


# ── Backtest CRUD ──────────────────────────────────────────────


def _row_to_backtest(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "strategy_id": row["strategy_id"],
        "strategy_name": row["strategy_name"],
        "symbol": row["symbol"],
        "initial_balance": row["initial_balance"],
        "risk_percent": row["risk_percent"],
        "stats": json.loads(row["stats"]),
        "trades": json.loads(row["trades"]),
        "equity_curve": json.loads(row["equity_curve"]),
        "created_at": row["created_at"],
    }


def save_backtest(
    strategy_id: str,
    strategy_name: str,
    symbol: str,
    initial_balance: float,
    risk_percent: float,
    result: dict,
) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    backtest_id = str(uuid.uuid4())
    conn = _get_connection()
    conn.execute(
        """INSERT INTO backtests
           (id, strategy_id, strategy_name, symbol, initial_balance, risk_percent,
            stats, trades, equity_curve, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            backtest_id,
            strategy_id,
            strategy_name,
            symbol,
            initial_balance,
            risk_percent,
            json.dumps(result["stats"]),
            json.dumps(result["trades"]),
            json.dumps(result["equity_curve"]),
            now,
        ),
    )
    conn.commit()
    conn.close()
    return {
        "id": backtest_id,
        "strategy_id": strategy_id,
        "strategy_name": strategy_name,
        "symbol": symbol,
        "initial_balance": initial_balance,
        "risk_percent": risk_percent,
        **result,
        "created_at": now,
    }


def list_backtests(strategy_id: str = None) -> list[dict]:
    conn = _get_connection()
    if strategy_id:
        rows = conn.execute(
            "SELECT id, strategy_id, strategy_name, symbol, initial_balance, risk_percent, stats, created_at FROM backtests WHERE strategy_id = ? ORDER BY created_at DESC",
            (strategy_id,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id, strategy_id, strategy_name, symbol, initial_balance, risk_percent, stats, created_at FROM backtests ORDER BY created_at DESC"
        ).fetchall()
    conn.close()
    return [
        {
            "id": r["id"],
            "strategy_id": r["strategy_id"],
            "strategy_name": r["strategy_name"],
            "symbol": r["symbol"],
            "initial_balance": r["initial_balance"],
            "risk_percent": r["risk_percent"],
            "stats": json.loads(r["stats"]),
            "created_at": r["created_at"],
        }
        for r in rows
    ]


def get_backtest(backtest_id: str) -> dict | None:
    conn = _get_connection()
    row = conn.execute(
        "SELECT * FROM backtests WHERE id = ?", (backtest_id,)
    ).fetchone()
    conn.close()
    return _row_to_backtest(row) if row else None


# ── Algo Trade CRUD ──────────────────────────────────────────────


def _row_to_algo_trade(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "strategy_id": row["strategy_id"],
        "strategy_name": row["strategy_name"],
        "rule_index": row["rule_index"],
        "rule_name": row["rule_name"],
        "symbol": row["symbol"],
        "timeframe": row["timeframe"],
        "direction": row["direction"],
        "volume": row["volume"],
        "entry_price": row["entry_price"],
        "entry_time": row["entry_time"],
        "sl_price": row["sl_price"],
        "tp_price": row["tp_price"],
        "sl_atr_mult": row["sl_atr_mult"],
        "tp_atr_mult": row["tp_atr_mult"],
        "atr_at_entry": row["atr_at_entry"],
        "entry_indicators": json.loads(row["entry_indicators"]),
        "entry_conditions": json.loads(row["entry_conditions"]),
        "exit_price": row["exit_price"],
        "exit_time": row["exit_time"],
        "exit_indicators": json.loads(row["exit_indicators"] or "{}"),
        "exit_reason": row["exit_reason"],
        "bars_held": row["bars_held"],
        "profit": row["profit"],
        "commission": row["commission"],
        "swap": row["swap"],
        "net_pnl": row["net_pnl"],
        "mt5_ticket": row["mt5_ticket"],
        "ml_confidence": row["ml_confidence"] if "ml_confidence" in row.keys() else None,
        "lstm_direction": row["lstm_direction"] if "lstm_direction" in row.keys() else None,
        "lstm_confidence": row["lstm_confidence"] if "lstm_confidence" in row.keys() else None,
        "status": row["status"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def save_algo_trade(trade: dict) -> dict:
    """Record a new algo trade at entry time."""
    now = datetime.now(timezone.utc).isoformat()
    trade_id = str(uuid.uuid4())
    conn = _get_connection()
    conn.execute(
        """INSERT INTO algo_trades
           (id, strategy_id, strategy_name, rule_index, rule_name,
            symbol, timeframe, direction, volume,
            entry_price, entry_time, sl_price, tp_price,
            sl_atr_mult, tp_atr_mult, atr_at_entry,
            entry_indicators, entry_conditions,
            mt5_ticket, ml_confidence, lstm_direction, lstm_confidence,
            status, created_at, updated_at)
           VALUES (?,?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?, ?,?, ?,?,?,?,?,?,?)""",
        (
            trade_id,
            trade.get("strategy_id"),
            trade["strategy_name"],
            trade.get("rule_index", 0),
            trade.get("rule_name", ""),
            trade["symbol"],
            trade["timeframe"],
            trade["direction"],
            trade["volume"],
            trade["entry_price"],
            trade["entry_time"],
            trade.get("sl_price"),
            trade.get("tp_price"),
            trade.get("sl_atr_mult"),
            trade.get("tp_atr_mult"),
            trade.get("atr_at_entry"),
            json.dumps(trade.get("entry_indicators", {})),
            json.dumps(trade.get("entry_conditions", [])),
            trade.get("mt5_ticket"),
            trade.get("ml_confidence"),
            trade.get("lstm_direction"),
            trade.get("lstm_confidence"),
            "open",
            now,
            now,
        ),
    )
    conn.commit()
    conn.close()
    return {**trade, "id": trade_id, "status": "open", "created_at": now, "updated_at": now}


def close_algo_trade(trade_id: str, exit_data: dict) -> dict | None:
    """Update an open algo trade with exit data."""
    now = datetime.now(timezone.utc).isoformat()
    conn = _get_connection()
    conn.execute(
        """UPDATE algo_trades
           SET exit_price = ?, exit_time = ?, exit_indicators = ?,
               exit_reason = ?, bars_held = ?,
               profit = ?, commission = ?, swap = ?, net_pnl = ?,
               status = 'closed', updated_at = ?
           WHERE id = ?""",
        (
            exit_data.get("exit_price"),
            exit_data.get("exit_time"),
            json.dumps(exit_data.get("exit_indicators", {})),
            exit_data.get("exit_reason"),
            exit_data.get("bars_held"),
            exit_data.get("profit"),
            exit_data.get("commission"),
            exit_data.get("swap"),
            exit_data.get("net_pnl"),
            now,
            trade_id,
        ),
    )
    conn.commit()
    conn.close()
    return get_algo_trade(trade_id)


def close_algo_trade_by_ticket(mt5_ticket: int, exit_data: dict) -> dict | None:
    """Close the open algo trade matching an MT5 ticket."""
    conn = _get_connection()
    row = conn.execute(
        "SELECT id FROM algo_trades WHERE mt5_ticket = ? AND status = 'open'",
        (mt5_ticket,),
    ).fetchone()
    conn.close()
    if not row:
        return None
    return close_algo_trade(row["id"], exit_data)


def get_algo_trade(trade_id: str) -> dict | None:
    conn = _get_connection()
    row = conn.execute("SELECT * FROM algo_trades WHERE id = ?", (trade_id,)).fetchone()
    conn.close()
    return _row_to_algo_trade(row) if row else None


def get_open_algo_trade(symbol: str = None) -> dict | None:
    """Get the currently-open algo trade, optionally scoped by symbol."""
    conn = _get_connection()
    if symbol:
        row = conn.execute(
            "SELECT * FROM algo_trades WHERE status = 'open' AND symbol = ? ORDER BY created_at DESC LIMIT 1",
            (symbol,),
        ).fetchone()
    else:
        row = conn.execute(
            "SELECT * FROM algo_trades WHERE status = 'open' ORDER BY created_at DESC LIMIT 1"
        ).fetchone()
    conn.close()
    return _row_to_algo_trade(row) if row else None


def list_algo_trades(
    strategy_id: str = None, symbol: str = None, limit: int = 100
) -> list[dict]:
    """List algo trades with optional filters."""
    conn = _get_connection()
    query = "SELECT * FROM algo_trades WHERE 1=1"
    params: list = []
    if strategy_id:
        query += " AND strategy_id = ?"
        params.append(strategy_id)
    if symbol:
        query += " AND symbol = ?"
        params.append(symbol)
    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [_row_to_algo_trade(r) for r in rows]


def get_algo_trade_stats(
    strategy_id: str = None, symbol: str = None
) -> dict:
    """Compute summary stats for closed algo trades."""
    trades = list_algo_trades(strategy_id=strategy_id, symbol=symbol, limit=10000)
    closed = [t for t in trades if t["status"] == "closed" and t["net_pnl"] is not None]
    if not closed:
        return {
            "total_trades": 0, "winning_trades": 0, "losing_trades": 0,
            "win_rate": 0.0, "total_pnl": 0.0, "avg_pnl": 0.0,
            "avg_bars_held": 0.0, "best_trade": 0.0, "worst_trade": 0.0,
            "exit_reasons": {},
        }
    wins = [t for t in closed if t["net_pnl"] > 0]
    pnls = [t["net_pnl"] for t in closed]
    bars = [t["bars_held"] for t in closed if t["bars_held"] is not None]
    reasons: dict[str, int] = {}
    for t in closed:
        r = t["exit_reason"] or "unknown"
        reasons[r] = reasons.get(r, 0) + 1
    return {
        "total_trades": len(closed),
        "winning_trades": len(wins),
        "losing_trades": len(closed) - len(wins),
        "win_rate": round(len(wins) / len(closed) * 100, 1),
        "total_pnl": round(sum(pnls), 2),
        "avg_pnl": round(sum(pnls) / len(pnls), 2),
        "avg_bars_held": round(sum(bars) / len(bars), 1) if bars else 0.0,
        "best_trade": round(max(pnls), 2),
        "worst_trade": round(min(pnls), 2),
        "exit_reasons": reasons,
    }


# ── ML Training Runs CRUD ──────────────────────────────────────


def save_training_run(run: dict) -> dict:
    """Save an ML training run record."""
    now = datetime.now(timezone.utc).isoformat()
    run_id = str(uuid.uuid4())
    conn = _get_connection()
    conn.execute(
        """INSERT INTO ml_training_runs
           (id, model_type, trained_at, total_samples, accuracy, precision_score,
            recall, f1_score, val_loss, epochs, feature_importance, extra_metrics)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            run_id,
            run.get("model_type", "unknown"),
            now,
            run.get("total_samples", 0),
            run.get("accuracy"),
            run.get("precision_score"),
            run.get("recall"),
            run.get("f1_score"),
            run.get("val_loss"),
            run.get("epochs"),
            json.dumps(run.get("feature_importance", {})),
            json.dumps(run.get("extra_metrics", {})),
        ),
    )
    conn.commit()
    conn.close()
    return {**run, "id": run_id, "trained_at": now}


def list_training_runs(model_type: str = None, limit: int = 50) -> list[dict]:
    """List ML training runs, optionally filtered by model type."""
    conn = _get_connection()
    if model_type:
        rows = conn.execute(
            "SELECT * FROM ml_training_runs WHERE model_type = ? ORDER BY trained_at DESC LIMIT ?",
            (model_type, limit),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM ml_training_runs ORDER BY trained_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    conn.close()
    return [
        {
            "id": r["id"],
            "model_type": r["model_type"],
            "trained_at": r["trained_at"],
            "total_samples": r["total_samples"],
            "accuracy": r["accuracy"],
            "precision_score": r["precision_score"],
            "recall": r["recall"],
            "f1_score": r["f1_score"],
            "val_loss": r["val_loss"],
            "epochs": r["epochs"],
            "feature_importance": json.loads(r["feature_importance"]),
            "extra_metrics": json.loads(r["extra_metrics"]),
        }
        for r in rows
    ]
