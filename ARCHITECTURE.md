# MasstTrader — Architecture

> Personal autonomous AI trading system
> Author: Aditya (NarayanJi)
> Stack: FastAPI + MT5 + CCXT + Groq/Llama3 + RAG + XGBoost + LSTM

---

## V1 vs V2 — Key Changes

| | **V1 (Platform)** | **V2 (Autonomous Agent)** |
|---|---|---|
| **Trading** | Manual rules — you build strategies, backtest, click start | Fully autonomous — agent decides everything 24/7 |
| **Brain** | Rule-based conditions (RSI > 70, MACD cross) | 7-node pipeline with regime detection, confidence scoring, devil's advocate |
| **Risk** | Simple: fixed % per trade | Institutional: drawdown kill switches, consecutive loss scaling, volatility adjustment, correlation blocks |
| **Context** | Just price + indicators | Macro (DXY, VIX), crypto intelligence (funding, OI), sentiment, session awareness |
| **Positions** | Open/close, that's it | Partial exits at 1R, trailing stops, regime-based exits, max hold time |
| **Data** | MT5 only | MT5 + CCXT (Binance/Bybit) + macro feeds |
| **Decisions** | You decide when/what to trade | Agent scans, filters, analyzes, decides, executes, monitors — zero input |
| **Logging** | Basic trade records (12 fields) | Full context snapshot per trade (44 fields: regime, session, confidence, reasoning, indicators, macro state) |
| **AI Usage** | Strategy parsing, trade analysis, tutoring | Signal generation (LLM), RAG from 13 trading books, devil's advocate filter |
| **Markets** | Any MT5 symbol | XAUUSD (Gold) + BTCUSDT (Bitcoin) primary |

V1 is the trading education tool. V2 is the autonomous money machine built on top of it.

---

## System Overview

```
+-----------------------------------------------------------------------------------+
|                              MASST TRADER                                          |
+-----------------------------------------------------------------------------------+
|                                                                                    |
|   +------------------+     +------------------+     +------------------+           |
|   |   FRONTEND        |     |   FASTAPI BACKEND |     |   MT5 TERMINAL   |           |
|   |   Next.js 16       |<--->|   Python 3.11     |<--->|   Exness (IPC)   |           |
|   |   Vercel            |     |   EC2:8008        |     |   Windows EC2    |           |
|   |                    |     |                    |     |                  |           |
|   | Pages:             |     | V1 API:            |     | Symbols:         |           |
|   |  Connection        |     |  /api/mt5/*        |     |  XAUUSDm         |           |
|   |  Strategy Builder  |     |  /api/data/*       |     |  BTCUSDm         |           |
|   |  Backtester        |     |  /api/strategy/*   |     |  EURUSDm         |           |
|   |  Live Dashboard    |     |  /api/backtest/*   |     |  GBPUSDm         |           |
|   |  Algo Control      |     |  /api/algo/*       |     |                  |           |
|   |  Analyzer          |     |  /api/ml/*         |     +------------------+           |
|   |  ML Dashboard      |     |  /api/tutor/*      |                                   |
|   |  AI Tutor          |     |                    |     +------------------+           |
|   +------------------+     | V2 API:            |     |   CCXT            |           |
|                             |  /api/agent/*      |<--->|   Binance/Bybit   |           |
|                             +------------------+     |   BTC/USDT         |           |
|                                    |                  +------------------+           |
|                            +-------v-------+                                        |
|                            | V2 AUTONOMOUS |                                        |
|                            | AGENT         |                                        |
|                            | (7-Node Loop) |                                        |
|                            +---------------+                                        |
+-----------------------------------------------------------------------------------+
```

---

## V1 — Trading Education Platform

### Data Flow

```
1. CONNECT          User -> Frontend -> POST /api/mt5/connect -> MT5 Terminal
                    Returns: account info (balance, equity, leverage)

2. FETCH DATA       User -> Frontend -> POST /api/data/fetch -> MT5 copy_rates
                    Returns: OHLCV candles + 20+ technical indicators

3. PARSE STRATEGY   User -> Frontend -> POST /api/strategy/parse -> Groq LLM
                    Input: "Buy when RSI < 30 and MACD crosses above signal"
                    Returns: Structured JSON rules with conditions

4. BACKTEST         User -> Frontend -> POST /api/backtest/run -> Core Engine
                    Runs strategy rules against historical candles
                    Returns: trades, stats, equity curve

5. ANALYZE TRADE    User -> Frontend -> POST /api/analyze/trade -> Groq LLM
                    Compares manual trade against strategy rules
                    Returns: alignment score + educational feedback

6. AI TUTOR         User -> Frontend -> POST /api/tutor/lesson -> Groq LLM
                    Personalized lesson based on level + instruments
                    Returns: markdown-formatted lesson
```

### ML Pipeline

#### XGBoost Confidence Filter (`ml_filter.py` + `trainer.py`)

```
Training Data Sources:
  1. Fresh backtests (run all strategies through backtester)
  2. Stored backtest results (from DB)
  3. Live algo trade outcomes (closed trades with P&L)

Feature Engineering (13 features):
  RSI_14, MACD_histogram, MACD_line, BB_width, ATR_14, ADX_14,
  Stoch_K, Stoch_D, Volume_ratio, EMA_9_21_spread,
  close_vs_BB_middle, close_vs_EMA_50, direction

Runtime (Algo Loop):
  Entry conditions met -> extract_features(indicators) -> predict_proba()
  -> confidence < 55% -> BLOCK trade
  -> confidence >= 55% -> ALLOW trade + log score
```

#### LSTM Price Predictor (`lstm_predictor.py`)

```
Architecture:
  Input: 50 candles x 24 indicator features
  -> LSTM(64, return_sequences=True) -> Dropout(0.2)
  -> LSTM(32) -> Dropout(0.2)
  -> Dense(16, relu) -> Dense(1, sigmoid)

Prediction:
  Latest 50 candles -> Scale -> Predict -> probability
  -> >= 0.55: "up" | <= 0.45: "down" | else: "neutral"
```

#### ML Data Flow

```
                    +-------------+
                    |  MT5 Broker  |
                    +------+------+
                           | Historical candles
                           v
                    +--------------+
                    |  Indicators  |---> 24 features (LSTM)
                    |  (ta library)|---> 13 features (XGBoost)
                    +------+-------+
                           |
              +------------+------------+
              v            v            v
       +------------+ +----------+ +------------+
       |  XGBoost   | |   LSTM   | |  Training  |
       |  Filter    | | Predictor| |  History   |
       |  (gate)    | |  (info)  | |  (SQLite)  |
       +-----+------+ +----+-----+ +-----+------+
             |             |              |
             v             v              v
       +--------------------------------------+
       |           ML Dashboard               |
       +--------------------------------------+
```

---

## V2 — Autonomous Trading Agent

### The 7-Node Agent Loop

The agent runs continuously, cycling through 7 sequential nodes every 5 minutes.

```
    +-------------------+
    |  1. MARKET SCANNER |<------------------------------------------+
    +-------------------+                                            |
            |                                                        |
            | Cleared symbols                                        |
            v                                                        |
    +-------------------+                                            |
    | 2. CONTEXT         |                                            |
    |    ENRICHER        |                                            |
    +-------------------+                                            |
            |                                                        |
            | Macro + crypto + sentiment context                     |
            v                                                        |
    +-------------------+                                            |
    | 3. REGIME          |                                            |
    |    DETECTOR        |                                            |
    +-------------------+                                            |
            |                                                        |
            | TRENDING_UP / TRENDING_DOWN / RANGING / VOLATILE       |
            v                                                        |
    +-------------------+                                            |
    | 4. SIGNAL          |                                            |
    |    GENERATOR       |  <-- AI Brain (Phase 2: LLM + RAG)        |
    +-------------------+                                            |
            |                                                        |
            | BUY/SELL/NONE + confidence + reasoning                 |
            v                                                        |
    +-------------------+                                            |
    | 5. RISK            |                                            |
    |    CALCULATOR      |  <-- Hard rules, LLM CANNOT override      |
    +-------------------+                                            |
            |                                                        |
            | Validated order (or REJECTED)                          |
            v                                                        |
    +-------------------+                                            |
    | 6. EXECUTION       |                                            |
    |    NODE            |                                            |
    +-------------------+                                            |
            |                                                        |
            | Fill price, slippage, ticket                           |
            v                                                        |
    +-------------------+                                            |
    | 7. MONITOR         |                                            |
    |    NODE            |-------------------------------------------+
    +-------------------+       Loop back (every 5 min)
```

---

### Node 1 — Market Scanner

```
INPUT:  Watchlist (XAUUSDm, BTCUSDm), current time
OUTPUT: Cleared symbols (passed all filters)

Filters:
  +-- Is Gold outside trade window? ---------> SKIP (London 08-10, NY 13-15 UTC)
  +-- Is news blackout active? --------------> SKIP (15 min before/after NFP, FOMC, CPI)
  +-- Is BTC in weekend low-liquidity? ------> FLAG (reduce size 30%)
```

### Node 2 — Context Enricher

```
INPUT:  Cleared symbols
OUTPUT: Enriched context object

                    +------------------+
                    | CONTEXT ENRICHER |
                    +------------------+
                           |
          +----------------+----------------+----------------+
          |                |                |                |
    +-----v-----+   +-----v-----+   +-----v-----+   +-----v-----+
    |   MACRO    |   |  CRYPTO   |   |   GOLD    |   | SENTIMENT |
    |            |   |           |   |           |   |           |
    | DXY trend  |   | Funding   |   | COT report|   | Fear &    |
    | VIX level  |   | rate      |   | Central   |   | Greed     |
    | Real yields|   | Open Int. |   | bank buys |   | Reddit    |
    | Fed funds  |   | Netflow   |   | GPR index |   | Twitter   |
    +------------+   +-----------+   +-----------+   +-----------+

    Phase 1: Stubs (defaults)
    Phase 3: Live API feeds (FRED, Coinglass, CFTC, alternative.me)
```

### Node 3 — Regime Detector

```
INPUT:  OHLCV + indicators (bias + trend timeframes)
OUTPUT: Regime tag per symbol

Decision Tree:
                         ADX > 25?
                        /         \
                      YES          NO
                      /              \
              EMAs aligned?        ADX < 20?
              MACD confirms?      /         \
             /            \     YES          NO
           YES             NO    |            |
            |               |   BB narrow?   Check trend TF
    TRENDING_UP/DOWN     AVOID   |            for tiebreaker
                              RANGING

    ATR > 1.5x avg + wide BB? -----> VOLATILE
```

### Node 4 — Signal Generator (AI Brain)

```
INPUT:  Indicators, regime, context, last 50 trades, (Phase 2: RAG passages)
OUTPUT: { direction, confidence %, reasoning, entry, SL, TP }

Phase 1 (Current) -- Rule-Based:

    TRENDING_UP:
      RSI < 70 + MACD positive           +30%
      MACD histogram crossed above zero   +20%
      Price > EMA9 > EMA21               +15%
      Stoch K > D, not overbought        +10%
      ADX > 25                           +10%
      ----------------------------------------
      Total >= 65% ? -----> BUY signal

    TRENDING_DOWN: (mirror logic) ----> SELL signal

    RANGING:
      RSI < 30 at BB lower -----> BUY  (mean reversion)
      RSI > 70 at BB upper -----> SELL (mean reversion)

Phase 2 (Coming) -- LLM + RAG:

    +-------------------------------------------------------------------+
    |                    GROQ / LLAMA 3 70B PROMPT                       |
    |                                                                    |
    |  Layer 1: System role (disciplined, patient, NOT trading = good)   |
    |  Layer 2: Macro context (DXY, VIX, funding, session)              |
    |  Layer 3: Market data (multi-TF OHLCV + all indicators)           |
    |  Layer 4: Trade history (last 10 trades with outcomes)            |
    |  Layer 5: RAG knowledge (top 3 passages from trading books)       |
    |  Layer 6: Task (output JSON signal or NONE)                       |
    |                                                                    |
    |  OUTPUT: { direction, confidence, reasoning, entry, sl, tp }       |
    +-------------------------------------------------------------------+

Devil's Advocate Filter (signals 65-75% confidence):

    Signal 70% BUY
         |
         v
    +--------------------+
    | DEVIL'S ADVOCATE   |  "Find reasons NOT to take this trade"
    | (2nd LLM call)     |
    +--------------------+
         |
    Counter-arguments found?
         |           |
        YES          NO
         |           |
    Downgrade     Keep signal
    -15% conf     as-is
         |
    Below 65%? --> NONE (no trade)
```

### Node 5 — Risk Calculator (Non-Negotiable Rules)

```
INPUT:  Signal, account state, open positions
OUTPUT: Validated order (or REJECTED)

The LLM CANNOT override these rules. Enforced at code level.

    Signal arrives
         |
         v
    +-- Daily DD >= 3%? -----------------------> HALT ALL (24h)
    +-- Weekly DD >= 8%? ----------------------> HALT ALL (until Monday)
    +-- Max 5 positions open? -----------------> REJECT
    +-- Same symbol already open? -------------> REJECT
    +-- Confidence < 65%? ---------------------> REJECT
    +-- DXY bullish + Gold long? --------------> REJECT (correlation block)
    +-- BTC funding > 0.1% + BTC long? --------> REJECT (funding block)
    +-- R:R < 1.5? ----------------------------> REJECT
         |
         | PASSED ALL CHECKS
         v
    Position Sizing:
         |
         +-- Base risk: 0.75% balance (Gold) / 0.5% (BTC)
         +-- 2 consecutive losses? -----> -25% size
         +-- 3 consecutive losses? -----> -50% size + require 75% confidence
         +-- ATR > 1.5x average? -------> -30% size (volatile)
         +-- BTC weekend? --------------> -30% size
         |
         v
    Calculate lot size (symbol-aware: Gold oz, BTC, Forex pips)
         |
         v
    APPROVED ORDER { symbol, direction, volume, entry, SL, TP, risk% }
```

### Node 6 — Execution

```
INPUT:  Validated order
OUTPUT: Fill price, slippage, MT5 ticket

    +-- ENV = demo? -----> Simulate fill at current bid/ask
    |                      Record to agent_trades table
    |
    +-- ENV = live? ------> MT5 order_send()
                            3 retries with backoff
                            Track slippage (fill vs expected)
                            Record to agent_trades table
```

### Node 7 — Monitor

```
INPUT:  Open positions, current prices, regime
OUTPUT: Close/modify actions

For each open trade:
    |
    +-- SL hit? ---------------------------> CLOSE (stop_loss)
    +-- TP hit? ---------------------------> CLOSE (take_profit)
    |
    +-- Profit >= 1R (ATR x 1.5)?
    |   +-- Partial exit done? NO ---------> CLOSE 50%, move SL to breakeven
    |
    +-- Profit >= 1x ATR?
    |   +-- Trailing stop active? NO ------> ACTIVATE trailing (0.5x ATR distance)
    |   +-- Trailing stop active? YES -----> MOVE SL up (ratchet, never down)
    |
    +-- Regime flipped to AVOID/VOLATILE? -> CLOSE (regime_exit)
    +-- DXY spiked against Gold long? ----> CLOSE (dxy_correlation_exit)
    +-- Held longer than max hours? -------> CLOSE (max_hold_8h / max_hold_12h)
```

---

## Data Layer

### Data Fetcher (Smart Multi-Source)

```
                    +-------------+
                    |  MT5        |
                    |  Terminal   |
                    |  (Exness)   |
                    +------+------+
                           |
                    IPC (same user session)
                           |
                    +------v------+
                    |  MT5        |     +----------+
                    |  Connector  |     |  CCXT    |
                    |  (Python)   |     | (Binance)|
                    +------+------+     +----+-----+
                           |                 |
                    +------v-----------------v------+
                    |       DATA FETCHER             |
                    |                                |
                    |  Priority:                     |
                    |  1. MT5 local (EC2 Windows)    |
                    |  2. EC2 remote API (Mac dev)   |
                    |  3. CCXT (crypto fallback)     |
                    +------+------------------------+
                           |
                    +------v------+
                    |  INDICATORS |
                    |  (ta lib)   |
                    +------+------+
                           |
          RSI, MACD, EMA (7 periods + slopes), SMA,
          Bollinger (+ width), ATR (+ 20-period avg),
          Stochastic, ADX (+ DI+/DI-), OBV, Volume ratio,
          Smart Money: Liquidity sweeps, AVWAP, Volume delta,
          Volume profile (POC, VAH, VAL)
```

### Technical Indicators

| Indicator | Parameters | V1 | V2 Added |
|-----------|-----------|-----|----------|
| RSI | period=14 | Y | |
| MACD | line, signal, histogram, histogram_prev | Y | |
| EMA | periods: 8, 9, 14, 21, 34, 50, 100 | Y | + slope (5-bar ROC) |
| SMA | period=20 | Y | |
| Bollinger Bands | upper, middle, lower, width | Y | |
| ATR | period=14 | Y | + 20-period rolling avg |
| Stochastic | K, D | Y | |
| ADX | value, DI+, DI- | Y | |
| OBV | On-Balance Volume | Y | |
| Volume ratio | vol / SMA(20) | Y | |
| Liquidity sweeps | bull/bear sweep detection | Y | |
| AVWAP | Anchored from swing H/L | Y | |
| Volume delta | buy/sell split + cumulative | Y | |
| Volume profile | POC, VAH, VAL, position | Y | |

---

## Session Awareness (V2)

```
UTC Hour:  0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23
           |                          |                                         |
SYDNEY:    [========================]                                    [======]
TOKYO:     [================]
LONDON:                         [==========================]
NEW YORK:                                      [==========================]

Gold windows:                    [==]              [==]
                              08-10 UTC         13-15 UTC

BTC weekend: Sat 20:00 ---------------------------------------- Sun 20:00 (size -30%)
```

---

## Risk Management Cascade (V2)

```
Account Balance: $10,000
         |
         v
    Max risk per trade:
    Gold = 0.75% = $75
    BTC  = 0.50% = $50
         |
    +----v---- Adjustments ----+
    |                          |
    | 2 losses in a row:       |
    | $75 x 0.75 = $56.25     |
    |                          |
    | 3 losses in a row:       |
    | $75 x 0.50 = $37.50     |
    | + require 75% confidence |
    |                          |
    | High volatility:         |
    | $75 x 0.70 = $52.50     |
    |                          |
    | BTC weekend:             |
    | $50 x 0.70 = $35.00     |
    +----+---------------------+
         |
         v
    Lot size = risk_amount / SL_distance
    (symbol-aware: Gold oz, BTC, Forex pips)
```

---

## Database Schema

### V1 Tables

```
+---------------------------+     +---------------------------+
|     strategies            |     |     backtests             |
+---------------------------+     +---------------------------+
| id, name, symbol          |     | id, strategy_id           |
| rules (JSON)              |     | symbol, initial_balance   |
| raw_description           |     | stats (JSON)              |
| ai_explanation            |     | trades (JSON)             |
| created_at, updated_at    |     | equity_curve (JSON)       |
+---------------------------+     +---------------------------+

+---------------------------+     +---------------------------+
|     algo_trades           |     |     ml_training_runs      |
+---------------------------+     +---------------------------+
| id, strategy_id           |     | id, model_type            |
| symbol, direction, volume |     | accuracy, precision       |
| entry/exit price & time   |     | recall, f1_score          |
| ml_confidence             |     | feature_importance (JSON) |
| lstm_direction/confidence |     +---------------------------+
| net_pnl, status           |
+---------------------------+
```

### V2 Tables

```
+---------------------------+     +---------------------------+
|     agent_trades (44 col) |     |     agent_cycles          |
+---------------------------+     +---------------------------+
| id, cycle_id              |     | id, timestamp             |
| symbol, direction, volume |     | symbols_scanned/cleared   |
| entry/exit price & time   |     | regimes (JSON)            |
| sl_price, tp_price        |     | signals (JSON)            |
| profit, net_pnl           |     | orders (JSON)             |
|                           |     | executions (JSON)         |
| -- V2 Enriched --         |     | monitor_actions (JSON)    |
| regime                    |     | errors (JSON)             |
| session (LONDON/NY/etc)   |     | session, duration_ms      |
| confidence (0-100)        |     +---------------------------+
| reasoning (full text)     |
| prompt_version            |     +---------------------------+
| rag_passages (JSON)       |     |   agent_daily_stats       |
| devil_advocate (bool)     |     +---------------------------+
| macro_snapshot (JSON)     |     | date                      |
| indicators_snapshot (JSON)|     | starting/ending_balance   |
| risk_amount, risk_percent |     | trades, wins, losses      |
| rr_ratio, atr_at_entry    |     | total_pnl, max_drawdown   |
| consecutive_losses        |     | win_rate                  |
|                           |     | by_session (JSON)         |
| -- Position Management -- |     | by_regime (JSON)          |
| partial_exit_done         |     | by_symbol (JSON)          |
| sl_moved_to_be            |     +---------------------------+
| trailing_stop_active      |
| mt5_ticket, status        |
+---------------------------+
```

---

## API Endpoints

### V1 — Platform

```
POST /api/mt5/connect         Connect to MT5 terminal
POST /api/data/fetch          Historical candles + indicators
POST /api/strategy/parse      AI: natural language -> structured rules
POST /api/backtest/run        Run strategy backtest
POST /api/analyze/trade       AI: score trade vs strategy
POST /api/tutor/lesson        AI: personalized trading lesson
POST /api/ml/train            Train XGBoost confidence filter
POST /api/ml/train-lstm       Train LSTM price predictor
POST /api/algo/start          Start rule-based algo on a symbol
POST /api/algo/stop           Stop algo instance
GET  /api/sse/live            Live streaming (prices, positions, signals)
GET  /api/sse/ticker          Sidebar price ticker
GET  /api/health              System status
```

### V2 — Agent

```
POST /api/agent/start         Start autonomous loop (5-min cycles)
POST /api/agent/stop          Stop gracefully
POST /api/agent/halt          Emergency halt (keeps monitoring)
POST /api/agent/resume        Resume after halt
GET  /api/agent/status        Current state, cycle count, open trades
POST /api/agent/cycle         Run single cycle manually (testing)
GET  /api/agent/trades        Trade history with full context
GET  /api/agent/stats         Performance by session/regime/symbol
```

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | Next.js 16 + TypeScript | UI framework |
| UI | shadcn/ui + Tailwind CSS v4 | Design system |
| Backend | FastAPI + Uvicorn | REST API |
| Broker (Forex/Gold) | MetaTrader5 Python (native IPC) | Direct MT5 terminal |
| Broker (Crypto) | CCXT (Binance + Bybit) | BTC/USDT trading |
| AI/LLM | Groq (Llama 3.3 70B) — free | Strategy parsing, signals (Phase 2), tutoring |
| AI Fallbacks | Gemini (free), Claude, GPT-4o | Auto-failover |
| ML | XGBoost (scikit-learn) | Trade confidence filter |
| Deep Learning | TensorFlow/Keras LSTM | Price direction prediction |
| Indicators | `ta` library + custom | 20+ technical indicators |
| Database | SQLite (WAL mode) | All persistence |
| Hosting (Backend) | AWS EC2 Windows (c7i-flex.large) | MT5 requires Windows |
| Hosting (Frontend) | Vercel | Auto-deploy from main |
| Service Manager | NSSM | Auto-start, auto-restart on crash |

---

## AI Provider Support

| Provider | Model | Cost | JSON Mode | Used For |
|----------|-------|------|-----------|----------|
| **Groq** (default) | Llama 3.3 70B | Free | Yes | Everything |
| Google Gemini | Gemini 2.0 Flash | Free tier | Yes | Fallback |
| Anthropic | Claude Sonnet 4 | Paid | No | Fallback |
| OpenAI | GPT-4o | Paid | Yes | Fallback |

---

## Build Phases

```
Phase 1 (DONE):   Foundation -- 7 nodes, risk rules, sessions, DB, paper trading
Phase 2 (NEXT):   LLM signal generator (Groq/Llama3) + RAG (Pinecone + 13 trading books)
Phase 3:          Intelligence layer -- live macro feeds, funding rates, sentiment APIs
Phase 4:          Telegram alerts + withdrawal automation
Phase 5:          Demo run (4 weeks minimum, 3 profitable weeks required)
Phase 6:          Live trading (small capital, parallel with demo)
```

---

## File Structure

```
backend/
  api/
    main.py                 REST API (V1 + V2 endpoints)
  core/
    indicators.py           20+ technical indicators
    backtester.py           Strategy backtesting engine
    ml_filter.py            XGBoost confidence filter
    lstm_predictor.py       LSTM price predictor
    trainer.py              ML training pipeline
  models/
    strategy.py             Strategy + Rule models
    trade.py                Trade models
  services/
    mt5_connector.py        MetaTrader5 native IPC
    ai_service.py           LLM integration (Groq, Gemini, Claude, GPT-4o)
  agent/                    V2 AUTONOMOUS AGENT
    config.py               All tunable parameters (.env backed)
    state.py                AgentState TypedDict (flows through all nodes)
    sessions.py             Session detection, Gold windows, news blackout
    db.py                   agent_trades, agent_cycles, agent_daily_stats
    graph.py                TradingAgent class -- main loop, data fetching
    data_fetcher.py         Smart data layer (MT5 local / EC2 remote / CCXT)
    feeds/
      crypto_feed.py        CCXT Binance/Bybit with failover
    nodes/
      market_scanner.py     Node 1 -- Filter watchlist
      context_enricher.py   Node 2 -- Macro/crypto/sentiment context
      regime_detector.py    Node 3 -- Classify market regime
      signal_generator.py   Node 4 -- Generate signals (rule-based -> LLM Phase 2)
      risk_calculator.py    Node 5 -- Position sizing + hard risk rules
      execution.py          Node 6 -- Paper/live execution
      monitor.py            Node 7 -- Partial exits, trailing stops, regime exits
  database.py               V1 SQLite layer
  seed_strategies.py        22 pre-built strategies

frontend/
  app/                      Next.js app router pages
  components/               Reusable UI (charts, strategy select, symbol picker)
  hooks/                    SSE + ticker hooks
  lib/
    api.ts                  Typed API client

config/
  settings.py               Environment config loader

deploy/
  setup.ps1                 EC2 Windows full setup (Python, Git, NSSM, venv)
  update.ps1                Pull + restart service
  env-template.ps1          .env generator

data/
  massttrader.db            SQLite database
  ml_models/                Trained model files (.joblib, .keras)
```
