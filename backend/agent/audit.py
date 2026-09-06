"""Structured audit log for the autonomous agent.

FeatureRequirements.md S10 requires a full structured JSON record per cycle,
written to daily files under logs/ and retained 90 days, including every NONE
signal - that is the record prompt tuning is done from.

Format is JSON Lines (one object per line), not a JSON array: it can be appended
to without rewriting the file, it survives a mid-write crash with only the last
line lost, and it streams with standard tools:

    cat logs/agent-2026-09-06.jsonl | jq 'select(.signals[].direction != "NONE")'

SQLite (agent_cycles) remains the queryable store. This is the durable forensic
record that survives the database being wiped or rebuilt.
"""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

logger = logging.getLogger("agent.audit")

# logs/ lives beside the repo root (backend/agent/audit.py -> ../../logs)
_LOG_DIR = Path(__file__).resolve().parent.parent.parent / "logs"
_RETENTION_DAYS = int(os.getenv("AUDIT_RETENTION_DAYS", "90"))
_FILENAME_RE = re.compile(r"^agent-(\d{4}-\d{2}-\d{2})\.jsonl$")

# Keys whose values must never reach disk.
_REDACT_KEYS = {"password", "mt5_password", "api_key", "groq_api_key", "token", "secret"}


def _redact(obj):
    """Recursively blank anything that looks like a credential.

    The audit log is a plaintext file that gets copied around and pasted into
    issues; a broker password must never end up in it.
    """
    if isinstance(obj, dict):
        return {
            k: ("***REDACTED***" if k.lower() in _REDACT_KEYS else _redact(v))
            for k, v in obj.items()
        }
    if isinstance(obj, (list, tuple)):
        return [_redact(v) for v in obj]
    return obj


def _log_path(when: datetime) -> Path:
    return _LOG_DIR / f"agent-{when.strftime('%Y-%m-%d')}.jsonl"


def write_cycle(cycle: dict) -> Path | None:
    """Append one cycle record. Never raises - auditing must not halt trading.

    Returns the path written, or None if the write failed.
    """
    try:
        _LOG_DIR.mkdir(parents=True, exist_ok=True)
        now = datetime.now(timezone.utc)
        record = _redact({"logged_at": now.isoformat(), **cycle})
        path = _log_path(now)
        # default=str so datetimes/Decimals/numpy scalars can't blow up the write
        line = json.dumps(record, default=str, ensure_ascii=False)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
        return path
    except Exception as e:  # noqa: BLE001 - deliberate: auditing is best-effort
        logger.error(f"AUDIT: failed to write cycle record: {e}")
        return None


def prune(retention_days: int | None = None) -> list[str]:
    """Delete audit files older than the retention window.

    Returns the names removed. Never raises.
    """
    days = _RETENTION_DAYS if retention_days is None else retention_days
    removed: list[str] = []
    try:
        if not _LOG_DIR.exists():
            return removed
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).date()
        for entry in _LOG_DIR.iterdir():
            m = _FILENAME_RE.match(entry.name)
            if not m:
                continue
            try:
                file_date = datetime.strptime(m.group(1), "%Y-%m-%d").date()
            except ValueError:
                continue
            if file_date < cutoff:
                entry.unlink()
                removed.append(entry.name)
        if removed:
            logger.info(f"AUDIT: pruned {len(removed)} file(s) older than {days} days")
    except Exception as e:  # noqa: BLE001
        logger.error(f"AUDIT: prune failed: {e}")
    return removed


def read_day(day: str) -> list[dict]:
    """Read one day's records (YYYY-MM-DD). Skips corrupt lines rather than failing."""
    path = _LOG_DIR / f"agent-{day}.jsonl"
    out: list[dict] = []
    if not path.exists():
        return out
    with path.open("r", encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                logger.warning(f"AUDIT: skipping malformed line {lineno} in {path.name}")
    return out
