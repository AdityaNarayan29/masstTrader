"""Tests for Telegram alerting.

The governing constraint: alerting must never be able to stop trading. Every
failure mode here (network down, HTTP error, throttling, unconfigured) must be
swallowed and reported as False, never raised.
"""
import pytest

from backend.agent import notifier


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    notifier._sent_times.clear()
    yield
    notifier._sent_times.clear()


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setattr(notifier.settings, "TELEGRAM_BOT_TOKEN", "123:ABC")
    monkeypatch.setattr(notifier.settings, "TELEGRAM_CHAT_ID", "999")


class _Resp:
    def __init__(self, status=200, payload=None, text=""):
        self.status_code = status
        self._payload = payload or {}
        self.text = text

    def json(self):
        return self._payload


def test_unconfigured_is_a_silent_noop(monkeypatch):
    monkeypatch.setattr(notifier.settings, "TELEGRAM_BOT_TOKEN", "")
    monkeypatch.setattr(notifier.settings, "TELEGRAM_CHAT_ID", "")
    assert notifier.is_configured() is False
    assert notifier.send("hello") is False       # must not raise


def test_successful_send(configured, monkeypatch):
    calls = []
    monkeypatch.setattr(notifier.requests, "post",
                        lambda url, **kw: calls.append((url, kw)) or _Resp(200))
    assert notifier.send("hi") is True
    url, kw = calls[0]
    assert "sendMessage" in url
    assert kw["json"]["chat_id"] == "999"
    assert kw["json"]["text"] == "hi"


def test_network_exception_is_swallowed(configured, monkeypatch):
    def boom(*a, **k):
        raise ConnectionError("network is down")
    monkeypatch.setattr(notifier.requests, "post", boom)
    monkeypatch.setattr(notifier.time, "sleep", lambda s: None)
    assert notifier.send("hi") is False          # returns, does not raise


def test_http_error_is_swallowed(configured, monkeypatch):
    monkeypatch.setattr(notifier.requests, "post",
                        lambda *a, **k: _Resp(500, text="server error"))
    monkeypatch.setattr(notifier.time, "sleep", lambda s: None)
    assert notifier.send("hi") is False


def test_retries_then_succeeds(configured, monkeypatch):
    attempts = {"n": 0}
    def flaky(*a, **k):
        attempts["n"] += 1
        return _Resp(200) if attempts["n"] >= 2 else _Resp(500)
    monkeypatch.setattr(notifier.requests, "post", flaky)
    monkeypatch.setattr(notifier.time, "sleep", lambda s: None)
    assert notifier.send("hi") is True
    assert attempts["n"] == 2


def test_429_respects_retry_after(configured, monkeypatch):
    waits, attempts = [], {"n": 0}
    def throttled(*a, **k):
        attempts["n"] += 1
        if attempts["n"] == 1:
            return _Resp(429, payload={"parameters": {"retry_after": 3}})
        return _Resp(200)
    monkeypatch.setattr(notifier.requests, "post", throttled)
    monkeypatch.setattr(notifier.time, "sleep", lambda s: waits.append(s))
    assert notifier.send("hi") is True
    assert 3 in waits, f"should honour retry_after, waited {waits}"


def test_local_rate_limit_drops_excess(configured, monkeypatch):
    monkeypatch.setattr(notifier.requests, "post", lambda *a, **k: _Resp(200))
    sent = sum(notifier.send(f"m{i}") for i in range(notifier._RATE_LIMIT + 5))
    assert sent == notifier._RATE_LIMIT, "must cap at the local rate budget"


def test_long_text_is_truncated_to_telegram_limit(configured, monkeypatch):
    captured = {}
    monkeypatch.setattr(notifier.requests, "post",
                        lambda url, **kw: captured.update(kw) or _Resp(200))
    notifier.send("x" * 9000)
    assert len(captured["json"]["text"]) == 4096


def test_html_in_user_content_is_escaped(configured, monkeypatch):
    """Reasoning text comes from an LLM; unescaped '<' breaks HTML parse_mode."""
    captured = {}
    monkeypatch.setattr(notifier.requests, "post",
                        lambda url, **kw: captured.update(kw) or _Resp(200))
    notifier.trade_opened(
        {"symbol": "XAU<script>", "direction": "BUY", "volume": 0.1,
         "stop_loss": 1990, "take_profit": 2020, "risk_percent": 0.75, "rr_ratio": 2.0},
        {"fill_price": 2000},
        confidence=80,
        reasoning="RSI < 30 & MACD > signal",
    )
    text = captured["json"]["text"]
    assert "<script>" not in text
    assert "&lt;script&gt;" in text
    assert "&lt; 30" in text and "&amp;" in text


@pytest.mark.parametrize("fn,args", [
    (notifier.trade_closed, ("XAUUSDm", -50.0, "stop_loss", 9950.0)),
    (notifier.partial_exit, ("XAUUSDm", 2010, 25.0)),
    (notifier.daily_drawdown_halt, (9700.0, 3.0)),
    (notifier.weekly_drawdown_halt, (9200.0, 8.0)),
    (notifier.circuit_breaker, (3, 50.0, 75.0)),
    (notifier.blocked, ("XAUUSDm", "DXY bullish")),
    (notifier.withdrawal_trigger, (1000.0, 1500.0, 3750.0)),
    (notifier.calibration_drift, (70.0, 48.0, 25)),
    (notifier.agent_error, ("signal_generator", "boom")),
    (notifier.daily_summary, ({"trades": 3, "win_rate": 66.7, "pnl": 120.0,
                               "balance": 10120.0, "best": 90.0, "worst": -30.0},)),
    (notifier.startup, ("demo", ["XAUUSDm"], "intraday")),
    (notifier.shutdown, ()),
])
def test_every_alert_type_sends_without_error(configured, monkeypatch, fn, args):
    captured = {}
    monkeypatch.setattr(notifier.requests, "post",
                        lambda url, **kw: captured.update(kw) or _Resp(200))
    assert fn(*args) is True
    assert captured["json"]["text"], "alert produced empty text"


def test_blocked_alerts_are_silent(configured, monkeypatch):
    """Informational blocks shouldn't buzz a phone at 3am."""
    captured = {}
    monkeypatch.setattr(notifier.requests, "post",
                        lambda url, **kw: captured.update(kw) or _Resp(200))
    notifier.blocked("XAUUSDm", "DXY bullish")
    assert captured["json"]["disable_notification"] is True


# ── Alert de-duplication in the agent loop ──────────────────────────────

def test_persistent_halt_alerts_once_not_every_cycle(configured, monkeypatch):
    """A drawdown halt persists across cycles. Alerting every 5 minutes until it
    clears would be unusable, so the agent alerts on the transition only."""
    from backend.agent.graph import TradingAgent

    sent = []
    monkeypatch.setattr(notifier, "daily_drawdown_halt",
                        lambda *a, **k: sent.append(("daily", a)) or True)
    monkeypatch.setattr(notifier, "trade_opened", lambda *a, **k: True)
    monkeypatch.setattr(notifier, "trade_closed", lambda *a, **k: True)
    monkeypatch.setattr(notifier, "blocked", lambda *a, **k: True)
    monkeypatch.setattr(notifier, "circuit_breaker", lambda *a, **k: True)
    monkeypatch.setattr(notifier, "agent_error", lambda *a, **k: True)

    agent = TradingAgent()
    halted = {"risk_halt": {"kind": "daily_drawdown", "balance": 9700.0, "dd_pct": 3.2}}

    for _ in range(4):
        agent._send_cycle_alerts(halted, {}, {}, {})
    assert len(sent) == 1, f"expected 1 alert across 4 halted cycles, got {len(sent)}"

    # Clearing then re-halting must alert again - it's a new event.
    agent._send_cycle_alerts({"risk_halt": None}, {}, {}, {})
    agent._send_cycle_alerts(halted, {}, {}, {})
    assert len(sent) == 2


def test_cycle_alerts_never_raise(configured, monkeypatch):
    """Alerting must not be able to take the trading loop down."""
    from backend.agent.graph import TradingAgent

    def boom(*a, **k):
        raise RuntimeError("telegram exploded")
    for name in ("daily_drawdown_halt", "trade_opened", "trade_closed",
                 "blocked", "circuit_breaker", "agent_error"):
        monkeypatch.setattr(notifier, name, boom)

    agent = TradingAgent()
    agent._send_cycle_alerts(
        {"risk_halt": {"kind": "daily_drawdown", "balance": 1.0, "dd_pct": 5.0},
         "consecutive_losses": 3, "errors": ["bad"]},
        {}, {}, {"XAUUSDm": {"success": True}},
    )  # must not raise
