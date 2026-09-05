"""Telegram alerting for the autonomous agent (FeatureRequirements.md S9).

The agent is designed to run 24/7 unattended on a VPS. Without alerting, a crash,
a tripped kill switch, or a losing streak is completely silent - you find out days
later by checking a dashboard. This module is what makes unattended operation
defensible.

Design rules:
  * Never raise. An alerting failure must never stop or crash the trading loop.
  * No-op cleanly when unconfigured, so demo/dev runs need no Telegram at all.
  * Rate-limit locally. Telegram allows ~20 messages/minute to one chat; blowing
    past that gets the bot throttled exactly when it is trying to report a crisis.
  * Never send credentials.
"""
from __future__ import annotations

import html
import logging
import threading
import time
from collections import deque
from datetime import datetime, timezone

import requests

from config.settings import settings

logger = logging.getLogger("agent.notifier")

_API = "https://api.telegram.org/bot{token}/{method}"
_TIMEOUT = 15
_RETRIES = 3

# Telegram throttles ~20 msg/min per chat. Stay under it.
_RATE_LIMIT = 18
_RATE_WINDOW = 60.0

_sent_times: deque[float] = deque()
_lock = threading.Lock()


def is_configured() -> bool:
    return bool(settings.TELEGRAM_BOT_TOKEN and settings.TELEGRAM_CHAT_ID)


def _rate_limited() -> bool:
    """True if sending now would exceed the local rate budget."""
    with _lock:
        now = time.monotonic()
        while _sent_times and now - _sent_times[0] > _RATE_WINDOW:
            _sent_times.popleft()
        if len(_sent_times) >= _RATE_LIMIT:
            return True
        _sent_times.append(now)
        return False


def send(text: str, *, silent: bool = False) -> bool:
    """Send a message. Returns True on success. Never raises."""
    if not is_configured():
        logger.debug("NOTIFY: Telegram not configured, skipping")
        return False

    if _rate_limited():
        logger.warning("NOTIFY: local rate limit hit, dropping message")
        return False

    url = _API.format(token=settings.TELEGRAM_BOT_TOKEN, method="sendMessage")
    payload = {
        "chat_id": settings.TELEGRAM_CHAT_ID,
        "text": text[:4096],          # Telegram hard limit
        "parse_mode": "HTML",
        "disable_notification": silent,
        "disable_web_page_preview": True,
    }

    for attempt in range(_RETRIES):
        try:
            r = requests.post(url, json=payload, timeout=_TIMEOUT)
            if r.status_code == 200:
                return True
            # 429 = throttled; obey the server's retry_after
            if r.status_code == 429:
                wait = r.json().get("parameters", {}).get("retry_after", 5)
                logger.warning(f"NOTIFY: throttled by Telegram, waiting {wait}s")
                time.sleep(min(wait, 30))
                continue
            logger.error(f"NOTIFY: HTTP {r.status_code} - {r.text[:200]}")
        except Exception as e:  # noqa: BLE001 - alerting is best-effort by design
            logger.error(f"NOTIFY: attempt {attempt + 1}/{_RETRIES} failed: {e}")
        time.sleep(2 ** attempt)
    return False


def _esc(v) -> str:
    return html.escape(str(v))


def _money(v) -> str:
    try:
        return f"{float(v):,.2f}"
    except (TypeError, ValueError):
        return str(v)


def _pnl(v) -> str:
    """Signed P&L with a direction marker."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return str(v)
    return f"{'+' if f >= 0 else ''}{f:,.2f}"


# ── Alert types (FeatureRequirements.md S9) ──────────────────────────────

def trade_opened(order: dict, execution: dict, confidence: float = 0,
                 reasoning: str = "") -> bool:
    sym = _esc(order.get("symbol"))
    side = _esc(order.get("direction"))
    lines = [
        f"<b>TRADE OPENED</b>  {sym} {side}",
        f"entry {_esc(execution.get('fill_price', order.get('entry_price')))}"
        f"  SL {_esc(order.get('stop_loss'))}  TP {_esc(order.get('take_profit'))}",
        f"lots {_esc(order.get('volume'))}  risk {_esc(order.get('risk_percent'))}%"
        f"  R:R {_esc(order.get('rr_ratio'))}",
        f"confidence {confidence:.0f}%",
    ]
    if execution.get("slippage"):
        lines.append(f"slippage {_esc(execution['slippage'])}")
    if reasoning:
        lines.append(f"\n<i>{_esc(reasoning[:400])}</i>")
    return send("\n".join(lines))


def trade_closed(symbol: str, pnl: float, reason: str, balance: float) -> bool:
    return send(
        f"<b>TRADE CLOSED</b>  {_esc(symbol)}\n"
        f"P&amp;L {_pnl(pnl)}  ({_esc(reason)})\n"
        f"balance {_money(balance)}"
    )


def partial_exit(symbol: str, price, pnl_locked: float) -> bool:
    return send(
        f"<b>PARTIAL EXIT</b>  {_esc(symbol)}\n"
        f"50% closed at {_esc(price)}, P&amp;L locked {_pnl(pnl_locked)}\n"
        f"stop moved to breakeven"
    )


def daily_drawdown_halt(balance: float, dd_pct: float, resume_at: str = "") -> bool:
    return send(
        f"<b>DAILY DRAWDOWN KILL SWITCH</b>\n"
        f"drawdown {dd_pct:.2f}%  balance {_money(balance)}\n"
        f"trading halted{f' until {_esc(resume_at)}' if resume_at else ' for 24h'}"
    )


def weekly_drawdown_halt(balance: float, dd_pct: float) -> bool:
    return send(
        f"<b>WEEKLY DRAWDOWN KILL SWITCH</b>\n"
        f"drawdown {dd_pct:.2f}%  balance {_money(balance)}\n"
        f"trading halted until Monday"
    )


def circuit_breaker(consecutive_losses: int, size_reduction_pct: float,
                    min_confidence: float) -> bool:
    return send(
        f"<b>CIRCUIT BREAKER</b>\n"
        f"{consecutive_losses} consecutive losses\n"
        f"position size -{size_reduction_pct:.0f}%, "
        f"min confidence now {min_confidence:.0f}%"
    )


def blocked(symbol: str, rule: str, detail: str = "") -> bool:
    """A hard risk rule prevented a trade (DXY, funding rate, news, session)."""
    return send(
        f"<b>BLOCKED</b>  {_esc(symbol)}\n{_esc(rule)}"
        + (f"\n{_esc(detail)}" if detail else ""),
        silent=True,   # informational - shouldn't buzz a phone at 3am
    )


def withdrawal_trigger(amount: float, new_baseline: float, next_trigger: float) -> bool:
    return send(
        f"<b>WITHDRAWAL TRIGGER</b>\n"
        f"withdraw {_money(amount)}\n"
        f"new baseline {_money(new_baseline)}\n"
        f"next trigger {_money(next_trigger)}"
    )


def calibration_drift(stated: float, actual: float, sample: int) -> bool:
    return send(
        f"<b>CALIBRATION DRIFT</b>\n"
        f"signals stated {stated:.0f}% confidence but won {actual:.0f}% "
        f"over {sample} trades"
    )


def agent_error(node: str, error: str, action: str = "") -> bool:
    return send(
        f"<b>AGENT ERROR</b>  {_esc(node)}\n"
        f"<code>{_esc(str(error)[:500])}</code>"
        + (f"\naction: {_esc(action)}" if action else "")
    )


def daily_summary(stats: dict) -> bool:
    return send(
        f"<b>DAILY SUMMARY</b>  "
        f"{_esc(datetime.now(timezone.utc).strftime('%Y-%m-%d'))}\n"
        f"trades {_esc(stats.get('trades', 0))}  "
        f"win rate {_esc(stats.get('win_rate', 0))}%\n"
        f"P&amp;L {_pnl(stats.get('pnl', 0))}  "
        f"balance {_money(stats.get('balance', 0))}\n"
        f"best {_pnl(stats.get('best', 0))}  worst {_pnl(stats.get('worst', 0))}"
    )


def startup(env: str, watchlist: list, tf_mode: str) -> bool:
    return send(
        f"<b>AGENT STARTED</b>\n"
        f"env <b>{_esc(env)}</b>  mode {_esc(tf_mode)}\n"
        f"watching {_esc(', '.join(watchlist))}"
    )


def shutdown(reason: str = "") -> bool:
    return send(f"<b>AGENT STOPPED</b>" + (f"\n{_esc(reason)}" if reason else ""))
