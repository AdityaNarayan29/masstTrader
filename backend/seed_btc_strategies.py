"""
Seed script — inserts BTC trading strategies into the database.
Run once:  python -m backend.seed_btc_strategies
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend.database import init_db, save_strategy

init_db()

# ── Strategy 1: Quick Test (designed to trigger fast so you can verify algo works) ──
quick_test = {
    "name": "BTC Quick Test",
    "symbol": "BTCUSDm",
    "rules": [
        {
            "name": "Quick Entry",
            "timeframe": "M1",
            "description": "Ultra-simple: buys when RSI > 25 (almost always true). Designed to trigger quickly for testing.",
            "direction": "buy",
            "entry_conditions": [
                {
                    "indicator": "RSI",
                    "parameter": "value",
                    "operator": ">",
                    "value": 25,
                    "description": "RSI above 25 (baseline — almost always true)",
                },
            ],
            "exit_conditions": [
                {
                    "indicator": "RSI",
                    "parameter": "value",
                    "operator": ">",
                    "value": 75,
                    "description": "RSI above 75 (overbought exit)",
                },
            ],
            "stop_loss_pips": 300,
            "take_profit_pips": 500,
        }
    ],
    "raw_description": "Test strategy: Buy when RSI > 25, exit when RSI > 75. SL 300 pips, TP 500 pips.",
    "ai_explanation": (
        "Ultra-simple strategy designed to trigger quickly for testing the algo trader. "
        "RSI > 25 is true ~95% of the time, so this will enter a trade almost immediately. "
        "SL = 300 pips (~$30 on BTC), TP = 500 pips (~$50 on BTC)."
    ),
}

# ── Strategy 2: RSI + MACD Momentum (real strategy) ──
momentum = {
    "name": "BTC RSI + MACD Momentum",
    "symbol": "BTCUSDm",
    "rules": [
        {
            "name": "MACD Momentum Buy",
            "timeframe": "M5",
            "description": "Buy when MACD histogram is positive and RSI is in the 35-65 range (momentum + room to run).",
            "direction": "buy",
            "entry_conditions": [
                {
                    "indicator": "MACD",
                    "parameter": "histogram",
                    "operator": ">",
                    "value": 0,
                    "description": "MACD histogram positive (bullish momentum)",
                },
                {
                    "indicator": "RSI",
                    "parameter": "value",
                    "operator": ">",
                    "value": 35,
                    "description": "RSI above 35 (not oversold)",
                },
                {
                    "indicator": "RSI",
                    "parameter": "value",
                    "operator": "<",
                    "value": 65,
                    "description": "RSI below 65 (room to run up)",
                },
            ],
            "exit_conditions": [
                {
                    "indicator": "RSI",
                    "parameter": "value",
                    "operator": ">",
                    "value": 72,
                    "description": "RSI above 72 (overbought — take profit)",
                },
            ],
            "stop_loss_pips": 400,
            "take_profit_pips": 800,
        }
    ],
    "raw_description": (
        "BTC momentum strategy: Buy when MACD histogram > 0 and RSI between 35-65. "
        "Exit when RSI > 72. SL 400 pips, TP 800 pips."
    ),
    "ai_explanation": (
        "Momentum strategy that enters during bullish momentum when RSI shows the market "
        "isn't overextended. MACD histogram > 0 confirms upward momentum. RSI 35-65 ensures "
        "we're not buying at overbought levels. Exits when RSI reaches overbought territory. "
        "For BTC, SL ~$40, TP ~$80 (2:1 reward/risk)."
    ),
}

# ── Strategy 3: EMA + Stochastic Reversal ──
reversal = {
    "name": "BTC Stochastic Reversal",
    "symbol": "BTCUSDm",
    "rules": [
        {
            "name": "Stochastic Oversold Bounce",
            "timeframe": "M15",
            "description": "Buy when Stochastic K crosses above D from oversold zone, with price above EMA_50.",
            "direction": "buy",
            "entry_conditions": [
                {
                    "indicator": "Stochastic",
                    "parameter": "K",
                    "operator": "crosses_above",
                    "value": "Stoch_D",
                    "description": "Stochastic K crosses above D (bullish crossover)",
                },
                {
                    "indicator": "close",
                    "parameter": "value",
                    "operator": ">",
                    "value": "EMA_50",
                    "description": "Price above EMA 50 (uptrend confirmation)",
                },
            ],
            "exit_conditions": [
                {
                    "indicator": "Stochastic",
                    "parameter": "K",
                    "operator": ">",
                    "value": 80,
                    "description": "Stochastic K above 80 (overbought — exit)",
                },
            ],
            "stop_loss_pips": 500,
            "take_profit_pips": 1000,
        }
    ],
    "raw_description": (
        "BTC reversal strategy: Buy when Stochastic K crosses above D with price above EMA 50. "
        "Exit when Stochastic K > 80. SL 500 pips, TP 1000 pips."
    ),
    "ai_explanation": (
        "Mean-reversion strategy targeting oversold bounces in an uptrend. "
        "Stochastic crossover signals momentum shift, EMA 50 confirms the trend direction. "
        "2:1 reward/risk ratio. SL ~$50, TP ~$100 on BTC."
    ),
}

strategies = [quick_test, momentum, reversal]

for s in strategies:
    result = save_strategy(s)
    print(f"Created: {result['name']} (id={result['id']})")

print(f"\nDone — {len(strategies)} BTC strategies seeded.")
