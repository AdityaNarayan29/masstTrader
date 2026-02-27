"""
Seed script — populates the database with trading strategies across multiple symbols.
Run from project root: python backend/seed_strategies.py
Works with any Python 3.7+ (no type union syntax).

Covers: Forex (EURUSDm, GBPUSDm, USDJPYm), Crypto (BTCUSDm), Gold (XAUUSDm)
Includes M1 scalpers, M5 swing entries, M15 trend strategies, and H1 position strategies.
"""
import sqlite3
import json
import uuid
import os
from datetime import datetime, timezone

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "massttrader.db")

STRATEGIES = [
    # ═══════════════════════════════════════════
    #  EURUSD — Forex Major (tight spreads)
    # ═══════════════════════════════════════════

    # 1. EMA Crossover + MACD Momentum — EURUSDm
    {
        "name": "EMA Cross + MACD Momentum — EURUSD",
        "symbol": "EURUSDm",
        "raw_description": "Buy when EMA 9 crosses above EMA 21, MACD histogram turns positive, and RSI is above 30 but below 70. Exit when MACD histogram turns negative. Use 1.5x ATR stop loss and 2.5x ATR take profit on M1.",
        "ai_explanation": "A classic trend-following scalper combining EMA crossover for direction, MACD histogram for momentum confirmation, and RSI as an overbought/oversold filter. Works best during London and NY sessions on EUR/USD with tight spreads.",
        "rules": [
            {
                "name": "EMA Cross + MACD Momentum",
                "timeframe": "1m",
                "direction": "buy",
                "description": "EMA 9/21 crossover confirmed by MACD momentum and RSI filter on EURUSD",
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
    # 2. BB Mean Reversion + RSI — EURUSDm
    {
        "name": "BB Mean Reversion + RSI — EURUSD",
        "symbol": "EURUSDm",
        "raw_description": "Buy when price closes below the lower Bollinger Band and RSI crosses above 20. Exit when price reaches the middle Bollinger Band. Use 1.5x ATR stop loss and 2x ATR take profit on M1.",
        "ai_explanation": "A mean-reversion scalper that buys at the lower Bollinger Band when RSI confirms oversold recovery. Uses a very short RSI period for faster signals on M1. Best during low-volatility Asian session or ranging EUR/USD markets.",
        "rules": [
            {
                "name": "BB Mean Reversion + RSI",
                "timeframe": "1m",
                "direction": "buy",
                "description": "Buy at lower BB with RSI oversold recovery on EURUSD",
                "entry_conditions": [
                    {"indicator": "close", "parameter": "value", "operator": "<", "value": "BB_lower", "description": "Price below lower Bollinger Band"},
                    {"indicator": "RSI", "parameter": "value", "operator": "crosses_above", "value": 20, "description": "RSI crosses above 20 (exiting oversold)"}
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
    # 3. BB + RSI + ADX Triple Filter — EURUSDm
    {
        "name": "BB + RSI + ADX Triple Filter — EURUSD",
        "symbol": "EURUSDm",
        "raw_description": "Buy when price is below the lower Bollinger Band, RSI crosses above 30, and ADX is below 32 (confirming range conditions). Exit when price reaches the middle Bollinger Band. Use 2x ATR stop loss and 2x ATR take profit on M1.",
        "ai_explanation": "A triple-filtered mean-reversion strategy for EUR/USD. The ADX filter (below 32) ensures we only trade in ranging markets where mean reversion works. Avoid 30 min before and 1 hour after high-impact news.",
        "rules": [
            {
                "name": "BB + RSI + ADX Triple Filter",
                "timeframe": "1m",
                "direction": "buy",
                "description": "Mean reversion with ADX range filter on EURUSD",
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
    # 4. Stochastic + EMA Trend — EURUSDm
    {
        "name": "Stochastic + EMA Trend — EURUSD",
        "symbol": "EURUSDm",
        "raw_description": "Buy when EMA 50 is above EMA 100 (uptrend), and Stochastic K crosses above D from below 20. Exit when Stochastic K goes above 80. Use 1.5x ATR stop loss and 2.5x ATR take profit on M1.",
        "ai_explanation": "A trend-following pullback strategy for EUR/USD. Uses dual EMAs (50/100) to confirm the trend direction, then enters on Stochastic oversold crossovers — catching pullbacks within the trend. High win rate in trending sessions.",
        "rules": [
            {
                "name": "Stochastic + EMA Trend",
                "timeframe": "1m",
                "direction": "buy",
                "description": "Pullback entry in uptrend using Stochastic oversold crossover on EURUSD",
                "entry_conditions": [
                    {"indicator": "EMA_50", "parameter": "value", "operator": ">", "value": "EMA_100", "description": "EMA 50 above EMA 100 (confirmed uptrend)"},
                    {"indicator": "Stochastic", "parameter": "K", "operator": "crosses_above", "value": "Stoch_D", "description": "Stochastic K crosses above D (bullish crossover)"},
                    {"indicator": "Stochastic", "parameter": "K", "operator": "<", "value": 20, "description": "Stochastic K below 20 (oversold zone)"}
                ],
                "exit_conditions": [
                    {"indicator": "Stochastic", "parameter": "K", "operator": ">", "value": 80, "description": "Stochastic K above 80 (overbought)"}
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
    # 5. RSI Divergence Scalper — EURUSDm
    {
        "name": "RSI Divergence Scalper — EURUSD",
        "symbol": "EURUSDm",
        "raw_description": "Buy when RSI crosses above 30 from oversold and MACD histogram is increasing. Exit when RSI crosses above 60. Use 1.5x ATR stop loss and 2.5x ATR take profit on M1.",
        "ai_explanation": "A counter-trend reversal scalper for EUR/USD. Enters when RSI recovers from oversold with MACD histogram showing decreasing bearish momentum (divergence signal). The RSI 60 exit captures the mean reversion move without overstaying.",
        "rules": [
            {
                "name": "RSI Divergence Scalper",
                "timeframe": "1m",
                "direction": "buy",
                "description": "Counter-trend entry on RSI oversold recovery on EURUSD",
                "entry_conditions": [
                    {"indicator": "RSI", "parameter": "value", "operator": "crosses_above", "value": 30, "description": "RSI crosses above 30 (recovering from oversold)"},
                    {"indicator": "MACD", "parameter": "histogram", "operator": ">", "value": "MACD_histogram_prev", "description": "MACD histogram increasing (bearish momentum fading)"}
                ],
                "exit_conditions": [
                    {"indicator": "RSI", "parameter": "value", "operator": ">", "value": 60, "description": "RSI above 60 (mean reversion target)"}
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

    # ═══════════════════════════════════════════
    #  GBPUSD — Volatile Forex Major
    # ═══════════════════════════════════════════

    # 6. ADX + DI Trend Strength — GBPUSDm
    {
        "name": "ADX + DI Trend Strength — GBPUSD",
        "symbol": "GBPUSDm",
        "raw_description": "Buy when ADX is above 20, DI+ is above DI-, and price is above EMA 14. Exit when ADX drops below 20. Use 1.5x ATR stop loss and 2x ATR take profit on M1.",
        "ai_explanation": "A pure trend-strength scalper using the ADX/DI system on GBP/USD. Only trades when a real trend exists (ADX > 20) and directional movement confirms the bias. EMA 14 acts as a fast trend filter. Best during London/NY sessions when Cable is volatile.",
        "rules": [
            {
                "name": "ADX + DI Trend Strength",
                "timeframe": "1m",
                "direction": "buy",
                "description": "Trend-following with ADX strength and DI direction on GBPUSD",
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
    # 7. BB Squeeze Breakout — GBPUSDm
    {
        "name": "BB Squeeze Breakout — GBPUSD",
        "symbol": "GBPUSDm",
        "raw_description": "Buy when price closes above the upper Bollinger Band, close is above EMA 50, and RSI is above 50. Exit when price closes below the middle Bollinger Band. Use 2x ATR stop loss and 3x ATR take profit on M1.",
        "ai_explanation": "A volatility breakout strategy for GBP/USD. Bollinger Band squeezes precede explosive moves. Enters when price breaks above the upper band with trend and momentum confirmation. Best during London/NY overlap when GBP/USD has strong directional moves.",
        "rules": [
            {
                "name": "BB Squeeze Breakout",
                "timeframe": "1m",
                "direction": "buy",
                "description": "Breakout above upper BB on GBPUSD",
                "entry_conditions": [
                    {"indicator": "close", "parameter": "value", "operator": ">", "value": "BB_upper", "description": "Price breaks above upper Bollinger Band"},
                    {"indicator": "close", "parameter": "value", "operator": ">", "value": "EMA_50", "description": "Price above EMA 50 (bullish trend bias)"},
                    {"indicator": "RSI", "parameter": "value", "operator": ">", "value": 50, "description": "RSI above 50 (bullish momentum)"}
                ],
                "exit_conditions": [
                    {"indicator": "close", "parameter": "value", "operator": "<", "value": "BB_middle", "description": "Price falls back to middle Bollinger Band"}
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
    # 8. Triple EMA Ribbon — GBPUSDm
    {
        "name": "Triple EMA Ribbon — GBPUSD",
        "symbol": "GBPUSDm",
        "raw_description": "Buy when EMAs are stacked bullish (EMA 8 > EMA 21 > EMA 34) and MACD histogram is positive. Exit when MACD histogram turns negative. Use 2x ATR stop loss and 3x ATR take profit on M5.",
        "ai_explanation": "Triple EMA ribbon on GBP/USD M5 for slightly longer holds. The EMA stack (8 > 21 > 34) confirms clean uptrends, MACD histogram adds momentum. M5 timeframe reduces noise compared to M1 while keeping entries responsive. Cable's volatility gives wider ATR-based stops room to breathe.",
        "rules": [
            {
                "name": "Triple EMA Ribbon",
                "timeframe": "5m",
                "direction": "buy",
                "description": "Bullish EMA stack (8>21>34) with MACD on GBPUSD M5",
                "entry_conditions": [
                    {"indicator": "EMA_8", "parameter": "value", "operator": ">", "value": "EMA_21", "description": "EMA 8 above EMA 21 (fast above medium)"},
                    {"indicator": "EMA_21", "parameter": "value", "operator": ">", "value": "EMA_34", "description": "EMA 21 above EMA 34 (medium above slow)"},
                    {"indicator": "MACD", "parameter": "histogram", "operator": ">", "value": 0, "description": "MACD histogram positive (momentum confirms)"}
                ],
                "exit_conditions": [
                    {"indicator": "MACD", "parameter": "histogram", "operator": "<", "value": 0, "description": "MACD histogram turns negative"}
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
    # 9. RSI Mean Reversion — GBPUSDm (same logic as EURUSD but on GBPUSD)
    {
        "name": "RSI Mean Reversion — GBPUSD",
        "symbol": "GBPUSDm",
        "raw_description": "Buy when RSI crosses above 25 from oversold and price is below the lower Bollinger Band. Exit when RSI crosses above 55 or price reaches BB middle. Use 2x ATR stop loss and 2x ATR take profit on M5.",
        "ai_explanation": "Mean reversion on GBP/USD M5. RSI oversold recovery combined with Bollinger Band extreme provides high-probability bounce entries. The wider ATR stops accommodate GBP's higher volatility. Works well during London session pullbacks in an overall trending day.",
        "rules": [
            {
                "name": "RSI Mean Reversion",
                "timeframe": "5m",
                "direction": "buy",
                "description": "RSI oversold bounce at lower BB on GBPUSD",
                "entry_conditions": [
                    {"indicator": "RSI", "parameter": "value", "operator": "crosses_above", "value": 25, "description": "RSI crosses above 25 (recovering from oversold)"},
                    {"indicator": "close", "parameter": "value", "operator": "<", "value": "BB_lower", "description": "Price below lower Bollinger Band (oversold extreme)"}
                ],
                "exit_conditions": [
                    {"indicator": "RSI", "parameter": "value", "operator": ">", "value": 55, "description": "RSI above 55 (mean reversion target)"}
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

    # ═══════════════════════════════════════════
    #  USDJPY — Yen Cross (different pip structure)
    # ═══════════════════════════════════════════

    # 10. EMA Cross + MACD Momentum — USDJPYm
    {
        "name": "EMA Cross + MACD Momentum — USDJPY",
        "symbol": "USDJPYm",
        "raw_description": "Buy when EMA 9 crosses above EMA 21, MACD histogram is positive, and RSI is between 30-70. Exit when MACD histogram turns negative. Use 1.5x ATR stop loss and 2.5x ATR take profit on M5.",
        "ai_explanation": "The same proven EMA crossover + MACD momentum logic applied to USD/JPY on M5. JPY pairs tend to trend strongly during Asian and NY sessions. ATR-based stops automatically adapt to JPY's different pip scale. Good for Tokyo session breakouts.",
        "rules": [
            {
                "name": "EMA Cross + MACD Momentum",
                "timeframe": "5m",
                "direction": "buy",
                "description": "EMA 9/21 crossover with MACD on USDJPY M5",
                "entry_conditions": [
                    {"indicator": "EMA_9", "parameter": "value", "operator": ">", "value": "EMA_21", "description": "EMA 9 above EMA 21 (bullish crossover)"},
                    {"indicator": "MACD", "parameter": "histogram", "operator": ">", "value": 0, "description": "MACD histogram positive (bullish momentum)"},
                    {"indicator": "RSI", "parameter": "value", "operator": ">", "value": 30, "description": "RSI above 30 (not oversold)"},
                    {"indicator": "RSI", "parameter": "value", "operator": "<", "value": 70, "description": "RSI below 70 (not overbought)"}
                ],
                "exit_conditions": [
                    {"indicator": "MACD", "parameter": "histogram", "operator": "<", "value": 0, "description": "MACD histogram turns negative"}
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
    # 11. Stochastic + EMA Trend — USDJPYm
    {
        "name": "Stochastic + EMA Trend — USDJPY",
        "symbol": "USDJPYm",
        "raw_description": "Buy when EMA 50 > EMA 100 (uptrend) and Stochastic K crosses above D from below 20. Exit when Stochastic K > 80. Use 2x ATR stop loss and 3x ATR take profit on M15.",
        "ai_explanation": "Stochastic pullback strategy on USD/JPY M15. JPY pairs often show clean trending behavior, making pullback entries reliable. The M15 timeframe gives stronger signals and the 3x ATR TP captures JPY's tendency for sustained directional moves.",
        "rules": [
            {
                "name": "Stochastic + EMA Trend",
                "timeframe": "15m",
                "direction": "buy",
                "description": "Stochastic pullback in uptrend on USDJPY M15",
                "entry_conditions": [
                    {"indicator": "EMA_50", "parameter": "value", "operator": ">", "value": "EMA_100", "description": "EMA 50 above EMA 100 (confirmed uptrend)"},
                    {"indicator": "Stochastic", "parameter": "K", "operator": "crosses_above", "value": "Stoch_D", "description": "Stochastic K crosses above D (bullish crossover)"},
                    {"indicator": "Stochastic", "parameter": "K", "operator": "<", "value": 20, "description": "Stochastic K below 20 (oversold zone)"}
                ],
                "exit_conditions": [
                    {"indicator": "Stochastic", "parameter": "K", "operator": ">", "value": 80, "description": "Stochastic K above 80 (overbought)"}
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
    # 12. ADX Trend Rider — USDJPYm (H1)
    {
        "name": "ADX Trend Rider — USDJPY H1",
        "symbol": "USDJPYm",
        "raw_description": "Buy when ADX > 25 (strong trend), DI+ > DI-, close > EMA 50, and RSI between 40-65. Exit when ADX < 20 or RSI > 75. Use 2x ATR stop loss and 4x ATR take profit on H1.",
        "ai_explanation": "H1 trend-riding strategy on USD/JPY. ADX confirms trend strength, DI confirms direction, EMA 50 confirms bias, and RSI ensures we're not entering overbought. The 4x ATR TP captures multi-hour JPY moves. Ideal for carry-trade driven trends.",
        "rules": [
            {
                "name": "ADX Trend Rider H1",
                "timeframe": "1h",
                "direction": "buy",
                "description": "H1 trend rider with ADX confirmation on USDJPY",
                "entry_conditions": [
                    {"indicator": "ADX", "parameter": "value", "operator": ">", "value": 25, "description": "ADX above 25 (strong trend)"},
                    {"indicator": "ADX", "parameter": "DI_plus", "operator": ">", "value": "DI_minus", "description": "DI+ above DI- (bullish direction)"},
                    {"indicator": "close", "parameter": "value", "operator": ">", "value": "EMA_50", "description": "Price above EMA 50 (bullish bias)"},
                    {"indicator": "RSI", "parameter": "value", "operator": ">", "value": 40, "description": "RSI above 40 (not oversold)"},
                    {"indicator": "RSI", "parameter": "value", "operator": "<", "value": 65, "description": "RSI below 65 (room to run)"}
                ],
                "exit_conditions": [
                    {"indicator": "ADX", "parameter": "value", "operator": "<", "value": 20, "description": "ADX below 20 (trend exhausted)"}
                ],
                "stop_loss_atr_multiplier": 2.0,
                "take_profit_atr_multiplier": 4.0,
                "stop_loss_pips": None,
                "take_profit_pips": None,
                "min_bars_in_trade": 3,
                "risk_percent": 1.0
            }
        ],
    },

    # ═══════════════════════════════════════════
    #  BTCUSD — Cryptocurrency (large price, wide ATR)
    # ═══════════════════════════════════════════

    # 13. BTC Quick Test (designed to trigger fast for verification)
    {
        "name": "BTC Quick Test",
        "symbol": "BTCUSDm",
        "raw_description": "Test strategy: Buy when RSI > 25, exit when RSI > 75. SL 300 pips, TP 500 pips.",
        "ai_explanation": "Ultra-simple strategy designed to trigger quickly for testing the algo trader on BTC. RSI > 25 is true ~95% of the time, so this will enter a trade almost immediately. SL = 300 pips (~$30 on BTC), TP = 500 pips (~$50 on BTC).",
        "rules": [
            {
                "name": "Quick Entry",
                "timeframe": "1m",
                "description": "Ultra-simple: buys when RSI > 25 (almost always true). Designed to trigger quickly for testing.",
                "direction": "buy",
                "entry_conditions": [
                    {"indicator": "RSI", "parameter": "value", "operator": ">", "value": 25, "description": "RSI above 25 (baseline — almost always true)"}
                ],
                "exit_conditions": [
                    {"indicator": "RSI", "parameter": "value", "operator": ">", "value": 75, "description": "RSI above 75 (overbought exit)"}
                ],
                "stop_loss_pips": 300,
                "take_profit_pips": 500,
                "stop_loss_atr_multiplier": None,
                "take_profit_atr_multiplier": None,
                "min_bars_in_trade": None,
                "risk_percent": 0.5
            }
        ],
    },
    # 14. BTC RSI + MACD Momentum
    {
        "name": "BTC RSI + MACD Momentum",
        "symbol": "BTCUSDm",
        "raw_description": "Buy when MACD histogram > 0 and RSI between 35-65. Exit when RSI > 72. Use 2x ATR stop loss and 3x ATR take profit on M5.",
        "ai_explanation": "Momentum strategy for BTC M5. Enters during bullish momentum when RSI shows the market isn't overextended. MACD histogram > 0 confirms upward momentum. RSI 35-65 ensures we're not buying at overbought levels. ATR-based stops adapt to BTC's high volatility automatically.",
        "rules": [
            {
                "name": "BTC MACD Momentum Buy",
                "timeframe": "5m",
                "description": "Buy BTC on MACD momentum with RSI range filter",
                "direction": "buy",
                "entry_conditions": [
                    {"indicator": "MACD", "parameter": "histogram", "operator": ">", "value": 0, "description": "MACD histogram positive (bullish momentum)"},
                    {"indicator": "RSI", "parameter": "value", "operator": ">", "value": 35, "description": "RSI above 35 (not oversold)"},
                    {"indicator": "RSI", "parameter": "value", "operator": "<", "value": 65, "description": "RSI below 65 (room to run up)"}
                ],
                "exit_conditions": [
                    {"indicator": "RSI", "parameter": "value", "operator": ">", "value": 72, "description": "RSI above 72 (overbought — take profit)"}
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
    # 15. BTC EMA Cross + RSI Filter
    {
        "name": "BTC EMA Cross + RSI — M5",
        "symbol": "BTCUSDm",
        "raw_description": "Buy BTC when EMA 9 crosses above EMA 21, RSI is between 30-70, and MACD histogram is positive. Exit when MACD histogram turns negative or RSI > 75. Use 2x ATR stop loss and 3x ATR take profit on M5.",
        "ai_explanation": "The proven EMA crossover strategy adapted for BTC M5. Crypto markets trend strongly, making EMA crossovers effective. ATR-based stops handle BTC's wide price swings. The RSI filter prevents entries at overbought extremes. Best during US market hours when BTC liquidity is highest.",
        "rules": [
            {
                "name": "BTC EMA Cross",
                "timeframe": "5m",
                "description": "EMA 9/21 crossover with RSI filter on BTC",
                "direction": "buy",
                "entry_conditions": [
                    {"indicator": "EMA_9", "parameter": "value", "operator": ">", "value": "EMA_21", "description": "EMA 9 above EMA 21 (bullish crossover)"},
                    {"indicator": "MACD", "parameter": "histogram", "operator": ">", "value": 0, "description": "MACD histogram positive (momentum confirms)"},
                    {"indicator": "RSI", "parameter": "value", "operator": ">", "value": 30, "description": "RSI above 30 (not oversold)"},
                    {"indicator": "RSI", "parameter": "value", "operator": "<", "value": 70, "description": "RSI below 70 (not overbought)"}
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
    # 16. BTC Stochastic Reversal
    {
        "name": "BTC Stochastic Reversal — M15",
        "symbol": "BTCUSDm",
        "raw_description": "Buy BTC when Stochastic K crosses above D from oversold zone, with price above EMA 50. Exit when Stochastic K > 80. Use 2.5x ATR stop loss and 4x ATR take profit on M15.",
        "ai_explanation": "Mean-reversion strategy targeting oversold bounces in BTC uptrends on M15. Stochastic crossover signals momentum shift, EMA 50 confirms trend direction. The wider 2.5x ATR stop accommodates crypto volatility while the 4x TP captures BTC's tendency for sharp recovery rallies.",
        "rules": [
            {
                "name": "BTC Stochastic Bounce",
                "timeframe": "15m",
                "description": "Stochastic oversold bounce in BTC uptrend",
                "direction": "buy",
                "entry_conditions": [
                    {"indicator": "Stochastic", "parameter": "K", "operator": "crosses_above", "value": "Stoch_D", "description": "Stochastic K crosses above D (bullish crossover)"},
                    {"indicator": "Stochastic", "parameter": "K", "operator": "<", "value": 25, "description": "Stochastic K below 25 (oversold zone)"},
                    {"indicator": "close", "parameter": "value", "operator": ">", "value": "EMA_50", "description": "Price above EMA 50 (uptrend confirmation)"}
                ],
                "exit_conditions": [
                    {"indicator": "Stochastic", "parameter": "K", "operator": ">", "value": 80, "description": "Stochastic K above 80 (overbought — exit)"}
                ],
                "stop_loss_atr_multiplier": 2.5,
                "take_profit_atr_multiplier": 4.0,
                "stop_loss_pips": None,
                "take_profit_pips": None,
                "min_bars_in_trade": 2,
                "risk_percent": 1.0
            }
        ],
    },
    # 17. BTC BB Mean Reversion
    {
        "name": "BTC BB Mean Reversion — M15",
        "symbol": "BTCUSDm",
        "raw_description": "Buy BTC when price closes below the lower Bollinger Band, RSI crosses above 25, and ADX < 35 (ranging). Exit when price reaches BB middle. Use 2.5x ATR stop loss and 3x ATR take profit on M15.",
        "ai_explanation": "Bollinger Band mean reversion adapted for BTC M15. Crypto markets frequently overextend and snap back. The ADX filter ensures we only trade during ranging/consolidation phases, not during parabolic trending. Wider ATR multipliers respect BTC's volatility.",
        "rules": [
            {
                "name": "BTC BB Mean Reversion",
                "timeframe": "15m",
                "description": "Mean reversion at lower BB on BTC with ADX range filter",
                "direction": "buy",
                "entry_conditions": [
                    {"indicator": "close", "parameter": "value", "operator": "<", "value": "BB_lower", "description": "Price below lower Bollinger Band (oversold extreme)"},
                    {"indicator": "RSI", "parameter": "value", "operator": "crosses_above", "value": 25, "description": "RSI crosses above 25 (recovering from oversold)"},
                    {"indicator": "ADX", "parameter": "value", "operator": "<", "value": 35, "description": "ADX below 35 (not in a strong trend)"}
                ],
                "exit_conditions": [
                    {"indicator": "close", "parameter": "value", "operator": ">", "value": "BB_middle", "description": "Price reaches middle Bollinger Band"}
                ],
                "stop_loss_atr_multiplier": 2.5,
                "take_profit_atr_multiplier": 3.0,
                "stop_loss_pips": None,
                "take_profit_pips": None,
                "min_bars_in_trade": 2,
                "risk_percent": 0.5
            }
        ],
    },
    # 18. BTC ADX Trend Rider — H1
    {
        "name": "BTC ADX Trend Rider — H1",
        "symbol": "BTCUSDm",
        "raw_description": "Buy BTC when ADX > 25, DI+ > DI-, close > EMA 50, and RSI 35-65. Exit when ADX < 20. Use 3x ATR stop loss and 5x ATR take profit on H1.",
        "ai_explanation": "H1 trend-riding strategy for BTC. Captures multi-hour trending moves in crypto. ADX confirms a real trend, DI confirms direction, EMA 50 confirms structural bias. The 5x ATR TP is aggressive but works for BTC's large directional moves. The 3x ATR SL gives room for BTC's wide swings.",
        "rules": [
            {
                "name": "BTC ADX Trend H1",
                "timeframe": "1h",
                "description": "H1 trend rider on BTC with ADX confirmation",
                "direction": "buy",
                "entry_conditions": [
                    {"indicator": "ADX", "parameter": "value", "operator": ">", "value": 25, "description": "ADX above 25 (strong trend)"},
                    {"indicator": "ADX", "parameter": "DI_plus", "operator": ">", "value": "DI_minus", "description": "DI+ above DI- (bullish direction)"},
                    {"indicator": "close", "parameter": "value", "operator": ">", "value": "EMA_50", "description": "Price above EMA 50 (bullish bias)"},
                    {"indicator": "RSI", "parameter": "value", "operator": ">", "value": 35, "description": "RSI above 35 (not oversold)"},
                    {"indicator": "RSI", "parameter": "value", "operator": "<", "value": 65, "description": "RSI below 65 (room to run)"}
                ],
                "exit_conditions": [
                    {"indicator": "ADX", "parameter": "value", "operator": "<", "value": 20, "description": "ADX below 20 (trend exhausted)"}
                ],
                "stop_loss_atr_multiplier": 3.0,
                "take_profit_atr_multiplier": 5.0,
                "stop_loss_pips": None,
                "take_profit_pips": None,
                "min_bars_in_trade": 3,
                "risk_percent": 1.0
            }
        ],
    },

    # ═══════════════════════════════════════════
    #  XAUUSD — Gold (large price, safe haven)
    # ═══════════════════════════════════════════

    # 19. Gold EMA Cross + RSI — M5
    {
        "name": "Gold EMA Cross + RSI — XAU M5",
        "symbol": "XAUUSDm",
        "raw_description": "Buy Gold when EMA 9 > EMA 21, MACD histogram > 0, and RSI 30-70. Exit when MACD histogram turns negative. Use 2x ATR stop loss and 3x ATR take profit on M5.",
        "ai_explanation": "EMA crossover momentum strategy adapted for Gold M5. Gold trends strongly during risk-off events and USD weakness. ATR-based stops handle Gold's $5-$20 per bar swings naturally. Best during London/NY sessions when Gold has peak liquidity.",
        "rules": [
            {
                "name": "Gold EMA Cross + RSI",
                "timeframe": "5m",
                "description": "EMA 9/21 crossover with RSI filter on Gold",
                "direction": "buy",
                "entry_conditions": [
                    {"indicator": "EMA_9", "parameter": "value", "operator": ">", "value": "EMA_21", "description": "EMA 9 above EMA 21 (bullish crossover)"},
                    {"indicator": "MACD", "parameter": "histogram", "operator": ">", "value": 0, "description": "MACD histogram positive (bullish momentum)"},
                    {"indicator": "RSI", "parameter": "value", "operator": ">", "value": 30, "description": "RSI above 30 (not oversold)"},
                    {"indicator": "RSI", "parameter": "value", "operator": "<", "value": 70, "description": "RSI below 70 (not overbought)"}
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
    # 20. Gold BB Mean Reversion — M15
    {
        "name": "Gold BB Mean Reversion — XAU M15",
        "symbol": "XAUUSDm",
        "raw_description": "Buy Gold when price < lower BB, RSI crosses above 25, and ADX < 30 (ranging). Exit when price > BB middle. Use 2x ATR stop loss and 2.5x ATR take profit on M15.",
        "ai_explanation": "BB mean reversion on Gold M15. Gold often overextends during news events and snaps back. The ADX filter avoids entries during one-way macro moves (Fed decisions, geopolitical shocks). M15 gives cleaner signals and the 2.5x ATR TP captures Gold's typical range-bound bounces.",
        "rules": [
            {
                "name": "Gold BB Mean Reversion",
                "timeframe": "15m",
                "description": "Mean reversion at lower BB on Gold with ADX filter",
                "direction": "buy",
                "entry_conditions": [
                    {"indicator": "close", "parameter": "value", "operator": "<", "value": "BB_lower", "description": "Price below lower Bollinger Band"},
                    {"indicator": "RSI", "parameter": "value", "operator": "crosses_above", "value": 25, "description": "RSI crosses above 25 (recovering from oversold)"},
                    {"indicator": "ADX", "parameter": "value", "operator": "<", "value": 30, "description": "ADX below 30 (not in a strong trend)"}
                ],
                "exit_conditions": [
                    {"indicator": "close", "parameter": "value", "operator": ">", "value": "BB_middle", "description": "Price reaches middle Bollinger Band"}
                ],
                "stop_loss_atr_multiplier": 2.0,
                "take_profit_atr_multiplier": 2.5,
                "stop_loss_pips": None,
                "take_profit_pips": None,
                "min_bars_in_trade": 2,
                "risk_percent": 0.5
            }
        ],
    },
    # 21. Gold Stochastic Pullback — M5
    {
        "name": "Gold Stochastic Pullback — XAU M5",
        "symbol": "XAUUSDm",
        "raw_description": "Buy Gold when EMA 50 > EMA 100, Stochastic K crosses above D from below 20. Exit when Stochastic K > 80. Use 2x ATR stop loss and 3x ATR take profit on M5.",
        "ai_explanation": "Stochastic pullback strategy on Gold M5. Gold trends strongly on macro themes, making pullback entries within the trend very effective. EMA 50 > EMA 100 confirms the structural uptrend, Stochastic catches the dips. Works especially well during risk-off phases when Gold is bid.",
        "rules": [
            {
                "name": "Gold Stochastic Pullback",
                "timeframe": "5m",
                "description": "Stochastic oversold pullback in Gold uptrend",
                "direction": "buy",
                "entry_conditions": [
                    {"indicator": "EMA_50", "parameter": "value", "operator": ">", "value": "EMA_100", "description": "EMA 50 above EMA 100 (confirmed uptrend)"},
                    {"indicator": "Stochastic", "parameter": "K", "operator": "crosses_above", "value": "Stoch_D", "description": "Stochastic K crosses above D (bullish crossover)"},
                    {"indicator": "Stochastic", "parameter": "K", "operator": "<", "value": 20, "description": "Stochastic K below 20 (oversold zone)"}
                ],
                "exit_conditions": [
                    {"indicator": "Stochastic", "parameter": "K", "operator": ">", "value": 80, "description": "Stochastic K above 80 (overbought)"}
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
    # 22. Gold ADX Trend Rider — H1
    {
        "name": "Gold ADX Trend Rider — XAU H1",
        "symbol": "XAUUSDm",
        "raw_description": "Buy Gold when ADX > 25, DI+ > DI-, close > EMA 50, RSI 35-65. Exit when ADX < 20. Use 2.5x ATR stop loss and 4x ATR take profit on H1.",
        "ai_explanation": "H1 trend-riding strategy for Gold. Captures multi-hour macro-driven moves. Gold's H1 trends are often driven by USD weakness, bond yields, or geopolitical risk — these tend to persist for hours, making the 4x ATR TP achievable. The 2.5x ATR SL gives enough room for Gold's intraday noise.",
        "rules": [
            {
                "name": "Gold ADX Trend H1",
                "timeframe": "1h",
                "description": "H1 trend rider on Gold with ADX confirmation",
                "direction": "buy",
                "entry_conditions": [
                    {"indicator": "ADX", "parameter": "value", "operator": ">", "value": 25, "description": "ADX above 25 (strong trend)"},
                    {"indicator": "ADX", "parameter": "DI_plus", "operator": ">", "value": "DI_minus", "description": "DI+ above DI- (bullish direction)"},
                    {"indicator": "close", "parameter": "value", "operator": ">", "value": "EMA_50", "description": "Price above EMA 50 (bullish bias)"},
                    {"indicator": "RSI", "parameter": "value", "operator": ">", "value": 35, "description": "RSI above 35 (not oversold)"},
                    {"indicator": "RSI", "parameter": "value", "operator": "<", "value": 65, "description": "RSI below 65 (room to run)"}
                ],
                "exit_conditions": [
                    {"indicator": "ADX", "parameter": "value", "operator": "<", "value": 20, "description": "ADX below 20 (trend exhausted)"}
                ],
                "stop_loss_atr_multiplier": 2.5,
                "take_profit_atr_multiplier": 4.0,
                "stop_loss_pips": None,
                "take_profit_pips": None,
                "min_bars_in_trade": 3,
                "risk_percent": 1.0
            }
        ],
    },

    # ═══════════════════════════════════════════
    #  SMART MONEY STRATEGIES
    # ═══════════════════════════════════════════

    # 23. Liquidity Sweep Reversal — EURUSD M5
    {
        "name": "Liquidity Sweep Reversal — EURUSD M5",
        "symbol": "EURUSDm",
        "raw_description": "Buy when a bullish liquidity sweep is detected, price is above AVWAP anchored to swing low, cumulative volume delta is positive, and RSI below 65. Exit when price reaches AVWAP anchored to swing high. Use 1.5x ATR stop loss and 3x ATR take profit.",
        "ai_explanation": "Smart money reversal: enters after institutional stop hunts below swing lows. The sweep signals large players grabbed liquidity and are likely to push price higher. AVWAP from swing low acts as dynamic support, positive cumulative delta confirms buying pressure. Targets AVWAP from swing high as resistance.",
        "rules": [
            {
                "name": "Bullish Liquidity Sweep",
                "timeframe": "5m",
                "direction": "buy",
                "description": "Enter on bullish sweep with AVWAP support and volume delta confirmation",
                "entry_conditions": [
                    {"indicator": "LiqSweep", "parameter": "bull", "operator": ">", "value": 0, "description": "Bullish liquidity sweep detected (swept swing low, closed above)"},
                    {"indicator": "close", "parameter": "value", "operator": ">", "value": "AVWAP_low", "description": "Price above AVWAP anchored to swing low (dynamic support holds)"},
                    {"indicator": "VolumeDelta", "parameter": "cumulative", "operator": ">", "value": 0, "description": "Cumulative volume delta positive (net buying pressure)"},
                    {"indicator": "RSI", "parameter": "value", "operator": "<", "value": 65, "description": "RSI below 65 (not overbought, room to run)"}
                ],
                "exit_conditions": [
                    {"indicator": "close", "parameter": "value", "operator": ">", "value": "AVWAP_high", "description": "Price reaches AVWAP from swing high (resistance target)"}
                ],
                "stop_loss_atr_multiplier": 1.5,
                "take_profit_atr_multiplier": 3.0,
                "stop_loss_pips": None,
                "take_profit_pips": None,
                "min_bars_in_trade": 3,
                "risk_percent": 1.0
            }
        ],
    },

    # 24. Volume Profile POC Bounce — EURUSD M15
    {
        "name": "Volume Profile POC Bounce — EURUSD M15",
        "symbol": "EURUSDm",
        "raw_description": "Buy when price is near the POC (VP_position between -0.5 and 0.5), volume delta SMA is positive, and RSI between 40-60. Exit when price reaches Value Area High. Use 1.5x ATR stop loss and 2.5x ATR take profit.",
        "ai_explanation": "Volume Profile mean-reversion: price gravitates to the Point of Control (highest-traded price level). When price returns to POC with positive volume delta, it signals accumulation by institutional players. RSI filter ensures entry in a neutral zone. Targets the Value Area High as natural resistance.",
        "rules": [
            {
                "name": "POC Bounce Long",
                "timeframe": "15m",
                "direction": "buy",
                "description": "Buy at POC with volume delta confirmation",
                "entry_conditions": [
                    {"indicator": "VolumeProfile", "parameter": "position", "operator": ">", "value": -0.5, "description": "Price near or above POC (within 0.5 ATR below)"},
                    {"indicator": "VolumeProfile", "parameter": "position", "operator": "<", "value": 0.5, "description": "Price not too far above POC (within 0.5 ATR above)"},
                    {"indicator": "VolumeDelta", "parameter": "sma", "operator": ">", "value": 0, "description": "Smoothed volume delta positive (buying pressure)"},
                    {"indicator": "RSI", "parameter": "value", "operator": ">", "value": 40, "description": "RSI above 40 (not oversold extreme)"},
                    {"indicator": "RSI", "parameter": "value", "operator": "<", "value": 60, "description": "RSI below 60 (neutral zone)"}
                ],
                "exit_conditions": [
                    {"indicator": "close", "parameter": "value", "operator": ">", "value": "VP_VAH", "description": "Price reaches Value Area High"}
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

    # 25. Smart Money Trend Continuation — GBPUSD M5
    {
        "name": "Smart Money Trend Continuation — GBPUSD M5",
        "symbol": "GBPUSDm",
        "raw_description": "Buy when price is above EMA 50, bullish liquidity sweep fires, cumulative delta positive, and price above AVWAP from swing low. Exit when RSI > 75. Use 2x ATR SL and 3x ATR TP.",
        "ai_explanation": "Trend continuation after a stop hunt: in an uptrend (price > EMA 50), a bullish liquidity sweep sweeps out weak longs below swing low, smart money absorbs selling and pushes price up. Cumulative delta confirms absorption. AVWAP from swing low is the institutional accumulation level. Best during London session.",
        "rules": [
            {
                "name": "Smart Money Trend Buy",
                "timeframe": "5m",
                "direction": "buy",
                "description": "Trend continuation after bullish liquidity sweep on GBPUSD",
                "entry_conditions": [
                    {"indicator": "close", "parameter": "value", "operator": ">", "value": "EMA_50", "description": "Price above EMA 50 (uptrend)"},
                    {"indicator": "LiqSweep", "parameter": "bull", "operator": ">", "value": 0, "description": "Bullish liquidity sweep detected"},
                    {"indicator": "VolumeDelta", "parameter": "cumulative", "operator": ">", "value": 0, "description": "Cumulative delta positive (buying absorption)"},
                    {"indicator": "close", "parameter": "value", "operator": ">", "value": "AVWAP_low", "description": "Price above AVWAP from swing low"}
                ],
                "exit_conditions": [
                    {"indicator": "RSI", "parameter": "value", "operator": ">", "value": 75, "description": "RSI above 75 (overbought)"}
                ],
                "stop_loss_atr_multiplier": 2.0,
                "take_profit_atr_multiplier": 3.0,
                "stop_loss_pips": None,
                "take_profit_pips": None,
                "min_bars_in_trade": 5,
                "risk_percent": 1.0
            }
        ],
    },

    # 26. Bearish Sweep + Volume Divergence — USDJPY M15
    {
        "name": "Bearish Sweep + Volume Divergence — USDJPY M15",
        "symbol": "USDJPYm",
        "raw_description": "Sell when a bearish liquidity sweep is detected, price is below AVWAP from swing high, volume delta is negative, and ADX > 20. Exit when price reaches AVWAP from swing low. Use 2x ATR SL and 3x ATR TP.",
        "ai_explanation": "Bearish smart money play: detects stop hunts above swing highs that trap breakout buyers, then shorts as price reverses. AVWAP from swing high confirms institutional distribution. Negative volume delta shows selling pressure dominating. ADX filter ensures sufficient volatility for the move.",
        "rules": [
            {
                "name": "Bearish Sweep Short",
                "timeframe": "15m",
                "direction": "sell",
                "description": "Short after bearish liquidity sweep on USDJPY",
                "entry_conditions": [
                    {"indicator": "LiqSweep", "parameter": "bear", "operator": ">", "value": 0, "description": "Bearish liquidity sweep detected (swept swing high, closed below)"},
                    {"indicator": "close", "parameter": "value", "operator": "<", "value": "AVWAP_high", "description": "Price below AVWAP from swing high (distribution confirmed)"},
                    {"indicator": "VolumeDelta", "parameter": "delta", "operator": "<", "value": 0, "description": "Current bar volume delta negative (selling pressure)"},
                    {"indicator": "ADX", "parameter": "value", "operator": ">", "value": 20, "description": "ADX above 20 (sufficient trend strength)"}
                ],
                "exit_conditions": [
                    {"indicator": "close", "parameter": "value", "operator": "<", "value": "AVWAP_low", "description": "Price reaches AVWAP from swing low (support target)"}
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

    # 27. Gold Value Area Breakout — XAU H1
    {
        "name": "Gold Value Area Breakout — XAU H1",
        "symbol": "XAUUSDm",
        "raw_description": "Buy Gold when price breaks above Value Area High, volume delta SMA is positive, ADX > 25, and close > EMA 50. Exit when ADX < 20. Use 2.5x ATR SL and 4x ATR TP.",
        "ai_explanation": "Volume Profile breakout on Gold H1: when price pushes above the Value Area High with positive volume delta and strong trend (ADX > 25), it signals a genuine breakout. Gold trends strongly during risk events and this captures those moves. Wide ATR stops accommodate Gold volatility.",
        "rules": [
            {
                "name": "Gold VA Breakout",
                "timeframe": "1h",
                "direction": "buy",
                "description": "Value Area High breakout on Gold with volume delta and trend confirmation",
                "entry_conditions": [
                    {"indicator": "close", "parameter": "value", "operator": ">", "value": "VP_VAH", "description": "Price above Value Area High (breakout)"},
                    {"indicator": "VolumeDelta", "parameter": "sma", "operator": ">", "value": 0, "description": "Smoothed volume delta positive (buying pressure supports breakout)"},
                    {"indicator": "ADX", "parameter": "value", "operator": ">", "value": 25, "description": "ADX above 25 (strong trend)"},
                    {"indicator": "close", "parameter": "value", "operator": ">", "value": "EMA_50", "description": "Price above EMA 50 (bullish structure)"}
                ],
                "exit_conditions": [
                    {"indicator": "ADX", "parameter": "value", "operator": "<", "value": 20, "description": "ADX below 20 (trend exhaustion)"}
                ],
                "stop_loss_atr_multiplier": 2.5,
                "take_profit_atr_multiplier": 4.0,
                "stop_loss_pips": None,
                "take_profit_pips": None,
                "min_bars_in_trade": 3,
                "risk_percent": 1.0
            }
        ],
    },

    # 28. BTC Sweep + Delta Momentum — M15
    {
        "name": "BTC Sweep + Delta Momentum — M15",
        "symbol": "BTCUSDm",
        "raw_description": "Buy BTC when bullish liquidity sweep fires, cumulative delta positive, price above VP POC, and RSI between 30-65. Exit when close > VP VAH. Use 2.5x ATR SL and 4x ATR TP.",
        "ai_explanation": "BTC smart money strategy: crypto markets are full of liquidity sweeps as exchanges hunt stops. After a bullish sweep below swing low, if cumulative delta shows net buying and price is above POC, it signals whale accumulation. BTC high volatility needs wider ATR stops. Targets Value Area High.",
        "rules": [
            {
                "name": "BTC Smart Money Buy",
                "timeframe": "15m",
                "direction": "buy",
                "description": "BTC entry after bullish sweep with delta and volume profile confirmation",
                "entry_conditions": [
                    {"indicator": "LiqSweep", "parameter": "bull", "operator": ">", "value": 0, "description": "Bullish liquidity sweep on BTC"},
                    {"indicator": "VolumeDelta", "parameter": "cumulative", "operator": ">", "value": 0, "description": "Cumulative delta positive (whale accumulation)"},
                    {"indicator": "close", "parameter": "value", "operator": ">", "value": "VP_POC", "description": "Price above POC (bullish positioning)"},
                    {"indicator": "RSI", "parameter": "value", "operator": ">", "value": 30, "description": "RSI above 30 (not deeply oversold)"},
                    {"indicator": "RSI", "parameter": "value", "operator": "<", "value": 65, "description": "RSI below 65 (room to run)"}
                ],
                "exit_conditions": [
                    {"indicator": "close", "parameter": "value", "operator": ">", "value": "VP_VAH", "description": "Price reaches Value Area High"}
                ],
                "stop_loss_atr_multiplier": 2.5,
                "take_profit_atr_multiplier": 4.0,
                "stop_loss_pips": None,
                "take_profit_pips": None,
                "min_bars_in_trade": 3,
                "risk_percent": 1.0
            }
        ],
    },

    # ═══════════════════════════════════════════
    #  PINE SCRIPT CONVERSIONS
    # ═══════════════════════════════════════════

    # 29. BTC Micro Momentum (Long + Short) — Pine Script conversion
    {
        "name": "BTC Micro Momentum — M5",
        "symbol": "BTCUSDm",
        "raw_description": "Bidirectional BTC strategy. Long: price above EMA 50 on 1H+4H, RSI > 60, exit RSI < 45. Short: price below EMA 50 on 1H+4H, RSI < 40, exit RSI > 55. ATR-based SL (1.5x) and TP (3.75x = 2.5:1 R:R). Base timeframe M5.",
        "ai_explanation": "Converted from Pine Script 'BTC Micro Momentum'. Two rules in one strategy: Long rule buys when multi-timeframe EMA 50 confirms uptrend + RSI momentum > 60. Short rule sells when EMA 50 confirms downtrend + RSI < 40. Both use ATR-based risk management with 2.5:1 R:R. The algo evaluates both rules on each candle and takes whichever direction triggers first.",
        "rules": [
            {
                "name": "BTC Micro Momentum — Long",
                "timeframe": "5m",
                "direction": "buy",
                "description": "Buy BTC when trending up on 1H+4H with RSI momentum",
                "entry_conditions": [
                    {"indicator": "close", "parameter": "value", "operator": ">", "value": "EMA_50_1h", "description": "Price above EMA 50 on 1H (higher TF uptrend)"},
                    {"indicator": "close", "parameter": "value", "operator": ">", "value": "EMA_50_4h", "description": "Price above EMA 50 on 4H (macro uptrend)"},
                    {"indicator": "RSI", "parameter": "value", "operator": ">", "value": 60, "description": "RSI above 60 (bullish momentum)"}
                ],
                "exit_conditions": [
                    {"indicator": "RSI", "parameter": "value", "operator": "<", "value": 45, "description": "RSI drops below 45 (momentum fading)"}
                ],
                "stop_loss_atr_multiplier": 1.5,
                "take_profit_atr_multiplier": 3.75,
                "stop_loss_pips": None,
                "take_profit_pips": None,
                "min_bars_in_trade": 3,
                "additional_timeframes": ["1h", "4h"],
                "risk_percent": 1.0
            },
            {
                "name": "BTC Micro Momentum — Short",
                "timeframe": "5m",
                "direction": "sell",
                "description": "Sell BTC when trending down on 1H+4H with RSI momentum",
                "entry_conditions": [
                    {"indicator": "close", "parameter": "value", "operator": "<", "value": "EMA_50_1h", "description": "Price below EMA 50 on 1H (higher TF downtrend)"},
                    {"indicator": "close", "parameter": "value", "operator": "<", "value": "EMA_50_4h", "description": "Price below EMA 50 on 4H (macro downtrend)"},
                    {"indicator": "RSI", "parameter": "value", "operator": "<", "value": 40, "description": "RSI below 40 (bearish momentum)"}
                ],
                "exit_conditions": [
                    {"indicator": "RSI", "parameter": "value", "operator": ">", "value": 55, "description": "RSI rises above 55 (momentum recovering)"}
                ],
                "stop_loss_atr_multiplier": 1.5,
                "take_profit_atr_multiplier": 3.75,
                "stop_loss_pips": None,
                "take_profit_pips": None,
                "min_bars_in_trade": 3,
                "additional_timeframes": ["1h", "4h"],
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
    symbols_seen = set()
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
        symbols_seen.add(s["symbol"])
        print(f"  + {s['name']} ({s['symbol']}) — id: {sid[:8]}...")

    conn.commit()
    conn.close()
    print(f"\nDone! Seeded {count} strategies across {len(symbols_seen)} symbols into {DB_PATH}")
    print(f"Symbols: {', '.join(sorted(symbols_seen))}")


if __name__ == "__main__":
    main()
