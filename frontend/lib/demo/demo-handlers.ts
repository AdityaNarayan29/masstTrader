/**
 * Demo request handler — routes API paths to mock data functions.
 * Called from api.ts when demo mode is enabled.
 */

import {
  tickPrice,
  demoAccount,
  demoPositions,
  demoSymbols,
  generateCandles,
  generateDemoPairedTrades,
  generateDemoHistory,
  generateBacktestResult,
  mockStrategyParse,
  demoBacktestExplanation,
  demoTradeAnalysis,
  demoLesson,
} from "./demo-data";
import { demoStorage } from "./demo-storage";
import { demoAlgo } from "./demo-algo";

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseBody(init?: RequestInit): Record<string, unknown> {
  if (!init?.body) return {};
  try {
    return JSON.parse(init.body as string);
  } catch {
    return {};
  }
}

function extractQueryParams(path: string): { cleanPath: string; params: Record<string, string> } {
  const [cleanPath, query] = path.split("?");
  const params: Record<string, string> = {};
  if (query) {
    for (const pair of query.split("&")) {
      const [k, v] = pair.split("=");
      if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || "");
    }
  }
  return { cleanPath, params };
}

export async function handleDemoRequest(
  fullPath: string,
  init?: RequestInit
): Promise<unknown> {
  const method = (init?.method || "GET").toUpperCase();
  const body = parseBody(init);
  const { cleanPath: path, params } = extractQueryParams(fullPath);

  // ── Health ─────────────────────────────────────
  if (path === "/api/health") {
    return {
      status: "ok",
      mt5_connected: true,
      has_data: true,
      has_strategy: demoStorage.getCurrentStrategy() !== null,
      has_env_creds: false,
    };
  }

  // ── MT5 ────────────────────────────────────────
  if (path === "/api/mt5/connect" && method === "POST") {
    return { success: true, terminal_build: 4150, terminal_name: "MasstTrader Demo" };
  }
  if (path === "/api/mt5/disconnect" && method === "POST") {
    return { success: true };
  }
  if (path === "/api/mt5/account") {
    return demoAccount();
  }
  if (path === "/api/mt5/positions") {
    return demoPositions();
  }
  if (path === "/api/mt5/symbols") {
    return demoSymbols();
  }
  if (path.startsWith("/api/mt5/price/")) {
    const symbol = path.replace("/api/mt5/price/", "");
    return tickPrice(symbol);
  }
  if (path === "/api/mt5/trade" && method === "POST") {
    return { result: "OK", ticket: 100000 + Math.floor(Math.random() * 900000) };
  }
  if (path.startsWith("/api/mt5/close/") && method === "POST") {
    return { success: true };
  }

  // ── Data ───────────────────────────────────────
  if (path === "/api/data/fetch" && method === "POST") {
    const symbol = (body.symbol as string) || "EURUSDm";
    const timeframe = (body.timeframe as string) || "1h";
    const bars = (body.bars as number) || 200;
    const candles = generateCandles(symbol, timeframe, bars);
    return { candles, count: candles.length, columns: ["datetime", "open", "high", "low", "close", "volume"] };
  }
  if (path === "/api/data/demo" && method === "POST") {
    const candles = generateCandles("EURUSDm", "5m", 500);
    return { candles, count: candles.length, columns: ["datetime", "open", "high", "low", "close", "volume"] };
  }
  if (path === "/api/data/history") {
    return generateDemoHistory();
  }
  if (path === "/api/data/trades") {
    const symbol = params.symbol || "EURUSDm";
    return generateDemoPairedTrades(symbol);
  }

  // ── Strategy parsing ───────────────────────────
  if (path === "/api/strategy/parse" && method === "POST") {
    await delay(1500);
    const result = mockStrategyParse(
      (body.description as string) || "RSI momentum strategy",
      (body.symbol as string) || "EURUSDm",
    );
    demoStorage.setCurrentStrategy(result);
    return result;
  }
  if (path === "/api/strategy/current") {
    return demoStorage.getCurrentStrategy() || { name: "No strategy loaded", rules: [] };
  }
  if (path === "/api/strategy/validate" && method === "POST") {
    return { errors: [], warnings: [], valid: true };
  }

  // ── Strategies CRUD ────────────────────────────
  if (path === "/api/strategies" && method === "GET") {
    return demoStorage.listStrategies();
  }
  if (path === "/api/strategies" && method === "POST") {
    return demoStorage.saveCurrentStrategy();
  }
  if (path === "/api/strategies/create" && method === "POST") {
    return demoStorage.createStrategy(body);
  }

  // Parameterized strategy routes
  const strategyLoadMatch = path.match(/^\/api\/strategies\/([^/]+)\/load$/);
  if (strategyLoadMatch && method === "POST") {
    return demoStorage.loadStrategy(strategyLoadMatch[1]);
  }

  const strategyMatch = path.match(/^\/api\/strategies\/([^/]+)$/);
  if (strategyMatch) {
    const id = strategyMatch[1];
    if (method === "GET") return demoStorage.getStrategy(id);
    if (method === "PUT") return demoStorage.updateStrategy(id, body);
    if (method === "DELETE") return demoStorage.deleteStrategy(id);
  }

  // ── Backtest ───────────────────────────────────
  if (path === "/api/backtest/run" && method === "POST") {
    await delay(2000);
    const initialBalance = (body.initial_balance as number) || 10000;
    const riskPercent = (body.risk_percent as number) || 1;
    const strategyId = body.strategy_id as string | undefined;
    const bars = (body.bars as number) || 2000;

    // Get symbol from strategy if available
    let symbol = "EURUSDm";
    if (strategyId) {
      try {
        const strat = demoStorage.getStrategy(strategyId);
        symbol = strat.symbol || "EURUSDm";
      } catch { /* use default */ }
    }

    const result = generateBacktestResult(initialBalance, riskPercent, symbol, bars);

    // Save to demo backtests
    const stratName = strategyId
      ? (demoStorage.getStrategy(strategyId)?.name ?? "Unknown")
      : "Current Strategy";
    demoStorage.saveBacktest(strategyId || "current", stratName, symbol, initialBalance, riskPercent, result);

    return result;
  }
  if (path === "/api/backtest/explain" && method === "POST") {
    await delay(1000);
    // Get stats from most recent backtest
    const backtests = demoStorage.listBacktests();
    const stats = backtests.length > 0 ? backtests[0].stats : {};
    return { explanation: demoBacktestExplanation(stats) };
  }

  // ── Backtests history ──────────────────────────
  if (path === "/api/backtests" && method === "GET") {
    return demoStorage.listBacktests(params.strategy_id);
  }
  const backtestMatch = path.match(/^\/api\/backtests\/([^/]+)$/);
  if (backtestMatch && method === "GET") {
    return demoStorage.getBacktest(backtestMatch[1]);
  }

  // ── Analyzer ───────────────────────────────────
  if (path === "/api/analyze/trade" && method === "POST") {
    await delay(1200);
    return demoTradeAnalysis(body);
  }

  // ── Algo ───────────────────────────────────────
  if (path === "/api/algo/start" && method === "POST") {
    return demoAlgo.start(body);
  }
  if (path === "/api/algo/stop" && method === "POST") {
    return demoAlgo.stop();
  }
  if (path === "/api/algo/status") {
    return demoAlgo.status();
  }

  // Algo trades routes — check stats BEFORE the general trades route
  if (path === "/api/algo/trades/stats") {
    return demoAlgo.getTradeStats();
  }
  const algoTradeDetailMatch = path.match(/^\/api\/algo\/trades\/([^/]+)$/);
  if (algoTradeDetailMatch && method === "GET") {
    const trades = demoAlgo.getTrades();
    return trades.find(t => t.id === algoTradeDetailMatch[1]) || {};
  }
  if (path === "/api/algo/trades") {
    return demoAlgo.getTrades();
  }

  // ── Tutor ──────────────────────────────────────
  if (path === "/api/tutor/lesson" && method === "POST") {
    await delay(1500);
    const topic = (body.topic as string) || "trading basics";
    return { lesson: demoLesson(topic) };
  }

  // ── Fallback ───────────────────────────────────
  console.warn(`[Demo] Unhandled route: ${method} ${path}`);
  return { success: true };
}
