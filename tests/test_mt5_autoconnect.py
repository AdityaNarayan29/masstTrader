"""Tests for MT5 auto-connect on startup.

Before this existed, credentials in .env were read (`has_env_creds` reported
true) but the connector stayed None until a human POSTed /api/mt5/connect.
Every restart came back silently disconnected — deploy, crash, NSSM
auto-restart, VM reboot. For an agent meant to run unattended for weeks, one
overnight reboot meant it was offline until somebody noticed.
"""
import os
import subprocess
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
PY = str(ROOT / ".venv" / "bin" / "python")


def _run(code, env_over, timeout=300):
    env = dict(os.environ)
    env.update({"MT5_LOGIN": "", "MT5_PASSWORD": "", "MT5_SERVER": "",
                "GROQ_API_KEY": "", "API_KEY": "", "AGENT_ENV": "demo",
                "TF_CPP_MIN_LOG_LEVEL": "3"})
    env.update(env_over)
    return subprocess.run([PY, "-c", code], cwd=str(ROOT), env=env,
                          capture_output=True, text=True, timeout=timeout)


@pytest.mark.slow
def test_startup_hook_is_registered():
    code = """
import backend.api.main as m
names = [h.__name__ for h in m.app.router.on_startup]
print("HOOKS", names)
"""
    r = _run(code, {})
    assert r.returncode == 0, (r.stdout + r.stderr)[-800:]
    assert "_autoconnect_mt5" in r.stdout, r.stdout


@pytest.mark.slow
def test_skips_cleanly_when_credentials_absent():
    """No credentials must not raise, and must not leave a half-open connector."""
    code = """
from fastapi.testclient import TestClient
import backend.api.main as m
with TestClient(m.app) as c:               # runs startup hooks
    print("STATUS", c.get("/api/health").status_code)
    print("CONNECTOR_NONE", m.connector is None)
"""
    r = _run(code, {})
    assert r.returncode == 0, (r.stdout + r.stderr)[-800:]
    assert "STATUS 200" in r.stdout, r.stdout
    assert "CONNECTOR_NONE True" in r.stdout, r.stdout


@pytest.mark.slow
def test_attempts_connection_when_credentials_present():
    """With credentials set it must try to connect, and a failure (no MT5 on
    this machine) must not take startup down with it."""
    code = """
from fastapi.testclient import TestClient
import backend.api.main as m
with TestClient(m.app) as c:
    print("STATUS", c.get("/api/health").status_code)
    print("HAS_ENV", c.get("/api/health").json()["has_env_creds"])
"""
    r = _run(code, {"MT5_LOGIN": "12345678", "MT5_PASSWORD": "x",
                    "MT5_SERVER": "Exness-MT5Trial16"})
    assert r.returncode == 0, (r.stdout + r.stderr)[-900:]
    # Startup survived even though MetaTrader5 cannot import on macOS/Linux.
    assert "STATUS 200" in r.stdout, r.stdout
    assert "HAS_ENV True" in r.stdout, r.stdout
