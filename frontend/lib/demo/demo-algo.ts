/**
 * Algo trading simulation state machine for demo mode.
 * Lifecycle: idle → checking → entering → in_position → exiting → checking (repeat)
 */

import { tickPrice, getCurrentPrice, demoAccount, DEMO_STRATEGIES } from "./demo-data";
import { demoStorage } from "./demo-storage";

interface Signal {
  time: string;
  action: string;
  detail: string;
}

interface AlgoTrade {
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
  status: string;
  created_at: string;
  updated_at: string;
}

interface ConditionState {
  description: string;
  indicator: string;
  parameter: string;
  operator: string;
  value: number | string;
  passed: boolean;
}

type Phase = "idle" | "checking" | "in_position";

interface AlgoState {
  running: boolean;
  symbol: string;
  timeframe: string;
  strategyName: string;
  strategyId: string | null;
  volume: number;
  phase: Phase;
  tickCount: number;
  entryTick: number;
  tradesPlaced: number;
  direction: "buy" | "sell";
  entryPrice: number;
  positionTicket: number;
  slPrice: number | null;
  tpPrice: number | null;
  atrAtEntry: number;
  barsHeld: number;
  signals: Signal[];
  completedTrades: AlgoTrade[];
  // How many ticks until entry (randomized)
  entryAt: number;
  // How many ticks until exit (randomized)
  exitAt: number;
  // Condition templates
  entryConditions: ConditionState[];
  exitConditions: ConditionState[];
  lastAdvancedAt: number;
}

let state: AlgoState | null = null;

function uuid(): string {
  return "at-" + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

function isBig(symbol: string): boolean {
  return symbol.includes("BTC") || symbol.includes("XAU") || symbol.includes("ETH")
    || symbol.includes("US30") || symbol.includes("JPY");
}

function getStrategy(strategyId?: string) {
  if (strategyId) {
    try {
      return demoStorage.getStrategy(strategyId);
    } catch { /* fallthrough */ }
  }
  return DEMO_STRATEGIES[0];
}

export const demoAlgo = {
  isRunning(): boolean {
    return state?.running === true;
  },

  start(params: Record<string, unknown>): { success: boolean; message: string } {
    const symbol = (params.symbol as string) || "EURUSDm";
    const timeframe = (params.timeframe as string) || "5m";
    const volume = (params.volume as number) || 0.01;
    const strategyId = params.strategy_id as string | undefined;

    const strategy = getStrategy(strategyId);
    const rule = strategy.rules[0];

    // Build condition templates from strategy
    const entryConditions: ConditionState[] = (rule?.entry_conditions || []).map(c => ({
      ...c, description: c.description || `${c.indicator} ${c.operator} ${c.value}`, passed: false,
    }));
    const exitConditions: ConditionState[] = (rule?.exit_conditions || []).map(c => ({
      ...c, description: c.description || `${c.indicator} ${c.operator} ${c.value}`, passed: false,
    }));

    state = {
      running: true,
      symbol,
      timeframe,
      strategyName: strategy.name,
      strategyId: strategy.id || null,
      volume,
      phase: "checking",
      tickCount: 0,
      entryTick: 0,
      tradesPlaced: 0,
      direction: (rule?.direction as "buy" | "sell") || "buy",
      entryPrice: 0,
      positionTicket: 0,
      slPrice: null,
      tpPrice: null,
      atrAtEntry: 0,
      barsHeld: 0,
      signals: [{ time: new Date().toISOString(), action: "info", detail: `Algo started on ${symbol} ${timeframe}` }],
      completedTrades: [],
      entryAt: 6 + Math.floor(Math.random() * 6),
      exitAt: 0,
      entryConditions,
      exitConditions,
      lastAdvancedAt: 0,
    };

    return { success: true, message: `Demo algo started on ${symbol}` };
  },

  stop(): { success: boolean; message: string } {
    if (!state) return { success: true, message: "Algo not running" };

    // If in position, close it
    if (state.phase === "in_position") {
      const price = getCurrentPrice(state.symbol);
      const exitPrice = state.direction === "buy" ? price.bid : price.ask;
      const pnl = state.direction === "buy"
        ? (exitPrice - state.entryPrice) * 100000 * state.volume
        : (state.entryPrice - exitPrice) * 100000 * state.volume;

      state.completedTrades.push({
        id: uuid(),
        strategy_id: state.strategyId,
        strategy_name: state.strategyName,
        rule_index: 0,
        rule_name: state.entryConditions.length > 0 ? "Rule 1" : "",
        symbol: state.symbol,
        timeframe: state.timeframe,
        direction: state.direction,
        volume: state.volume,
        entry_price: state.entryPrice,
        entry_time: new Date(Date.now() - state.barsHeld * 60000).toISOString(),
        sl_price: state.slPrice,
        tp_price: state.tpPrice,
        sl_atr_mult: 1.5,
        tp_atr_mult: 3.0,
        atr_at_entry: state.atrAtEntry,
        entry_indicators: { RSI_14: 42, EMA_50: state.entryPrice * 0.999, MACD_histogram: 0.0002 },
        entry_conditions: state.entryConditions,
        exit_price: exitPrice,
        exit_time: new Date().toISOString(),
        exit_indicators: { RSI_14: 55, EMA_50: exitPrice * 1.001 },
        exit_reason: "algo_stopped",
        bars_held: state.barsHeld,
        profit: Math.round(pnl * 100) / 100,
        commission: -0.07,
        swap: 0,
        net_pnl: Math.round((pnl - 0.07) * 100) / 100,
        mt5_ticket: state.positionTicket,
        status: "closed",
        created_at: new Date(Date.now() - state.barsHeld * 60000).toISOString(),
        updated_at: new Date().toISOString(),
      });
      state.tradesPlaced++;

      state.signals.push({
        time: new Date().toISOString(),
        action: "closed",
        detail: `Algo stopped — closed ${state.direction} at ${exitPrice.toFixed(isBig(state.symbol) ? 2 : 5)} | P&L: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`,
      });
    }

    state.signals.push({ time: new Date().toISOString(), action: "info", detail: "Algo stopped" });
    state.running = false;
    return { success: true, message: "Demo algo stopped" };
  },

  status() {
    if (!state || !state.running) {
      return {
        running: false,
        symbol: null,
        timeframe: "5m",
        strategy_name: null,
        strategy_id: null,
        volume: 0,
        in_position: false,
        position_ticket: null,
        trades_placed: 0,
        signals: [],
        current_price: null,
        indicators: {},
        entry_conditions: [],
        exit_conditions: [],
        last_check: null,
        trade_state: null,
        active_rule_index: 0,
      };
    }

    // Dedup: don't advance more than once per 800ms
    const now = Date.now();
    if (now - state.lastAdvancedAt > 800) {
      state.lastAdvancedAt = now;
      this._advance();
    }

    const price = getCurrentPrice(state.symbol);
    const dec = isBig(state.symbol) ? 2 : 5;

    // Build indicators
    const rsi = 30 + Math.random() * 40;
    const ema50 = price.bid * (1 + (Math.random() - 0.5) * 0.002);
    const macdHist = (Math.random() - 0.5) * 0.001;

    return {
      running: true,
      symbol: state.symbol,
      timeframe: state.timeframe,
      strategy_name: state.strategyName,
      strategy_id: state.strategyId,
      volume: state.volume,
      in_position: state.phase === "in_position",
      position_ticket: state.phase === "in_position" ? state.positionTicket : null,
      trades_placed: state.tradesPlaced,
      signals: state.signals.slice(-50),
      current_price: { bid: price.bid, ask: price.ask, spread: Math.round((price.ask - price.bid) * 100000) / 100000 },
      indicators: {
        RSI_14: Math.round(rsi * 100) / 100,
        EMA_50: Math.round(ema50 * Math.pow(10, dec)) / Math.pow(10, dec),
        SMA_20: Math.round(ema50 * 1.0005 * Math.pow(10, dec)) / Math.pow(10, dec),
        MACD_histogram: Math.round(macdHist * 10000) / 10000,
        ATR_14: Math.round(price.bid * 0.003 * Math.pow(10, dec)) / Math.pow(10, dec),
        close: Math.round(price.bid * Math.pow(10, dec)) / Math.pow(10, dec),
      },
      entry_conditions: state.entryConditions,
      exit_conditions: state.exitConditions,
      last_check: new Date().toISOString(),
      trade_state: state.phase === "in_position" ? {
        ticket: state.positionTicket,
        entry_price: state.entryPrice,
        sl_price: state.slPrice,
        tp_price: state.tpPrice,
        direction: state.direction,
        volume: state.volume,
        entry_time: new Date(Date.now() - state.barsHeld * 60000).toISOString(),
        bars_since_entry: state.barsHeld,
        atr_at_entry: state.atrAtEntry,
        sl_atr_mult: 1.5,
        tp_atr_mult: 3.0,
      } : null,
      active_rule_index: 0,
    };
  },

  _advance() {
    if (!state || !state.running) return;

    // Tick the price
    tickPrice(state.symbol);
    state.tickCount++;

    const price = getCurrentPrice(state.symbol);
    const dec = isBig(state.symbol) ? 2 : 5;

    if (state.phase === "checking") {
      // Gradually turn entry conditions green
      const progress = state.tickCount / state.entryAt;
      for (let i = 0; i < state.entryConditions.length; i++) {
        const threshold = (i + 1) / state.entryConditions.length;
        state.entryConditions[i].passed = progress >= threshold;
      }

      // Check and log
      if (state.tickCount % 3 === 0) {
        const passing = state.entryConditions.filter(c => c.passed).length;
        const total = state.entryConditions.length;
        state.signals.push({
          time: new Date().toISOString(),
          action: "check",
          detail: `Entry: ${passing}/${total} conditions met | price ${price.bid.toFixed(dec)}`,
        });
      }

      // All conditions met → enter
      if (state.tickCount >= state.entryAt) {
        const entryPrice = state.direction === "buy" ? price.ask : price.bid;
        const atr = entryPrice * 0.003;
        const slDist = atr * 1.5;
        const tpDist = atr * 3.0;

        state.entryPrice = entryPrice;
        state.atrAtEntry = Math.round(atr * Math.pow(10, dec)) / Math.pow(10, dec);
        state.positionTicket = 100000 + Math.floor(Math.random() * 900000);
        state.slPrice = state.direction === "buy"
          ? Math.round((entryPrice - slDist) * Math.pow(10, dec)) / Math.pow(10, dec)
          : Math.round((entryPrice + slDist) * Math.pow(10, dec)) / Math.pow(10, dec);
        state.tpPrice = state.direction === "buy"
          ? Math.round((entryPrice + tpDist) * Math.pow(10, dec)) / Math.pow(10, dec)
          : Math.round((entryPrice - tpDist) * Math.pow(10, dec)) / Math.pow(10, dec);
        state.barsHeld = 0;
        state.entryTick = state.tickCount;
        state.phase = "in_position";
        state.exitAt = state.tickCount + 15 + Math.floor(Math.random() * 20);

        // Reset exit conditions
        for (const c of state.exitConditions) c.passed = false;

        // All entry conditions should be passed
        for (const c of state.entryConditions) c.passed = true;

        state.signals.push({
          time: new Date().toISOString(),
          action: state.direction,
          detail: `Opened ${state.direction.toUpperCase()} ${state.volume} at ${entryPrice.toFixed(dec)} | SL: ${state.slPrice!.toFixed(dec)} | TP: ${state.tpPrice!.toFixed(dec)}`,
        });
      }
    } else if (state.phase === "in_position") {
      state.barsHeld++;

      // Simulate P/L
      const currentBid = price.bid;
      const unrealizedPnl = state.direction === "buy"
        ? (currentBid - state.entryPrice) * 100000 * state.volume
        : (state.entryPrice - currentBid) * 100000 * state.volume;

      // Toggle exit conditions toward passing as we approach exitAt
      const exitProgress = (state.tickCount - state.entryTick) / (state.exitAt - state.entryTick);
      for (let i = 0; i < state.exitConditions.length; i++) {
        const threshold = (i + 1) / state.exitConditions.length;
        state.exitConditions[i].passed = exitProgress >= threshold * 0.9;
      }

      // Check for exit
      const shouldExit = state.tickCount >= state.exitAt;
      let exitReason = "strategy_exit";

      // Check SL/TP
      if (state.slPrice != null && state.direction === "buy" && currentBid <= state.slPrice) {
        exitReason = "stop_loss";
      } else if (state.slPrice != null && state.direction === "sell" && currentBid >= state.slPrice) {
        exitReason = "stop_loss";
      } else if (state.tpPrice != null && state.direction === "buy" && currentBid >= state.tpPrice) {
        exitReason = "take_profit";
      } else if (state.tpPrice != null && state.direction === "sell" && currentBid <= state.tpPrice) {
        exitReason = "take_profit";
      }

      const hitSlTp = exitReason !== "strategy_exit";

      if (shouldExit || hitSlTp) {
        const exitPrice = state.direction === "buy" ? price.bid : price.ask;
        const pnl = state.direction === "buy"
          ? (exitPrice - state.entryPrice) * 100000 * state.volume
          : (state.entryPrice - exitPrice) * 100000 * state.volume;

        // Mark all exit conditions as passed
        for (const c of state.exitConditions) c.passed = true;

        state.completedTrades.push({
          id: uuid(),
          strategy_id: state.strategyId,
          strategy_name: state.strategyName,
          rule_index: 0,
          rule_name: state.entryConditions.length > 0 ? "Rule 1" : "",
          symbol: state.symbol,
          timeframe: state.timeframe,
          direction: state.direction,
          volume: state.volume,
          entry_price: state.entryPrice,
          entry_time: new Date(Date.now() - state.barsHeld * 60000).toISOString(),
          sl_price: state.slPrice,
          tp_price: state.tpPrice,
          sl_atr_mult: 1.5,
          tp_atr_mult: 3.0,
          atr_at_entry: state.atrAtEntry,
          entry_indicators: {
            RSI_14: 28 + Math.random() * 5,
            EMA_50: state.entryPrice * (1 + (Math.random() - 0.5) * 0.001),
            MACD_histogram: (Math.random() - 0.3) * 0.001,
          },
          entry_conditions: state.entryConditions.map(c => ({ ...c, passed: true })),
          exit_price: exitPrice,
          exit_time: new Date().toISOString(),
          exit_indicators: {
            RSI_14: 60 + Math.random() * 15,
            EMA_50: exitPrice * (1 + (Math.random() - 0.5) * 0.001),
          },
          exit_reason: exitReason,
          bars_held: state.barsHeld,
          profit: Math.round(pnl * 100) / 100,
          commission: -0.07,
          swap: 0,
          net_pnl: Math.round((pnl - 0.07) * 100) / 100,
          mt5_ticket: state.positionTicket,
          status: "closed",
          created_at: new Date(Date.now() - state.barsHeld * 60000).toISOString(),
          updated_at: new Date().toISOString(),
        });

        state.tradesPlaced++;

        const reasonLabel = exitReason === "stop_loss" ? "SL hit" : exitReason === "take_profit" ? "TP hit" : "exit signal";
        state.signals.push({
          time: new Date().toISOString(),
          action: "closed",
          detail: `Closed ${state.direction.toUpperCase()} at ${exitPrice.toFixed(dec)} | ${reasonLabel} | P&L: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} | ${state.barsHeld} bars`,
        });

        // Reset for next cycle
        state.phase = "checking";
        state.tickCount = 0;
        state.entryAt = 6 + Math.floor(Math.random() * 6);
        state.entryTick = 0;
        // Reset conditions
        for (const c of state.entryConditions) c.passed = false;
        for (const c of state.exitConditions) c.passed = false;
        // Flip direction occasionally
        if (Math.random() > 0.6) {
          state.direction = state.direction === "buy" ? "sell" : "buy";
        }
      } else if (state.tickCount % 2 === 0) {
        // Log status
        state.signals.push({
          time: new Date().toISOString(),
          action: "check",
          detail: `In position: ${state.barsHeld} bars | P&L: ${unrealizedPnl >= 0 ? "+" : ""}$${unrealizedPnl.toFixed(2)} | price ${currentBid.toFixed(dec)}`,
        });
      }
    }

    // Keep signals trimmed
    if (state.signals.length > 50) {
      state.signals = state.signals.slice(-50);
    }
  },

  getTrades(): AlgoTrade[] {
    return state?.completedTrades ?? [];
  },

  getTradeStats() {
    const trades = state?.completedTrades ?? [];
    const closed = trades.filter(t => t.status === "closed" && t.net_pnl != null);
    if (closed.length === 0) {
      return {
        total_trades: 0, winning_trades: 0, losing_trades: 0,
        win_rate: 0, total_pnl: 0, avg_pnl: 0,
        avg_bars_held: 0, best_trade: 0, worst_trade: 0,
        exit_reasons: {},
      };
    }

    const wins = closed.filter(t => t.net_pnl! > 0);
    const pnls = closed.map(t => t.net_pnl!);
    const bars = closed.filter(t => t.bars_held != null).map(t => t.bars_held!);
    const reasons: Record<string, number> = {};
    for (const t of closed) {
      const r = t.exit_reason || "unknown";
      reasons[r] = (reasons[r] || 0) + 1;
    }

    return {
      total_trades: closed.length,
      winning_trades: wins.length,
      losing_trades: closed.length - wins.length,
      win_rate: Math.round((wins.length / closed.length) * 1000) / 10,
      total_pnl: Math.round(pnls.reduce((s, v) => s + v, 0) * 100) / 100,
      avg_pnl: Math.round((pnls.reduce((s, v) => s + v, 0) / pnls.length) * 100) / 100,
      avg_bars_held: bars.length > 0 ? Math.round((bars.reduce((s, v) => s + v, 0) / bars.length) * 10) / 10 : 0,
      best_trade: Math.round(Math.max(...pnls) * 100) / 100,
      worst_trade: Math.round(Math.min(...pnls) * 100) / 100,
      exit_reasons: reasons,
    };
  },
};
