"""
ML Confidence Filter — quality gate for algo trade entries.

Scores each trade signal 0-1 using a trained XGBoost/RandomForest model.
Trades below the threshold are skipped. If no model exists, all trades pass.
"""
import os
import logging
import numpy as np
from datetime import datetime

logger = logging.getLogger("massttrader.ml")

MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "ml_models")
DEFAULT_MODEL_PATH = os.path.join(MODEL_DIR, "confidence_filter.joblib")
DEFAULT_THRESHOLD = 0.55

FEATURE_COLUMNS = [
    "RSI_14",
    "MACD_histogram",
    "MACD_line",
    "BB_width",
    "ATR_14",
    "ADX_14",
    "Stoch_K",
    "Stoch_D",
    "Volume_ratio",
    "EMA_9_21_spread",
    "close_vs_BB_middle",
    "close_vs_EMA_50",
    "direction",
    # Smart Money features
    "Liq_sweep_bull",
    "Liq_sweep_bear",
    "Volume_delta",
    "Cumulative_delta",
    "VP_position",
]

# Module-level model cache
_loaded_model = None
_loaded_model_path = None


def extract_features(indicators: dict, direction: str = "buy", close_price: float = None) -> np.ndarray:
    """
    Extract a 13-element feature vector from an indicator snapshot dict.
    Uses the same keys stored in algo_trades.entry_indicators.
    Missing values default to neutral values.
    """
    rsi = float(indicators.get("RSI_14", 50.0) or 50.0)
    macd_hist = float(indicators.get("MACD_histogram", 0.0) or 0.0)
    macd_line = float(indicators.get("MACD_line", 0.0) or 0.0)
    bb_width = float(indicators.get("BB_width", 0.0) or 0.0)
    atr = float(indicators.get("ATR_14", 0.0) or 0.0)
    adx = float(indicators.get("ADX_14", 0.0) or 0.0)
    stoch_k = float(indicators.get("Stoch_K", 50.0) or 50.0)
    stoch_d = float(indicators.get("Stoch_D", 50.0) or 50.0)
    vol_ratio = float(indicators.get("Volume_ratio", 1.0) or 1.0)

    # Derived features
    ema_9 = float(indicators.get("EMA_9", 0.0) or 0.0)
    ema_21 = float(indicators.get("EMA_21", 0.0) or 0.0)
    ema_spread = (ema_9 - ema_21) if (ema_9 and ema_21) else 0.0

    bb_mid = float(indicators.get("BB_middle", 0.0) or 0.0)
    close = close_price or float(indicators.get("close", bb_mid or 1.0) or 1.0)
    close_vs_bb = ((close - bb_mid) / bb_mid) if bb_mid else 0.0

    ema_50 = float(indicators.get("EMA_50", 0.0) or 0.0)
    close_vs_ema50 = ((close - ema_50) / ema_50) if ema_50 else 0.0

    dir_enc = 1.0 if direction == "buy" else 0.0

    # Smart Money features
    liq_bull = float(indicators.get("Liq_sweep_bull", 0.0) or 0.0)
    liq_bear = float(indicators.get("Liq_sweep_bear", 0.0) or 0.0)
    vol_delta = float(indicators.get("Volume_delta", 0.0) or 0.0)
    cum_delta = float(indicators.get("Cumulative_delta", 0.0) or 0.0)
    vp_position = float(indicators.get("VP_position", 0.0) or 0.0)

    return np.array([
        rsi, macd_hist, macd_line, bb_width, atr, adx,
        stoch_k, stoch_d, vol_ratio,
        ema_spread, close_vs_bb, close_vs_ema50, dir_enc,
        liq_bull, liq_bear, vol_delta, cum_delta, vp_position,
    ], dtype=np.float64)


def load_model(model_path: str = None):
    """Load model from disk with module-level caching. Returns None if not found."""
    global _loaded_model, _loaded_model_path
    path = model_path or DEFAULT_MODEL_PATH

    if _loaded_model is not None and _loaded_model_path == path:
        return _loaded_model

    if not os.path.exists(path):
        logger.info("No ML model at %s — filter disabled", path)
        return None

    try:
        import joblib
        _loaded_model = joblib.load(path)
        _loaded_model_path = path
        logger.info("ML confidence model loaded from %s", path)
        return _loaded_model
    except Exception as e:
        logger.error("Failed to load ML model: %s", e)
        _loaded_model = None
        return None


def predict_confidence(
    indicators: dict,
    direction: str = "buy",
    close_price: float = None,
    model_path: str = None,
) -> dict:
    """
    Predict confidence score for a trade entry.
    Returns dict: {score, pass, threshold, model_loaded}
    If no model, returns score=1.0 pass=True (all trades allowed).
    """
    model = load_model(model_path)
    if model is None:
        return {
            "score": 1.0,
            "pass": True,
            "threshold": DEFAULT_THRESHOLD,
            "model_loaded": False,
        }

    features = extract_features(indicators, direction, close_price)
    features_2d = features.reshape(1, -1)

    try:
        # Replace NaN/Inf before prediction
        features_2d = np.nan_to_num(features_2d, nan=0.0, posinf=0.0, neginf=0.0)
        # Check for feature dimension mismatch (old model trained on fewer features)
        expected = getattr(model, "n_features_in_", None)
        if expected is not None and expected != features_2d.shape[1]:
            logger.warning(
                "ML model expects %d features but got %d — retrain needed, bypassing filter",
                expected, features_2d.shape[1],
            )
            return {
                "score": 1.0,
                "pass": True,
                "threshold": DEFAULT_THRESHOLD,
                "model_loaded": False,
            }
        proba = model.predict_proba(features_2d)[0]
        # Class 1 = winning trade
        confidence = float(proba[1]) if len(proba) > 1 else float(proba[0])
        return {
            "score": round(confidence, 4),
            "pass": confidence >= DEFAULT_THRESHOLD,
            "threshold": DEFAULT_THRESHOLD,
            "model_loaded": True,
        }
    except Exception as e:
        logger.error("ML prediction failed: %s", e)
        return {
            "score": 1.0,
            "pass": True,
            "threshold": DEFAULT_THRESHOLD,
            "model_loaded": False,
        }


def reload_model(model_path: str = None):
    """Force reload model from disk (call after retraining)."""
    global _loaded_model, _loaded_model_path
    _loaded_model = None
    _loaded_model_path = None
    return load_model(model_path)


def get_model_status(model_path: str = None) -> dict:
    """Return metadata about the ML model."""
    path = model_path or DEFAULT_MODEL_PATH
    exists = os.path.exists(path)
    info = {
        "model_exists": exists,
        "model_loaded": _loaded_model is not None,
        "model_path": path,
        "threshold": DEFAULT_THRESHOLD,
        "feature_count": len(FEATURE_COLUMNS),
        "features": FEATURE_COLUMNS,
    }
    if exists:
        info["model_file_size_kb"] = round(os.path.getsize(path) / 1024, 1)
        mtime = os.path.getmtime(path)
        info["model_trained_at"] = datetime.fromtimestamp(mtime).isoformat()
    return info
