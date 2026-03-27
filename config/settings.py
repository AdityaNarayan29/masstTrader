import os
from pathlib import Path
from dotenv import load_dotenv

# Explicitly load .env from project root (parent of config/)
_project_root = Path(__file__).resolve().parent.parent
load_dotenv(_project_root / ".env")


class Settings:
    # MT5 (native)
    MT5_LOGIN: str = os.getenv("MT5_LOGIN", "")
    MT5_PASSWORD: str = os.getenv("MT5_PASSWORD", "")
    MT5_SERVER: str = os.getenv("MT5_SERVER", "")
    MT5_PATH: str = os.getenv("MT5_PATH", "")

    # AI
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    GOOGLE_API_KEY: str = os.getenv("GOOGLE_API_KEY", "")
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    AI_PROVIDER: str = os.getenv("AI_PROVIDER", "groq")

    # Security
    API_KEY: str = os.getenv("API_KEY", "")
    CORS_ORIGINS: str = os.getenv("CORS_ORIGINS", "http://localhost:3000")

    # V2 Agent
    AGENT_ENV: str = os.getenv("AGENT_ENV", "demo")  # "demo" or "live"
    TF_MODE: str = os.getenv("TF_MODE", "intraday")
    WATCHLIST: str = os.getenv("WATCHLIST", "XAUUSDm,BTCUSDm")
    LOOP_INTERVAL_SECONDS: str = os.getenv("LOOP_INTERVAL_SECONDS", "300")

    # Crypto exchanges (optional — for BTC trading)
    BINANCE_API_KEY: str = os.getenv("BINANCE_API_KEY", "")
    BINANCE_API_SECRET: str = os.getenv("BINANCE_API_SECRET", "")
    BYBIT_API_KEY: str = os.getenv("BYBIT_API_KEY", "")
    BYBIT_API_SECRET: str = os.getenv("BYBIT_API_SECRET", "")
    CRYPTO_TESTNET: str = os.getenv("CRYPTO_TESTNET", "true")

    def validate(self):
        errors = []
        if not self.ANTHROPIC_API_KEY and not self.OPENAI_API_KEY and not self.GOOGLE_API_KEY and not self.GROQ_API_KEY:
            errors.append("At least one AI API key is required (GROQ, ANTHROPIC, OPENAI, or GOOGLE)")
        return errors


settings = Settings()
