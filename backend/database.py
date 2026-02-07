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
    """)
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
