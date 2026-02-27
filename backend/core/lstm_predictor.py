"""
LSTM Price Direction Predictor — deep learning model for next-candle prediction.

Uses 50-candle sequences of 24 indicator features to predict if the next candle
closes higher (up) or lower (down). CPU-only TensorFlow/Keras.
"""
import os
import logging
import numpy as np
import pandas as pd
from datetime import datetime, timezone

logger = logging.getLogger("massttrader.lstm")

MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "ml_models")
LSTM_MODEL_PATH = os.path.join(MODEL_DIR, "lstm_predictor.keras")
LSTM_SCALER_PATH = os.path.join(MODEL_DIR, "lstm_scaler.joblib")

SEQUENCE_LENGTH = 50

# 24 features from indicator columns (subset of what add_all_indicators produces)
LSTM_FEATURE_COLUMNS = [
    "RSI_14", "MACD_line", "MACD_signal", "MACD_histogram",
    "EMA_8", "EMA_9", "EMA_14", "EMA_21", "EMA_34", "EMA_50", "EMA_100",
    "SMA_20", "BB_upper", "BB_middle", "BB_lower", "BB_width",
    "ATR_14", "ADX_14", "DI_plus", "DI_minus",
    "Stoch_K", "Stoch_D", "OBV", "Volume_ratio",
    # Smart Money features
    "Liq_sweep_bull", "Liq_sweep_bear",
    "Volume_delta", "Cumulative_delta", "Delta_SMA_14",
    "VP_POC", "VP_position",
    "AVWAP_high", "AVWAP_low",
]

# Module-level cache
_lstm_model = None
_lstm_scaler = None
_lstm_model_path = None


def _create_sequences(df: pd.DataFrame, seq_length: int = SEQUENCE_LENGTH):
    """
    Create (X, y) pairs from a DataFrame with indicator columns.
    X: (n_samples, seq_length, n_features) — sliding window of indicators
    y: (n_samples,) — 1 if next candle closes higher, 0 otherwise
    """
    # Select feature columns that exist in the DataFrame
    available = [c for c in LSTM_FEATURE_COLUMNS if c in df.columns]
    if len(available) < 10:
        raise ValueError(f"Only {len(available)} features available, need at least 10")

    data = df[available].values.astype(np.float64)
    close = df["close"].values.astype(np.float64)

    X, y = [], []
    for i in range(seq_length, len(data) - 1):
        X.append(data[i - seq_length:i])
        y.append(1 if close[i + 1] > close[i] else 0)

    return np.array(X), np.array(y), available


def _build_model(seq_length: int, n_features: int):
    """Build a 2-layer LSTM model for binary classification."""
    os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"  # suppress TF warnings
    from tensorflow import keras

    model = keras.Sequential([
        keras.layers.LSTM(64, return_sequences=True, input_shape=(seq_length, n_features)),
        keras.layers.Dropout(0.2),
        keras.layers.LSTM(32),
        keras.layers.Dropout(0.2),
        keras.layers.Dense(16, activation="relu"),
        keras.layers.Dense(1, activation="sigmoid"),
    ])
    model.compile(optimizer="adam", loss="binary_crossentropy", metrics=["accuracy"])
    return model


def load_lstm_model(model_path: str = None):
    """Load LSTM model + scaler from disk with caching."""
    global _lstm_model, _lstm_scaler, _lstm_model_path
    path = model_path or LSTM_MODEL_PATH

    if _lstm_model is not None and _lstm_model_path == path:
        return _lstm_model

    if not os.path.exists(path):
        logger.info("No LSTM model at %s — predictor disabled", path)
        return None

    try:
        os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
        from tensorflow import keras
        _lstm_model = keras.models.load_model(path)
        _lstm_model_path = path

        # Load scaler
        scaler_path = model_path.replace(".keras", "_scaler.joblib") if model_path else LSTM_SCALER_PATH
        if os.path.exists(scaler_path):
            import joblib
            _lstm_scaler = joblib.load(scaler_path)

        logger.info("LSTM model loaded from %s", path)
        return _lstm_model
    except Exception as e:
        logger.error("Failed to load LSTM model: %s", e)
        _lstm_model = None
        return None


def reload_lstm_model(model_path: str = None):
    """Force reload LSTM model from disk."""
    global _lstm_model, _lstm_scaler, _lstm_model_path
    _lstm_model = None
    _lstm_scaler = None
    _lstm_model_path = None
    return load_lstm_model(model_path)


def predict_direction(df: pd.DataFrame, model_path: str = None) -> dict:
    """
    Predict next-candle direction from a DataFrame with indicators.
    Needs at least SEQUENCE_LENGTH + 1 rows.
    Returns: {direction, confidence, model_loaded}
    """
    model = load_lstm_model(model_path)
    if model is None:
        return {"direction": "neutral", "confidence": 0.0, "model_loaded": False}

    available = [c for c in LSTM_FEATURE_COLUMNS if c in df.columns]
    if len(available) < 10 or len(df) < SEQUENCE_LENGTH:
        return {"direction": "neutral", "confidence": 0.0, "model_loaded": True}

    try:
        data = df[available].iloc[-SEQUENCE_LENGTH:].values.astype(np.float64)

        # Scale if scaler available
        if _lstm_scaler is not None:
            data = _lstm_scaler.transform(data)

        # Replace NaN/Inf
        data = np.nan_to_num(data, nan=0.0, posinf=0.0, neginf=0.0)

        # Predict
        X = data.reshape(1, SEQUENCE_LENGTH, len(available))
        prob = float(model.predict(X, verbose=0)[0][0])

        if prob >= 0.55:
            direction = "up"
            confidence = prob
        elif prob <= 0.45:
            direction = "down"
            confidence = 1.0 - prob
        else:
            direction = "neutral"
            confidence = 0.5

        return {
            "direction": direction,
            "confidence": round(confidence, 4),
            "model_loaded": True,
        }
    except Exception as e:
        logger.error("LSTM prediction failed: %s", e)
        return {"direction": "neutral", "confidence": 0.0, "model_loaded": False}


def train_lstm(
    connector=None,
    symbol: str = "EURUSDm",
    timeframe: str = "1h",
    bars: int = 5000,
    model_path: str = None,
) -> dict:
    """
    Train the LSTM model on historical candle data.
    Returns training report dict.
    """
    path = model_path or LSTM_MODEL_PATH
    os.makedirs(os.path.dirname(path), exist_ok=True)

    if not connector or not hasattr(connector, "is_connected") or not connector.is_connected:
        return {"success": False, "error": "MT5 not connected — cannot fetch training data"}

    # Fetch historical data
    logger.info("Fetching %d bars of %s %s for LSTM training...", bars, symbol, timeframe)
    try:
        from backend.core.indicators import add_all_indicators
        connector.select_symbol(symbol)
        df = connector.get_history(symbol, timeframe, bars)
        df = add_all_indicators(df)
        df = df.dropna().reset_index()
    except Exception as e:
        return {"success": False, "error": f"Data fetch failed: {e}"}

    if len(df) < SEQUENCE_LENGTH + 50:
        return {"success": False, "error": f"Not enough data: {len(df)} candles (need {SEQUENCE_LENGTH + 50}+)"}

    # Create sequences
    try:
        X, y, used_features = _create_sequences(df)
    except ValueError as e:
        return {"success": False, "error": str(e)}

    if len(X) < 50:
        return {"success": False, "error": f"Too few samples: {len(X)} (need 50+)"}

    logger.info("Created %d sequences with %d features", len(X), len(used_features))

    # Scale features
    from sklearn.preprocessing import StandardScaler
    n_samples, seq_len, n_features = X.shape
    X_flat = X.reshape(-1, n_features)
    scaler = StandardScaler()
    X_flat = scaler.fit_transform(X_flat)
    X = X_flat.reshape(n_samples, seq_len, n_features)
    X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)

    # Train/test split
    from sklearn.model_selection import train_test_split
    stratify = y if len(set(y)) > 1 else None
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=stratify,
    )

    # Build and train
    os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
    from tensorflow import keras

    model = _build_model(seq_len, n_features)

    callbacks = [
        keras.callbacks.EarlyStopping(patience=5, restore_best_weights=True),
    ]

    history = model.fit(
        X_train, y_train,
        epochs=50,
        batch_size=32,
        validation_split=0.2,
        callbacks=callbacks,
        verbose=0,
    )

    # Evaluate
    from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score
    y_pred_prob = model.predict(X_test, verbose=0).flatten()
    y_pred = (y_pred_prob >= 0.5).astype(int)

    accuracy = accuracy_score(y_test, y_pred)
    precision = precision_score(y_test, y_pred, zero_division=0)
    recall = recall_score(y_test, y_pred, zero_division=0)
    f1 = f1_score(y_test, y_pred, zero_division=0)
    val_loss = min(history.history.get("val_loss", [0]))
    epochs_trained = len(history.history["loss"])

    # Save model + scaler
    model.save(path)
    import joblib
    scaler_path = path.replace(".keras", "_scaler.joblib") if path.endswith(".keras") else LSTM_SCALER_PATH
    joblib.dump(scaler, scaler_path)

    logger.info("LSTM saved to %s", path)

    # Reload into memory
    reload_lstm_model(path)

    # Save training run to DB
    try:
        from backend.database import save_training_run
        save_training_run({
            "model_type": "lstm",
            "total_samples": len(X),
            "accuracy": round(accuracy, 4),
            "precision_score": round(precision, 4),
            "recall": round(recall, 4),
            "f1_score": round(f1, 4),
            "val_loss": round(val_loss, 6),
            "epochs": epochs_trained,
            "extra_metrics": {
                "symbol": symbol,
                "timeframe": timeframe,
                "bars": bars,
                "features_used": len(used_features),
                "sequence_length": seq_len,
            },
        })
    except Exception as e:
        logger.warning("Failed to save training run: %s", e)

    report = {
        "success": True,
        "model_path": path,
        "symbol": symbol,
        "timeframe": timeframe,
        "total_samples": len(X),
        "train_size": len(X_train),
        "test_size": len(X_test),
        "features_used": len(used_features),
        "sequence_length": seq_len,
        "up_rate_in_data": round(float(np.mean(y)) * 100, 1),
        "accuracy": round(accuracy, 4),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1_score": round(f1, 4),
        "val_loss": round(val_loss, 6),
        "epochs_trained": epochs_trained,
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }

    logger.info("LSTM training complete — accuracy=%.2f%% F1=%.4f samples=%d epochs=%d",
                accuracy * 100, f1, len(X), epochs_trained)
    return report


def get_lstm_status(model_path: str = None) -> dict:
    """Return metadata about the LSTM model."""
    path = model_path or LSTM_MODEL_PATH
    exists = os.path.exists(path)
    info = {
        "model_exists": exists,
        "model_loaded": _lstm_model is not None,
        "model_path": path,
        "sequence_length": SEQUENCE_LENGTH,
        "feature_count": len(LSTM_FEATURE_COLUMNS),
        "features": LSTM_FEATURE_COLUMNS,
    }
    if exists:
        info["model_file_size_kb"] = round(os.path.getsize(path) / 1024, 1)
        mtime = os.path.getmtime(path)
        info["model_trained_at"] = datetime.fromtimestamp(mtime).isoformat()
    return info
