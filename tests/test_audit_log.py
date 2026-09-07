"""Tests for the structured audit log (FeatureRequirements.md S10)."""
import json
from datetime import datetime, timedelta, timezone

import pytest

from backend.agent import audit


@pytest.fixture(autouse=True)
def _tmp_log_dir(tmp_path, monkeypatch):
    """Point the audit module at a temp dir so tests never touch real logs/."""
    monkeypatch.setattr(audit, "_LOG_DIR", tmp_path)
    return tmp_path


def test_write_cycle_creates_daily_jsonl(_tmp_log_dir):
    path = audit.write_cycle({"id": "abc123", "session": "LONDON"})
    assert path is not None and path.exists()
    assert path.name.startswith("agent-") and path.suffix == ".jsonl"

    lines = path.read_text().strip().split("\n")
    assert len(lines) == 1
    rec = json.loads(lines[0])
    assert rec["id"] == "abc123"
    assert rec["session"] == "LONDON"
    assert "logged_at" in rec


def test_appends_rather_than_overwrites(_tmp_log_dir):
    audit.write_cycle({"id": "one"})
    audit.write_cycle({"id": "two"})
    path = next(_tmp_log_dir.glob("agent-*.jsonl"))
    ids = [json.loads(l)["id"] for l in path.read_text().strip().split("\n")]
    assert ids == ["one", "two"]


def test_none_signals_are_recorded(_tmp_log_dir):
    """Spec: every NONE signal is logged - it's what prompt tuning reads."""
    audit.write_cycle({"id": "c", "signals": {
        "XAUUSDm": {"direction": "NONE", "confidence": 42, "reasoning": "no setup"}
    }})
    rec = audit.read_day(datetime.now(timezone.utc).strftime("%Y-%m-%d"))[0]
    assert rec["signals"]["XAUUSDm"]["direction"] == "NONE"
    assert rec["signals"]["XAUUSDm"]["confidence"] == 42


def test_credentials_are_redacted(_tmp_log_dir):
    audit.write_cycle({
        "id": "c",
        "account": {"login": 123, "password": "hunter2"},
        "nested": {"config": {"groq_api_key": "gsk_realkeyvalue"}},
    })
    raw = next(_tmp_log_dir.glob("agent-*.jsonl")).read_text()
    assert "hunter2" not in raw
    assert "gsk_realkeyvalue" not in raw
    assert "***REDACTED***" in raw
    # non-secret fields survive
    assert '"login": 123' in raw


def test_write_never_raises_on_unserialisable_values(_tmp_log_dir):
    """A bad value must not take the trading loop down with it."""
    class Weird:
        pass
    path = audit.write_cycle({"id": "c", "obj": Weird(), "when": datetime.now()})
    assert path is not None, "audit failure must be swallowed, not raised"


def test_prune_removes_only_files_past_retention(_tmp_log_dir):
    now = datetime.now(timezone.utc)
    old_name = f"agent-{(now - timedelta(days=120)).strftime('%Y-%m-%d')}.jsonl"
    recent_name = f"agent-{(now - timedelta(days=5)).strftime('%Y-%m-%d')}.jsonl"
    unrelated = "notes.txt"
    for n in (old_name, recent_name, unrelated):
        (_tmp_log_dir / n).write_text("{}\n")

    removed = audit.prune(retention_days=90)

    assert old_name in removed
    assert recent_name not in removed
    assert not (_tmp_log_dir / old_name).exists()
    assert (_tmp_log_dir / recent_name).exists()
    assert (_tmp_log_dir / unrelated).exists(), "must not touch unrelated files"


def test_read_day_skips_corrupt_lines(_tmp_log_dir):
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    (_tmp_log_dir / f"agent-{day}.jsonl").write_text(
        '{"id": "good1"}\nnot json at all\n{"id": "good2"}\n'
    )
    recs = audit.read_day(day)
    assert [r["id"] for r in recs] == ["good1", "good2"]


def test_read_day_returns_empty_for_missing_file(_tmp_log_dir):
    assert audit.read_day("1999-01-01") == []
