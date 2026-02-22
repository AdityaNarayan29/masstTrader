"""
ML model training pipeline for the confidence filter.

Collects labeled data from backtests + live trades, trains XGBoost,
saves model to disk for use by ml_filter.predict_confidence().
"""
import os
import json
import logging
import numpy as np
from datetime import datetime, timezone

logger = logging.getLogger("massttrader.ml")

from backend.core.ml_filter import (
    extract_features,
    FEATURE_COLUMNS,
    MODEL_DIR,
    DEFAULT_MODEL_PATH,
    reload_model,
)


def _collect_backtest_data(connector=None, bars=2000) -> list[tuple]:
    """Run all saved strategies through backtester, collect (features, label) samples."""
    from backend.database import list_strategies
    from backend.core.backtester import run_backtest
    from backend.core.indicators import add_all_indicators

    strategies = list_strategies()
    samples = []

    for strat in strategies:
        rules = strat.get("rules", [])
        if not rules:
            continue
        symbol = strat.get("symbol", "EURUSDm")

        for rule in rules:
            direction = rule.get("direction", "buy")
            timeframe = rule.get("timeframe", "1h")

            # Fetch historical data via MT5
            try:
                if connector and hasattr(connector, "is_connected") and connector.is_connected:
                    connector.select_symbol(symbol)
                    df = connector.get_history(symbol, timeframe, bars)
                    df = add_all_indicators(df)
                else:
                    continue
            except Exception as e:
                logger.warning("Skipping %s/%s: %s", strat["name"], rule.get("name", ""), e)
                continue

            # Run backtest
            try:
                result = run_backtest(df, rule, initial_balance=10000, risk_per_trade=1.0)
                for trade in result.get("trades", []):
                    indicators = trade.get("indicators_at_entry", {})
                    if not indicators:
                        continue
                    features = extract_features(indicators, direction)
                    label = 1 if trade.get("profit", 0) > 0 else 0
                    samples.append((features, label))
            except Exception as e:
                logger.warning("Backtest failed for %s: %s", strat["name"], e)
                continue

    logger.info("Collected %d samples from fresh backtests", len(samples))
    return samples


def _collect_stored_backtest_data() -> list[tuple]:
    """Collect samples from previously saved backtests in the DB."""
    from backend.database import list_backtests, get_backtest

    samples = []
    try:
        backtests = list_backtests()
    except Exception:
        return samples

    for bt_summary in backtests:
        bt = get_backtest(bt_summary["id"])
        if not bt:
            continue
        trades = bt.get("trades", [])
        if isinstance(trades, str):
            try:
                trades = json.loads(trades)
            except Exception:
                continue
        for trade in trades:
            indicators = trade.get("indicators_at_entry", {})
            if not indicators or len(indicators) < 3:
                continue
            features = extract_features(indicators, "buy")
            label = 1 if trade.get("profit", 0) > 0 else 0
            samples.append((features, label))

    logger.info("Collected %d samples from stored backtests", len(samples))
    return samples


def _collect_live_trade_data() -> list[tuple]:
    """Collect samples from closed algo_trades in the DB."""
    from backend.database import list_algo_trades

    samples = []
    try:
        trades = list_algo_trades(limit=10000)
    except Exception:
        return samples

    for trade in trades:
        if trade.get("status") != "closed" or trade.get("net_pnl") is None:
            continue
        indicators = trade.get("entry_indicators", {})
        if not indicators or len(indicators) < 3:
            continue
        direction = trade.get("direction", "buy")
        features = extract_features(indicators, direction)
        label = 1 if trade["net_pnl"] > 0 else 0
        samples.append((features, label))

    logger.info("Collected %d samples from live trades", len(samples))
    return samples


def train_model(connector=None, bars=2000, model_path=None) -> dict:
    """
    Full training pipeline:
    1. Collect data from backtests + stored backtests + live trades
    2. Train XGBoost classifier
    3. Save model to disk and reload into memory
    Returns training report dict.
    """
    path = model_path or DEFAULT_MODEL_PATH
    os.makedirs(os.path.dirname(path), exist_ok=True)

    # Collect all training data
    logger.info("Starting ML training pipeline...")

    backtest_samples = _collect_backtest_data(connector, bars)
    stored_samples = _collect_stored_backtest_data()
    live_samples = _collect_live_trade_data()

    all_samples = backtest_samples + stored_samples + live_samples

    if len(all_samples) < 20:
        return {
            "success": False,
            "error": f"Insufficient training data: {len(all_samples)} samples (need at least 20)",
            "backtest_samples": len(backtest_samples),
            "stored_backtest_samples": len(stored_samples),
            "live_samples": len(live_samples),
        }

    X = np.array([s[0] for s in all_samples])
    y = np.array([s[1] for s in all_samples])

    # Clean features
    X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)

    # Train/test split
    from sklearn.model_selection import train_test_split

    # Stratify only if both classes present
    stratify = y if len(set(y)) > 1 else None
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=stratify,
    )

    # Train model — XGBoost primary, RandomForest fallback
    try:
        from xgboost import XGBClassifier

        model = XGBClassifier(
            n_estimators=100,
            max_depth=4,
            learning_rate=0.1,
            min_child_weight=3,
            subsample=0.8,
            colsample_bytree=0.8,
            eval_metric="logloss",
            random_state=42,
        )
        model_type = "XGBoost"
    except ImportError:
        from sklearn.ensemble import RandomForestClassifier

        model = RandomForestClassifier(
            n_estimators=100,
            max_depth=6,
            min_samples_leaf=5,
            random_state=42,
        )
        model_type = "RandomForest"

    model.fit(X_train, y_train)

    # Evaluate
    from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score

    y_pred = model.predict(X_test)
    accuracy = accuracy_score(y_test, y_pred)
    precision = precision_score(y_test, y_pred, zero_division=0)
    recall = recall_score(y_test, y_pred, zero_division=0)
    f1 = f1_score(y_test, y_pred, zero_division=0)

    # Feature importance
    importance = {}
    if hasattr(model, "feature_importances_"):
        importance = dict(
            zip(FEATURE_COLUMNS, [round(float(v), 4) for v in model.feature_importances_])
        )

    # Save model
    import joblib

    joblib.dump(model, path)
    logger.info("Model saved to %s", path)

    # Reload into memory
    reload_model(path)

    # Save training run to DB
    try:
        from backend.database import save_training_run
        save_training_run({
            "model_type": model_type.lower(),
            "total_samples": len(all_samples),
            "accuracy": round(accuracy, 4),
            "precision_score": round(precision, 4),
            "recall": round(recall, 4),
            "f1_score": round(f1, 4),
            "extra_metrics": {
                "backtest_samples": len(backtest_samples),
                "stored_backtest_samples": len(stored_samples),
                "live_samples": len(live_samples),
                "win_rate_in_data": round(float(np.mean(y)) * 100, 1),
                "feature_importance": importance,
            },
        })
    except Exception as e:
        logger.warning("Failed to save training run: %s", e)

    report = {
        "success": True,
        "model_type": model_type,
        "model_path": path,
        "total_samples": len(all_samples),
        "backtest_samples": len(backtest_samples),
        "stored_backtest_samples": len(stored_samples),
        "live_samples": len(live_samples),
        "train_size": len(X_train),
        "test_size": len(X_test),
        "win_rate_in_data": round(float(np.mean(y)) * 100, 1),
        "accuracy": round(accuracy, 4),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1_score": round(f1, 4),
        "feature_importance": importance,
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }

    logger.info("Training complete — %s accuracy=%.2f%% F1=%.4f samples=%d",
                model_type, accuracy * 100, f1, len(all_samples))
    return report
