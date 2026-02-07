const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://13.48.148.223:8008";

async function request<T>(path: string, options?: RequestInit, timeoutMs = 30000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      ...options,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || "Request failed");
    }
    return res.json();
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error("Request timed out — check if the backend is reachable");
    }
    if (e instanceof TypeError && (e.message.includes("fetch") || e.message.includes("Failed"))) {
      throw new Error("Cannot reach backend — check if the server is running and the port is open");
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
  }>("/api/health"),

  mt5: {
    connect: (login: number, password: string, server: string, mt5Path?: string) =>
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
  },

  strategy: {
    parse: (description: string, symbol: string) =>
      request<{
        name: string;
        rules: Array<{
          name: string; timeframe: string; description: string;
          entry_conditions: Array<{ indicator: string; parameter: string; operator: string; value: number | string; description: string }>;
          exit_conditions: Array<{ indicator: string; parameter: string; operator: string; value: number | string; description: string }>;
          stop_loss_pips: number | null;
          take_profit_pips: number | null;
        }>;
        ai_explanation: string;
        symbol: string;
        raw_description: string;
      }>("/api/strategy/parse", {
        method: "POST",
        body: JSON.stringify({ description, symbol }),
      }),
    current: () => request("/api/strategy/current"),
  },

  strategies: {
    list: () =>
      request<Array<{
        id: string; name: string; symbol: string;
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
    run: (initialBalance: number, riskPercent: number, strategyId?: string) =>
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
      }>("/api/backtest/run", {
        method: "POST",
        body: JSON.stringify({
          initial_balance: initialBalance,
          risk_percent: riskPercent,
          ...(strategyId ? { strategy_id: strategyId } : {}),
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
    }) =>
      request<{ analysis: string; alignment_score: number }>(
        "/api/analyze/trade",
        { method: "POST", body: JSON.stringify(data) }
      ),
  },

  tutor: {
    lesson: (topic: string, level: string, instruments: string[]) =>
      request<{ lesson: string }>("/api/tutor/lesson", {
        method: "POST",
        body: JSON.stringify({ topic, level, instruments }),
      }),
  },
};
