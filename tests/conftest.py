import os
import sys
import pathlib

# Import the app package from the repo root regardless of where pytest is invoked.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

# Keep tests off the real broker and off any real AI provider.
os.environ.setdefault("AGENT_ENV", "demo")
os.environ.setdefault("MT5_LOGIN", "")
os.environ.setdefault("MT5_PASSWORD", "")
os.environ.setdefault("MT5_SERVER", "")
