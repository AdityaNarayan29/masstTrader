"""
Agent-specific database layer.
Extended trade schema with regime, session, confidence, reasoning, RAG passages.
Separate from V1 tables — new table `agent_trades` + `agent_cycles`.
"""
import sqlite3
import json
import uuid
import os
from datetime import datetime, timezone

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "data", "massttrader.db")


def _conn() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_agent_tables():
    """Create V2 agent tables. Idempotent."""
    conn = _conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS agent_trades (
            id                TEXT PRIMARY KEY,
            cycle_id          TEXT,
            symbol            TEXT NOT NULL,
            direction         TEXT NOT NULL,
            volume            REAL NOT NULL,
            entry_price       REAL NOT NULL,
            entry_time        TEXT NOT NULL,
            sl_price          REAL,
            tp_price          REAL,
            exit_price        REAL,
            exit_time         TEXT,
            exit_reason       TEXT,
            profit            REAL,
            net_pnl           REAL,
            bars_held         INTEGER,
            slippage          REAL,
            fill_type         TEXT,

            -- V2 enriched fields
            regime            TEXT,
            session           TEXT,
            timeframe_mode    TEXT,
            confidence        REAL,
            reasoning         TEXT,
            prompt_version    TEXT,
            rag_passages      TEXT NOT NULL DEFAULT '[]',
            devil_advocate    INTEGER NOT NULL DEFAULT 0,
            devil_result      TEXT,

            -- Context snapshot at entry
            macro_snapshot    TEXT NOT NULL DEFAULT '{}',
            crypto_snapshot   TEXT NOT NULL DEFAULT '{}',
            sentiment_snapshot TEXT NOT NULL DEFAULT '{}',
            indicators_snapshot TEXT NOT NULL DEFAULT '{}',

            -- Risk
            risk_amount       REAL,
            risk_percent      REAL,
            rr_ratio          REAL,
            atr_at_entry      REAL,
            consecutive_losses INTEGER DEFAULT 0,

            -- Partial exit tracking
            partial_exit_done INTEGER NOT NULL DEFAULT 0,
            partial_exit_price REAL,
            partial_exit_time TEXT,
            sl_moved_to_be    INTEGER NOT NULL DEFAULT 0,
            trailing_stop_active INTEGER NOT NULL DEFAULT 0,

            -- MT5
            mt5_ticket        INTEGER,

            status            TEXT NOT NULL DEFAULT 'open',
            created_at        TEXT NOT NULL,
            updated_at        TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS agent_cycles (
            id              TEXT PRIMARY KEY,
            timestamp       TEXT NOT NULL,
            timeframe_mode  TEXT,
            symbols_scanned TEXT NOT NULL DEFAULT '[]',
            symbols_cleared TEXT NOT NULL DEFAULT '[]',
            symbols_skipped TEXT NOT NULL DEFAULT '[]',
            regimes         TEXT NOT NULL DEFAULT '{}',
            signals         TEXT NOT NULL DEFAULT '{}',
            orders          TEXT NOT NULL DEFAULT '{}',
            executions      TEXT NOT NULL DEFAULT '{}',
            monitor_actions TEXT NOT NULL DEFAULT '[]',
            errors          TEXT NOT NULL DEFAULT '[]',
            session         TEXT,
            news_blackout   INTEGER NOT NULL DEFAULT 0,
            duration_ms     INTEGER,
            created_at      TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS agent_daily_stats (
            id            TEXT PRIMARY KEY,
            date          TEXT NOT NULL UNIQUE,
            starting_balance REAL,
            ending_balance REAL,
            total_trades  INTEGER NOT NULL DEFAULT 0,
            winning_trades INTEGER NOT NULL DEFAULT 0,
            losing_trades INTEGER NOT NULL DEFAULT 0,
            total_pnl     REAL NOT NULL DEFAULT 0,
            max_drawdown  REAL NOT NULL DEFAULT 0,
            win_rate      REAL NOT NULL DEFAULT 0,
            by_session    TEXT NOT NULL DEFAULT '{}',
            by_regime     TEXT NOT NULL DEFAULT '{}',
            by_symbol     TEXT NOT NULL DEFAULT '{}',
            prompt_version TEXT,
            created_at    TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_agent_trades_symbol ON agent_trades(symbol);
        CREATE INDEX IF NOT EXISTS idx_agent_trades_status ON agent_trades(status);
        CREATE INDEX IF NOT EXISTS idx_agent_trades_created ON agent_trades(created_at);
        CREATE INDEX IF NOT EXISTS idx_agent_cycles_created ON agent_cycles(created_at);
    """)
    conn.close()


# ── Agent Trade CRUD ─────────────────────────────────────────────

def save_agent_trade(trade: dict) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    trade_id = str(uuid.uuid4())
    conn = _conn()
    conn.execute(
        """INSERT INTO agent_trades
           (id, cycle_id, symbol, direction, volume, entry_price, entry_time,
            sl_price, tp_price, regime, session, timeframe_mode,
            confidence, reasoning, prompt_version,
            rag_passages, devil_advocate, devil_result,
            macro_snapshot, crypto_snapshot, sentiment_snapshot, indicators_snapshot,
            risk_amount, risk_percent, rr_ratio, atr_at_entry, consecutive_losses,
            mt5_ticket, fill_type, slippage,
            status, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?, ?,?,?,?,?, ?,?,?, ?,?,?, ?,?,?,?, ?,?,?,?,?, ?,?,?, ?,?,?)""",
        (
            trade_id,
            trade.get("cycle_id"),
            trade["symbol"],
            trade["direction"],
            trade["volume"],
            trade["entry_price"],
            trade.get("entry_time", now),
            trade.get("sl_price"),
            trade.get("tp_price"),
            trade.get("regime"),
            trade.get("session"),
            trade.get("timeframe_mode"),
            trade.get("confidence"),
            trade.get("reasoning"),
            trade.get("prompt_version"),
            json.dumps(trade.get("rag_passages", [])),
            1 if trade.get("devil_advocate") else 0,
            trade.get("devil_result"),
            json.dumps(trade.get("macro_snapshot", {})),
            json.dumps(trade.get("crypto_snapshot", {})),
            json.dumps(trade.get("sentiment_snapshot", {})),
            json.dumps(trade.get("indicators_snapshot", {})),
            trade.get("risk_amount"),
            trade.get("risk_percent"),
            trade.get("rr_ratio"),
            trade.get("atr_at_entry"),
            trade.get("consecutive_losses", 0),
            trade.get("mt5_ticket"),
            trade.get("fill_type"),
            trade.get("slippage"),
            "open",
            now,
            now,
        ),
    )
    conn.commit()
    conn.close()
    return {**trade, "id": trade_id, "status": "open", "created_at": now}


def close_agent_trade(trade_id: str, exit_data: dict) -> dict | None:
    now = datetime.now(timezone.utc).isoformat()
    conn = _conn()
    conn.execute(
        """UPDATE agent_trades
           SET exit_price=?, exit_time=?, exit_reason=?,
               profit=?, net_pnl=?, bars_held=?,
               status='closed', updated_at=?
           WHERE id=?""",
        (
            exit_data.get("exit_price"),
            exit_data.get("exit_time", now),
            exit_data.get("exit_reason"),
            exit_data.get("profit"),
            exit_data.get("net_pnl"),
            exit_data.get("bars_held"),
            now,
            trade_id,
        ),
    )
    conn.commit()
    conn.close()
    return get_agent_trade(trade_id)


def update_agent_trade_partial_exit(trade_id: str, price: float):
    """Mark that partial exit at 1R was done."""
    now = datetime.now(timezone.utc).isoformat()
    conn = _conn()
    conn.execute(
        """UPDATE agent_trades
           SET partial_exit_done=1, partial_exit_price=?, partial_exit_time=?,
               sl_moved_to_be=1, updated_at=?
           WHERE id=?""",
        (price, now, now, trade_id),
    )
    conn.commit()
    conn.close()


def update_agent_trade_trailing(trade_id: str, active: bool):
    now = datetime.now(timezone.utc).isoformat()
    conn = _conn()
    conn.execute(
        "UPDATE agent_trades SET trailing_stop_active=?, updated_at=? WHERE id=?",
        (1 if active else 0, now, trade_id),
    )
    conn.commit()
    conn.close()


def _row_to_agent_trade(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "cycle_id": row["cycle_id"],
        "symbol": row["symbol"],
        "direction": row["direction"],
        "volume": row["volume"],
        "entry_price": row["entry_price"],
        "entry_time": row["entry_time"],
        "sl_price": row["sl_price"],
        "tp_price": row["tp_price"],
        "exit_price": row["exit_price"],
        "exit_time": row["exit_time"],
        "exit_reason": row["exit_reason"],
        "profit": row["profit"],
        "net_pnl": row["net_pnl"],
        "bars_held": row["bars_held"],
        "slippage": row["slippage"],
        "fill_type": row["fill_type"],
        "regime": row["regime"],
        "session": row["session"],
        "timeframe_mode": row["timeframe_mode"],
        "confidence": row["confidence"],
        "reasoning": row["reasoning"],
        "prompt_version": row["prompt_version"],
        "rag_passages": json.loads(row["rag_passages"]),
        "devil_advocate": bool(row["devil_advocate"]),
        "devil_result": row["devil_result"],
        "macro_snapshot": json.loads(row["macro_snapshot"]),
        "risk_amount": row["risk_amount"],
        "risk_percent": row["risk_percent"],
        "rr_ratio": row["rr_ratio"],
        "atr_at_entry": row["atr_at_entry"],
        "consecutive_losses": row["consecutive_losses"],
        "partial_exit_done": bool(row["partial_exit_done"]),
        "trailing_stop_active": bool(row["trailing_stop_active"]),
        "mt5_ticket": row["mt5_ticket"],
        "status": row["status"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def get_agent_trade(trade_id: str) -> dict | None:
    conn = _conn()
    row = conn.execute("SELECT * FROM agent_trades WHERE id=?", (trade_id,)).fetchone()
    conn.close()
    return _row_to_agent_trade(row) if row else None


def get_open_agent_trades(symbol: str = None) -> list[dict]:
    conn = _conn()
    if symbol:
        rows = conn.execute(
            "SELECT * FROM agent_trades WHERE status='open' AND symbol=?", (symbol,)
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM agent_trades WHERE status='open'").fetchall()
    conn.close()
    return [_row_to_agent_trade(r) for r in rows]


def get_recent_agent_trades(limit: int = 50) -> list[dict]:
    conn = _conn()
    rows = conn.execute(
        "SELECT * FROM agent_trades WHERE status='closed' ORDER BY created_at DESC LIMIT ?",
        (limit,),
    ).fetchall()
    conn.close()
    return [_row_to_agent_trade(r) for r in rows]


def get_consecutive_losses() -> int:
    """Count consecutive losses from most recent closed trades."""
    conn = _conn()
    rows = conn.execute(
        "SELECT net_pnl FROM agent_trades WHERE status='closed' ORDER BY created_at DESC LIMIT 10"
    ).fetchall()
    conn.close()
    count = 0
    for r in rows:
        if r["net_pnl"] is not None and r["net_pnl"] < 0:
            count += 1
        else:
            break
    return count


def get_consecutive_wins() -> int:
    """Count consecutive wins from most recent closed trades."""
    conn = _conn()
    rows = conn.execute(
        "SELECT net_pnl FROM agent_trades WHERE status='closed' ORDER BY created_at DESC LIMIT 10"
    ).fetchall()
    conn.close()
    count = 0
    for r in rows:
        if r["net_pnl"] is not None and r["net_pnl"] > 0:
            count += 1
        else:
            break
    return count


# ── Cycle logging ────────────────────────────────────────────────

def save_agent_cycle(cycle: dict) -> str:
    now = datetime.now(timezone.utc).isoformat()
    cycle_id = cycle.get("id", str(uuid.uuid4()))
    conn = _conn()
    conn.execute(
        """INSERT INTO agent_cycles
           (id, timestamp, timeframe_mode, symbols_scanned, symbols_cleared,
            symbols_skipped, regimes, signals, orders, executions,
            monitor_actions, errors, session, news_blackout, duration_ms, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            cycle_id,
            cycle.get("timestamp", now),
            cycle.get("timeframe_mode"),
            json.dumps(cycle.get("symbols_scanned", [])),
            json.dumps(cycle.get("symbols_cleared", [])),
            json.dumps(cycle.get("symbols_skipped", [])),
            json.dumps(cycle.get("regimes", {})),
            json.dumps(cycle.get("signals", {})),
            json.dumps(cycle.get("orders", {})),
            json.dumps(cycle.get("executions", {})),
            json.dumps(cycle.get("monitor_actions", [])),
            json.dumps(cycle.get("errors", [])),
            cycle.get("session"),
            1 if cycle.get("news_blackout") else 0,
            cycle.get("duration_ms"),
            now,
        ),
    )
    conn.commit()
    conn.close()
    return cycle_id


# ── Daily stats ──────────────────────────────────────────────────

def get_daily_pnl(date_str: str = None) -> float:
    """Get total PnL for a given day (default: today)."""
    if date_str is None:
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    conn = _conn()
    row = conn.execute(
        """SELECT COALESCE(SUM(net_pnl), 0) as total
           FROM agent_trades
           WHERE status='closed' AND DATE(exit_time) = ?""",
        (date_str,),
    ).fetchone()
    conn.close()
    return row["total"] if row else 0.0


def get_weekly_pnl() -> float:
    """Get total PnL for current week (Mon-Sun)."""
    now = datetime.now(timezone.utc)
    monday = now - __import__("datetime").timedelta(days=now.weekday())
    monday_str = monday.strftime("%Y-%m-%d")
    conn = _conn()
    row = conn.execute(
        """SELECT COALESCE(SUM(net_pnl), 0) as total
           FROM agent_trades
           WHERE status='closed' AND DATE(exit_time) >= ?""",
        (monday_str,),
    ).fetchone()
    conn.close()
    return row["total"] if row else 0.0
