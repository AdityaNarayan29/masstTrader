import { isDemoMode, setDemoMode } from "./demo";
import { handleDemoRequest } from "./demo/demo-handlers";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "";

async function request<T>(path: string, options?: RequestInit, timeoutMs = 30000): Promise<T> {
  // Demo mode: serve everything locally
  if (isDemoMode()) {
    return handleDemoRequest(path, options) as Promise<T>;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (API_KEY) headers["x-api-key"] = API_KEY;
    const res = await fetch(`${API_BASE}${path}`, {
      headers,
      signal: controller.signal,
      ...options,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || "Request failed");
    }
    return res.json();
  } catch (e: unknown) {
    // If user explicitly enabled demo mode, use demo handlers
    if (isDemoMode()) {
      return handleDemoRequest(path, options) as Promise<T>;
    }
    // Never silently fall back to demo — surface the real error
    const isNetworkError =
      (e instanceof DOMException && e.name === "AbortError") ||
      (e instanceof TypeError && (e.message.includes("fetch") || e.message.includes("Failed")));
    if (isNetworkError) {
      throw new Error("Backend unreachable — check your server connection");
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

// ── MT5 ──
export const api = {
  health: () => request<{
    status: string;
    mt5_connected: boolean;
    has_data: boolean;
    has_strategy: boolean;
    has_env_creds: boolean;
  }>("/api/health"),

  mt5: {
    connect: (login?: number, password?: string, server?: string, mt5Path?: string) =>
      request<{ success: boolean; terminal_build: number; terminal_name: string }>(
        "/api/mt5/connect",
        { method: "POST", body: JSON.stringify({ login, password, server, mt5_path: mt5Path }) }
      ),
    disconnect: () =>
      request("/api/mt5/disconnect", { method: "POST" }),
    account: () =>
      request<{
        login: number; name: string; server: string;
        balance: number; equity: number; margin: number;
        free_margin: number; leverage: number; currency: string; profit: number;
      }>("/api/mt5/account"),
    positions: () =>
      request<Array<{
        ticket: number; symbol: string; type: string; volume: number;
        open_price: number; current_price: number; profit: number;
        stop_loss: number; take_profit: number; open_time: string;
      }>>("/api/mt5/positions"),
    symbols: (group?: string) =>
      request<string[]>(`/api/mt5/symbols${group ? `?group=${group}` : ""}`),
    price: (symbol: string) =>
      request<{ symbol: string; bid: number; ask: number }>(`/api/mt5/price/${symbol}`),
    trade: (symbol: string, tradeType: string, volume: number, sl?: number, tp?: number) =>
      request("/api/mt5/trade", {
        method: "POST",
        body: JSON.stringify({ symbol, trade_type: tradeType, volume, stop_loss: sl, take_profit: tp }),
      }),
    close: (ticket: number) =>
      request(`/api/mt5/close/${ticket}`, { method: "POST" }),
  },

  data: {
    fetch: (symbol: string, timeframe: string, bars: number) =>
      request<{ candles: Record<string, unknown>[]; count: number; columns: string[] }>(
        "/api/data/fetch",
        { method: "POST", body: JSON.stringify({ symbol, timeframe, bars }) }
      ),
    demo: () =>
      request<{ candles: Record<string, unknown>[]; count: number; columns: string[] }>(
        "/api/data/demo",
        { method: "POST" }
      ),
    history: (days: number) =>
      request<Record<string, unknown>[]>(`/api/data/history?days=${days}`),
    trades: (symbol?: string, days?: number) =>
      request<Array<{
        position_id: number;
        symbol: string;
        direction: string;
        volume: number;
        entry_price: number;
        entry_time: string;
        exit_price: number | null;
        exit_time: string | null;
        profit: number | null;
        commission: number;
        swap: number;
        net_pnl: number | null;
        closed: boolean;
        comment: string;
      }>>(`/api/data/trades?${new URLSearchParams({
        ...(symbol ? { symbol } : {}),
        ...(days ? { days: String(days) } : {}),
      }).toString()}`),
  },

  strategy: {
    parse: (description: string, symbol: string) =>
      request<{
        name: string;
        rules: Array<{
          name: string; timeframe: string; description: string; direction?: string;
          entry_conditions: Array<{ indicator: string; parameter: string; operator: string; value: number | string; description: string }>;
          exit_conditions: Array<{ indicator: string; parameter: string; operator: string; value: number | string; description: string }>;
          stop_loss_pips: number | null;
          take_profit_pips: number | null;
          stop_loss_atr_multiplier: number | null;
          take_profit_atr_multiplier: number | null;
          min_bars_in_trade: number | null;
          additional_timeframes: string[] | null;
        }>;
        ai_explanation: string;
        symbol: string;
        raw_description: string;
      }>("/api/strategy/parse", {
        method: "POST",
        body: JSON.stringify({ description, symbol }),
      }),
    current: () => request("/api/strategy/current"),
    validate: () =>
      request<{ errors: string[]; warnings: string[]; valid: boolean }>(
        "/api/strategy/validate", { method: "POST" }
      ),
  },

  strategies: {
    list: () =>
      request<Array<{
        id: string; name: string; symbol: string;
        timeframe: string; direction: string;
        entry_conditions: Array<{ indicator: string; parameter: string; operator: string; value: number | string; description: string }>;
        exit_conditions: Array<{ indicator: string; parameter: string; operator: string; value: number | string; description: string }>;
        stop_loss_pips: number | null;
        take_profit_pips: number | null;
        stop_loss_atr_multiplier: number | null;
        take_profit_atr_multiplier: number | null;
        min_bars_in_trade: number | null;
        additional_timeframes: string[] | null;
        rule_count: number; created_at: string; updated_at: string;
      }>>("/api/strategies"),
    get: (id: string) =>
      request<{
        id: string; name: string; symbol: string;
        rules: Array<Record<string, unknown>>;
        raw_description: string; ai_explanation: string;
        created_at: string; updated_at: string;
      }>(`/api/strategies/${id}`),
    save: () =>
      request<{
        id: string; name: string; symbol: string;
        rules: Array<Record<string, unknown>>;
        raw_description: string; ai_explanation: string;
        created_at: string; updated_at: string;
      }>("/api/strategies", { method: "POST" }),
    create: (strategy: { name: string; symbol: string; rules: Array<Record<string, unknown>>; raw_description?: string; ai_explanation?: string }) =>
      request<{
        id: string; name: string; symbol: string;
        rules: Array<Record<string, unknown>>;
        raw_description: string; ai_explanation: string;
        created_at: string; updated_at: string;
      }>("/api/strategies/create", { method: "POST", body: JSON.stringify(strategy) }),
    update: (id: string) =>
      request<{
        id: string; name: string; symbol: string;
        rules: Array<Record<string, unknown>>;
        raw_description: string; ai_explanation: string;
        created_at: string; updated_at: string;
      }>(`/api/strategies/${id}`, { method: "PUT" }),
    delete: (id: string) =>
      request<{ success: boolean }>(`/api/strategies/${id}`, { method: "DELETE" }),
    load: (id: string) =>
      request<{
        id: string; name: string; symbol: string;
        rules: Array<Record<string, unknown>>;
        raw_description: string; ai_explanation: string;
        created_at: string; updated_at: string;
      }>(`/api/strategies/${id}/load`, { method: "POST" }),
  },

  backtest: {
    run: (initialBalance: number, riskPercent: number, strategyId?: string, timeframe?: string, bars?: number) =>
      request<{
        trades: Array<{
          entry_price: number; exit_price: number; entry_time: string;
          exit_time: string; pnl_pips: number; profit: number; exit_reason: string;
        }>;
        stats: {
          total_trades: number; winning_trades: number; losing_trades: number;
          win_rate: number; total_profit: number; profit_factor: number;
          max_drawdown: number; sharpe_ratio: number; avg_win: number;
          avg_loss: number; best_trade: number; worst_trade: number; final_balance: number;
        };
        equity_curve: number[];
        candles: Array<{
          datetime: string; open: number; high: number; low: number; close: number; volume: number;
        }>;
      }>("/api/backtest/run", {
        method: "POST",
        body: JSON.stringify({
          initial_balance: initialBalance,
          risk_percent: riskPercent,
          ...(strategyId ? { strategy_id: strategyId } : {}),
          ...(timeframe ? { timeframe } : {}),
          ...(bars ? { bars } : {}),
        }),
      }),
    explain: () =>
      request<{ explanation: string }>("/api/backtest/explain", { method: "POST" }),
  },

  backtests: {
    list: (strategyId?: string) =>
      request<Array<{
        id: string; strategy_id: string; strategy_name: string; symbol: string;
        initial_balance: number; risk_percent: number;
        stats: Record<string, number>; created_at: string;
      }>>(`/api/backtests${strategyId ? `?strategy_id=${strategyId}` : ""}`),
    get: (id: string) =>
      request<Record<string, unknown>>(`/api/backtests/${id}`),
  },

  analyze: {
    trade: (data: {
      symbol: string; trade_type: string; entry_price: number;
      exit_price: number; profit: number; open_time: string;
      close_time: string; indicators_at_entry: Record<string, number>;
      strategy_id?: string;
    }) =>
      request<{ analysis: string; alignment_score: number }>(
        "/api/analyze/trade",
        { method: "POST", body: JSON.stringify(data) }
      ),
  },

  algo: {
    start: (symbol: string, timeframe: string, volume: number, strategyId?: string) =>
      request<{ success: boolean; message: string; symbol: string }>("/api/algo/start", {
        method: "POST",
        body: JSON.stringify({
          symbol,
          timeframe,
          volume,
          ...(strategyId ? { strategy_id: strategyId } : {}),
        }),
      }),
    stop: (symbol?: string) =>
      request<{ success: boolean; message: string }>(
        `/api/algo/stop${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ""}`,
        { method: "POST" },
      ),
    status: (symbol?: string) =>
      request<{
        running: boolean;
        symbol: string | null;
        timeframe: string;
        strategy_name: string | null;
        strategy_id: string | null;
        volume: number;
        in_position: boolean;
        position_ticket: number | null;
        trades_placed: number;
        signals: Array<{ time: string; action: string; detail: string }>;
        current_price: { bid: number; ask: number; spread: number } | null;
        indicators: Record<string, number | string | null>;
        entry_conditions: Array<{
          description: string; indicator: string; parameter: string;
          operator: string; value: number | string; passed: boolean;
        }>;
        exit_conditions: Array<{
          description: string; indicator: string; parameter: string;
          operator: string; value: number | string; passed: boolean;
        }>;
        last_check: string | null;
        trade_state: {
          ticket: number; entry_price: number;
          sl_price: number | null; tp_price: number | null;
          direction: string; volume: number; entry_time: string;
          bars_since_entry: number; atr_at_entry: number | null;
          sl_atr_mult: number | null; tp_atr_mult: number | null;
        } | null;
        active_rule_index: number;
        ml_confidence: {
          score: number; pass: boolean; threshold: number; model_loaded: boolean;
        } | null;
        instances?: Record<string, {
          running: boolean; symbol: string; timeframe: string;
          strategy_name: string | null; strategy_id: string | null;
          volume: number; in_position: boolean; position_ticket: number | null;
          trades_placed: number; signals: Array<{ time: string; action: string; detail: string }>;
          current_price: { bid: number; ask: number; spread: number } | null;
          indicators: Record<string, number | string | null>;
          entry_conditions: Array<{ description: string; indicator: string; parameter: string; operator: string; value: number | string; passed: boolean }>;
          exit_conditions: Array<{ description: string; indicator: string; parameter: string; operator: string; value: number | string; passed: boolean }>;
          last_check: string | null;
          trade_state: { ticket: number; entry_price: number; sl_price: number | null; tp_price: number | null; direction: string; volume: number; entry_time: string; bars_since_entry: number; atr_at_entry: number | null; sl_atr_mult: number | null; tp_atr_mult: number | null } | null;
          active_rule_index: number;
          ml_confidence: { score: number; pass: boolean; threshold: number; model_loaded: boolean } | null;
        }>;
      }>(`/api/algo/status${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ""}`),
    trades: (strategyId?: string, symbol?: string, limit?: number) =>
      request<Array<{
        id: string;
        strategy_id: string | null;
        strategy_name: string;
        rule_index: number;
        rule_name: string;
        symbol: string;
        timeframe: string;
        direction: string;
        volume: number;
        entry_price: number;
        entry_time: string;
        sl_price: number | null;
        tp_price: number | null;
        sl_atr_mult: number | null;
        tp_atr_mult: number | null;
        atr_at_entry: number | null;
        entry_indicators: Record<string, number | string | null>;
        entry_conditions: Array<{
          description: string; indicator: string; parameter: string;
          operator: string; value: number | string; passed: boolean;
        }>;
        exit_price: number | null;
        exit_time: string | null;
        exit_indicators: Record<string, number | string | null>;
        exit_reason: string | null;
        bars_held: number | null;
        profit: number | null;
        commission: number | null;
        swap: number | null;
        net_pnl: number | null;
        mt5_ticket: number | null;
        ml_confidence: number | null;
        status: string;
        created_at: string;
        updated_at: string;
      }>>(`/api/algo/trades?${new URLSearchParams({
        ...(strategyId ? { strategy_id: strategyId } : {}),
        ...(symbol ? { symbol } : {}),
        ...(limit ? { limit: String(limit) } : {}),
      }).toString()}`),
    tradeStats: (strategyId?: string, symbol?: string) =>
      request<{
        total_trades: number;
        winning_trades: number;
        losing_trades: number;
        win_rate: number;
        total_pnl: number;
        avg_pnl: number;
        avg_bars_held: number;
        best_trade: number;
        worst_trade: number;
        exit_reasons: Record<string, number>;
      }>(`/api/algo/trades/stats?${new URLSearchParams({
        ...(strategyId ? { strategy_id: strategyId } : {}),
        ...(symbol ? { symbol } : {}),
      }).toString()}`),
  },

  tutor: {
    lesson: (topic: string, level: string, instruments: string[]) =>
      request<{ lesson: string }>("/api/tutor/lesson", {
        method: "POST",
        body: JSON.stringify({ topic, level, instruments }),
      }),
  },

  ml: {
    status: () =>
      request<{
        model_exists: boolean; model_loaded: boolean; model_path: string;
        threshold: number; feature_count: number; features: string[];
        model_file_size_kb?: number; model_trained_at?: string;
      }>("/api/ml/status"),
    train: () =>
      request<{
        success: boolean; error?: string; model_type?: string;
        total_samples?: number; backtest_samples?: number;
        stored_backtest_samples?: number; live_samples?: number;
        train_size?: number; test_size?: number; win_rate_in_data?: number;
        accuracy?: number; precision?: number; recall?: number; f1_score?: number;
        feature_importance?: Record<string, number>; trained_at?: string;
      }>("/api/ml/train", { method: "POST" }, 120000),
    reload: () =>
      request<Record<string, unknown>>("/api/ml/reload", { method: "POST" }),
    setThreshold: (threshold: number) =>
      request<{ threshold: number }>("/api/ml/threshold", {
        method: "POST",
        body: JSON.stringify({ threshold }),
      }),
  },
};
