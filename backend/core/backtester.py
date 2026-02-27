"""
Backtesting engine — runs strategy rules against historical data.
"""
import pandas as pd
import numpy as np
from backend.core.indicators import add_all_indicators, get_indicator_snapshot


def evaluate_condition(row: pd.Series, prev_row: pd.Series, condition: dict) -> bool:
    """Evaluate a single indicator condition against a candle row."""
    indicator = condition["indicator"]
    parameter = condition.get("parameter", "value")
    operator = condition["operator"]
    target_value = condition["value"]

    # Map indicator+parameter to column name
    col = _resolve_column(indicator, parameter)
    if col not in row.index:
        return False

    current_val = row[col]
    if pd.isna(current_val):
        return False

    # Resolve target (could be a number or another indicator reference)
    if isinstance(target_value, str):
        target_col = _resolve_column(target_value, "value")
        if target_col in row.index:
            target_num = row[target_col]
        else:
            try:
                target_num = float(target_value)
            except ValueError:
                return False
    else:
        target_num = float(target_value)

    if pd.isna(target_num):
        return False

    if operator == ">":
        return current_val > target_num
    elif operator == "<":
        return current_val < target_num
    elif operator == "==":
        return abs(current_val - target_num) < 1e-8
    elif operator == "crosses_above":
        if prev_row is None or col not in prev_row.index:
            return False
        prev_val = prev_row[col]
        if isinstance(target_value, str):
            target_col = _resolve_column(target_value, "value")
            if target_col in prev_row.index:
                prev_target = prev_row[target_col]
            else:
                prev_target = target_num
        else:
            prev_target = target_num
        return prev_val <= prev_target and current_val > target_num
    elif operator == "crosses_below":
        if prev_row is None or col not in prev_row.index:
            return False
        prev_val = prev_row[col]
        if isinstance(target_value, str):
            target_col = _resolve_column(target_value, "value")
            if target_col in prev_row.index:
                prev_target = prev_row[target_col]
            else:
                prev_target = target_num
        else:
            prev_target = target_num
        return prev_val >= prev_target and current_val < target_num

    return False


def _resolve_column(indicator: str, parameter: str) -> str:
    """Map indicator name + parameter to the actual DataFrame column."""
    mapping = {
        ("RSI", "value"): "RSI_14",
        ("MACD", "line"): "MACD_line",
        ("MACD", "signal"): "MACD_signal",
        ("MACD", "histogram"): "MACD_histogram",
        ("EMA", "value"): "EMA_50",
        ("SMA", "value"): "SMA_20",
        ("Bollinger", "upper"): "BB_upper",
        ("Bollinger", "middle"): "BB_middle",
        ("Bollinger", "lower"): "BB_lower",
        ("Bollinger", "width"): "BB_width",
        ("ATR", "value"): "ATR_14",
        ("Stochastic", "K"): "Stoch_K",
        ("Stochastic", "D"): "Stoch_D",
        ("ADX", "value"): "ADX_14",
        ("ADX", "DI_plus"): "DI_plus",
        ("ADX", "DI_minus"): "DI_minus",
        ("Volume", "OBV"): "OBV",
        ("Volume", "ratio"): "Volume_ratio",
        # Smart Money — Liquidity Sweep
        ("LiqSweep", "bull"): "Liq_sweep_bull",
        ("LiqSweep", "bear"): "Liq_sweep_bear",
        ("LiqSweep", "swing_high"): "Swing_high",
        ("LiqSweep", "swing_low"): "Swing_low",
        # Smart Money — Anchored VWAP
        ("AVWAP", "high"): "AVWAP_high",
        ("AVWAP", "low"): "AVWAP_low",
        # Smart Money — Volume Delta
        ("VolumeDelta", "delta"): "Volume_delta",
        ("VolumeDelta", "cumulative"): "Cumulative_delta",
        ("VolumeDelta", "sma"): "Delta_SMA_14",
        ("VolumeDelta", "value"): "Volume_delta",
        # Smart Money — Volume Profile
        ("VolumeProfile", "poc"): "VP_POC",
        ("VolumeProfile", "vah"): "VP_VAH",
        ("VolumeProfile", "val"): "VP_VAL",
        ("VolumeProfile", "position"): "VP_position",
        ("VolumeProfile", "value"): "VP_POC",
    }

    # Direct column name match (e.g., "EMA_50")
    key = (indicator, parameter)
    if key in mapping:
        return mapping[key]

    # Raw OHLCV column names
    if indicator in ("open", "high", "low", "close", "volume"):
        return indicator

    # Try indicator as a direct column name (e.g., "EMA_50", "DI_minus", "MACD_histogram_prev")
    if "_" in indicator:
        return indicator

    # Fallback: combine indicator and parameter (e.g., "ADX" + "DI_plus" -> "ADX_DI_plus")
    # but prefer direct column names first
    return f"{indicator}_{parameter}"


def run_backtest(
    df: pd.DataFrame,
    strategy_rule: dict,
    initial_balance: float = 10000.0,
    risk_per_trade: float = 1.0,
    all_rules: list = None,
) -> dict:
    """
    Run a backtest on historical data using strategy rules.

    Supports multi-rule strategies (e.g. one buy rule + one sell rule).
    If all_rules is provided, iterates all rules on each bar looking for entries.
    Otherwise falls back to the single strategy_rule for backward compatibility.

    Returns dict with:
    - trades: list of executed trades
    - stats: performance statistics
    - equity_curve: list of equity values over time
    """
    # Add indicators
    df = add_all_indicators(df)
    df = df.dropna().reset_index()

    # Build list of rule configs
    rules_list = all_rules if all_rules else [strategy_rule]
    rule_configs = []
    for idx, rule in enumerate(rules_list):
        rule_configs.append({
            "index": idx,
            "direction": rule.get("direction", "buy"),
            "entry_conditions": rule.get("entry_conditions", []),
            "exit_conditions": rule.get("exit_conditions", []),
            "sl_pips": rule.get("stop_loss_pips"),
            "tp_pips": rule.get("take_profit_pips"),
            "sl_atr_mult": rule.get("stop_loss_atr_multiplier"),
            "tp_atr_mult": rule.get("take_profit_atr_multiplier"),
            "min_bars": rule.get("min_bars_in_trade") or 0,
        })

    balance = initial_balance
    equity_curve = [balance]
    trades = []
    in_position = False
    entry_price = 0
    entry_time = None
    entry_index = 0
    active_rc = None  # which rule opened the current position
    effective_sl_pips = None
    effective_tp_pips = None
    active_direction = "buy"

    for i in range(1, len(df)):
        row = df.iloc[i]
        prev_row = df.iloc[i - 1]

        if not in_position:
            # Check entry conditions for ALL rules, take first match
            for rc in rule_configs:
                if not rc["entry_conditions"]:
                    continue
                all_entry_met = all(
                    evaluate_condition(row, prev_row, cond)
                    for cond in rc["entry_conditions"]
                )
                if all_entry_met:
                    entry_price = row["close"]
                    entry_time = row["datetime"]
                    entry_index = i
                    in_position = True
                    active_rc = rc
                    active_direction = rc["direction"]

                    # Compute effective SL/TP from ATR at entry time
                    atr_val = float(row["ATR_14"]) if "ATR_14" in row.index and not pd.isna(row.get("ATR_14")) else 0
                    if rc["sl_atr_mult"] and atr_val > 0:
                        effective_sl_pips = (atr_val * rc["sl_atr_mult"]) * 10000
                    else:
                        effective_sl_pips = rc["sl_pips"]
                    if rc["tp_atr_mult"] and atr_val > 0:
                        effective_tp_pips = (atr_val * rc["tp_atr_mult"]) * 10000
                    else:
                        effective_tp_pips = rc["tp_pips"]
                    break  # first matching rule wins

        else:
            # Check exit conditions using the active rule
            current_price = row["close"]
            # PnL direction depends on whether it's a buy or sell
            if active_direction == "buy":
                pnl_pips = (current_price - entry_price) * 10000
            else:
                pnl_pips = (entry_price - current_price) * 10000

            exit_reason = None

            # SL/TP checks always fire (capital protection, not gated by min_bars)
            if effective_sl_pips and pnl_pips <= -effective_sl_pips:
                exit_reason = "stop_loss"

            if effective_tp_pips and pnl_pips >= effective_tp_pips:
                exit_reason = "take_profit"

            # Strategy exit conditions — gated behind min_bars
            bars_held = i - entry_index
            min_bars = active_rc["min_bars"]
            exit_conditions = active_rc["exit_conditions"]
            if exit_conditions and bars_held >= min_bars:
                all_exit_met = all(
                    evaluate_condition(row, prev_row, cond)
                    for cond in exit_conditions
                )
                if all_exit_met:
                    exit_reason = "strategy_exit"

            if exit_reason:
                # Calculate profit
                risk_amount = balance * (risk_per_trade / 100)
                sl_for_calc = effective_sl_pips if effective_sl_pips and effective_sl_pips > 0 else None
                if sl_for_calc:
                    profit = risk_amount * (pnl_pips / sl_for_calc)
                else:
                    profit = risk_amount * (pnl_pips / 100)

                balance += profit

                trades.append(
                    {
                        "entry_price": entry_price,
                        "exit_price": current_price,
                        "entry_time": str(entry_time),
                        "exit_time": str(row["datetime"]),
                        "direction": active_direction,
                        "pnl_pips": round(pnl_pips, 2),
                        "profit": round(profit, 2),
                        "exit_reason": exit_reason,
                        "rule_index": active_rc["index"],
                        "indicators_at_entry": get_indicator_snapshot(
                            df, entry_index
                        ),
                        "indicators_at_exit": get_indicator_snapshot(df, i),
                    }
                )
                in_position = False
                active_rc = None

        equity_curve.append(balance)

    # Calculate statistics
    stats = _calculate_stats(trades, initial_balance, balance, equity_curve)

    return {"trades": trades, "stats": stats, "equity_curve": equity_curve}


def _calculate_stats(
    trades: list, initial_balance: float, final_balance: float, equity_curve: list
) -> dict:
    if not trades:
        return {
            "total_trades": 0,
            "win_rate": 0,
            "total_profit": 0,
            "profit_factor": 0,
            "max_drawdown": 0,
            "sharpe_ratio": 0,
            "avg_win": 0,
            "avg_loss": 0,
            "best_trade": 0,
            "worst_trade": 0,
            "final_balance": initial_balance,
        }

    profits = [t["profit"] for t in trades]
    wins = [p for p in profits if p > 0]
    losses = [p for p in profits if p <= 0]

    gross_profit = sum(wins) if wins else 0
    gross_loss = abs(sum(losses)) if losses else 0.0001

    # Max drawdown
    peak = initial_balance
    max_dd = 0
    for eq in equity_curve:
        if eq > peak:
            peak = eq
        dd = (peak - eq) / peak * 100
        if dd > max_dd:
            max_dd = dd

    # Sharpe ratio (simplified)
    returns = np.diff(equity_curve) / equity_curve[:-1] if len(equity_curve) > 1 else [0]
    sharpe = (np.mean(returns) / np.std(returns) * np.sqrt(252)) if np.std(returns) > 0 else 0

    return {
        "total_trades": len(trades),
        "winning_trades": len(wins),
        "losing_trades": len(losses),
        "win_rate": round(len(wins) / len(trades) * 100, 1),
        "total_profit": round(final_balance - initial_balance, 2),
        "profit_factor": round(gross_profit / gross_loss, 2),
        "max_drawdown": round(max_dd, 2),
        "sharpe_ratio": round(float(sharpe), 2),
        "avg_win": round(np.mean(wins), 2) if wins else 0,
        "avg_loss": round(np.mean(losses), 2) if losses else 0,
        "best_trade": round(max(profits), 2),
        "worst_trade": round(min(profits), 2),
        "final_balance": round(final_balance, 2),
    }
