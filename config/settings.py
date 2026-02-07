import os
from dotenv import load_dotenv

load_dotenv()


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

    def validate(self):
        errors = []
        if not self.ANTHROPIC_API_KEY and not self.OPENAI_API_KEY and not self.GOOGLE_API_KEY:
            errors.append("At least one AI API key is required (ANTHROPIC, OPENAI, or GOOGLE)")
        return errors


settings = Settings()
