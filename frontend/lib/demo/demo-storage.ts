/**
 * localStorage-based CRUD for demo mode.
 * Strategies and backtests persist across page refreshes.
 */

import { DEMO_STRATEGIES, generateBacktestResult, type DemoStrategy } from "./demo-data";

const STRATEGIES_KEY = "masst_demo_strategies";
const BACKTESTS_KEY = "masst_demo_backtests";
const CURRENT_KEY = "masst_demo_current_strategy";
const SEEDED_KEY = "masst_demo_seeded";

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

function uuid(): string {
  return "demo-" + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

// ── Auto-seed ────────────────────────────────────────────────

function ensureSeeded(): void {
  if (typeof window === "undefined") return;
  if (localStorage.getItem(SEEDED_KEY)) return;
  write(STRATEGIES_KEY, DEMO_STRATEGIES);
  localStorage.setItem(SEEDED_KEY, "true");
}

// ── Strategies ───────────────────────────────────────────────

function strategySummary(s: DemoStrategy) {
  const first = s.rules[0];
  return {
    id: s.id,
    name: s.name,
    symbol: s.symbol,
    timeframe: first?.timeframe ?? "H1",
    direction: first?.direction ?? "buy",
    entry_conditions: first?.entry_conditions ?? [],
    exit_conditions: first?.exit_conditions ?? [],
    stop_loss_pips: first?.stop_loss_pips ?? null,
    take_profit_pips: first?.take_profit_pips ?? null,
    stop_loss_atr_multiplier: first?.stop_loss_atr_multiplier ?? null,
    take_profit_atr_multiplier: first?.take_profit_atr_multiplier ?? null,
    min_bars_in_trade: first?.min_bars_in_trade ?? null,
    additional_timeframes: first?.additional_timeframes ?? null,
    rule_count: s.rules.length,
    created_at: s.created_at,
    updated_at: s.updated_at,
  };
}

export const demoStorage = {
  // ── Strategies ───────────────────────────────────

  listStrategies() {
    ensureSeeded();
    const all = read<DemoStrategy[]>(STRATEGIES_KEY, []);
    return all.map(strategySummary);
  },

  getStrategy(id: string) {
    ensureSeeded();
    const all = read<DemoStrategy[]>(STRATEGIES_KEY, []);
    const found = all.find(s => s.id === id);
    if (!found) throw new Error("Strategy not found");
    return found;
  },

  createStrategy(data: Record<string, unknown>) {
    ensureSeeded();
    const now = new Date().toISOString();
    const strategy: DemoStrategy = {
      id: uuid(),
      name: (data.name as string) || "Untitled Strategy",
      symbol: (data.symbol as string) || "EURUSDm",
      rules: (data.rules as DemoStrategy["rules"]) || [],
      raw_description: (data.raw_description as string) || "",
      ai_explanation: (data.ai_explanation as string) || "",
      created_at: now,
      updated_at: now,
    };
    const all = read<DemoStrategy[]>(STRATEGIES_KEY, []);
    all.unshift(strategy);
    write(STRATEGIES_KEY, all);
    return strategy;
  },

  saveCurrentStrategy() {
    const current = this.getCurrentStrategy();
    if (!current) throw new Error("No current strategy to save");
    if (current.id) {
      return this.updateStrategy(current.id, current as unknown as Record<string, unknown>);
    }
    return this.createStrategy(current as unknown as Record<string, unknown>);
  },

  updateStrategy(id: string, updates: Record<string, unknown>) {
    ensureSeeded();
    const all = read<DemoStrategy[]>(STRATEGIES_KEY, []);
    const idx = all.findIndex(s => s.id === id);
    if (idx < 0) throw new Error("Strategy not found");
    const now = new Date().toISOString();
    // Merge current strategy data if it exists (for PUT /api/strategies/:id)
    const current = this.getCurrentStrategy();
    const merged = {
      ...all[idx],
      ...(current && current.name ? current : {}),
      ...updates,
      id,
      updated_at: now,
    } as DemoStrategy;
    all[idx] = merged;
    write(STRATEGIES_KEY, all);
    return merged;
  },

  deleteStrategy(id: string) {
    ensureSeeded();
    const all = read<DemoStrategy[]>(STRATEGIES_KEY, []);
    write(STRATEGIES_KEY, all.filter(s => s.id !== id));
    return { success: true };
  },

  loadStrategy(id: string) {
    const strategy = this.getStrategy(id);
    write(CURRENT_KEY, strategy);
    return strategy;
  },

  setCurrentStrategy(strategy: unknown) {
    write(CURRENT_KEY, strategy);
  },

  getCurrentStrategy(): DemoStrategy | null {
    return read<DemoStrategy | null>(CURRENT_KEY, null);
  },

  // ── Backtests ────────────────────────────────────

  listBacktests(strategyId?: string) {
    const all = read<Array<Record<string, unknown>>>(BACKTESTS_KEY, []);
    const filtered = strategyId
      ? all.filter(b => b.strategy_id === strategyId)
      : all;
    return filtered.map(b => ({
      id: b.id as string,
      strategy_id: b.strategy_id as string,
      strategy_name: b.strategy_name as string,
      symbol: b.symbol as string,
      initial_balance: b.initial_balance as number,
      risk_percent: b.risk_percent as number,
      stats: b.stats as Record<string, number>,
      created_at: b.created_at as string,
    }));
  },

  getBacktest(id: string) {
    const all = read<Array<Record<string, unknown>>>(BACKTESTS_KEY, []);
    const found = all.find(b => b.id === id);
    if (!found) throw new Error("Backtest not found");
    return found;
  },

  saveBacktest(strategyId: string, strategyName: string, symbol: string, initialBalance: number, riskPercent: number, result: Record<string, unknown>) {
    const now = new Date().toISOString();
    const backtest = {
      id: uuid(),
      strategy_id: strategyId,
      strategy_name: strategyName,
      symbol,
      initial_balance: initialBalance,
      risk_percent: riskPercent,
      ...result,
      created_at: now,
    };
    const all = read<Array<Record<string, unknown>>>(BACKTESTS_KEY, []);
    all.unshift(backtest);
    write(BACKTESTS_KEY, all);
    return backtest;
  },
};
