# Masst Trader v2 — Feature Requirements

> Pure AI autonomous trading agent · Personal build · Do not distribute
> Author: Aditya (NarayanJi) · Stack: LangGraph + Groq/Llama3 + MT5 + CCXT + RAG
> Goal: Minimum time to consistent profitability

---

## 1. Overview

Masst Trader v2 is a fully autonomous AI trading agent that operates 24/7 on a
Windows VPS. It requires zero manual input during live operation. The agent
analyzes market conditions across multiple data dimensions, retrieves relevant
trading wisdom from a curated knowledge base, generates high-confidence signals,
manages risk, executes orders, and monitors positions entirely on its own.

**Primary markets:** XAUUSD (Gold) via Exness MT5 · BTCUSDT via Binance/Bybit
**Environment:** Windows VPS · Exness MT5 · Python backend · FastAPI · LangGraph
**Deployment:** Demo first (minimum 4 weeks) → Live with small capital → Scale

**Design philosophy:** Every feature exists to do one of three things:

1. Increase signal quality (higher win rate)
2. Reduce signal noise (fewer bad trades)
3. Protect capital (survive losing streaks)

---

## 2. Core Architecture

The system is a LangGraph agent with 7 sequential nodes that form a continuous loop.

```
[Market Scanner] → [Context Enricher] → [Regime Detector] → [Signal Generator]
       → [Risk Calculator] → [Execution Node] → [Monitor Node]
                    ↺ loops back to Market Scanner
```

Each node is a discrete Python function with defined inputs, outputs, and
failure handling. All timeframes and intervals are configurable via .env.

**Default (intraday):** Entry = M5 · Trend = M15 · Bias = H1
**Scalping mode:** Entry = M1 · Trend = M5 · Bias = M15
**Swing mode:** Entry = H1 · Trend = H4 · Bias = D1
**Daily mode:** Entry = H4 · Trend = D1 · Bias = W1

Config keys: TF_ENTRY, TF_TREND, TF_BIAS, LOOP_INTERVAL_SECONDS

---

## 3. Data Layer

### 3.1 MT5 Feed (Forex / Gold)

- Connect to Exness MT5 via MetaTrader5 Python lib on Windows VPS
- Fetch OHLCV for all configured timeframes (M1 through W1)
- Fetch live tick data (bid/ask/spread) for XAUUSD
- Fetch account info: balance, equity, margin, open positions
- Auto-reconnect with exponential backoff on disconnection

### 3.2 Crypto Feed (BTC)

- Connect to Binance and Bybit via ccxt unified interface
- Fetch OHLCV for BTCUSDT across all timeframes
- WebSocket stream for live price updates
- Testnet mode for demo; mainnet for live (toggled via .env)

### 3.3 Macro / Correlation Data

These are the inputs most retail algo traders skip. This is your edge.

- **DXY (US Dollar Index):** Gold moves inverse to DXY almost always. If DXY
  is trending up strongly, no Gold longs regardless of chart. Hard rule: DXY
  momentum above threshold blocks Gold buys entirely.
- **VIX (Volatility Index):** Extreme VIX (>30) signals risk-off. Gold behaves
  differently, BTC typically sells off. Adjust confidence thresholds accordingly.
- **US Real Yields (TIPS):** Inverse correlation with Gold. Rising real yields
  = headwind for Gold longs. Fetched weekly via FRED API (free).
- **BTC Dominance:** Rising dominance = BTC relatively strong vs alts. Context
  signal for BTC directional bias.
- **Fed Funds Futures:** Signals market expectations on rate decisions. Affects
  Gold directly. Via CME Group data or Quandl (free tier).

### 3.4 BTC-Specific Intelligence

- **Funding Rates:** From Binance/Bybit API every cycle. Extreme positive
  funding (>0.1% per 8h) = overleveraged longs, squeeze risk — block longs.
  Extreme negative funding = overleveraged shorts, long squeeze likely.
  One of the most reliable contrarian signals in crypto.
- **Liquidation Heatmaps:** Coinglass API. Price gravitates toward
  high-liquidation zones (liquidity magnets). Agent uses this to identify
  likely TP targets and avoid placing SLs at obvious liquidation clusters.
- **Open Interest:** Rising OI + rising price = strong trend confirmation.
  Falling OI + rising price = weak move, likely reversal.
- **Exchange Netflow:** BTC flowing from exchanges to wallets = accumulation
  (bullish). Flowing to exchanges = distribution (bearish). Glassnode API.
- **Whale Alert:** Large on-chain transactions (>1000 BTC). Signals institutional
  activity. Via Whale Alert API (free tier).

### 3.5 Gold-Specific Intelligence

- **COT Report (Commitment of Traders):** CFTC releases weekly. Shows what
  commercials (smart money) are doing. Commercials net long Gold = strong
  bullish backdrop. Parsed from CFTC website, cached weekly.
- **Central Bank Buying Data:** IMF/World Gold Council monthly. Sustained
  central bank buying = long-term bullish backdrop.
- **Geopolitical Risk Index:** GPR Index (free, academic source). Elevated
  geopolitical risk = Gold safe haven premium. Threshold-based signal.

### 3.6 Sentiment Data

- **Crypto Fear & Greed Index:** alternative.me API, free, daily. Extreme
  fear (<20) = contrarian BTC buy signal. Extreme greed (>80) = caution on longs.
- **Reddit Sentiment:** r/Gold and r/Bitcoin. When retail is overwhelmingly
  bullish it is often a contrarian sell signal. Scraped via PRAW (Reddit API),
  scored via VADER sentiment analyzer.
- **Twitter/X Sentiment:** Crypto Twitter BTC sentiment. Scraped via Nitter
  or RapidAPI. Extreme retail euphoria = be cautious adding longs.

### 3.7 Economic Calendar

- Fetch high-impact events weekly via Forex Factory or Investing.com API
- Hard blackout 15 min before and after: NFP, FOMC decisions, Powell speeches,
  US CPI, GDP releases
- All blackout events logged with reason in audit trail

### 3.8 Session Awareness

- Agent knows current session: Sydney, Tokyo, London, New York
- **Gold:** Trade primarily during London open (08:00–10:00 GMT) and NY open
  (13:00–15:00 GMT). Skip Asian session entirely.
- **BTC:** Trades 24/7 but reduces position size 30% on low-liquidity weekends
  (Sat 20:00 GMT – Sun 20:00 GMT)
- All session windows configurable via .env

### 3.9 Agent Memory (Trade History)

- Every completed trade stored in SQLite with full context snapshot
- Fields: symbol, direction, entry, exit, SL, TP, PnL, regime, session,
  confidence, reasoning, timeframe mode, RAG passages used, prompt version, outcome
- Agent reads last 50 trades before every signal decision
- Agent explicitly instructed to identify patterns in its own recent losses

---

## 4. RAG Knowledge Base (The Secret Weapon)

This is what separates this agent from every basic trading bot. The agent has
access to a curated library of trading wisdom retrieved in real time to
contextualize every trade decision — it has read more trading books than most
human traders ever will.

### 4.1 Architecture

- Same stack as Masst Docs: LangChain + Pinecone + HuggingFace embeddings
- Books chunked into 500-token passages with 50-token overlap
- Indexed by topic tags: entry, exit, risk, psychology, Gold, BTC, regime, trend
- Query at signal time: agent describes current setup, retrieves top 3 passages
- Retrieved passages injected into Groq prompt alongside all market data

### 4.2 Trading Books to Ingest

| Book                                    | Author         | Key contribution                      |
| --------------------------------------- | -------------- | ------------------------------------- |
| Trading in the Zone                     | Mark Douglas   | Discipline, probability mindset       |
| The Disciplined Trader                  | Mark Douglas   | Patience, cutting losses clean        |
| Market Wizards                          | Jack Schwager  | Real patterns from the world's best   |
| Reminiscences of a Stock Operator       | Lefèvre        | Market wisdom, manipulation awareness |
| Technical Analysis of Financial Markets | Murphy         | Comprehensive TA reference            |
| Reading Price Charts Bar by Bar         | Al Brooks      | Price action entries and exits        |
| Advances in Financial Machine Learning  | Lopez de Prado | Quant edge, feature engineering       |
| The New Case for Gold                   | Rickards       | Gold macro fundamentals               |
| How to Trade in Stocks                  | Livermore      | Position building, trend following    |
| Trading Systems and Methods             | Kaufman        | Systematic trading design             |

### 4.3 Psychology Books to Ingest

| Book                       | Author        | Key contribution              |
| -------------------------- | ------------- | ----------------------------- |
| The Psychology of Trading  | Steenbarger   | Cognitive biases in decisions |
| Trade Mindfully            | Gary Dayton   | Mindfulness and patience      |
| The Mental Game of Trading | Jared Tendler | Tilt, confidence, discipline  |

### 4.4 How RAG Compresses Time to Profitability

Without RAG the agent takes trades that look fine on indicators but violate
fundamental trading principles. With RAG it avoids them. Example:

```
Setup: Gold at major resistance, RSI overbought, M15 trend still bullish

Without RAG → enters long (indicators green on M5)
              price reverses from resistance → SL hit → loss

With RAG → queries "overbought at resistance in uptrend"
           retrieves: "Never buy overbought at major resistance without
           a pullback first" — Al Brooks
           → outputs NONE, confidence 52%, waits
           → price pulls back → enters cleanly next cycle → TP hit
```

This effect compounds across hundreds of trades. It is the single biggest
accelerator to reducing the losing trade rate.

---

## 5. LangGraph Agent Nodes

### Node 1 — Market Scanner

**Input:** Watchlist, current time, session, news calendar
**Output:** Symbols cleared for analysis this cycle
**Logic:**

- Skip symbols in news blackout window
- Skip Gold during Asian session
- Skip BTC if funding rate extreme AND regime unclear
- Log reason for every skip in audit trail

### Node 2 — Context Enricher (New node)

**Input:** Cleared symbols from scanner
**Output:** Enriched context object per symbol
**Logic:**

- Fetch DXY trend for Gold context
- Fetch BTC funding rate, open interest, exchange netflow
- Fetch Fear & Greed score
- Fetch COT positioning (cached weekly)
- Compile Reddit/Twitter sentiment (cached hourly)
- Package all context for downstream nodes

### Node 3 — Regime Detector

**Input:** OHLCV from all 3 configured timeframes + enriched context
**Output:** Regime tag: TRENDING_UP / TRENDING_DOWN / RANGING / VOLATILE / AVOID
**Logic:**

- Calculate ADX, ATR, Bollinger Band width, EMA slope, MACD histogram
- LLM classifies regime with full macro context
- AVOID tag skips symbol entirely, logged with reason

### Node 4 — Signal Generator (LLM Brain)

**Input:** OHLCV (all 3 TFs), indicators, regime, enriched context,
last 50 trades, RAG-retrieved trading wisdom
**Output:** { direction, confidence, reasoning, entry, sl, tp }

Full prompt layers (in order):

1. System role — disciplined agent, patience, NOT trading is often best
2. Macro context — DXY, VIX, funding, Fear & Greed, session
3. Market data — multi-TF OHLCV + full indicator set
4. Trade history — last 10 trades with outcomes
5. RAG knowledge — top 3 retrieved passages from trading books
6. Task — output JSON signal, if in doubt output NONE

**Devil's advocate filter:**
For signals with confidence 65–75%, run a second LLM call with a devil's
advocate persona — explicitly asked to find strong reasons NOT to take the
trade. If it surfaces strong counter-arguments, confidence is downgraded and
signal discarded. Eliminates marginal trades that erode win rate over time.

### Node 5 — Risk Calculator

**Input:** Signal, account state, open positions, daily PnL, ATR, regime
**Output:** Validated order object — or REJECTED
**Logic:**

- Gold: max 0.75% balance at risk per trade
- BTC: max 0.5% balance at risk per trade
- Volatility scaling: ATR > 1.5x 20-period average → reduce size 30%
- Consecutive loss scaling:
  - 2 losses in a row → next trade -25% size
  - 3 losses in a row → next trade -50% size, require 75% confidence
  - Resets after 2 consecutive wins
- ATR-based SL: entry ± (ATR × 1.5)
- Minimum R:R 1.5 — reject if TP < 1.5x SL distance
- Reject if max positions (5) reached or same symbol already open

### Node 6 — Execution Node

**Input:** Validated order object
**Output:** Ticket, fill price, slippage
**Logic:**

- Smart entry: limit order 2–3 pips inside price for better fill
- Fallback: if limit not filled in 60 seconds, cancel and re-evaluate next cycle
- MT5: order_send() with 3 retries, exponential backoff
- CCXT: create_order() with 3 retries
- Demo: simulate fill at current price
- Live: real execution (ENV=live)
- Log actual vs expected fill price (slippage tracking)

### Node 7 — Monitor Node

**Input:** Open positions, prices, account state, regime
**Output:** Close/modify actions for open positions
**Logic:**

- Partial exit: close 50% at 1R, move SL to breakeven, let 50% run to TP
- Trailing stop: once 1x ATR in profit, trail SL by ATR x 0.5
- LLM regime exit: if regime flips to AVOID/VOLATILE, LLM can force close
- DXY correlation exit: sharp DXY spike against open Gold long → close immediately
- Max hold time: configurable per symbol
- Loop back to Market Scanner

---

## 6. Risk Management (Non-Negotiable Rules)

Enforced at code level. LLM cannot override under any circumstances.

| Rule                             | Value                                                           |
| -------------------------------- | --------------------------------------------------------------- |
| Max risk per trade — Gold        | 0.75% of balance                                                |
| Max risk per trade — BTC         | 0.5% of balance                                                 |
| Volatility size adjustment       | -30% when ATR > 1.5x average                                    |
| Daily drawdown kill switch       | 3% — halt all trading for 24h                                   |
| Weekly drawdown kill switch      | 8% — halt all trading until Monday                              |
| Max open positions               | 5                                                               |
| Max same-symbol positions        | 1                                                               |
| Consecutive loss circuit breaker | 2 losses = -25% size, 3 losses = -50% + 75% confidence required |
| Min R:R ratio                    | 1.5                                                             |
| News blackout                    | 15 min before/after NFP, FOMC, CPI, GDP                         |
| Confidence threshold             | 65% minimum                                                     |
| Devil's advocate filter          | Active for signals 65–75% confidence                            |
| Emergency stop                   | /stop command or dashboard                                      |
| DXY block                        | No Gold longs when DXY strongly bullish                         |
| Funding rate block               | No BTC longs when funding > 0.1% per 8h                         |
| Max hold time — Gold             | MAX_HOLD_HOURS_GOLD (default 8h)                                |
| Max hold time — BTC              | MAX_HOLD_HOURS_BTC (default 12h)                                |

---

## 7. Prompt Versioning + Auto-Optimization

### 7.1 Prompt Versioning

- Every Groq call tagged with prompt version ID (e.g. prompt_v1.3)
- Every trade result linked to the prompt version that generated it
- Weekly stats per version: win rate, avg R:R, confidence calibration

### 7.2 Confidence Calibration Tracking

- Track: are 70% confidence signals actually winning ~70% of the time?
- If 70% signals win only 50% → threshold needs raising or prompt needs tuning
- Auto Telegram alert when calibration drifts >10% over 20+ trades

### 7.3 Session + Regime Performance Tracking

- Win rate by: session, regime, timeframe mode, symbol
- Suggestions auto-generated (not auto-applied): "Gold Asian session win rate
  is 38% — consider tightening Asian session block"
- Human confirms before applying any automatic rule changes

---

## 8. Withdrawal Automation

Baseline tracks the starting point for each withdrawal cycle.

**Trigger:** current_balance >= baseline × 2.5

**Action:**

1. Withdraw = baseline × 1.0
2. New baseline = baseline × 1.5
3. Telegram alert: amount, new baseline, next trigger level
4. Audit log entry
5. Aditya executes manually (agent never initiates broker withdrawal)

**Progression:**

```
Start:   $1,000 → trigger $2,500 → withdraw $1,000 → new base $1,500
Round 2: $1,500 → trigger $3,750 → withdraw $1,500 → new base $2,250
Round 3: $2,250 → trigger $5,625 → withdraw $2,250 → new base $3,375
Round 4: $3,375 → trigger $8,437 → withdraw $3,375 → new base $5,062
```

---

## 9. Notifications (Telegram)

| Event                  | Alert content                                                     |
| ---------------------- | ----------------------------------------------------------------- |
| Trade opened           | Symbol, direction, entry, SL, TP, lot, confidence, RAG quote used |
| Partial exit triggered | Symbol, 50% closed at X, PnL locked, SL at BE                     |
| Trade closed           | Symbol, PnL, reason, running balance                              |
| Daily drawdown kill    | Balance, drawdown %, resume time                                  |
| Weekly drawdown kill   | Balance, drawdown %, resume Monday                                |
| Circuit breaker        | Consecutive losses, new position size, new confidence threshold   |
| Withdrawal trigger     | Amount, new baseline, next trigger                                |
| DXY block              | DXY blocked Gold long this cycle                                  |
| Funding block          | Extreme funding blocked BTC long this cycle                       |
| Calibration drift      | Win rate vs confidence deviation alert                            |
| Agent error            | Node, error message, action taken                                 |
| Daily summary          | Trades, win rate, PnL, balance, best and worst trade              |
| Weekly report          | Full breakdown by session, regime, symbol                         |

**Commands:**

- /status — balance, equity, open positions, daily PnL
- /stop — emergency halt
- /resume — resume after halt
- /trades — last 10 trades with PnL and reasoning
- /summary — today's full breakdown
- /weekly — this week's performance report
- /winrate — win rate by session, regime, symbol
- /next — next withdrawal trigger level and current distance to it

---

## 10. Audit Logs

Full structured JSON log per cycle including: timestamp, prompt version,
symbol, session, regime, macro context snapshot, signal, confidence, whether
devil's advocate ran, RAG passage IDs used, full reasoning, action taken,
order details (ticket, fill type, entry requested vs filled, slippage, SL,
TP, lots, risk amount, risk %).

Stored as daily JSON files in logs/. Retained 90 days.
Every NONE signal also logged — this is how prompt tuning happens.

---

## 11. Tech Stack

| Layer             | Technology                                      |
| ----------------- | ----------------------------------------------- |
| Agent framework   | LangGraph                                       |
| Primary LLM       | Groq / Llama 3 70B                              |
| Fallback LLM      | OpenAI GPT-4o-mini (auto-failover if Groq down) |
| RAG framework     | LangChain                                       |
| Vector store      | Pinecone                                        |
| Embeddings        | HuggingFace                                     |
| Forex broker      | Exness MT5 via MetaTrader5 Python lib           |
| Crypto broker     | Binance + Bybit via ccxt                        |
| Backend           | FastAPI                                         |
| Scheduler         | APScheduler                                     |
| Database          | SQLite                                          |
| Alerts            | python-telegram-bot                             |
| Indicators        | pandas-ta                                       |
| On-chain data     | Glassnode API (BTC netflow)                     |
| Liquidation data  | Coinglass API                                   |
| Macro data        | FRED API (real yields, free)                    |
| Sentiment scoring | VADER + PRAW (Reddit)                           |
| Deployment        | Windows VPS                                     |
| Language          | Python 3.11+                                    |

---

## 12. Build Phases

### Phase 1 — Foundation (Week 1–2)

- [ ] MT5 data feed (XAUUSD OHLCV + tick + account)
- [ ] CCXT feed (BTCUSDT OHLCV + WebSocket)
- [ ] Indicator calculation (EMA, RSI, MACD, ATR, ADX, Bollinger)
- [ ] LangGraph skeleton — all 7 nodes, rule-based stubs
- [ ] Risk calculator with full position sizing logic
- [ ] SQLite schema + trade logger
- [ ] Paper execution (demo mode, no real orders)
- [ ] Session awareness + news calendar blackout

### Phase 2 — LLM + RAG (Week 3–4)

- [ ] Groq signal generator with full prompt structure
- [ ] Regime detector with LLM classification
- [ ] RAG pipeline — ingest all books into Pinecone
- [ ] RAG query integration into signal prompt
- [ ] Agent memory (last 50 trades as context)
- [ ] Devil's advocate second LLM call (65–75% signals)
- [ ] Confidence filtering (65% threshold)
- [ ] Prompt versioning system

### Phase 3 — Intelligence Layer (Week 5)

- [ ] DXY feed + Gold correlation block
- [ ] BTC funding rate feed + block rule
- [ ] BTC open interest + liquidation heatmap (Coinglass)
- [ ] Crypto Fear & Greed integration
- [ ] Reddit sentiment scraper (PRAW + VADER)
- [ ] COT report parser (weekly, cached)
- [ ] Context Enricher node fully operational
- [ ] LLM fallback to OpenAI on Groq failure

### Phase 4 — Risk + Alerts (Week 6)

- [ ] All hard risk rules enforced at code level
- [ ] Daily + weekly drawdown kill switches
- [ ] Consecutive loss circuit breaker
- [ ] Volatility-adjusted position sizing
- [ ] Partial exit at 1R + trailing stop logic
- [ ] Withdrawal trigger + Telegram notification
- [ ] Full Telegram bot (all commands and alerts)
- [ ] Weekly performance report auto-generation

### Phase 5 — Demo Run (Week 7–10)

- [ ] Run on Exness demo — minimum 4 weeks
- [ ] Review audit logs weekly
- [ ] Track win rate by session, regime, prompt version
- [ ] Monitor confidence calibration drift
- [ ] Tune RAG queries and prompts based on losing trades
- [ ] Do not go live until 3 consecutive profitable demo weeks

### Phase 6 — Live (Week 11+)

- [ ] Switch ENV=live
- [ ] Minimum capital on Exness
- [ ] Run live + demo in parallel for 2 weeks
- [ ] Scale capital after 2 profitable live months

---

## 13. What Reduces Turnover Time Most (Priority Order)

1. RAG knowledge base — prevents bad trades a pure indicator bot takes
2. Devil's advocate filter — eliminates marginal signals that erode win rate
3. Macro correlation rules (DXY, funding) — avoids trading against macro
4. Consecutive loss circuit breaker — protects capital during drawdown periods
5. Session filtering — only trade when the market moves for your pair
6. Partial exit at 1R — converts breakeven trades into small wins
7. Prompt versioning + calibration — continuously improves over time

---

## 14. What This Is Not

- Not a get-rich-quick system — it is a disciplined compounding engine
- Not infallible — no system wins 100% of the time
- Not unsupervised forever — weekly audit log review is mandatory
- Not a product — personal tool only in v1

---

Last updated: March 2026
Next step: Phase 1 — scaffold project and build MT5 + CCXT data feeds
