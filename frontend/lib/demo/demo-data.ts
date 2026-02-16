/**
 * Mock data generators for demo mode.
 * All data is generated in-browser — no backend needed.
 */

// ── Symbol base prices ──────────────────────────────────────

const BASE_PRICES: Record<string, number> = {
  EURUSDm: 1.085,    GBPUSDm: 1.272,    USDJPYm: 149.5,
  AUDUSDm: 0.658,    USDCADm: 1.352,    USDCHFm: 0.875,
  NZDUSDm: 0.612,    EURGBPm: 0.853,    XAUUSDm: 2345.0,
  XAGUSDm: 28.5,     BTCUSDm: 97500.0,  ETHUSDm: 2650.0,
  US30m:   39500.0,   US500m:  5200.0,   USTECm:  18200.0,
  // Non-micro variants
  EURUSD: 1.085,     GBPUSD: 1.272,     BTCUSD: 97500.0,
  XAUUSD: 2345.0,
};

function getBasePrice(symbol: string): number {
  return BASE_PRICES[symbol] ?? 1.1;
}

function isBigSymbol(symbol: string): boolean {
  return symbol.includes("BTC") || symbol.includes("XAU") || symbol.includes("XAG")
    || symbol.includes("US30") || symbol.includes("US500") || symbol.includes("USTEC")
    || symbol.includes("JPY") || symbol.includes("ETH");
}

function getPipSize(symbol: string): number {
  if (symbol.includes("BTC")) return 10;
  if (symbol.includes("ETH")) return 1;
  if (symbol.includes("XAU")) return 0.1;
  if (symbol.includes("XAG")) return 0.01;
  if (symbol.includes("US30") || symbol.includes("US500") || symbol.includes("USTEC")) return 1;
  if (symbol.includes("JPY")) return 0.01;
  return 0.00001;
}

function getSpreadPips(symbol: string): number {
  if (symbol.includes("BTC")) return 50;
  if (symbol.includes("ETH")) return 5;
  if (symbol.includes("XAU")) return 0.3;
  if (symbol.includes("XAG")) return 0.03;
  if (symbol.includes("US30") || symbol.includes("US500") || symbol.includes("USTEC")) return 3;
  if (symbol.includes("JPY")) return 0.03;
  return 0.00015;
}

// ── Price simulation (module-level mutable state) ────────────

const currentPrices: Record<string, { bid: number; ask: number }> = {};

function ensurePrice(symbol: string): { bid: number; ask: number } {
  if (!currentPrices[symbol]) {
    const base = getBasePrice(symbol);
    const spread = getSpreadPips(symbol);
    currentPrices[symbol] = { bid: base, ask: base + spread };
  }
  return currentPrices[symbol];
}

export function tickPrice(symbol: string): { symbol: string; bid: number; ask: number } {
  const p = ensurePrice(symbol);
  const pip = getPipSize(symbol);
  const delta = (Math.random() - 0.5) * pip * 3;
  // Mean reversion: pull gently toward base
  const base = getBasePrice(symbol);
  const reversion = (base - p.bid) * 0.002;
  p.bid = p.bid + delta + reversion;
  p.ask = p.bid + getSpreadPips(symbol);
  return { symbol, bid: p.bid, ask: p.ask };
}

export function getCurrentPrice(symbol: string): { bid: number; ask: number } {
  return ensurePrice(symbol);
}

// ── Candle generation ────────────────────────────────────────

const TF_SECONDS: Record<string, number> = {
  "1m": 60, "5m": 300, "15m": 900, "30m": 1800,
  "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800,
  M1: 60, M5: 300, M15: 900, M30: 1800,
  H1: 3600, H4: 14400, D1: 86400, W1: 604800,
};

export function generateCandles(
  symbol: string,
  timeframe: string,
  count: number
): Array<Record<string, unknown>> {
  const tfSec = TF_SECONDS[timeframe] || 3600;
  const pip = getPipSize(symbol);
  const volatility = pip * 15;
  const now = Math.floor(Date.now() / 1000);
  // End 1 minute ago to leave room for live ticks
  const endTime = now - 60;
  const startTime = endTime - (count - 1) * tfSec;

  let price = getBasePrice(symbol);
  // Random starting offset
  price += (Math.random() - 0.5) * volatility * 20;

  const candles: Array<Record<string, unknown>> = [];
  const closes: number[] = [];

  for (let i = 0; i < count; i++) {
    const time = startTime + i * tfSec;
    const dt = new Date(time * 1000).toISOString();

    const open = price;
    const move = (Math.random() - 0.5) * volatility * 2;
    const close = open + move;
    const high = Math.max(open, close) + Math.random() * volatility * 0.5;
    const low = Math.min(open, close) - Math.random() * volatility * 0.5;
    const volume = 500 + Math.floor(Math.random() * 4500);

    closes.push(close);

    // Simple indicator calculations
    const rsi = computeRSI(closes, 14);
    const ema50 = computeEMA(closes, 50);
    const sma20 = computeSMA(closes, 20);
    const ema20 = computeEMA(closes, 20);
    const atr = volatility * (0.8 + Math.random() * 0.4);
    const bbMid = sma20;
    const bbStd = computeStdDev(closes, 20);
    const bbUpper = bbMid + 2 * bbStd;
    const bbLower = bbMid - 2 * bbStd;

    candles.push({
      datetime: dt,
      time: dt,
      open: round(open, symbol),
      high: round(high, symbol),
      low: round(low, symbol),
      close: round(close, symbol),
      volume,
      // Indicators
      RSI_14: round(rsi, symbol, 2),
      EMA_50: round(ema50, symbol),
      EMA_20: round(ema20, symbol),
      SMA_20: round(sma20, symbol),
      ATR_14: round(atr, symbol),
      BB_upper: round(bbUpper, symbol),
      BB_middle: round(bbMid, symbol),
      BB_lower: round(bbLower, symbol),
      MACD_line: round((ema20 - ema50) * 1000, symbol, 4),
      MACD_signal: round((ema20 - ema50) * 800, symbol, 4),
      MACD_histogram: round((ema20 - ema50) * 200, symbol, 4),
    });

    price = close;
  }

  // Update current price to match last candle
  const lastClose = candles[candles.length - 1].close as number;
  const spread = getSpreadPips(symbol);
  currentPrices[symbol] = { bid: lastClose, ask: lastClose + spread };

  return candles;
}

function round(v: number, symbol: string, forceDec?: number): number {
  const dec = forceDec ?? (isBigSymbol(symbol) ? 2 : 5);
  return Math.round(v * Math.pow(10, dec)) / Math.pow(10, dec);
}

function computeRSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50;
  const slice = closes.slice(-period - 1);
  let gains = 0, losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i] - slice[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  if (losses === 0) return 95;
  const rs = (gains / period) / (losses / period);
  return Math.round((100 - 100 / (1 + rs)) * 100) / 100;
}

function computeEMA(closes: number[], period: number): number {
  if (closes.length === 0) return 0;
  if (closes.length < period) return closes[closes.length - 1];
  const k = 2 / (period + 1);
  let ema = closes[0];
  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

function computeSMA(closes: number[], period: number): number {
  if (closes.length === 0) return 0;
  const slice = closes.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / slice.length;
}

function computeStdDev(closes: number[], period: number): number {
  if (closes.length < 2) return 0;
  const slice = closes.slice(-period);
  const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / slice.length;
  return Math.sqrt(variance);
}

// ── Account & positions ──────────────────────────────────────

export function demoAccount() {
  return {
    login: 88880001,
    name: "Demo Trader",
    server: "MasstTrader-Demo",
    balance: 10000,
    equity: 10000,
    margin: 0,
    free_margin: 10000,
    leverage: 100,
    currency: "USD",
    profit: 0,
  };
}

export function demoPositions(): Array<Record<string, unknown>> {
  return [];
}

export function demoSymbols(): string[] {
  return Object.keys(BASE_PRICES).filter(s => s.endsWith("m"));
}

// ── Demo strategies (pre-built) ──────────────────────────────

export interface DemoCondition {
  indicator: string;
  parameter: string;
  operator: string;
  value: number | string;
  description?: string;
}

export interface DemoStrategyRule {
  name?: string;
  description?: string;
  timeframe: string;
  direction: string;
  entry_conditions: DemoCondition[];
  exit_conditions: DemoCondition[];
  stop_loss_pips: number | null;
  take_profit_pips: number | null;
  stop_loss_atr_multiplier: number | null;
  take_profit_atr_multiplier: number | null;
  min_bars_in_trade: number | null;
  additional_timeframes: string[] | null;
  risk_percent?: number;
}

export interface DemoStrategy {
  id: string;
  name: string;
  symbol: string;
  rules: DemoStrategyRule[];
  raw_description: string;
  ai_explanation: string;
  created_at: string;
  updated_at: string;
}

export const DEMO_STRATEGIES: DemoStrategy[] = [
  {
    id: "demo-rsi-macd",
    name: "RSI + MACD Reversal",
    symbol: "EURUSDm",
    rules: [{
      name: "RSI Oversold + MACD Cross",
      timeframe: "H1",
      direction: "buy",
      description: "Buy when RSI oversold and MACD histogram turns positive",
      entry_conditions: [
        { indicator: "RSI", parameter: "value", operator: "<", value: 30, description: "RSI below 30 (oversold)" },
        { indicator: "MACD", parameter: "histogram", operator: "crosses_above", value: 0, description: "MACD histogram crosses above zero" },
      ],
      exit_conditions: [
        { indicator: "RSI", parameter: "value", operator: ">", value: 70, description: "RSI above 70 (overbought)" },
      ],
      stop_loss_pips: null,
      take_profit_pips: null,
      stop_loss_atr_multiplier: 1.5,
      take_profit_atr_multiplier: 3.0,
      min_bars_in_trade: 3,
      additional_timeframes: null,
      risk_percent: 1.0,
    }],
    raw_description: "Buy when RSI crosses below 30 and MACD histogram turns positive on H1. Exit when RSI goes above 70. Use 1.5x ATR stop loss and 3x ATR take profit.",
    ai_explanation: "This strategy identifies oversold reversals confirmed by MACD momentum shift. It uses ATR-based risk management with a 2:1 reward-to-risk ratio.",
    created_at: "2026-01-15T10:00:00Z",
    updated_at: "2026-02-10T14:30:00Z",
  },
  {
    id: "demo-ema-cross",
    name: "EMA Crossover Trend",
    symbol: "GBPUSDm",
    rules: [{
      name: "EMA 20/50 Crossover",
      timeframe: "H1",
      direction: "buy",
      description: "Buy when fast EMA crosses above slow EMA with ADX confirmation",
      entry_conditions: [
        { indicator: "EMA_20", parameter: "value", operator: "crosses_above", value: "EMA_50", description: "EMA 20 crosses above EMA 50" },
        { indicator: "ADX", parameter: "value", operator: ">", value: 25, description: "ADX above 25 (trending market)" },
      ],
      exit_conditions: [
        { indicator: "EMA_20", parameter: "value", operator: "crosses_below", value: "EMA_50", description: "EMA 20 crosses below EMA 50" },
      ],
      stop_loss_pips: null,
      take_profit_pips: null,
      stop_loss_atr_multiplier: 2.0,
      take_profit_atr_multiplier: 4.0,
      min_bars_in_trade: 5,
      additional_timeframes: null,
      risk_percent: 1.0,
    }],
    raw_description: "Buy when EMA 20 crosses above EMA 50 with ADX above 25. Exit on reverse cross. 2x ATR SL, 4x ATR TP.",
    ai_explanation: "A trend-following strategy using dual EMA crossover with ADX filter to avoid ranging markets.",
    created_at: "2026-01-20T08:00:00Z",
    updated_at: "2026-02-12T16:00:00Z",
  },
  {
    id: "demo-btc-momentum",
    name: "BTC Micro Momentum",
    symbol: "BTCUSDm",
    rules: [{
      name: "RSI Momentum + Price Action",
      timeframe: "M5",
      direction: "buy",
      description: "Buy on RSI momentum with price above EMA 50",
      entry_conditions: [
        { indicator: "RSI", parameter: "value", operator: ">", value: 55, description: "RSI above 55 (bullish momentum)" },
        { indicator: "close", parameter: "value", operator: ">", value: "EMA_50", description: "Price above EMA 50" },
      ],
      exit_conditions: [
        { indicator: "RSI", parameter: "value", operator: "<", value: 45, description: "RSI below 45 (momentum fading)" },
      ],
      stop_loss_pips: null,
      take_profit_pips: null,
      stop_loss_atr_multiplier: 1.5,
      take_profit_atr_multiplier: 3.75,
      min_bars_in_trade: 5,
      additional_timeframes: ["H1"],
      risk_percent: 0.5,
    }],
    raw_description: "Buy BTC when RSI > 55 and price above EMA 50 on 5m chart. Exit when RSI < 45. 1.5x ATR SL, 2.5:1 reward-to-risk.",
    ai_explanation: "A scalping strategy for BTC using RSI momentum confirmed by price position relative to the 50 EMA.",
    created_at: "2026-02-01T12:00:00Z",
    updated_at: "2026-02-14T09:00:00Z",
  },
];

// ── Strategy parse mock ──────────────────────────────────────

export function mockStrategyParse(description: string, symbol: string) {
  const desc = description.toLowerCase();
  const dir = desc.includes("sell") || desc.includes("short") ? "sell" : "buy";
  const tf = desc.includes("5m") || desc.includes("5 min") ? "M5"
    : desc.includes("15m") ? "M15"
    : desc.includes("4h") ? "H4"
    : desc.includes("daily") || desc.includes("1d") ? "D1"
    : "H1";

  const entry: Array<{ indicator: string; parameter: string; operator: string; value: number | string; description: string }> = [];
  const exit: Array<{ indicator: string; parameter: string; operator: string; value: number | string; description: string }> = [];

  // Build conditions from keywords
  if (desc.includes("rsi")) {
    const rsiMatch = desc.match(/rsi\s*[<>]=?\s*(\d+)/i);
    const rsiVal = rsiMatch ? parseInt(rsiMatch[1]) : (dir === "buy" ? 30 : 70);
    entry.push({ indicator: "RSI", parameter: "value", operator: dir === "buy" ? "<" : ">", value: rsiVal, description: `RSI ${dir === "buy" ? "below" : "above"} ${rsiVal}` });
    exit.push({ indicator: "RSI", parameter: "value", operator: dir === "buy" ? ">" : "<", value: dir === "buy" ? 70 : 30, description: `RSI ${dir === "buy" ? "above 70" : "below 30"}` });
  }
  if (desc.includes("ema") || desc.includes("moving average")) {
    entry.push({ indicator: "close", parameter: "value", operator: dir === "buy" ? ">" : "<", value: "EMA_50", description: `Price ${dir === "buy" ? "above" : "below"} EMA 50` });
  }
  if (desc.includes("macd")) {
    entry.push({ indicator: "MACD", parameter: "histogram", operator: "crosses_above", value: 0, description: "MACD histogram crosses above zero" });
  }
  if (desc.includes("bollinger") || desc.includes("bb")) {
    entry.push({ indicator: "close", parameter: "value", operator: "<", value: "BB_lower", description: "Price below lower Bollinger Band" });
    exit.push({ indicator: "close", parameter: "value", operator: ">", value: "BB_upper", description: "Price above upper Bollinger Band" });
  }

  // Defaults if nothing matched
  if (entry.length === 0) {
    entry.push(
      { indicator: "RSI", parameter: "value", operator: "<", value: 30, description: "RSI below 30 (oversold)" },
      { indicator: "close", parameter: "value", operator: ">", value: "EMA_50", description: "Price above EMA 50" },
    );
  }
  if (exit.length === 0) {
    exit.push({ indicator: "RSI", parameter: "value", operator: ">", value: 70, description: "RSI above 70 (overbought)" });
  }

  // Parse SL/TP from description
  const slMatch = desc.match(/(\d+(?:\.\d+)?)\s*x?\s*atr\s*(?:stop|sl)/i) || desc.match(/sl\s*(\d+(?:\.\d+)?)\s*x?\s*atr/i);
  const tpMatch = desc.match(/(\d+(?:\.\d+)?)\s*x?\s*atr\s*(?:take|tp)/i) || desc.match(/tp\s*(\d+(?:\.\d+)?)\s*x?\s*atr/i);
  const slMult = slMatch ? parseFloat(slMatch[1]) : 1.5;
  const tpMult = tpMatch ? parseFloat(tpMatch[1]) : 3.0;
  const minBarsMatch = desc.match(/(\d+)\s*bars?/i);
  const minBars = minBarsMatch ? parseInt(minBarsMatch[1]) : null;

  const name = description.length > 50
    ? description.substring(0, 47) + "..."
    : description || "Custom Strategy";

  return {
    name: `AI: ${name}`,
    rules: [{
      name: "Rule 1",
      timeframe: tf,
      direction: dir,
      description: `Auto-generated from: "${description.substring(0, 100)}"`,
      entry_conditions: entry,
      exit_conditions: exit,
      stop_loss_pips: null,
      take_profit_pips: null,
      stop_loss_atr_multiplier: slMult,
      take_profit_atr_multiplier: tpMult,
      min_bars_in_trade: minBars,
      additional_timeframes: null,
      risk_percent: 1.0,
    }],
    ai_explanation: `This strategy was parsed from your description. It uses ${entry.map(e => e.indicator).join(" + ")} for entry signals and ${exit.map(e => e.indicator).join(" + ")} for exits. Risk is managed with ${slMult}x ATR stop loss and ${tpMult}x ATR take profit.`,
    symbol: symbol || "EURUSDm",
    raw_description: description,
  };
}

// ── Backtest result generation ───────────────────────────────

export function generateBacktestResult(
  initialBalance: number,
  riskPercent: number,
  symbol: string,
  numBars: number,
) {
  const candles = generateCandles(symbol || "EURUSDm", "1h", numBars || 2000);
  const numTrades = 15 + Math.floor(Math.random() * 15);
  const trades: Array<Record<string, unknown>> = [];
  let balance = initialBalance;
  const equityCurve: number[] = [balance];

  for (let i = 0; i < numTrades; i++) {
    const entryIdx = Math.floor((i / numTrades) * (candles.length - 50)) + 10;
    const barsHeld = 3 + Math.floor(Math.random() * 20);
    const exitIdx = Math.min(entryIdx + barsHeld, candles.length - 1);

    const entryCandle = candles[entryIdx];
    const exitCandle = candles[exitIdx];
    const entryPrice = entryCandle.close as number;
    const exitPrice = exitCandle.close as number;

    const direction = Math.random() > 0.5 ? "buy" : "sell";
    const pnlPips = direction === "buy"
      ? (exitPrice - entryPrice) / getPipSize(symbol || "EURUSDm")
      : (entryPrice - exitPrice) / getPipSize(symbol || "EURUSDm");

    // Bias toward slight profitability
    const adjustedPnl = pnlPips + (Math.random() - 0.4) * 5;
    const riskAmount = balance * (riskPercent / 100);
    const profit = (adjustedPnl / 30) * riskAmount;

    const exitReasons = ["strategy_exit", "stop_loss", "take_profit"];
    const exitReason = profit > 0
      ? (Math.random() > 0.3 ? "take_profit" : "strategy_exit")
      : (Math.random() > 0.3 ? "stop_loss" : "strategy_exit");

    balance += profit;
    equityCurve.push(balance);

    trades.push({
      entry_price: entryPrice,
      exit_price: exitPrice,
      entry_time: entryCandle.datetime || entryCandle.time,
      exit_time: exitCandle.datetime || exitCandle.time,
      pnl_pips: Math.round(adjustedPnl * 10) / 10,
      profit: Math.round(profit * 100) / 100,
      exit_reason: exitReason,
      direction,
    });
  }

  const wins = trades.filter(t => (t.profit as number) > 0);
  const losses = trades.filter(t => (t.profit as number) <= 0);
  const totalProfit = trades.reduce((s, t) => s + (t.profit as number), 0);
  const grossWins = wins.reduce((s, t) => s + (t.profit as number), 0);
  const grossLosses = Math.abs(losses.reduce((s, t) => s + (t.profit as number), 0));

  // Max drawdown from equity curve
  let maxDD = 0, peak = equityCurve[0];
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = ((peak - eq) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
  }

  const stats = {
    total_trades: numTrades,
    winning_trades: wins.length,
    losing_trades: losses.length,
    win_rate: Math.round((wins.length / numTrades) * 10000) / 100,
    total_profit: Math.round(totalProfit * 100) / 100,
    profit_factor: grossLosses > 0 ? Math.round((grossWins / grossLosses) * 100) / 100 : 99,
    max_drawdown: Math.round(maxDD * 100) / 100,
    sharpe_ratio: Math.round((0.5 + Math.random() * 1.5) * 100) / 100,
    avg_win: wins.length > 0 ? Math.round((grossWins / wins.length) * 100) / 100 : 0,
    avg_loss: losses.length > 0 ? Math.round((-grossLosses / losses.length) * 100) / 100 : 0,
    best_trade: wins.length > 0 ? Math.round(Math.max(...wins.map(t => t.profit as number)) * 100) / 100 : 0,
    worst_trade: losses.length > 0 ? Math.round(Math.min(...losses.map(t => t.profit as number)) * 100) / 100 : 0,
    final_balance: Math.round(balance * 100) / 100,
  };

  return { trades, stats, equity_curve: equityCurve, candles };
}

// ── Paired trades (MT5-style) ────────────────────────────────

export function generateDemoPairedTrades(symbol: string): Array<Record<string, unknown>> {
  const pip = getPipSize(symbol || "EURUSDm");
  const base = getBasePrice(symbol || "EURUSDm");
  const trades: Array<Record<string, unknown>> = [];
  const now = Date.now();

  for (let i = 0; i < 8; i++) {
    const entryTime = new Date(now - (8 - i) * 3600 * 1000 * 12).toISOString();
    const exitTime = new Date(now - (8 - i) * 3600 * 1000 * 12 + 3600 * 1000 * (2 + Math.random() * 6)).toISOString();
    const direction = Math.random() > 0.5 ? "buy" : "sell";
    const entryPrice = base + (Math.random() - 0.5) * pip * 100;
    const pnl = (Math.random() - 0.45) * pip * 50;
    const exitPrice = direction === "buy" ? entryPrice + pnl : entryPrice - pnl;
    const profit = direction === "buy"
      ? (exitPrice - entryPrice) * 100000 * 0.01
      : (entryPrice - exitPrice) * 100000 * 0.01;
    const commission = -0.07;

    trades.push({
      position_id: 100000 + i,
      symbol: symbol || "EURUSDm",
      direction,
      volume: 0.01,
      entry_price: Math.round(entryPrice * 100000) / 100000,
      entry_time: entryTime,
      exit_price: Math.round(exitPrice * 100000) / 100000,
      exit_time: exitTime,
      profit: Math.round(profit * 100) / 100,
      commission,
      swap: 0,
      net_pnl: Math.round((profit + commission) * 100) / 100,
      closed: true,
      comment: "",
    });
  }

  return trades;
}

// ── Demo trade history ───────────────────────────────────────

export function generateDemoHistory(): Array<Record<string, unknown>> {
  const now = Date.now();
  return Array.from({ length: 10 }, (_, i) => ({
    ticket: 200000 + i,
    symbol: i % 2 === 0 ? "EURUSDm" : "GBPUSDm",
    type: i % 3 === 0 ? "DEAL_TYPE_SELL" : "DEAL_TYPE_BUY",
    volume: 0.01,
    profit: Math.round((Math.random() - 0.45) * 20 * 100) / 100,
    open_time: new Date(now - (10 - i) * 86400 * 1000).toISOString(),
    close_time: new Date(now - (10 - i) * 86400 * 1000 + 7200 * 1000).toISOString(),
    open_price: 1.085 + (Math.random() - 0.5) * 0.005,
    close_price: 1.085 + (Math.random() - 0.5) * 0.005,
  }));
}

// ── AI text templates ────────────────────────────────────────

export function demoBacktestExplanation(stats: Record<string, number>): string {
  const winRate = stats.win_rate ?? 55;
  const totalTrades = stats.total_trades ?? 20;
  const maxDD = stats.max_drawdown ?? 8;
  const pf = stats.profit_factor ?? 1.3;
  const netProfit = stats.total_profit ?? 150;

  return `## Backtest Analysis

### Overview
Your strategy showed a **${winRate}% win rate** across ${totalTrades} trades with a profit factor of ${pf}. The final P&L was **$${netProfit.toFixed(2)}**.

### Strengths
- The profit factor of ${pf} indicates the strategy generates more profit than loss on average
- Win rate of ${winRate}% is ${winRate > 55 ? "above average" : "reasonable"} for a systematic strategy
- The strategy correctly identifies ${winRate > 50 ? "more winners than losers" : "trades with favorable risk-reward"}

### Risk Assessment
- Maximum drawdown of ${maxDD.toFixed(1)}% is ${maxDD < 10 ? "well within acceptable limits" : maxDD < 20 ? "moderate — consider tighter stops" : "high — review position sizing"}
- Average winning trade exceeds average losing trade, indicating good risk-reward management

### Recommendations
1. ${maxDD > 15 ? "Consider reducing position size or tightening stop loss to reduce drawdown" : "Current risk parameters look well-calibrated"}
2. ${winRate < 50 ? "Focus on improving entry timing — perhaps add confirmation indicators" : "Entry timing is solid, consider optimizing exit conditions"}
3. Run the strategy across different market conditions (trending vs ranging) to validate robustness
4. Consider adding a maximum daily loss limit for additional risk protection`;
}

export function demoTradeAnalysis(data: Record<string, unknown>): { analysis: string; alignment_score: number } {
  const score = 40 + Math.floor(Math.random() * 50);
  const symbol = data.symbol || "EURUSDm";
  const tradeType = data.trade_type || "buy";
  const profit = data.profit as number || 0;
  const outcome = profit >= 0 ? "Right" : "Wrong";

  return {
    alignment_score: score,
    analysis: `## Trade Analysis

### Strategy Alignment: ${score}/100

This ${tradeType} trade on ${symbol} ${profit >= 0 ? "was profitable" : "resulted in a loss"}.

### Entry Assessment
- The entry timing ${score > 60 ? "aligned well with the strategy signals" : "could have been improved"}
- ${score > 70 ? "All entry conditions were met at the time of entry" : "Some entry conditions were borderline at entry time"}

### What Went ${outcome}
${profit >= 0
  ? "- The market moved in the expected direction, confirming the strategy signal\n- Risk management allowed the trade to reach its profit target"
  : "- The market moved against the position shortly after entry\n- Consider whether additional confirmation signals could have filtered this trade out"}

### Key Takeaways
1. ${score > 60 ? "Continue following the strategy rules — this trade demonstrated good discipline" : "Review whether this trade met all entry criteria before execution"}
2. ${profit >= 0 ? "Good trade management — consider if you could have captured more of the move" : "The stop loss protected capital — review if the SL distance was appropriate"}
3. Always cross-reference multiple timeframes before entering trades`,
  };
}

export function demoLesson(topic: string): string {
  const t = topic.toLowerCase();

  if (t.includes("rsi")) {
    return `# Understanding the Relative Strength Index (RSI)

## What is RSI?
The RSI is a momentum oscillator that measures the speed and magnitude of price changes. It ranges from 0 to 100.

## Key Levels
- **Above 70**: Overbought — the asset may be due for a pullback
- **Below 30**: Oversold — the asset may be due for a bounce
- **50 line**: Acts as a trend filter — above 50 is bullish, below is bearish

## How to Use RSI in Trading
1. **Oversold/Overbought reversal**: Buy when RSI crosses above 30, sell when it crosses below 70
2. **Divergence**: When price makes a new high but RSI doesn't — potential reversal signal
3. **Trend confirmation**: RSI staying above 50 confirms an uptrend

## Common Mistakes
- Don't use RSI alone — always combine with price action or other indicators
- In strong trends, RSI can stay overbought/oversold for extended periods
- Different timeframes show different RSI values — check your trading timeframe

## Practice Exercise
On your next chart, identify 3 instances where RSI below 30 led to a price bounce. Note how far the bounce went and whether it was a good entry point.`;
  }

  if (t.includes("risk") || t.includes("money management")) {
    return `# Risk Management Fundamentals

## The 1% Rule
Never risk more than 1-2% of your total account on a single trade. This ensures you can survive a streak of losses.

## Position Sizing Formula
\`\`\`
Position Size = (Account Balance × Risk %) / (Entry Price - Stop Loss)
\`\`\`

## Stop Loss Placement
- **ATR-based**: Place SL at 1.5-2x the Average True Range from entry
- **Structure-based**: Place SL below/above recent swing points
- **Never move your stop loss further away** — only trail it in your favor

## Risk-Reward Ratio
- Aim for at least 2:1 reward-to-risk
- A 2:1 ratio means you only need to win 34% of trades to break even
- Higher ratios (3:1, 4:1) allow lower win rates while remaining profitable

## Key Principles
1. Define your risk BEFORE entering a trade
2. Use stop losses on every trade — no exceptions
3. Don't add to losing positions
4. Take partial profits at key levels`;
  }

  return `# Trading Lesson: ${topic}

## Introduction
Understanding ${topic} is essential for developing consistent trading strategies. This lesson covers the key concepts and practical applications.

## Core Concepts
1. **Definition**: ${topic} refers to a set of techniques and indicators used by traders to make informed decisions
2. **Application**: Used across all timeframes and asset classes
3. **Importance**: Helps identify high-probability trading setups

## Practical Tips
- Always practice new concepts on a demo account first
- Keep a trading journal to track your progress
- Combine multiple approaches for confirmation
- Focus on consistency rather than perfection

## Common Pitfalls
- Over-optimizing based on historical data (curve fitting)
- Ignoring risk management in favor of entry signals
- Trading too many instruments at once
- Not adapting to changing market conditions

## Next Steps
1. Practice identifying ${topic} patterns on your current charts
2. Backtest a simple strategy using these concepts
3. Start with small position sizes when trading live
4. Review and refine your approach weekly`;
}
