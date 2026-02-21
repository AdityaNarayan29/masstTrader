"""
Seed script — populates the database with proven M1 scalping strategies.
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
    # ─────────────────────────────────────────
    # 1. EMA Crossover + MACD Momentum Scalper
    # ─────────────────────────────────────────
    {
        "name": "EMA Cross + MACD Momentum",
        "symbol": "EURUSDm",
        "raw_description": "Buy when EMA 9 crosses above EMA 21, MACD histogram turns positive, and RSI(7) is above 30 but below 70. Exit when MACD histogram turns negative. Use 1.5x ATR stop loss and 2.5x ATR take profit on M1.",
        "ai_explanation": "A classic trend-following scalper combining EMA crossover for direction, MACD histogram for momentum confirmation, and RSI as an overbought/oversold filter. Works best during London and NY sessions on major pairs with tight spreads.",
        "rules": [
            {
                "name": "EMA Cross + MACD Momentum",
                "timeframe": "1m",
                "direction": "buy",
                "description": "EMA 9/21 crossover confirmed by MACD momentum and RSI filter",
                "entry_conditions": [
                    {"indicator": "EMA_9", "parameter": "value", "operator": ">", "value": "EMA_21", "description": "EMA 9 above EMA 21 (bullish crossover)"},
                    {"indicator": "MACD", "parameter": "histogram", "operator": ">", "value": 0, "description": "MACD histogram positive (bullish momentum)"},
                    {"indicator": "RSI", "parameter": "value", "operator": ">", "value": 30, "description": "RSI above 30 (not oversold)"},
                    {"indicator": "RSI", "parameter": "value", "operator": "<", "value": 70, "description": "RSI below 70 (not overbought)"}
                ],
                "exit_conditions": [
                    {"indicator": "MACD", "parameter": "histogram", "operator": "<", "value": 0, "description": "MACD histogram turns negative (momentum fading)"}
                ],
                "stop_loss_atr_multiplier": 1.5,
                "take_profit_atr_multiplier": 2.5,
                "stop_loss_pips": None,
                "take_profit_pips": None,
                "min_bars_in_trade": 3,
                "risk_percent": 1.0
            }
        ],
    },
    # ─────────────────────────────────────────
    # 2. Bollinger Band Mean Reversion + RSI(4)
    # ─────────────────────────────────────────
    {
        "name": "BB Mean Reversion + RSI",
        "symbol": "EURUSDm",
        "raw_description": "Buy when price closes below the lower Bollinger Band and RSI(4) crosses above 20. Exit when price reaches the middle Bollinger Band. Use 1.5x ATR stop loss and 2x ATR take profit on M1.",
        "ai_explanation": "A mean-reversion scalper that buys at the lower Bollinger Band when RSI confirms oversold recovery. Uses a very short RSI period (4) for faster signals on M1. Best during low-volatility Asian session or ranging markets.",
        "rules": [
            {
                "name": "BB Mean Reversion + RSI",
                "timeframe": "1m",
                "direction": "buy",
                "description": "Buy at lower BB with RSI(4) oversold recovery",
                "entry_conditions": [
                    {"indicator": "close", "parameter": "value", "operator": "<", "value": "BB_lower", "description": "Price below lower Bollinger Band"},
                    {"indicator": "RSI", "parameter": "value", "operator": "crosses_above", "value": 20, "description": "RSI(4) crosses above 20 (exiting oversold)"}
                ],
                "exit_conditions": [
                    {"indicator": "close", "parameter": "value", "operator": ">", "value": "BB_middle", "description": "Price reaches middle Bollinger Band (20 SMA)"}
                ],
                "stop_loss_atr_multiplier": 1.5,
                "take_profit_atr_multiplier": 2.0,
                "stop_loss_pips": None,
                "take_profit_pips": None,
                "min_bars_in_trade": 2,
                "risk_percent": 0.5
            }
        ],
    },
    # ─────────────────────────────────────────
    # 3. BB + RSI + ADX Triple Filter Scalper
    # ─────────────────────────────────────────
    {
        "name": "BB + RSI + ADX Triple Filter",
        "symbol": "EURUSDm",
        "raw_description": "Buy when price is below the lower Bollinger Band, RSI crosses above 30, and ADX is below 32 (confirming range conditions). Exit when price reaches the middle Bollinger Band. Use 2x ATR stop loss and 2x ATR take profit on M1.",
        "ai_explanation": "A triple-filtered mean-reversion strategy. The ADX filter (below 32) ensures we only trade in ranging markets where mean reversion works. Backtested across 76+ scenarios on TradingView. Avoid 30 min before and 1 hour after high-impact news.",
        "rules": [
            {
                "name": "BB + RSI + ADX Triple Filter",
                "timeframe": "1m",
                "direction": "buy",
                "description": "Mean reversion with ADX range filter to avoid trending markets",
                "entry_conditions": [
                    {"indicator": "close", "parameter": "value", "operator": "<", "value": "BB_lower", "description": "Price below lower Bollinger Band"},
                    {"indicator": "RSI", "parameter": "value", "operator": "crosses_above", "value": 30, "description": "RSI crosses above 30 (recovering from oversold)"},
                    {"indicator": "ADX", "parameter": "value", "operator": "<", "value": 32, "description": "ADX below 32 (market is ranging, not trending)"}
                ],
                "exit_conditions": [
                    {"indicator": "close", "parameter": "value", "operator": ">", "value": "BB_middle", "description": "Price reaches middle Bollinger Band"}
                ],
                "stop_loss_atr_multiplier": 2.0,
                "take_profit_atr_multiplier": 2.0,
                "stop_loss_pips": None,
                "take_profit_pips": None,
                "min_bars_in_trade": 2,
                "risk_percent": 0.5
            }
        ],
    },
    # ─────────────────────────────────────────
    # 4. Stochastic + EMA Trend Scalper
    # ─────────────────────────────────────────
    {
        "name": "Stochastic + EMA Trend Scalper",
        "symbol": "EURUSDm",
        "raw_description": "Buy when EMA 50 is above EMA 100 (uptrend), and Stochastic K crosses above D from below 20 (oversold pullback in uptrend). Exit when Stochastic K goes above 80. Use 1.5x ATR stop loss and 2.5x ATR take profit on M1.",
        "ai_explanation": "A trend-following pullback strategy. Uses dual EMAs (50/100) to confirm the trend direction, then enters on Stochastic oversold crossovers — catching pullbacks within the trend. High win rate in trending sessions.",
        "rules": [
            {
                "name": "Stochastic + EMA Trend Scalper",
                "timeframe": "1m",
                "direction": "buy",
                "description": "Pullback entry in uptrend using Stochastic oversold crossover",
                "entry_conditions": [
                    {"indicator": "EMA_50", "parameter": "value", "operator": ">", "value": "EMA_100", "description": "EMA 50 above EMA 100 (confirmed uptrend)"},
                    {"indicator": "Stochastic", "parameter": "K", "operator": "crosses_above", "value": "Stoch_D", "description": "Stochastic K crosses above D (bullish crossover)"},
                    {"indicator": "Stochastic", "parameter": "K", "operator": "<", "value": 20, "description": "Stochastic K below 20 (oversold zone)"}
                ],
                "exit_conditions": [
                    {"indicator": "Stochastic", "parameter": "K", "operator": ">", "value": 80, "description": "Stochastic K above 80 (overbought — take profit)"}
                ],
                "stop_loss_atr_multiplier": 1.5,
                "take_profit_atr_multiplier": 2.5,
                "stop_loss_pips": None,
                "take_profit_pips": None,
                "min_bars_in_trade": 3,
                "risk_percent": 1.0
            }
        ],
    },
    # ─────────────────────────────────────────
    # 5. ADX + DI Trend Strength Scalper
    # ─────────────────────────────────────────
    {
        "name": "ADX + DI Trend Strength",
        "symbol": "GBPUSDm",
        "raw_description": "Buy when ADX is above 20 (trend exists), DI+ is above DI-, and price is above EMA 14. Exit when ADX drops below 20 or price crosses below EMA 14. Use 1.5x ATR stop loss and 2x ATR take profit on M1.",
        "ai_explanation": "A pure trend-strength scalper using the ADX/DI system. Only trades when a real trend exists (ADX > 20) and directional movement confirms the bias. EMA 14 acts as a fast trend filter. Best on volatile pairs like GBP/USD during London/NY sessions.",
        "rules": [
            {
                "name": "ADX + DI Trend Strength",
                "timeframe": "1m",
                "direction": "buy",
                "description": "Trend-following with ADX strength and DI directional confirmation",
                "entry_conditions": [
                    {"indicator": "ADX", "parameter": "value", "operator": ">", "value": 20, "description": "ADX above 20 (trend has strength)"},
                    {"indicator": "ADX", "parameter": "DI_plus", "operator": ">", "value": "DI_minus", "description": "DI+ above DI- (bullish direction)"},
                    {"indicator": "close", "parameter": "value", "operator": ">", "value": "EMA_14", "description": "Price above EMA 14 (bullish bias)"}
                ],
                "exit_conditions": [
                    {"indicator": "ADX", "parameter": "value", "operator": "<", "value": 20, "description": "ADX below 20 (trend weakening)"}
                ],
                "stop_loss_atr_multiplier": 1.5,
                "take_profit_atr_multiplier": 2.0,
                "stop_loss_pips": None,
                "take_profit_pips": None,
                "min_bars_in_trade": 3,
                "risk_percent": 1.0
            }
        ],
    },
    # ─────────────────────────────────────────
    # 6. Triple EMA Ribbon Scalper
    # ─────────────────────────────────────────
    {
        "name": "Triple EMA Ribbon",
        "symbol": "EURUSDm",
        "raw_description": "Buy when EMAs are stacked bullish (EMA 8 > EMA 21 > EMA 34) and MACD histogram is positive. Exit when price closes below EMA 8 or MACD histogram turns negative. Use 2x ATR stop loss and 3x ATR take profit on M1.",
        "ai_explanation": "A strong trend-following strategy using a triple EMA ribbon for direction alignment. All three EMAs must be stacked in order (8 > 21 > 34) confirming a clean uptrend. MACD histogram adds momentum confirmation. Works well on trending sessions.",
        "rules": [
            {
                "name": "Triple EMA Ribbon",
                "timeframe": "1m",
                "direction": "buy",
                "description": "Bullish EMA stack (8>21>34) with MACD momentum confirmation",
                "entry_conditions": [
                    {"indicator": "EMA_8", "parameter": "value", "operator": ">", "value": "EMA_21", "description": "EMA 8 above EMA 21 (fast above medium)"},
                    {"indicator": "EMA_21", "parameter": "value", "operator": ">", "value": "EMA_34", "description": "EMA 21 above EMA 34 (medium above slow)"},
                    {"indicator": "MACD", "parameter": "histogram", "operator": ">", "value": 0, "description": "MACD histogram positive (momentum confirms)"}
                ],
                "exit_conditions": [
                    {"indicator": "MACD", "parameter": "histogram", "operator": "<", "value": 0, "description": "MACD histogram turns negative (momentum fading)"}
                ],
                "stop_loss_atr_multiplier": 2.0,
                "take_profit_atr_multiplier": 3.0,
                "stop_loss_pips": None,
                "take_profit_pips": None,
                "min_bars_in_trade": 3,
                "risk_percent": 1.0
            }
        ],
    },
    # ─────────────────────────────────────────
    # 7. RSI Divergence Scalper
    # ─────────────────────────────────────────
    {
        "name": "RSI Divergence Scalper",
        "symbol": "EURUSDm",
        "raw_description": "Buy when RSI(7) crosses above 30 from oversold and MACD histogram is increasing (getting less negative). Exit when RSI crosses above 60 or MACD histogram turns negative. Use 1.5x ATR stop loss and 2.5x ATR take profit on M1.",
        "ai_explanation": "A counter-trend reversal scalper. Enters when RSI recovers from oversold with MACD histogram showing decreasing bearish momentum (divergence signal). The RSI 60 exit captures the mean reversion move without overstaying. Best on EUR/USD and GBP/USD.",
        "rules": [
            {
                "name": "RSI Divergence Scalper",
                "timeframe": "1m",
                "direction": "buy",
                "description": "Counter-trend entry on RSI oversold recovery with MACD divergence",
                "entry_conditions": [
                    {"indicator": "RSI", "parameter": "value", "operator": "crosses_above", "value": 30, "description": "RSI crosses above 30 (recovering from oversold)"},
                    {"indicator": "MACD", "parameter": "histogram", "operator": ">", "value": "MACD_histogram_prev", "description": "MACD histogram increasing (bearish momentum fading)"}
                ],
                "exit_conditions": [
                    {"indicator": "RSI", "parameter": "value", "operator": ">", "value": 60, "description": "RSI above 60 (mean reversion target reached)"}
                ],
                "stop_loss_atr_multiplier": 1.5,
                "take_profit_atr_multiplier": 2.5,
                "stop_loss_pips": None,
                "take_profit_pips": None,
                "min_bars_in_trade": 2,
                "risk_percent": 0.5
            }
        ],
    },
    # ─────────────────────────────────────────
    # 8. BB Squeeze Breakout + Volume
    # ─────────────────────────────────────────
    {
        "name": "BB Squeeze Breakout",
        "symbol": "GBPUSDm",
        "raw_description": "Buy when price closes above the upper Bollinger Band, close is above EMA 50 (bullish bias), and RSI is above 50 (momentum confirms). Exit when price closes below the middle Bollinger Band. Use 2x ATR stop loss and 3x ATR take profit on M1.",
        "ai_explanation": "A volatility breakout strategy. Bollinger Band squeezes (low volatility) precede explosive moves. This strategy enters when price breaks above the upper band with trend and momentum confirmation. The EMA 50 keeps you on the right side. Best on volatile pairs like GBP/USD and GBP/JPY during London/NY overlap.",
        "rules": [
            {
                "name": "BB Squeeze Breakout",
                "timeframe": "1m",
                "direction": "buy",
                "description": "Breakout above upper BB with trend and momentum confirmation",
                "entry_conditions": [
                    {"indicator": "close", "parameter": "value", "operator": ">", "value": "BB_upper", "description": "Price breaks above upper Bollinger Band"},
                    {"indicator": "close", "parameter": "value", "operator": ">", "value": "EMA_50", "description": "Price above EMA 50 (bullish trend bias)"},
                    {"indicator": "RSI", "parameter": "value", "operator": ">", "value": 50, "description": "RSI above 50 (bullish momentum)"}
                ],
                "exit_conditions": [
                    {"indicator": "close", "parameter": "value", "operator": "<", "value": "BB_middle", "description": "Price falls back to middle Bollinger Band (failed breakout)"}
                ],
                "stop_loss_atr_multiplier": 2.0,
                "take_profit_atr_multiplier": 3.0,
                "stop_loss_pips": None,
                "take_profit_pips": None,
                "min_bars_in_trade": 2,
                "risk_percent": 1.0
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
