"""
Session awareness + economic calendar blackout system.
Knows current trading session, enforces news blackouts, and session-based filters.
"""
from datetime import datetime, timezone, timedelta
from backend.agent.config import AgentConfig


def get_current_session(utc_now: datetime = None) -> str:
    """Determine which trading session(s) are active right now."""
    if utc_now is None:
        utc_now = datetime.now(timezone.utc)
    hour = utc_now.hour

    # Check each session — sessions can overlap (London + NY)
    # Return the most relevant one for trading decisions
    for session_name, (start, end) in AgentConfig.SESSIONS.items():
        if start < end:
            if start <= hour < end:
                return session_name
        else:  # wraps midnight (e.g. Sydney 21-6)
            if hour >= start or hour < end:
                return session_name

    return "CLOSED"


def is_gold_trade_window(utc_now: datetime = None) -> bool:
    """Check if we're in a Gold-favorable trading window."""
    if utc_now is None:
        utc_now = datetime.now(timezone.utc)
    hour = utc_now.hour
    for start, end in AgentConfig.GOLD_TRADE_WINDOWS:
        if start <= hour < end:
            return True
    return False


def is_btc_weekend(utc_now: datetime = None) -> bool:
    """Check if we're in the low-liquidity BTC weekend window.
    Sat 20:00 UTC to Sun 20:00 UTC.
    """
    if utc_now is None:
        utc_now = datetime.now(timezone.utc)
    wd = utc_now.weekday()  # Mon=0, Sun=6
    hour = utc_now.hour
    if wd == 5 and hour >= 20:  # Saturday 20:00+
        return True
    if wd == 6 and hour < 20:   # Sunday before 20:00
        return True
    return False


# ── Economic Calendar & News Blackout ────────────────────────────

# In-memory cache of upcoming high-impact events
# In production, this gets populated from Forex Factory / Investing.com API
_calendar_cache: list[dict] = []
_calendar_last_fetch: datetime | None = None


def set_calendar_events(events: list[dict]):
    """Update the calendar cache. Called by the Context Enricher node.
    Each event: {name: str, time: datetime, currency: str, impact: str}
    """
    global _calendar_cache, _calendar_last_fetch
    _calendar_cache = events
    _calendar_last_fetch = datetime.now(timezone.utc)


def get_calendar_events() -> list[dict]:
    """Return cached calendar events."""
    return _calendar_cache


def is_news_blackout(symbol: str, utc_now: datetime = None) -> tuple[bool, list[dict]]:
    """Check if we're in a news blackout window for this symbol.

    Returns (is_blackout, list_of_blocking_events).
    """
    if utc_now is None:
        utc_now = datetime.now(timezone.utc)

    blackout_minutes = AgentConfig.NEWS_BLACKOUT_MINUTES
    blocking = []

    for event in _calendar_cache:
        event_time = event.get("time")
        if not isinstance(event_time, datetime):
            continue

        # Check if event is high-impact
        event_name = event.get("name", "")
        is_high_impact = any(
            kw.lower() in event_name.lower()
            for kw in AgentConfig.HIGH_IMPACT_EVENTS
        )
        if not is_high_impact and event.get("impact", "").lower() != "high":
            continue

        # Check if within blackout window
        window_start = event_time - timedelta(minutes=blackout_minutes)
        window_end = event_time + timedelta(minutes=blackout_minutes)
        if window_start <= utc_now <= window_end:
            blocking.append({
                "event": event_name,
                "time": event_time.isoformat(),
                "currency": event.get("currency", ""),
            })

    return len(blocking) > 0, blocking


def should_skip_symbol(symbol: str, utc_now: datetime = None) -> tuple[bool, str]:
    """Master check: should this symbol be skipped this cycle?

    Returns (should_skip, reason).
    """
    if utc_now is None:
        utc_now = datetime.now(timezone.utc)

    sym = symbol.upper()

    # Gold: skip outside trade windows
    if "XAU" in sym or "GOLD" in sym:
        if not is_gold_trade_window(utc_now):
            session = get_current_session(utc_now)
            return True, f"Gold skipped: outside trade window (session={session})"

    # News blackout
    is_blackout, events = is_news_blackout(symbol, utc_now)
    if is_blackout:
        event_names = ", ".join(e["event"] for e in events)
        return True, f"News blackout: {event_names}"

    return False, ""
