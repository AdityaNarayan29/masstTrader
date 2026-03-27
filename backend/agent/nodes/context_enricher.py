"""
Node 2 — Context Enricher
Fetches macro, crypto, gold, and sentiment context for cleared symbols.
This is where the data edge comes from.
"""
import logging
from datetime import datetime, timezone

from backend.agent.config import AgentConfig
from backend.agent.state import (
    AgentState, MacroContext, CryptoContext, GoldContext, SentimentContext,
)

logger = logging.getLogger("agent.enricher")


def run(state: AgentState) -> AgentState:
    """Enrich context for all cleared symbols."""
    cleared = state.get("cleared_symbols", [])
    if not cleared:
        return state

    macro = _fetch_macro_context()
    crypto = _fetch_crypto_context(cleared)
    gold = _fetch_gold_context(cleared)
    sentiment = _fetch_sentiment_context()

    return {
        **state,
        "macro_context": macro,
        "crypto_context": crypto,
        "gold_context": gold,
        "sentiment_context": sentiment,
    }


def _fetch_macro_context() -> MacroContext:
    """Fetch DXY, VIX, real yields, etc.

    Phase 1: Returns stub data. Phase 3 will wire up FRED API + live feeds.
    """
    # TODO Phase 3: Wire up real macro feeds
    # - DXY from MT5 (DXY symbol or USDX) or external API
    # - VIX from CBOE / Yahoo Finance
    # - US Real Yields from FRED API (TIPS)
    logger.debug("ENRICHER: Macro context — using defaults (Phase 1 stub)")
    return MacroContext(
        dxy_trend="neutral",
        dxy_momentum=0.0,
        vix=20.0,
        us_real_yield=0.0,
        btc_dominance=0.0,
        fed_funds_sentiment="neutral",
    )


def _fetch_crypto_context(symbols: list[str]) -> CryptoContext:
    """Fetch BTC-specific intelligence: funding, OI, netflow."""
    has_btc = any("BTC" in s.upper() for s in symbols)
    if not has_btc:
        return CryptoContext()

    # TODO Phase 3: Wire up Coinglass, Glassnode, exchange APIs
    # Phase 1: Try to fetch funding rate from CCXT if available
    try:
        from backend.agent.feeds.crypto_feed import fetch_funding_rate
        funding = fetch_funding_rate()
        return CryptoContext(
            funding_rate=funding.get("funding_rate", 0),
            open_interest=0,
            oi_change_pct=0,
            exchange_netflow=0,
            liquidation_levels=[],
            fear_greed_index=50,
        )
    except Exception as e:
        logger.warning(f"ENRICHER: Crypto context failed — {e}")
        return CryptoContext(
            funding_rate=0,
            open_interest=0,
            fear_greed_index=50,
        )


def _fetch_gold_context(symbols: list[str]) -> GoldContext:
    """Fetch Gold-specific intelligence: COT, central bank buying, GPR."""
    has_gold = any("XAU" in s.upper() or "GOLD" in s.upper() for s in symbols)
    if not has_gold:
        return GoldContext()

    # TODO Phase 3: Wire up CFTC COT parser, IMF/WGC data
    logger.debug("ENRICHER: Gold context — using defaults (Phase 1 stub)")
    return GoldContext(
        cot_commercial_net=0,
        central_bank_buying=False,
        geopolitical_risk_index=0,
    )


def _fetch_sentiment_context() -> SentimentContext:
    """Fetch sentiment: Fear & Greed, Reddit, Twitter."""
    # TODO Phase 3: Wire up alternative.me, PRAW, Nitter
    logger.debug("ENRICHER: Sentiment context — using defaults (Phase 1 stub)")
    return SentimentContext(
        reddit_score=0.0,
        twitter_score=0.0,
        fear_greed=50,
    )
