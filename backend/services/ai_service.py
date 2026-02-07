"""
AI Service — handles all LLM interactions for strategy parsing,
trade analysis, and personalized education.
Supports: Groq (free), Google Gemini (free), Anthropic Claude, OpenAI GPT-4.
"""
import json
from config.settings import settings


def _call_llm(system_prompt: str, user_prompt: str, json_mode: bool = False) -> str:
    provider = settings.AI_PROVIDER

    if provider == "groq":
        from groq import Groq
        client = Groq(api_key=settings.GROQ_API_KEY)
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        kwargs = {"model": "llama-3.3-70b-versatile", "messages": messages, "max_tokens": 4096}
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        response = client.chat.completions.create(**kwargs)
        return response.choices[0].message.content

    elif provider == "gemini":
        import google.generativeai as genai
        genai.configure(api_key=settings.GOOGLE_API_KEY)
        model = genai.GenerativeModel(
            "gemini-2.0-flash",
            system_instruction=system_prompt,
        )
        gen_config = {}
        if json_mode:
            gen_config["response_mime_type"] = "application/json"
        response = model.generate_content(user_prompt, generation_config=gen_config or None)
        return response.text

    elif provider == "anthropic":
        from anthropic import Anthropic
        client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        return response.content[0].text

    else:  # openai
        from openai import OpenAI
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        kwargs = {"model": "gpt-4o", "messages": messages, "max_tokens": 4096}
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        response = client.chat.completions.create(**kwargs)
        return response.choices[0].message.content


# ──────────────────────────────────────────────
# 1. STRATEGY PARSER — Natural Language → Rules
# ──────────────────────────────────────────────

STRATEGY_PARSER_SYSTEM = """You are a trading strategy parser. The user will describe a trading strategy in natural language. You must convert it to a structured JSON format.

Output ONLY valid JSON with this schema:
{
  "name": "strategy name",
  "rules": [
    {
      "name": "rule name",
      "timeframe": "1h",
      "entry_conditions": [
        {
          "indicator": "RSI",
          "parameter": "value",
          "operator": ">|<|crosses_above|crosses_below|==",
          "value": 30,
          "description": "RSI is above 30"
        }
      ],
      "exit_conditions": [...],
      "stop_loss_pips": 50,
      "take_profit_pips": 100,
      "risk_percent": 1.0,
      "description": "human readable rule description"
    }
  ],
  "ai_explanation": "A clear explanation of what this strategy does and when it triggers"
}

Available indicators: RSI, MACD (parameters: line, signal, histogram), EMA_{period}, SMA_{period}, Bollinger (parameters: upper, middle, lower, width), ATR, Stochastic (parameters: K, D), ADX (parameters: value, DI_plus, DI_minus), Volume (parameters: OBV, ratio).

If the user mentions a timeframe, use it. Default to 1h if not specified.
If the user doesn't mention stop loss / take profit, leave them as null.
Be precise with operator selection — "crosses above" is different from "is above"."""


def parse_strategy(natural_language: str, symbol: str = "") -> dict:
    """Convert natural language strategy description to structured rules."""
    prompt = f"Symbol: {symbol}\n\nStrategy description: {natural_language}"
    result = _call_llm(STRATEGY_PARSER_SYSTEM, prompt, json_mode=True)
    try:
        return json.loads(result)
    except json.JSONDecodeError:
        # Try to extract JSON from the response
        start = result.find("{")
        end = result.rfind("}") + 1
        if start != -1 and end > start:
            return json.loads(result[start:end])
        raise ValueError(f"AI did not return valid JSON: {result[:200]}")


# ──────────────────────────────────────────────
# 2. TRADE ANALYZER — Critique manual trades
# ──────────────────────────────────────────────

TRADE_ANALYZER_SYSTEM = """You are a trading coach analyzing a trader's manual trade against their defined strategy. Your goal is to educate, not judge.

You will receive:
1. The trader's strategy rules
2. The trade details (entry/exit price, time, profit/loss)
3. Indicator values at the time of entry

Your analysis should:
- Check each strategy condition: was it met at entry? Use exact indicator values.
- Give a Strategy Alignment Score (0-100): 100 = perfectly followed strategy, 0 = completely against it.
- Explain what the trader did right.
- Explain what deviated from the strategy and WHY that matters.
- Suggest what the trader should have done instead.
- Use the trader's actual numbers — no generic advice.

Tone: Supportive but honest. Like a mentor, not a critic. Use the trader's own data as teaching moments.

Format your response as:
## Strategy Alignment Score: X/100

### What You Did Right
- ...

### What Deviated From Your Strategy
- ...

### What The Indicators Were Saying
- ...

### Lesson From This Trade
- ...
"""


def analyze_trade(
    strategy: dict,
    trade: dict,
    indicators_at_entry: dict,
    indicators_at_exit: dict = None,
) -> dict:
    """Analyze a manual trade against the user's strategy."""
    prompt = f"""
Strategy: {json.dumps(strategy, indent=2)}

Trade Details:
- Symbol: {trade.get('symbol')}
- Type: {trade.get('type', trade.get('trade_type'))}
- Entry Price: {trade.get('entry_price')}
- Exit Price: {trade.get('exit_price', 'still open')}
- Profit/Loss: {trade.get('profit', 'still open')}
- Open Time: {trade.get('open_time')}

Indicator Values at Entry:
{json.dumps(indicators_at_entry, indent=2)}

Indicator Values at Exit:
{json.dumps(indicators_at_exit, indent=2) if indicators_at_exit else 'N/A (trade still open or not available)'}
"""
    analysis = _call_llm(TRADE_ANALYZER_SYSTEM, prompt)

    # Extract score from the response
    score = 50  # default
    if "Score:" in analysis:
        try:
            score_text = analysis.split("Score:")[1].split("/")[0].strip()
            score = int(score_text)
        except (ValueError, IndexError):
            pass

    return {"analysis": analysis, "alignment_score": score}


# ──────────────────────────────────────────────
# 3. BACKTEST EXPLAINER — Summarize results
# ──────────────────────────────────────────────

BACKTEST_EXPLAINER_SYSTEM = """You are a trading educator explaining backtest results to a trader. Make the data meaningful and actionable.

You will receive backtest statistics and trade details.

Formatting rules (STRICT — follow exactly):
- Use markdown headers (##) for each section
- Use bullet points (-) for every insight, NOT paragraphs
- Each bullet should be 1-2 sentences max
- **Bold** all key numbers, percentages, and dollar amounts
- Keep it scannable — a trader should understand in 30 seconds

Structure your response EXACTLY like this:

## Performance Summary
- bullet points about overall performance using real numbers

## When This Strategy Works
- bullet points about favorable market conditions

## When It Fails
- bullet points about unfavorable conditions

## How to Improve
- bullet points with specific, actionable suggestions

## Risk Verdict
- bullet points on whether this is safe to trade live

Use the actual numbers. Be specific, not generic. If win rate is 45%, say "you lose more trades than you win, but your avg winner (**$X**) is larger than your avg loser (**$Y**)."
Never write long paragraphs. Every line must be a bullet point under a header."""


def explain_backtest(stats: dict, trades: list[dict], strategy: dict) -> str:
    """Generate a human-readable explanation of backtest results."""
    prompt = f"""
Strategy: {json.dumps(strategy, indent=2)}

Backtest Statistics:
{json.dumps(stats, indent=2)}

Sample Trades (first 10):
{json.dumps(trades[:10], indent=2)}

Total trades: {len(trades)}
"""
    return _call_llm(BACKTEST_EXPLAINER_SYSTEM, prompt)


# ──────────────────────────────────────────────
# 4. EDUCATION — Personalized lessons
# ──────────────────────────────────────────────

EDUCATOR_SYSTEM = """You are a personalized trading tutor. You adapt your teaching to the trader's level, the instruments they trade, and their actual trading history.

Rules:
- Use examples from the instruments they trade (not generic forex examples for a synthetics trader)
- Reference their actual trades when possible
- Explain concepts progressively — check understanding before advancing
- Never promise profits or give financial advice
- Focus on concepts, risk management, and analysis skills
- Use analogies and visual descriptions
- Keep explanations concise but complete

Formatting rules (STRICT):
- Structure your response using bullet points and short pointers, NOT long paragraphs
- Use **bold** for key terms, important concepts, and critical values
- Use markdown headers (##, ###) to organize sections
- Each bullet point should be 1-2 sentences max
- Use numbered lists for sequential steps or processes

If the trader asks about a concept, explain it using THEIR context."""


def get_lesson(
    topic: str,
    trader_level: str = "intermediate",
    instruments: list[str] = None,
    trade_history_summary: str = "",
) -> str:
    """Generate a personalized lesson on a trading topic."""
    prompt = f"""
Trader Level: {trader_level}
Instruments They Trade: {', '.join(instruments or ['general'])}
Their Recent Trading Summary: {trade_history_summary or 'Not available'}

Topic to teach: {topic}
"""
    return _call_llm(EDUCATOR_SYSTEM, prompt)
