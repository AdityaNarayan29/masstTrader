# MasstTrader

**AI-Powered Trading Education & Strategy Platform**

MasstTrader connects to MetaTrader 5, lets you describe trading strategies in plain English, backtests them on real historical data, analyzes your trades with AI feedback, and teaches you trading concepts — all from one platform.

## Features

| Feature | Description |
|---------|-------------|
| **MT5 Connection** | Connect to any MetaTrader 5 broker account (Exness, Deriv, etc.) directly from the browser. View positions, trade history, and account metrics |
| **Live Dashboard** | Real-time SSE-streamed prices, candlestick charts with indicator overlays (EMA, RSI, MACD, Bollinger Bands), open positions with live P/L, and account metrics |
| **AI Strategy Builder** | Describe a strategy in natural language ("Buy when RSI < 30 and MACD crosses above signal") — AI converts it to structured, executable rules |
| **Backtester** | Test strategies against real MT5 historical data with configurable timeframe, bars, balance, and risk. Candlestick chart with trade entry/exit markers, equity curve, and per-trade P/L breakdown |
| **AI Trade Analyzer** | Submit a trade you took and AI compares it against your strategy rules, giving an alignment score (0-100) and detailed coaching feedback |
| **Algo Trading** | Automatically execute trades based on your strategy rules with live condition monitoring, indicator tracking, and signal logging |
| **AI Tutor** | Personalized trading lessons based on your experience level and the instruments you trade, with follow-up chat |
| **Strategy Persistence** | Save, load, update, and delete strategies and backtests in a SQLite database |
| **Light/Dark Theme** | Full light and dark theme support with emerald green accent, toggle from sidebar |
| **Symbol Combobox** | Searchable symbol picker with grouped presets (Forex, Metals, Crypto, Indices) and custom input |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          BROWSER (Client)                           │
│                                                                     │
│  Next.js 16 + TypeScript + Tailwind v4 + shadcn/ui                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ Strategy │ │   Live   │ │ Backtest │ │ Analyzer │ │  Tutor   │   │
│  │ Builder  │ │Dashboard │ │  Engine  │ │   (AI)   │ │  (AI)    │  │
│  └────┬─────┘ └───┬──────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ │
│       │       SSE ↓Stream       │            │            │        │
│       │  ┌─────────────┐        │            │            │        │
│       │  │EventSource  │        │            │            │        │
│       │  │/api/sse/live│        │            │            │        │
│       │  │/api/sse/tick│        │            │            │        │
│       │  └──────┬──────┘        │            │            │        │
│       │         │               │            │            │        │
│  ─────┴─────────┴───────────────┴────────────┴────────────┴──────  │
│                          REST API Client (api.ts)                   │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │ HTTPS
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     VERCEL EDGE NETWORK                             │
│                                                                     │
│  vercel.json rewrites: /api/* → http://EC2:8008/api/*              │
│  (HTTPS → HTTP proxy, solves mixed content)                         │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │ HTTP
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│               AWS EC2 Windows (FastAPI + Uvicorn :8008)             │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                      FastAPI Application                       │ │
│  │                                                                │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │ │
│  │  │  REST    │  │   SSE    │  │  Algo    │  │  Backtest    │  │ │
│  │  │Endpoints │  │Streaming │  │  Engine  │  │   Engine     │  │ │
│  │  │(CRUD,MT5)│  │(live,tick│  │(bg thread│  │(indicators,  │  │ │
│  │  │          │  │ er)      │  │ trading) │  │ evaluate)    │  │ │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │ │
│  │       │              │             │               │          │ │
│  │  ─────┴──────────────┴─────────────┴───────────────┴────────  │ │
│  │                    MT5 Connector (IPC)                         │ │
│  └──────────────────────────┬─────────────────────────────────────┘ │
│                             │                                       │
│  ┌──────────────────────────┴──────────────────────────────────┐   │
│  │                                                              │   │
│  │  ┌────────────┐    ┌────────────┐    ┌────────────────────┐ │   │
│  │  │ MetaTrader │    │   SQLite   │    │   Groq / Gemini /  │ │   │
│  │  │ 5 Terminal │    │   (data/   │    │   Claude / OpenAI  │ │   │
│  │  │  (Exness)  │    │   .db)     │    │   (AI Provider)    │ │   │
│  │  └────────────┘    └────────────┘    └────────────────────┘ │   │
│  │                                                              │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
Live Streaming (SSE):
  Browser → GET /api/sse/live?symbol=EURUSDm&timeframe=1m
         ← event: price   (every 500ms)  — bid, ask, spread
         ← event: positions (every 1s)   — open trades with P/L
         ← event: account  (every 2s)    — balance, equity, margin
         ← event: algo     (every 1s)    — conditions, indicators, signals
         ← event: candle   (every 5s)    — OHLCV + computed indicators

Sidebar Ticker (SSE):
  Browser → GET /api/sse/ticker?symbol=EURUSDm
         ← event: price       (every 1s) — bid, ask
         ← event: account     (every 4s) — equity, profit
         ← event: algo_status (every 2s) — running, trades count

Strategy Flow:
  User describes in English → AI parses to rules → Save to SQLite
  → Load into Backtest Engine OR Algo Engine

Algo Trading:
  Strategy rules → Background thread → MT5 price check (5s loop)
  → Evaluate entry/exit conditions → Place/close trades via MT5
```

## Tech Stack

**Frontend**
- Next.js 16 + TypeScript
- Tailwind CSS v4 + shadcn/ui + next-themes
- lightweight-charts (TradingView) for candlestick charts
- Recharts for equity curves and analytics
- Deployed on Vercel

**Backend**
- FastAPI + Uvicorn
- MetaTrader5 Python package (native IPC)
- `ta` library + pandas for technical indicators
- SQLite for persistence
- Deployed on AWS EC2 Windows

**AI**
- Groq (Llama 3.3 70B) — free, default provider
- Also supports: Google Gemini, Anthropic Claude, OpenAI GPT-4o

## Project Structure

```
masstTrader/
├── frontend/                    # Next.js app
│   ├── app/
│   │   ├── page.tsx            # Landing page
│   │   ├── layout.tsx          # Root layout with sidebar
│   │   ├── sidebar.tsx         # Navigation sidebar
│   │   ├── connection/         # MT5 connection page
│   │   ├── live/               # Live streaming dashboard
│   │   ├── strategy/           # AI strategy builder
│   │   ├── backtest/           # Backtester with charts
│   │   ├── analyzer/           # AI trade analyzer
│   │   └── tutor/              # AI tutor
│   ├── components/
│   │   ├── live-chart.tsx      # TradingView candlestick chart
│   │   ├── symbol-combobox.tsx # Searchable symbol picker
│   │   └── theme-provider.tsx  # Light/dark theme (next-themes)
│   ├── hooks/
│   │   ├── use-live-stream.ts  # SSE streaming hook (live dashboard)
│   │   └── use-ticker.ts       # SSE ticker hook (sidebar)
│   ├── lib/
│   │   └── api.ts              # Typed API client
│   └── vercel.json             # API proxy rewrites
│
├── backend/
│   ├── api/
│   │   └── main.py             # All FastAPI endpoints + SSE streaming
│   ├── core/
│   │   ├── backtester.py       # Backtesting engine
│   │   └── indicators.py       # Technical indicators (ta library)
│   ├── services/
│   │   └── ai_service.py       # LLM calls (Groq/Gemini/Claude/OpenAI)
│   ├── models/
│   │   └── mt5_connector.py    # MetaTrader5 connection wrapper
│   └── database.py             # SQLite persistence
│
├── config/
│   └── settings.py             # Environment config
├── data/                       # SQLite database
├── ARCHITECTURE.md             # Detailed architecture docs
└── requirements.txt            # Python dependencies
```

## Setup

### Backend (AWS EC2 Windows)

```bash
# Clone
git clone https://github.com/AdityaNarayan29/masstTrader.git
cd masstTrader

# Install Python dependencies
pip install -r requirements.txt

# Set environment variables
set AI_PROVIDER=groq
set GROQ_API_KEY=gsk_...

# Run
uvicorn backend.api.main:app --host 0.0.0.0 --port 8008
```

### Frontend (Local / Vercel)

```bash
cd frontend

# Install
pnpm install

# Set environment variables
echo "NEXT_PUBLIC_API_URL=http://13.48.148.223:8008" > .env.local

# Run
pnpm dev
```

### Vercel Deployment

1. Connect the `frontend/` directory to Vercel
2. **Do not** set `NEXT_PUBLIC_API_URL` (leave empty — all requests use Vercel rewrites to avoid mixed content)
3. `vercel.json` rewrites `/api/*` → `http://EC2:8008/api/*` (handles HTTPS → HTTP proxy)
4. SSE streaming works through the same rewrite — no WebSocket or special config needed

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | System status (MT5, data, strategy) |
| POST | `/api/mt5/connect` | Connect to MT5 broker |
| POST | `/api/mt5/disconnect` | Disconnect from MT5 |
| GET | `/api/mt5/account` | Account info (balance, equity, margin) |
| GET | `/api/mt5/positions` | Open positions |
| POST | `/api/mt5/trade` | Place a trade |
| POST | `/api/mt5/close/:ticket` | Close a position |
| POST | `/api/data/fetch` | Fetch historical OHLCV + indicators |
| POST | `/api/data/demo` | Load synthetic demo data |
| POST | `/api/strategy/parse` | AI: natural language → strategy rules |
| GET | `/api/strategies` | List saved strategies |
| POST | `/api/strategies` | Save current strategy |
| POST | `/api/backtest/run` | Run backtest on historical data |
| POST | `/api/backtest/explain` | AI explanation of backtest results |
| POST | `/api/analyze/trade` | AI trade analysis vs strategy |
| POST | `/api/algo/start` | Start algo trading |
| POST | `/api/algo/stop` | Stop algo trading |
| GET | `/api/algo/status` | Algo status with conditions + indicators |
| POST | `/api/tutor/lesson` | AI-generated trading lesson |
| SSE | `/api/sse/live` | Full stream: prices, positions, account, candles, algo |
| SSE | `/api/sse/ticker` | Lightweight stream: price + account for sidebar |

## License

MIT
