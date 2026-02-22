# MasstTrader — Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER (Browser)                           │
│                     http://localhost:3000                        │
└──────────────────────────┬──────────────────────────────────────┘
                           │ REST API calls
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   FRONTEND (Mac / Local)                         │
│                   Next.js 16 + TypeScript                        │
│                   Tailwind CSS + shadcn/ui                       │
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────┐ ┌──────┐│
│  │Connection│ │ Strategy │ │Backtester│ │ Analyzer │ │ ML │ │Tutor ││
│  │  Page    │ │ Builder  │ │  Page    │ │   Page   │ │Dash│ │ Page ││
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └────┘ └──────┘│
│                                                                  │
│  lib/api.ts ── Typed API client with timeout + error handling    │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP (port 8008)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│               BACKEND (AWS EC2 Windows)                          │
│               FastAPI + Uvicorn                                  │
│               http://13.48.148.223:8008                          │
│                                                                  │
│  ┌───────────────────── API Layer ─────────────────────────┐    │
│  │                                                          │    │
│  │  /api/mt5/*      MT5 connection, account, trading        │    │
│  │  /api/data/*     Historical candles + indicators         │    │
│  │  /api/strategy/* AI strategy parsing                     │    │
│  │  /api/backtest/* Strategy backtesting + AI explanation   │    │
│  │  /api/analyze/*  Trade analysis vs strategy              │    │
│  │  /api/tutor/*    Personalized AI lessons                 │    │
│  │  /api/ml/*       ML training, prediction, dashboard     │    │
│  │  /api/health     System status check                     │    │
│  │                                                          │    │
│  └──────────┬──────────────┬──────────────┬────────────────┘    │
│             │              │              │                       │
│             ▼              ▼              ▼                       │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │MT5 Connector │ │  AI Service  │ │  Core Engine │            │
│  │              │ │              │ │              │            │
│  │ Native IPC   │ │ Groq (free)  │ │ Indicators   │            │
│  │ MetaTrader5  │ │ Gemini (free)│ │ (ta library) │            │
│  │ Python pkg   │ │ Claude       │ │              │            │
│  │              │ │ GPT-4o       │ │ Backtester   │            │
│  └──────┬───────┘ └──────┬───────┘ └──────────────┘            │
│         │                │                                       │
│         ▼                ▼                                       │
│  ┌──────────────┐ ┌──────────────┐                              │
│  │ MT5 Terminal │ │   LLM API    │                              │
│  │ (Exness)     │ │  (Groq Cloud)│                              │
│  │ Running on   │ │              │                              │
│  │ same Windows │ │  Llama 3.3   │                              │
│  │ instance     │ │  70B Free    │                              │
│  └──────────────┘ └──────────────┘                              │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

```
1. CONNECT          User → Frontend → POST /api/mt5/connect → MT5 Terminal (IPC)
                    Returns: account info (balance, equity, leverage)

2. FETCH DATA       User → Frontend → POST /api/data/fetch → MT5 copy_rates_from_pos()
                    Returns: OHLCV candles + 10 technical indicators

3. PARSE STRATEGY   User → Frontend → POST /api/strategy/parse → Groq LLM
                    Input: "Buy when RSI < 30 and MACD crosses above signal"
                    Returns: Structured JSON rules with conditions

4. BACKTEST         User → Frontend → POST /api/backtest/run → Core Engine
                    Runs strategy rules against historical candles
                    Returns: trades, stats, equity curve

5. ANALYZE TRADE    User → Frontend → POST /api/analyze/trade → Groq LLM
                    Compares manual trade against strategy rules
                    Returns: alignment score + educational feedback

6. AI TUTOR         User → Frontend → POST /api/tutor/lesson → Groq LLM
                    Personalized lesson based on level + instruments
                    Returns: markdown-formatted lesson
```

## ML Pipeline

### XGBoost Confidence Filter (`ml_filter.py` + `trainer.py`)
```
Training Data Sources:
  1. Fresh backtests (run all strategies through backtester)
  2. Stored backtest results (from DB)
  3. Live algo trade outcomes (closed trades with P&L)

Feature Engineering (13 features):
  RSI_14, MACD_histogram, MACD_line, BB_width, ATR_14, ADX_14,
  Stoch_K, Stoch_D, Volume_ratio, EMA_9_21_spread,
  close_vs_BB_middle, close_vs_EMA_50, direction

Pipeline:
  Collect samples → NaN cleaning → Train/test split (80/20)
  → XGBoost classifier → Evaluate → Save .joblib → Reload into memory

Runtime (Algo Loop):
  Entry conditions met → extract_features(indicators) → predict_proba()
  → confidence < threshold (55%) → BLOCK trade
  → confidence >= threshold → ALLOW trade + log score
```

### LSTM Price Predictor (`lstm_predictor.py`)
```
Architecture:
  Input: 50 candles × 24 indicator features
  → LSTM(64, return_sequences=True) → Dropout(0.2)
  → LSTM(32) → Dropout(0.2)
  → Dense(16, relu) → Dense(1, sigmoid)

Training:
  Historical candles → add_all_indicators() → StandardScaler
  → Sliding window sequences → Binary labels (close[i+1] > close[i])
  → Train with EarlyStopping(patience=5) → Save .keras + scaler

Prediction:
  Latest 50 candles → Scale → Predict → probability
  → >= 0.55: "up" | <= 0.45: "down" | else: "neutral"
```

### ML Data Flow
```
                    ┌─────────────┐
                    │  MT5 Broker  │
                    └──────┬──────┘
                           │ Historical candles
                           ▼
                    ┌──────────────┐
                    │  Indicators  │──→ 24 features (LSTM)
                    │  (ta library)│──→ 13 features (XGBoost)
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
       ┌────────────┐ ┌──────────┐ ┌────────────┐
       │  XGBoost   │ │   LSTM   │ │  Training  │
       │  Filter    │ │ Predictor│ │  History   │
       │ (gate)     │ │ (info)   │ │  (SQLite)  │
       └─────┬──────┘ └────┬─────┘ └─────┬──────┘
             │             │              │
             ▼             ▼              ▼
       ┌──────────────────────────────────────┐
       │           ML Dashboard               │
       │  Accuracy charts, training controls, │
       │  confidence distribution, trade      │
       │  outcome analysis                    │
       └──────────────────────────────────────┘
```

## Technical Indicators (computed on data fetch)

| Indicator | Parameters | Library |
|-----------|-----------|---------|
| RSI | period=14 | `ta` |
| MACD | line, signal, histogram | `ta` |
| EMA | period=50 | `ta` |
| SMA | period=20 | `ta` |
| Bollinger Bands | upper, middle, lower, width | `ta` |
| ATR | period=14 | `ta` |
| Stochastic | K, D | `ta` |
| ADX | value, DI+, DI- | `ta` |
| Volume | OBV, ratio | `ta` |

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | Next.js 16 + TypeScript | UI framework |
| UI Components | shadcn/ui + Tailwind CSS v4 | Design system |
| Backend | FastAPI + Uvicorn | REST API server |
| Broker Connection | MetaTrader5 Python (native IPC) | Direct MT5 terminal communication |
| AI/LLM | Groq (Llama 3.3 70B) — free | Strategy parsing, analysis, tutoring |
| ML | XGBoost (scikit-learn) | Trade confidence filter |
| Deep Learning | TensorFlow/Keras LSTM | Price direction prediction |
| Indicators | `ta` library + pandas | Technical analysis calculations |
| Hosting | AWS EC2 Windows (backend) | MT5 requires Windows |
| Data | SQLite + pandas DataFrames | Persistence + in-memory analysis |

## AI Provider Support

| Provider | Model | Cost | JSON Mode |
|----------|-------|------|-----------|
| **Groq** (default) | Llama 3.3 70B | Free | Yes |
| Google Gemini | Gemini 2.0 Flash | Free tier | Yes |
| Anthropic | Claude Sonnet 4 | Paid | No (extracts JSON) |
| OpenAI | GPT-4o | Paid | Yes |

## Environment Variables (.env)

```env
# Required: AI (pick one)
AI_PROVIDER=groq
GROQ_API_KEY=gsk_...

# Optional: MT5 (can also connect via frontend form)
MT5_LOGIN=260210496
MT5_PASSWORD=...
MT5_SERVER=Exness-MT5Trial15
```
