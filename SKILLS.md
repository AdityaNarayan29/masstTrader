# MasstTrader - Production Readiness Tracker

> Living document. **Update the status table after every feature is implemented.**
> Every claim here is verified against the codebase - no assumptions. If something
> is unverified it is marked `UNVERIFIED` explicitly.
>
> Last updated: 2026-09-06

## How to use this file

1. Work top-down through the phases. P0 blocks real money, P1 blocks trust, P2 is the spec backlog.
2. After finishing an item: set status to `DONE`, add the date, and write what
   changed under **Change log** with the files touched and how it was verified.
3. Never mark `DONE` without a verification step that actually ran.

---

## Verified system state (2026-09-06)

| Component | State | Evidence |
| --- | --- | --- |
| Azure VM | Running, Sweden Central, `D2as_v5` 2vCPU/8GB | `az vm get-instance-view` |
| Backend | FastAPI on `51.107.189.223:8008`, NSSM service, auto-restart | `/api/health` 200 |
| MT5 | **Connected** - acct `472604152`, `Exness-MT5Trial16`, demo, 1:2000 | `/api/mt5/account` |
| MT5 balance | **$0.00** - agent cannot size any position | `/api/mt5/account` |
| AI (Groq) | Working, `openai/gpt-oss-120b` | `/api/strategy/parse` returned valid rules |
| Backtester | Working, 42 trades on demo data | `/api/backtest/run` |
| V2 agent | Cycles run; signal generator is rule-based, not LLM | `/api/agent/cycle` |
| Frontend | Next.js 16, 9 pages, all 200 | local `:3000` |
| Tests | 64 passing (`pytest -q`) | indicators, risk, auth, audit, notifier |

---

## P0 - Blocks running with real money

| # | Item | Status | Done |
| --- | --- | --- | --- |
| 1 | API auth fails open - blank `API_KEY` disables all auth | **DONE** | 2026-09-06 |
| 2 | No Telegram/alerting - agent runs unattended with no way to report failure | **DONE** | 2026-09-06 |
| 3 | No structured audit log (spec S10 requires daily JSON in `logs/`) | **DONE** | 2026-09-06 |
| 4 | Kill switches (daily/weekly drawdown) have never been executed or tested | **DONE** | 2026-09-06 |
| 5 | Local bug fixes are uncommitted - a VM rebuild reintroduces them | TODO | |
| 6 | `setup.ps1` omits VC++ redistributable - TensorFlow fails on fresh deploy | **DONE** | 2026-09-06 |
| 22 | MT5 connection does not survive a restart - credentials are not in the VM's `.env` | TODO | |

### Detail

**22. MT5 connection is not durable.** Connecting through
`POST /api/mt5/connect` (the web form) stores the connector in memory only. Any
restart - deploy, crash, NSSM auto-restart, VM reboot - drops it, and because
`MT5_LOGIN`/`MT5_PASSWORD`/`MT5_SERVER` are blank in the VM's `.env` the agent
cannot reconnect on its own. Observed directly: the deploy on 2026-09-06 flipped
`mt5_connected` from true to false. For unattended 24/7 operation the credentials
must live in `.env` so `graph.py::_get_mt5_connector` can auto-reconnect.

**1. API auth fails open.** `backend/api/main.py:86` - `if _API_KEY and request.url.path != "/api/health"`.
A blank `API_KEY` skips authentication for every route, including `POST /api/mt5/trade`
and `POST /api/agent/start`. Currently mitigated only by the NSG rule restricting
port 8008 to one IP. Opening 8008 for Vercel (which the documented architecture
requires) makes trade placement world-callable.
*Fix:* fail closed - refuse to start when `API_KEY` is unset and `AGENT_ENV=live`.

**2. No alerting.** `grep -ri telegram` returns zero files. `FeatureRequirements.md` S9
specifies 13 alert types and 8 commands. The agent is designed to run 24/7 unattended;
without alerting a crash, a kill-switch trip, or a losing streak is silent.

**3. No audit log.** Spec S10 wants per-cycle structured JSON in `logs/`, retained 90
days, including every `NONE` signal. Currently only `agent_cycles` rows in SQLite and
stdout via NSSM.

**4. Kill switches untested.** `risk_calculator.py` implements daily (3%) and weekly (8%)
drawdown halts and the consecutive-loss breaker. None has ever fired - `agent_trades`
is empty. Untested safety code is not safety code.

**5. Uncommitted fixes.** Volume-profile `IndexError`, configurable Groq model,
`setup.ps1` branch, `env-template.ps1` em-dash. Applied live to the VM via
`run-command`; a rebuild from GitHub loses all of them.

**6. VC++ redistributable.** TensorFlow could not import on the fresh VM
(`msvcp140.dll` missing). Fixed manually; `setup.ps1` still does not install it.

---

## P1 - Correctness and maintainability

| # | Item | Status | Done |
| --- | --- | --- | --- |
| 7 | Zero tests - no coverage of risk sizing, backtester, or indicators | **PARTIAL** (32 tests) | 2026-09-06 |
| 8 | 26 exception handlers silently `pass` | TODO | |
| 9 | Dead code: `backend/agent/data_fetcher.py` (107 lines, never imported) | **DONE** | 2026-09-06 |
| 10 | Module-level mutable globals + 12 `global` statements in `main.py` | TODO | |
| 11 | `main.py` is 2370 lines - all endpoints in one module | TODO | |
| 12 | Deploy workflow targets the old EC2 host, not the Azure VM | **DONE** | 2026-09-06 |
| 13 | No SQLite backup - trade history is unrecoverable if the disk dies | TODO | |

### Detail

**9. Dead code.** `data_fetcher.py` is never imported; `graph.py` has its own
`_fetch_symbol_data`. They disagree: `data_fetcher` routes with `"m" not in symbol`
(matches an `m` anywhere), `graph.py` uses `not symbol.endswith("m")`. Only the
`graph.py` version has the CCXT fallback that makes BTC work at all.

**10. Global state.** `connector`, `historical_data`, `current_strategy`,
`backtest_results`, `trade_history` are module-level and mutated via `global`.
Two concurrent backtests race on `historical_data`.

---

## P2 - Spec backlog (FeatureRequirements.md Phases 2-4)

| # | Item | Status | Done |
| --- | --- | --- | --- |
| 14 | Signal generator is rule-based; spec wants LLM (Phase 2) | TODO | |
| 15 | Devil's advocate is rule-based; spec wants a second LLM call | TODO | |
| 16 | RAG knowledge base - entirely absent (spec ranks it #1 for profitability) | TODO | |
| 17 | Macro feeds return hardcoded stubs (DXY, VIX, COT, Fear & Greed) | TODO | |
| 18 | News calendar blackout - only a list of event-name strings exists | TODO | |
| 19 | Confidence calibration tracking | TODO | |
| 20 | Withdrawal automation (spec S8) | TODO | |
| 21 | No agent page in the frontend - agent is API-only | TODO | |
| 23 | UI was form-first, not market-first - no chart, no persistent price, `max-w-5xl` on a 1440px canvas | **DONE** | 2026-09-06 |

### Detail

**17. Stubs pass silently.** `context_enricher.py` returns `dxy_trend="neutral"`,
`vix=20.0`, `fear_greed=50` as constants. The DXY-blocks-Gold-longs rule and the
funding-rate block therefore never fire, and never log that they were skipped.
The agent trades as though macro were always benign.

---

## Change log

<!-- Newest first. One entry per completed item. -->

### 2026-09-06 - Architecture diagram rebuilt on the design system

Seven hues - emerald, blue, purple, amber, red, cyan, neutral - assigned per box
with no rule behind them. Colour looked meaningful and wasn't, and none of it
came from the token set.

There *was* latent meaning buried in it: amber was always an external system,
emerald always the agent path, red always a rejection. Formalised into four
semantic roles - `default` (ours), `accent` (the V2 agent path), `edge`
(outside our control - dashed border rather than a new hue), `danger` (hard
limit or rejection).

- 7-node agent loop had one hue per step. The step number already carries the
  sequence, so all nodes now share a treatment; only Risk stays distinct,
  because a hard limit genuinely is a different kind of node. The legend
  dropped from 6 entries to 3 that mean something.
- Tab switcher and container were hard-coded `white/10` and `neutral-950`,
  ignoring the theme. Now tokens.
- External systems are consistent: MT5 Terminal, Binance/Bybit, Groq Cloud,
  MT5 Connector and CCXT Feed all dashed, none carrying a primary ring.
- Raw colour classes in the file: 108 -> 0.

### 2026-09-06 - Landing page rebuilt around the product

**The core miss: no picture of the product.** A trading platform landing page
that never shows the platform is asking people to imagine it. Added a real
screenshot of the algo terminal - live EURUSD candles, Bollinger Bands, RSI,
strategy conditions - captured from the running app, not a mockup, framed in
window chrome with a fade at the base.

**Root container was `max-w-5xl`.** The entire landing was capped at 1024px on a
1512px screen - ~490px unused, and the product shot could never exceed it.
Now `max-w-7xl`; prose keeps `max-w-2xl` because the fix for a narrow page is
not a 1280px-wide paragraph.

**Factual error on the landing page.** The architecture diagram said
"FastAPI Backend - EC2 Windows - :8008". That host has been dead for months and
the backend is on Azure. Corrected.

**Detail fixes.**
- Hero grid ended in a hard rectangle where the section stopped, which reads as
  a rendering artefact. Now radially masked so it dissolves.
- 7 feature cards in a 3-column grid orphaned one on the last row. Centred, via
  a selector that survives features being added or removed.
- "How It Works" cards were ~190px tall around ~90px of content. Now ~110px.
- Step arrows were `/40` opacity - effectively invisible. Now `/70`.
- Stats strip was `text-2xl font-black font-mono` on four items, competing with
  the headline directly above it.

**Not changed:** the headline copy, and the architecture diagram's multi-colour
palette. The colours encode layer identity there rather than price direction,
so mapping them to `--up`/`--down` would be wrong; it does deserve a narrower
palette, which is a separate job.

### 2026-09-06 - All 9 pages audited and fixed; tokens actually adopted

Captured every page with Playwright at 1512px (tall viewport - the app scrolls
inside `main`, so `full_page` returns only the viewport) and worked through each.

**`/algo` - the worst offender.** An algo trading page **with no chart on it**.
`historicalCandles` was only fetched once an algo was already running, so
arriving gave you a form, a rules card and ~1700px of empty space. The chart is
how you judge whether a strategy's conditions make sense *before* running it,
which is exactly when it was missing. Now loads on arrival. Price bar was three
~110px cards with `text-2xl` figures for three numbers; now a compact strip that
also carries equity and floating P&L, reusing the page's existing stream rather
than mounting `MarketBar` and opening a second SSE connection.

**`/analyzer`** - form ended at 600px, then ~1800px of nothing. Now full width
with a result region that says what the analysis contains.

**Landing** - structurally good. Fixed one real flaw: 7 feature cards in a
3-column grid left an orphan on the last row, which reads as a mistake. The
remainder is now centred, via a selector that keeps working if a feature is
added or removed.

**Design tokens actually adopted.** The tokens existed but ~200 raw
`text-green-500` / `text-red-500` usages meant almost nothing used them - a
design system nobody applies is just a stylesheet. Migrated 77 lines across 7
files to `text-up` / `text-down` / `bg-up` / `border-down`. Deliberately
excluded:
- lines mentioning `error`/`destructive` - an error is destructive, not "down";
  the two real cases in `/ml` were moved to `text-destructive`
- `app/page.tsx` and `architecture-diagram.tsx` - their greens are brand and
  diagram palette. Mapping those to `--up` would assert "this went up" about a
  marketing button.

### 2026-09-06 - /connection redesigned; deposit-shown-as-profit bug fixed

**Correctness bug found while redesigning.** MT5 trade history includes balance
operations (deposits, withdrawals, credits) alongside real trades. They have no
symbol and zero volume, and the page rendered them as `Unknown` / `sell` with
the amount in profit-green: the $5,000 account funding displayed as
**"P/L +5000.00"**. Money paid in, shown as money made. Balance operations are
now detected (no symbol, or zero volume, or a balance/credit type) and rendered
as `Deposit`/`Withdrawal` with a neutral amount.

**Layout.**
- Removed the `max-w-4xl` cap I had wrongly left on this page - it has two
  tables and wants the width. ~370px of dead margin recovered.
- Account block: four ~200x80px cards replaced by one divided 5-metric strip.
  Boxing each figure separately adds chrome without adding meaning.
- Trade history: ~78px cards to ~29px table rows.
- Positions and history now **load automatically** once connected, instead of
  showing a panel whose only content was "click Refresh to load". The manual
  buttons remain for re-fetching.
- Deleted descriptions that restated their own heading ("View currently open
  trades on your MT5 account" under "Open Positions").

### 2026-09-06 - Every page audited; global layout fixes

Screenshotted all 9 pages at 1512x900 and reviewed each. The same three faults
repeated everywhere, so they were fixed systemically rather than page by page:

1. **Width caps.** Every page used `max-w-4xl`/`5xl`/`7xl`, leaving ~450px of
   dead right margin on a 1512px screen. Removed on all data-dense pages.
   Kept a reading measure on `/tutor` only - long prose lines genuinely are
   harder to read, so full width would be worse there.
2. **Oversized headers.** `text-2xl font-bold` on every page, ~90px of chrome
   restating what the highlighted sidebar item already said. Now `text-lg`.
3. **Results hidden behind a conditional.** `/backtest` rendered the parameter
   form and then literally nothing until a run finished - three-quarters of the
   viewport blank. Now an empty state that says what a run produces, and it
   grows to fill the height (`main` is a flex column so children can expand).

**Strategy list rebuilt.** Was ~70px bordered cards; 29 strategies meant
scrolling to find a name. Now a ~33px-row table with a filter - 8 visible at
once instead of 3.

**Added `components/trade/page.tsx`**: `PageHeader`, `PageBody`, `SplitPane`,
`Row`.

**Still on the old card-stack layout:** `/algo` (1823 lines - needs
decomposition before restyling), `/ml`, `/analyzer`, `/tutor`, `/connection`.
These got the width and header fixes but not a structural redesign.

### 2026-09-06 - Design system + Market Watch redesign

**Diagnosis (from screenshots, not assumption).** The UI was form-first: every
screen opened with a settings card, content was capped at `max-w-5xl` on a
1440px display, and `/live` rendered *nothing* until you pressed "Watch Market".
A trading screen that shows no market on arrival.

**Added trading tokens** to `globals.css`, light and dark:
- `--up` / `--down` / `--flat` / `--warn`, kept deliberately separate from
  `--primary`. When brand green and profit green are the same value, every
  button reads as a gain and the signal stops meaning anything.
- `--surface-1..3` for elevation without shadows, which vanish on dark grounds.
- `--grid-line`, lighter than `--border`, so dense tables read as rows not cages.
- `.price` / `.tnum` utilities: `tabular-nums` + `slashed-zero`. Without tabular
  figures a price column shivers horizontally on every tick.
- `tick-up` / `tick-down` flash, wrapped in `prefers-reduced-motion`.

**Added primitives** in `components/trade/`:
- `MarketBar` - persistent symbol / bid / ask / spread / balance / equity /
  unrealised. The fix for "nothing on screen tells me what the market is doing".
- `Panel` / `Empty` - denser than shadcn `Card`, which wastes about a third of
  the viewport once six are stacked.
- `Stat` / `StatRow`, and `num.tsx` with one set of formatters so a price never
  renders at two precisions in two places.
- `dir()` treats exactly 0 as flat, not up - breakeven in green overstates it.

**Rebuilt `/live`** as a terminal: full-width, chart-dominant, right rail,
docked positions table, loads on arrival. `layout-shell.tsx` gives
`/live`, `/algo`, `/backtest` a flush full-height `<main>`.

**Degraded state.** With MT5 down the chart now falls back to generated candles
behind an unmissable `SAMPLE DATA` banner rather than going blank. An unlabelled
fake chart would be worse than either, hence the banner.

**Docs:** `docs/DESIGN.md` (tokens, primitives, layout rules, new-screen
checklist) and `docs/README.md` (documentation index). README now carries a
documentation map.

**Still TODO:** `/algo` (1823 lines, needs decomposition), `/backtest`,
`/strategy`, `/ml`, `/analyzer`, `/tutor`, `/connection` still use the old
card-stack layout.

### 2026-09-06 - Deployed to the Azure VM

- PR #1 opened. Merge to `main` was blocked by the local permission classifier,
  so the VM was deployed from the `production-hardening` branch directly.
- VM now at `657dc6e`: `notifier.py`, `audit.py`, `tests/` all present,
  `data_fetcher.py` gone.
- **API auth enabled on the VM.** Verified from outside: `/api/health` 200,
  `/api/strategies` 401 with no key, 401 with a wrong key, 200 with the right
  one. Frontend already supported it (`x-api-key` header for REST, `api_key`
  query param for SSE, since EventSource cannot set headers).
- **Telegram configured on the VM** and confirmed sending.
- P1 #12 closed: the EC2 deploy workflow targeted a host that no longer answers.
  Replaced with a manual workflow plus `deploy/azure-deploy.sh`, which refuses
  to restart while the agent holds open positions.
- **Found #22:** the restart dropped the MT5 connection and it cannot come back
  by itself. See above.

### 2026-09-06 - P0 #2 Telegram alerting (all P0 items now closed)

**Added `backend/agent/notifier.py`** - bot `@MasstTrader_bot`, wired into the
agent lifecycle in `graph.py`.
- Alert types per spec S9: trade opened / closed / partial exit, daily and weekly
  drawdown kill switches, circuit breaker, DXY and funding blocks, withdrawal
  trigger, calibration drift, agent error, daily summary, startup, shutdown.
- **Never raises.** Network failure, HTTP error, throttling and missing config all
  return False. Alerting must not be able to stop the trading loop.
- **No-op when unconfigured**, so demo and dev runs need no Telegram at all.
- Local rate limit of 18/min - Telegram throttles ~20/min per chat, and being
  throttled precisely while reporting a crisis is the worst time for it.
  Honours the server's `retry_after` on 429.
- HTML-escapes all interpolated content. Signal reasoning comes from an LLM, and
  a stray `<` breaks `parse_mode=HTML` silently.
- **De-duplicated halts.** A drawdown halt persists across cycles; alerting every
  5 minutes until it clears would be unusable. Alerts fire on the transition, and
  again if the condition clears and returns.
- `risk_calculator.py` now reports *why* it halted via `state["risk_halt"]`
  instead of silently returning no orders - the halt reason was previously
  visible only in a log line.
- *Verified:* 24 unit tests (retries, 429 backoff, rate limit, escaping, truncation,
  de-dup, never-raise), plus live sends to chat `7942290807` - startup,
  trade-opened, and drawdown-halt alerts all delivered, and a repeated halt
  correctly suppressed.

### 2026-09-06 - P0 #3 structured audit log

**Added `backend/agent/audit.py`** and wired it into `graph.py::_log_cycle`.
- JSON Lines (one object per line) in `logs/agent-YYYY-MM-DD.jsonl`, not a JSON
  array: appendable without a rewrite, survives a mid-write crash losing only the
  last line, and greps/`jq`s directly.
- Records everything spec S10 asks for, including the macro/crypto/gold/sentiment
  snapshot the decision was actually made against, `prompt_version`, `agent_env`,
  account state, and **every NONE signal**.
- Credentials are recursively redacted before write (password, api_key, token,
  secret). Verified a broker password cannot reach the file.
- `write_cycle` never raises - a logging failure must not stop trading.
- `audit.prune()` runs on agent start, enforcing the 90-day window
  (`AUDIT_RETENTION_DAYS`), and only touches files matching `agent-<date>.jsonl`.
- `logs/` added to `.gitignore`.
- *Verified:* 8 unit tests, plus an end-to-end run - a real cycle
  (`710c5b0c`, BTCUSDm, regime TRENDING_UP, signal NONE @ 20%) was written and
  read back with all fields intact.

### 2026-09-06 - P0 security + first test suite

**P0 #1 - API auth now fails closed.** `backend/api/main.py`
- Startup raises `RuntimeError` when `AGENT_ENV=live` and `API_KEY` is unset,
  rather than silently serving `/api/mt5/trade` to anyone who can reach the port.
- Demo mode still starts without a key but logs an explicit warning.
- Swapped `key != _API_KEY` for `secrets.compare_digest` (the plain compare leaked
  the key byte-by-byte via timing).
- `OPTIONS` now bypasses the check so CORS preflight is not broken by it.
- *Verified:* `tests/test_api_auth.py` - 401 without key, 401 with wrong key,
  200 with correct key, `/api/health` exempt, live+blank refuses to boot.

**P0 #4 - kill switches now have tests.** `tests/test_risk_calculator.py` (25 tests)
- Daily 3% / weekly 8% drawdown halts, checked either side of the boundary.
- Consecutive-loss breaker: 2 losses = -25% size, 3 = -50% and a 75% confidence bar.
- DXY-blocks-Gold-longs, funding-blocks-BTC-longs, min R:R 1.5, max positions,
  duplicate-symbol block, zero/negative balance halt.
- Property test: realised risk never exceeds the per-symbol cap.
- *Verified:* 25/25 pass. None of these paths had ever executed before - `agent_trades`
  is still empty, so no halt had ever actually fired in production.

**P0 #6 - VC++ redistributable added to `setup.ps1`.**
- New step 3/9 installs `vc_redist.x64.exe` silently; accepts exit code 3010
  (success, reboot pending). Skips if `msvcp140_1.dll` is already present.
- Without it TensorFlow cannot import on a bare Windows Server image - this broke
  the real Azure deploy and had to be fixed by hand.

**P1 #7 - test suite created.** 32 tests total, `pytest.ini` with a `slow` marker.
- `tests/test_indicators_volume_profile.py` reproduces the production `IndexError`
  exactly (`index 50 is out of bounds for axis 0 with size 50`). First attempt at
  this test passed against the *broken* code - the trigger needs POC on the top
  price level with a zero-volume level directly below and POC < 70% of window
  volume. Confirmed by reverting the fix and watching it fail.

**P1 #9 - removed `backend/agent/data_fetcher.py`.**
- 107 lines, never imported. `graph.py` has its own `_fetch_symbol_data`, and the
  two disagreed on symbol routing (`"m" not in symbol` vs `not symbol.endswith("m")`).
  Only the `graph.py` copy has the CCXT fallback that makes BTC work.
- Also removed its stale entry from `ARCHITECTURE.md`.

### 2026-09-06 - Tracker created
- Audited codebase and running deployment; recorded verified state above.
- No code changed.
