"""
Seed script — populates the database with sample trading strategies.
Run from project root: python backend/seed_strategies.py
Works with any Python 3.7+ (no type union syntax).
"""
import sqlite3
import json
import uuid
import os
from datetime import datetime, timezone

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "massttrader.db")

STRATEGIES = [
    {
        "name": "RSI Reversal",
        "symbol": "EURUSDm",
        "raw_description": "Buy when RSI drops below 30 (oversold), sell when RSI rises above 70 (overbought). Use 20-pip stop loss and 40-pip take profit.",
        "ai_explanation": "A classic mean-reversion strategy that buys oversold conditions and exits at overbought levels. Works best in ranging/sideways markets.",
        "rules": [
            {
                "direction": "buy",
                "entry_conditions": [
                    {"indicator": "RSI", "parameter": "value", "operator": "<", "value": 30, "description": "RSI below 30 (oversold)"}
                ],
                "exit_conditions": [
                    {"indicator": "RSI", "parameter": "value", "operator": ">", "value": 70, "description": "RSI above 70 (overbought)"}
                ],
                "stop_loss_pips": 20,
                "take_profit_pips": 40
            }
        ],
    },
    {
        "name": "MACD Crossover",
        "symbol": "EURUSDm",
        "raw_description": "Buy when MACD line crosses above signal line and RSI is above 50. Exit when MACD line crosses below signal line. 25-pip SL, 50-pip TP.",
        "ai_explanation": "A trend-following strategy combining MACD momentum crossover with RSI as a trend filter. Only takes long entries when overall momentum is bullish.",
        "rules": [
            {
                "direction": "buy",
                "entry_conditions": [
                    {"indicator": "MACD", "parameter": "line", "operator": "crosses_above", "value": "MACD_signal", "description": "MACD line crosses above signal line"},
                    {"indicator": "RSI", "parameter": "value", "operator": ">", "value": 50, "description": "RSI above 50 (bullish momentum)"}
                ],
                "exit_conditions": [
                    {"indicator": "MACD", "parameter": "line", "operator": "crosses_below", "value": "MACD_signal", "description": "MACD line crosses below signal line"}
                ],
                "stop_loss_pips": 25,
                "take_profit_pips": 50
            }
        ],
    },
    {
        "name": "Bollinger Bounce",
        "symbol": "EURUSDm",
        "raw_description": "Buy when price touches the lower Bollinger Band and RSI is below 40. Exit when price reaches the middle band. 15-pip SL, 30-pip TP.",
        "ai_explanation": "A mean-reversion strategy that enters at the lower Bollinger Band expecting a bounce back to the mean. RSI filter avoids catching falling knives in strong downtrends.",
        "rules": [
            {
                "direction": "buy",
                "entry_conditions": [
                    {"indicator": "close", "parameter": "value", "operator": "<", "value": "BB_lower", "description": "Price below lower Bollinger Band"},
                    {"indicator": "RSI", "parameter": "value", "operator": "<", "value": 40, "description": "RSI below 40 (confirming oversold)"}
                ],
                "exit_conditions": [
                    {"indicator": "close", "parameter": "value", "operator": ">", "value": "BB_middle", "description": "Price returns to middle Bollinger Band"}
                ],
                "stop_loss_pips": 15,
                "take_profit_pips": 30
            }
        ],
    },
    {
        "name": "EMA + ADX Trend Rider",
        "symbol": "GBPUSDm",
        "raw_description": "Buy when price is above EMA 50 and ADX is above 25 (strong trend). Exit when ADX drops below 20 (trend weakening). 30-pip SL, 60-pip TP.",
        "ai_explanation": "A trend-strength strategy that only enters when the market is in a confirmed uptrend (price > EMA) AND the trend is strong (ADX > 25). Exits early when trend momentum fades.",
        "rules": [
            {
                "direction": "buy",
                "entry_conditions": [
                    {"indicator": "close", "parameter": "value", "operator": ">", "value": "EMA_50", "description": "Price above EMA 50 (uptrend)"},
                    {"indicator": "ADX", "parameter": "value", "operator": ">", "value": 25, "description": "ADX above 25 (strong trend)"}
                ],
                "exit_conditions": [
                    {"indicator": "ADX", "parameter": "value", "operator": "<", "value": 20, "description": "ADX below 20 (trend weakening)"}
                ],
                "stop_loss_pips": 30,
                "take_profit_pips": 60
            }
        ],
    },
    {
        "name": "Stochastic + BB Squeeze",
        "symbol": "EURUSDm",
        "raw_description": "Buy when Stochastic K crosses above D from below 20, and Bollinger Band width is below 0.002 (squeeze). Exit when Stoch K above 80. 20-pip SL, 45-pip TP.",
        "ai_explanation": "Combines the Stochastic oscillator's oversold crossover with a Bollinger Band squeeze to catch breakouts from low-volatility consolidation zones.",
        "rules": [
            {
                "direction": "buy",
                "entry_conditions": [
                    {"indicator": "Stochastic", "parameter": "K", "operator": "crosses_above", "value": "Stoch_D", "description": "Stochastic K crosses above D"},
                    {"indicator": "Stochastic", "parameter": "K", "operator": "<", "value": 20, "description": "Stochastic K below 20 (oversold zone)"},
                    {"indicator": "Bollinger", "parameter": "width", "operator": "<", "value": 0.002, "description": "Bollinger Band width squeezed"}
                ],
                "exit_conditions": [
                    {"indicator": "Stochastic", "parameter": "K", "operator": ">", "value": 80, "description": "Stochastic K above 80 (overbought)"}
                ],
                "stop_loss_pips": 20,
                "take_profit_pips": 45
            }
        ],
    },
    {
        "name": "MACD Histogram Momentum",
        "symbol": "GBPUSDm",
        "raw_description": "Buy when MACD histogram turns positive and price is above EMA 50. Exit when histogram turns negative. 20-pip SL, 40-pip TP.",
        "ai_explanation": "A momentum strategy using the MACD histogram as a leading signal. When it flips positive, momentum is shifting bullish. The EMA filter keeps you on the right side of the trend.",
        "rules": [
            {
                "direction": "buy",
                "entry_conditions": [
                    {"indicator": "MACD", "parameter": "histogram", "operator": ">", "value": 0, "description": "MACD histogram is positive"},
                    {"indicator": "close", "parameter": "value", "operator": ">", "value": "EMA_50", "description": "Price above EMA 50 (uptrend confirmation)"}
                ],
                "exit_conditions": [
                    {"indicator": "MACD", "parameter": "histogram", "operator": "<", "value": 0, "description": "MACD histogram turns negative"}
                ],
                "stop_loss_pips": 20,
                "take_profit_pips": 40
            }
        ],
    },
    {
        "name": "RSI + EMA Pullback",
        "symbol": "EURUSDm",
        "raw_description": "Buy when RSI crosses above 40 from below and price is above EMA 50 (pullback in uptrend). Exit when RSI crosses below 60. 15-pip SL, 35-pip TP.",
        "ai_explanation": "Catches pullback entries in established uptrends. Waits for RSI to dip to the 30-40 zone then re-enters as momentum returns. EMA keeps you in trend direction only.",
        "rules": [
            {
                "direction": "buy",
                "entry_conditions": [
                    {"indicator": "RSI", "parameter": "value", "operator": "crosses_above", "value": 40, "description": "RSI crosses above 40 (momentum returning)"},
                    {"indicator": "close", "parameter": "value", "operator": ">", "value": "EMA_50", "description": "Price above EMA 50 (in uptrend)"}
                ],
                "exit_conditions": [
                    {"indicator": "RSI", "parameter": "value", "operator": "crosses_below", "value": 60, "description": "RSI drops back below 60"}
                ],
                "stop_loss_pips": 15,
                "take_profit_pips": 35
            }
        ],
    },
]


def main():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
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

    now = datetime.now(timezone.utc).isoformat()
    count = 0
    for s in STRATEGIES:
        sid = str(uuid.uuid4())
        conn.execute(
            """INSERT INTO strategies
               (id, name, symbol, rules, raw_description, ai_explanation, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                sid,
                s["name"],
                s["symbol"],
                json.dumps(s["rules"]),
                s["raw_description"],
                s.get("ai_explanation", ""),
                now,
                now,
            ),
        )
        count += 1
        print(f"  + {s['name']} ({s['symbol']}) — id: {sid[:8]}...")

    conn.commit()
    conn.close()
    print(f"\nDone! Seeded {count} strategies into {DB_PATH}")


if __name__ == "__main__":
    main()
