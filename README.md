# MasstTrader

**AI-Powered Trading Education & Strategy Platform**

MasstTrader connects to MetaTrader 5, lets you describe trading strategies in plain English, backtests them on real historical data, analyzes your trades with AI feedback, and teaches you trading concepts — all from one platform.

## Features

| Feature | Description |
|---------|-------------|
| **MT5 Connection** | Connect to any MetaTrader 5 broker account (Exness, Deriv, etc.) directly from the browser. View positions, trade history, and account metrics |
| **Live Dashboard** | Real-time streaming prices, candlestick charts with indicator overlays (EMA, SMA, Bollinger Bands), open positions with live P/L, and account metrics via WebSocket |
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
Browser (Vercel HTTPS)
    │
    ├── REST API ──→ Vercel Rewrites ──→ AWS EC2 Windows (FastAPI :8008)
    │                                         │
    │                                    ┌────┴────┐
    │                                    │         │
    │                               MT5 Terminal  Groq LLM
    │                               (Exness IPC)  (Llama 3.3 70B)
    │
    └── WebSocket ──→ Direct to AWS (ws://13.48.148.223:8008)
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system diagram, data flow, and technical details.

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
│   │   └── use-live-stream.ts  # WebSocket hook
│   ├── lib/
│   │   └── api.ts              # Typed API client
│   └── vercel.json             # API proxy rewrites
│
├── backend/
│   ├── api/
│   │   └── main.py             # All FastAPI endpoints + WebSocket
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
echo "NEXT_PUBLIC_WS_URL=ws://13.48.148.223:8008" >> .env.local

# Run
pnpm dev
```

### Vercel Deployment

1. Connect the `frontend/` directory to Vercel
2. **Do not** set `NEXT_PUBLIC_API_URL` (leave it empty so requests use Vercel rewrites to avoid mixed content)
3. Set `NEXT_PUBLIC_WS_URL=ws://13.48.148.223:8008` for live streaming
4. `vercel.json` rewrites handle the HTTPS → HTTP proxy to the backend

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
| WS | `/api/ws/live` | WebSocket: live prices, positions, candles |

## License

MIT
