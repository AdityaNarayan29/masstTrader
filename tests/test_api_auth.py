"""Tests for API authentication.

The original middleware was `if _API_KEY and path != "/api/health"` - a blank
API_KEY silently disabled auth for every route, including POST /api/mt5/trade
and POST /api/agent/start. That is fail-open: the least safe default, applied
exactly when the operator forgot to configure security.

These are subprocess tests because the behaviour under test happens at import
time, and importing backend.api.main pulls in TensorFlow (slow, and it caches).
"""
import os
import subprocess
import sys
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
PY = str(ROOT / ".venv" / "bin" / "python")

IMPORT_APP = "import backend.api.main as m; print('IMPORT_OK')"


def _run(code, env_over, timeout=300):
    env = dict(os.environ)
    # Never let a developer's real .env leak into these assertions.
    env.update({"MT5_LOGIN": "", "MT5_PASSWORD": "", "MT5_SERVER": "",
                "GROQ_API_KEY": "", "TF_CPP_MIN_LOG_LEVEL": "3"})
    env.update(env_over)
    return subprocess.run([PY, "-c", code], cwd=str(ROOT), env=env,
                          capture_output=True, text=True, timeout=timeout)


@pytest.mark.slow
def test_live_mode_without_api_key_refuses_to_start():
    """The security-critical case: live trading must never run unauthenticated."""
    r = _run(IMPORT_APP, {"AGENT_ENV": "live", "API_KEY": ""})
    assert r.returncode != 0, "live + blank API_KEY must refuse to start"
    combined = r.stdout + r.stderr
    assert "API_KEY must be set" in combined, combined[-800:]


@pytest.mark.slow
def test_live_mode_with_api_key_starts():
    r = _run(IMPORT_APP, {"AGENT_ENV": "live", "API_KEY": "test-key-123"})
    assert r.returncode == 0, (r.stdout + r.stderr)[-800:]
    assert "IMPORT_OK" in r.stdout


@pytest.mark.slow
def test_demo_mode_without_api_key_starts_but_warns():
    """Demo stays convenient, but must say plainly that it is unauthenticated."""
    r = _run(IMPORT_APP, {"AGENT_ENV": "demo", "API_KEY": ""})
    assert r.returncode == 0, (r.stdout + r.stderr)[-800:]
    assert "unauthenticated" in (r.stdout + r.stderr).lower()


@pytest.mark.slow
def test_requests_are_rejected_without_the_key_and_accepted_with_it():
    code = """
import os
from fastapi.testclient import TestClient
import backend.api.main as m
c = TestClient(m.app)
print("HEALTH_NOKEY", c.get("/api/health").status_code)
print("STRATS_NOKEY", c.get("/api/strategies").status_code)
print("STRATS_BADKEY", c.get("/api/strategies", headers={"x-api-key": "wrong"}).status_code)
print("STRATS_GOODKEY", c.get("/api/strategies", headers={"x-api-key": "test-key-123"}).status_code)
"""
    r = _run(code, {"AGENT_ENV": "demo", "API_KEY": "test-key-123"})
    out = r.stdout
    assert r.returncode == 0, (r.stdout + r.stderr)[-1500:]
    # health is deliberately exempt so uptime checks work
    assert "HEALTH_NOKEY 200" in out, out
    # everything else must be locked down
    assert "STRATS_NOKEY 401" in out, out
    assert "STRATS_BADKEY 401" in out, out
    assert "STRATS_GOODKEY 200" in out, out
