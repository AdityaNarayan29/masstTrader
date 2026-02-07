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
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐│
│  │Connection│ │ Strategy │ │Backtester│ │ Analyzer │ │  Tutor ││
│  │  Page    │ │ Builder  │ │  Page    │ │   Page   │ │  Page  ││
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └────────┘│
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
| Indicators | `ta` library + pandas | Technical analysis calculations |
| Hosting | AWS EC2 Windows (backend) | MT5 requires Windows |
| Data | pandas DataFrames (in-memory) | Candle + indicator storage |

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
