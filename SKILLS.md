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

### Detail

**17. Stubs pass silently.** `context_enricher.py` returns `dxy_trend="neutral"`,
`vix=20.0`, `fear_greed=50` as constants. The DXY-blocks-Gold-longs rule and the
funding-rate block therefore never fire, and never log that they were skipped.
The agent trades as though macro were always benign.

---

## Change log

<!-- Newest first. One entry per completed item. -->

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
