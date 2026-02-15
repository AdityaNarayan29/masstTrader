"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { api } from "@/lib/api";
import { useLiveStream } from "@/hooks/use-live-stream";
import { LiveChart, type TradeMarkerData, type PositionOverlay } from "@/components/live-chart";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface HistoricalCandle {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  EMA_50?: number;
  SMA_20?: number;
  BB_upper?: number;
  BB_middle?: number;
  BB_lower?: number;
  RSI_14?: number;
}

type AlgoStatus = import("@/hooks/use-live-stream").AlgoStatusData;

interface FullRule {
  name: string;
  timeframe: string;
  direction?: string;
  description?: string;
  entry_conditions: Array<{ indicator: string; parameter: string; operator: string; value: number | string; description: string }>;
  exit_conditions: Array<{ indicator: string; parameter: string; operator: string; value: number | string; description: string }>;
  stop_loss_pips: number | null;
  take_profit_pips: number | null;
  stop_loss_atr_multiplier?: number | null;
  take_profit_atr_multiplier?: number | null;
  min_bars_in_trade?: number | null;
  additional_timeframes?: string[] | null;
  risk_percent?: number;
}

interface FullStrategy {
  id: string;
  name: string;
  symbol: string;
  rules: FullRule[];
  raw_description: string;
  ai_explanation: string;
}

// Convert MT5 timeframe format ("M5", "H1") → frontend format ("5m", "1h")
const MT5_TO_UI_TF: Record<string, string> = {
  M1: "1m", M5: "5m", M15: "15m", M30: "30m",
  H1: "1h", H4: "4h", D1: "1d", W1: "1w",
};
function toUiTimeframe(mt5tf: string): string {
  return MT5_TO_UI_TF[mt5tf] || mt5tf.toLowerCase();
}

export default function AlgoPage() {
  // Strategy & algo config
  type StrategyItem = Awaited<ReturnType<typeof api.strategies.list>>[number];
  const [strategies, setStrategies] = useState<StrategyItem[]>([]);
  const [strategyId, setStrategyId] = useState("__current__");
  const [symbol, setSymbol] = useState("");
  const [timeframe, setTimeframe] = useState("5m");
  const [volume, setVolume] = useState(0.01);

  // Full strategy (with all rules) — fetched when strategy is selected
  const [fullStrategy, setFullStrategy] = useState<FullStrategy | null>(null);

  // Algo state
  const [polledAlgo, setPolledAlgo] = useState<AlgoStatus | null>(null);
  const [algoLoading, setAlgoLoading] = useState(false);
  const [algoStopping, setAlgoStopping] = useState(false);
  const algoInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Chart state
  const [historicalCandles, setHistoricalCandles] = useState<HistoricalCandle[]>([]);
  const [loadingChart, setLoadingChart] = useState(false);
  const [streamStarted, setStreamStarted] = useState(false);
  const autoLoadedRef = useRef(false);

  // Trade history (raw MT5 deals — used for chart markers)
  type PairedTrade = Awaited<ReturnType<typeof api.data.trades>>[number];
  const [tradeHistory, setTradeHistory] = useState<PairedTrade[]>([]);

  // Algo trades (enriched DB records with strategy context)
  type AlgoTrade = Awaited<ReturnType<typeof api.algo.trades>>[number];
  type AlgoTradeStats = Awaited<ReturnType<typeof api.algo.tradeStats>>;
  const [algoTrades, setAlgoTrades] = useState<AlgoTrade[]>([]);
  const [algoTradeStats, setAlgoTradeStats] = useState<AlgoTradeStats | null>(null);
  const [expandedTradeId, setExpandedTradeId] = useState<string | null>(null);

  const stream = useLiveStream(symbol || "EURUSDm", timeframe);
  const liveInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const [polledPrice, setPolledPrice] = useState<{ bid: number; ask: number; symbol: string } | null>(null);
  const [polledAccount, setPolledAccount] = useState<typeof stream.account>(null);
  const [polledPositions, setPolledPositions] = useState<typeof stream.positions>([]);

  // Merged data
  const price = stream.price ?? (polledPrice ? { ...polledPrice, last: 0, volume: 0, time: "" } : null);
  const account = stream.account ?? polledAccount;
  const positions = stream.positions.length > 0 ? stream.positions : polledPositions;
  const algo: AlgoStatus | null = polledAlgo?.running && stream.algo ? stream.algo : polledAlgo;

  // ── Derived chart data ──

  const tradeMarkers = useMemo<TradeMarkerData[]>(() => {
    const markers: TradeMarkerData[] = [];
    const usedTimes = new Set<string>();

    // 1) Markers from live algo signals (current session)
    if (algo?.signals) {
      for (const sig of algo.signals) {
        if (!["buy", "sell", "close", "closed"].includes(sig.action)) continue;
        const priceMatch = sig.detail.match(/at\s+([\d.]+)/i);
        const p = priceMatch ? parseFloat(priceMatch[1]) : 0;
        if (p === 0) continue;
        const key = `${sig.time}-${sig.action}`;
        usedTimes.add(key);
        markers.push({
          time: Math.floor(new Date(sig.time).getTime() / 1000),
          type: sig.action === "buy" || sig.action === "sell" ? "entry" : "exit",
          direction: sig.action as "buy" | "sell" | "close",
          price: p,
          label: sig.action.toUpperCase(),
        });
      }
    }

    // 2) Markers from trade history (past trades from MT5)
    for (const t of tradeHistory) {
      if (!t.entry_time) continue;
      const entryKey = `entry-${t.position_id}`;
      if (!usedTimes.has(entryKey)) {
        usedTimes.add(entryKey);
        markers.push({
          time: Math.floor(new Date(t.entry_time).getTime() / 1000),
          type: "entry",
          direction: t.direction as "buy" | "sell",
          price: t.entry_price,
          label: t.direction.toUpperCase(),
        });
      }
      if (t.exit_price && t.exit_time) {
        const exitKey = `exit-${t.position_id}`;
        if (!usedTimes.has(exitKey)) {
          usedTimes.add(exitKey);
          markers.push({
            time: Math.floor(new Date(t.exit_time).getTime() / 1000),
            type: "exit",
            direction: "close",
            price: t.exit_price,
            label: `${t.profit != null && t.profit >= 0 ? "+" : ""}${t.profit?.toFixed(2) ?? ""}`,
          });
        }
      }
    }

    return markers;
  }, [algo?.signals, tradeHistory]);

  const positionOverlay = useMemo<PositionOverlay | null>(() => {
    if (!algo?.in_position || !algo.position_ticket) return null;
    // Prefer trade_state (has calculated SL/TP), fall back to MT5 position
    const ts = algo.trade_state;
    if (ts) {
      return {
        entryPrice: ts.entry_price,
        stopLoss: ts.sl_price,
        takeProfit: ts.tp_price,
        type: ts.direction as "buy" | "sell",
      };
    }
    const pos = positions.find((p) => p.ticket === algo.position_ticket);
    if (!pos) return null;
    return {
      entryPrice: pos.open_price,
      stopLoss: pos.stop_loss || null,
      takeProfit: pos.take_profit || null,
      type: pos.type as "buy" | "sell",
    };
  }, [algo?.in_position, algo?.position_ticket, algo?.trade_state, positions]);

  const rsiData = useMemo(() => {
    return historicalCandles
      .filter((c) => c.RSI_14 != null && !isNaN(Number(c.RSI_14)))
      .map((c) => ({
        time: Math.floor(new Date(c.datetime).getTime() / 1000),
        value: Number(c.RSI_14),
      }));
  }, [historicalCandles]);

  const latestRSI = stream.candle?.indicators?.RSI_14 ?? null;

  const activePosition = useMemo(() => {
    if (!algo?.in_position || !algo.position_ticket) return null;
    return positions.find((p) => p.ticket === algo.position_ticket) ?? null;
  }, [algo?.in_position, algo?.position_ticket, positions]);

  const selectedStrategy = useMemo(() => {
    if (strategyId === "__current__") return null;
    return strategies.find((s) => s.id === strategyId) ?? null;
  }, [strategyId, strategies]);

  // ── Effects ──

  // Load saved strategies, auto-select first
  useEffect(() => {
    api.strategies.list().then((list) => {
      setStrategies(list);
      if (list.length > 0) {
        const first = list[0];
        setStrategyId(first.id);
        if (first.symbol) setSymbol(first.symbol);
        if (first.timeframe) {
          const uiTf = toUiTimeframe(first.timeframe);
          if (["1m", "5m", "15m", "30m", "1h", "4h"].includes(uiTf)) setTimeframe(uiTf);
        }
      }
    }).catch(() => {});
  }, []);

  // Fetch full strategy (with ALL rules) when selection changes
  useEffect(() => {
    if (strategyId === "__current__" || !strategyId) {
      setFullStrategy(null);
      return;
    }
    api.strategies.get(strategyId).then((s) => {
      setFullStrategy(s as unknown as FullStrategy);
    }).catch(() => setFullStrategy(null));
  }, [strategyId]);

  // Fetch trade history (raw MT5 deals for chart markers)
  useEffect(() => {
    if (!symbol) return;
    api.data.trades(symbol, 30).then(setTradeHistory).catch(() => {});
  }, [symbol]);

  // Fetch algo trades (enriched DB records) when symbol is known
  useEffect(() => {
    if (!symbol) return;
    api.algo.trades(undefined, symbol, 100).then(setAlgoTrades).catch(() => {});
    api.algo.tradeStats(undefined, symbol).then(setAlgoTradeStats).catch(() => {});
  }, [symbol]);

  // Refresh trade history + algo trades when a trade is closed
  useEffect(() => {
    if (!symbol || !algo?.trades_placed) return;
    api.data.trades(symbol, 30).then(setTradeHistory).catch(() => {});
    api.algo.trades(undefined, symbol, 100).then(setAlgoTrades).catch(() => {});
    api.algo.tradeStats(undefined, symbol).then(setAlgoTradeStats).catch(() => {});
  }, [algo?.trades_placed, symbol]);

  // Poll algo status every 1s (HTTP baseline; SSE overlays when available)
  useEffect(() => {
    const poll = () => api.algo.status().then(setPolledAlgo).catch(() => {});
    poll();
    algoInterval.current = setInterval(poll, 1000);
    return () => { if (algoInterval.current) clearInterval(algoInterval.current); };
  }, []);

  // Auto-load chart when page opens and algo is already running
  useEffect(() => {
    if (autoLoadedRef.current) return;
    if (!polledAlgo?.running || !polledAlgo.symbol) return;
    autoLoadedRef.current = true;
    const algoSym = polledAlgo.symbol;
    const algoTf = polledAlgo.timeframe || "1h";
    // Sync local state to match running algo
    setSymbol(algoSym);
    const uiTf = toUiTimeframe(algoTf);
    if (["1m", "5m", "15m", "30m", "1h", "4h"].includes(uiTf)) setTimeframe(uiTf);
    setLoadingChart(true);
    setStreamStarted(true);
    api.data.fetch(algoSym, uiTf, 200)
      .then((data) => setHistoricalCandles(data.candles as unknown as HistoricalCandle[]))
      .catch(() => {})
      .finally(() => setLoadingChart(false));
  }, [polledAlgo]);

  // HTTP poll fallback for price/account/positions when SSE is down
  useEffect(() => {
    if (stream.status === "connected" || !streamStarted || !symbol) {
      if (liveInterval.current) { clearInterval(liveInterval.current); liveInterval.current = null; }
      return;
    }
    const poll = () => {
      api.mt5.price(symbol).then(setPolledPrice).catch(() => {});
      api.mt5.account().then(setPolledAccount).catch(() => {});
      api.mt5.positions().then(setPolledPositions).catch(() => {});
    };
    poll();
    liveInterval.current = setInterval(poll, 1000);
    return () => { if (liveInterval.current) clearInterval(liveInterval.current); };
  }, [stream.status, streamStarted, symbol]);

  // ── Handlers ──

  const startStream = async (sym?: string) => {
    const s = sym || symbol;
    if (!s) return;
    const tf = selectedStrategy?.timeframe ? toUiTimeframe(selectedStrategy.timeframe) : timeframe;
    setLoadingChart(true);
    setStreamStarted(true);
    try {
      const data = await api.data.fetch(s, tf, 200);
      setHistoricalCandles(data.candles as unknown as HistoricalCandle[]);
      stream.changeSymbol(s, tf);
      stream.connect();
    } catch {
      stream.connect();
    } finally {
      setLoadingChart(false);
    }
  };

  const handleStart = async () => {
    setAlgoLoading(true);
    try {
      const stratId = strategyId !== "__current__" ? strategyId : undefined;
      const algoSymbol = selectedStrategy?.symbol || symbol;
      const algoTf = selectedStrategy?.timeframe ? toUiTimeframe(selectedStrategy.timeframe) : timeframe;
      if (!streamStarted) await startStream(algoSymbol);
      await api.algo.start(algoSymbol, algoTf, volume, stratId);
      const status = await api.algo.status();
      setPolledAlgo(status);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to start algo");
    } finally {
      setAlgoLoading(false);
    }
  };

  const handleStop = async () => {
    setAlgoStopping(true);
    try {
      await api.algo.stop();
      const status = await api.algo.status();
      setPolledAlgo(status);
    } catch {
      // ignore
    } finally {
      setAlgoStopping(false);
    }
  };

  // Spread: use raw difference for BTC/XAU (large prices), points for forex
  const isBigPrice = symbol.includes("BTC") || symbol.includes("XAU") || (price && price.bid > 100);
  const spread = price
    ? isBigPrice
      ? (price.ask - price.bid).toFixed(2)
      : ((price.ask - price.bid) * 100000).toFixed(1)
    : "---";
  const spreadUnit = isBigPrice ? "USD" : "points";

  const indicators = algo?.running && algo.indicators && Object.keys(algo.indicators).length > 0
    ? algo.indicators
    : stream.candle?.indicators ?? null;

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Algo Trader</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Run automated strategies with live visualization
          </p>
        </div>
        <div className="flex items-center gap-2">
          {algo?.running && (
            <Badge className="bg-primary text-primary-foreground animate-pulse text-xs">
              ALGO RUNNING
            </Badge>
          )}
        </div>
      </div>

      {/* Error */}
      {stream.error && (
        <Card className="border-destructive/50 bg-destructive/10">
          <CardContent className="py-3 text-sm text-red-500">
            {stream.error}
          </CardContent>
        </Card>
      )}

      {/* ── Controls ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Algo Controls</CardTitle>
          <CardDescription>
            Select a strategy, configure parameters, and start the algo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Config row */}
          <div className="flex flex-wrap items-end gap-4">
            {strategies.length > 0 && !algo?.running && (
              <div className="space-y-2">
                <Label>Strategy</Label>
                <Select value={strategyId} onValueChange={(id) => {
                  setStrategyId(id);
                  const strat = strategies.find((s) => s.id === id);
                  if (strat) {
                    if (strat.symbol) setSymbol(strat.symbol);
                    if (strat.timeframe) {
                      const uiTf = toUiTimeframe(strat.timeframe);
                      if (["1m", "5m", "15m", "30m", "1h", "4h"].includes(uiTf)) setTimeframe(uiTf);
                    }
                  }
                }}>
                  <SelectTrigger className="w-full sm:w-56">
                    <SelectValue placeholder="Select strategy" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__current__">Current (in-memory)</SelectItem>
                    {strategies.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} ({s.symbol})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {selectedStrategy ? (
              <div className="space-y-2">
                <Label>Timeframe</Label>
                <div className="flex items-center gap-2 h-9">
                  <Badge variant="outline" className="text-sm font-mono px-3 py-1">
                    {selectedStrategy.timeframe || timeframe}
                  </Badge>
                  {selectedStrategy.additional_timeframes && selectedStrategy.additional_timeframes.length > 0 && (
                    <>
                      <span className="text-xs text-muted-foreground">+</span>
                      {selectedStrategy.additional_timeframes.map((tf) => (
                        <Badge key={tf} variant="secondary" className="text-[10px] font-mono">
                          {tf}
                        </Badge>
                      ))}
                    </>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground">From strategy</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Timeframe</Label>
                <Select
                  value={timeframe}
                  onValueChange={setTimeframe}
                  disabled={algo?.running === true}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["1m", "5m", "15m", "30m", "1h", "4h"].map((tf) => (
                      <SelectItem key={tf} value={tf}>
                        {tf}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {!algo?.running && (
              <div className="space-y-2">
                <Label>
                  {selectedStrategy?.stop_loss_atr_multiplier ? "Fallback Vol" : "Volume"}
                </Label>
                <Input
                  type="number"
                  value={volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value) || 0.01)}
                  className="w-24"
                  step="0.01"
                  min="0.01"
                />
                {selectedStrategy?.stop_loss_atr_multiplier && (
                  <p className="text-[10px] text-muted-foreground">
                    Dynamic sizing active (risk-based)
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-3">
            {!algo?.running ? (
              <Button
                onClick={handleStart}
                disabled={algoLoading || !symbol || (strategyId === "__current__" && strategies.length > 0)}
              >
                {algoLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {algoLoading ? "Starting..." : "Start Algo"}
              </Button>
            ) : (
              <Button
                variant="destructive"
                onClick={handleStop}
                disabled={algoStopping}
              >
                {algoStopping && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {algoStopping ? "Stopping..." : "Stop Algo"}
              </Button>
            )}
            {loadingChart && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading chart...
              </span>
            )}
          </div>

          {/* Strategy preview — all rules */}
          {selectedStrategy && !algo?.running && (() => {
            const rules = fullStrategy?.rules ?? [];
            // Fallback: if full strategy not loaded yet, show first rule from list data
            const displayRules: FullRule[] = rules.length > 0 ? rules : [{
              name: selectedStrategy.name,
              timeframe: selectedStrategy.timeframe,
              direction: selectedStrategy.direction,
              entry_conditions: selectedStrategy.entry_conditions,
              exit_conditions: selectedStrategy.exit_conditions,
              stop_loss_pips: selectedStrategy.stop_loss_pips,
              take_profit_pips: selectedStrategy.take_profit_pips,
              stop_loss_atr_multiplier: selectedStrategy.stop_loss_atr_multiplier,
              take_profit_atr_multiplier: selectedStrategy.take_profit_atr_multiplier,
              min_bars_in_trade: selectedStrategy.min_bars_in_trade,
              additional_timeframes: selectedStrategy.additional_timeframes,
            }];
            return (
              <div className="border-t pt-3 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{fullStrategy?.name ?? selectedStrategy.name}</span>
                  <Badge variant="outline" className="text-[10px]">{selectedStrategy.symbol}</Badge>
                  {displayRules.length > 1 && (
                    <Badge variant="secondary" className="text-[10px]">{displayRules.length} rules</Badge>
                  )}
                </div>
                <div className="space-y-2">
                  {displayRules.map((rule, ri) => {
                    const isActive = ri === 0;
                    const dir = rule.direction || "buy";
                    const borderColor = dir === "buy" ? "border-green-500/30" : "border-red-500/30";
                    const bgColor = dir === "buy" ? "bg-green-500/5" : "bg-red-500/5";
                    return (
                      <div key={ri} className={`rounded-lg border ${borderColor} ${bgColor} p-3 space-y-2`}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={dir === "buy" ? "default" : "destructive"} className="text-[10px]">
                            {dir.toUpperCase()}
                          </Badge>
                          {isActive && (
                            <Badge variant="outline" className="text-[10px] border-blue-500/50 text-blue-500">
                              ACTIVE
                            </Badge>
                          )}
                          {!isActive && (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">
                              DORMANT
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-[10px]">{rule.timeframe}</Badge>
                          {rule.stop_loss_atr_multiplier != null && (
                            <Badge variant="destructive" className="text-[10px]">SL {rule.stop_loss_atr_multiplier}x ATR</Badge>
                          )}
                          {rule.stop_loss_pips != null && !rule.stop_loss_atr_multiplier && (
                            <Badge variant="destructive" className="text-[10px]">SL {rule.stop_loss_pips} pips</Badge>
                          )}
                          {rule.take_profit_atr_multiplier != null && (
                            <Badge className="bg-green-600 hover:bg-green-600/90 text-white text-[10px]">TP {rule.take_profit_atr_multiplier}x ATR</Badge>
                          )}
                          {rule.take_profit_pips != null && !rule.take_profit_atr_multiplier && (
                            <Badge className="bg-green-600 hover:bg-green-600/90 text-white text-[10px]">TP {rule.take_profit_pips} pips</Badge>
                          )}
                          {rule.min_bars_in_trade != null && (
                            <Badge variant="outline" className="text-[10px]">Min {rule.min_bars_in_trade} bars</Badge>
                          )}
                          {rule.additional_timeframes && rule.additional_timeframes.length > 0 && (
                            <Badge variant="outline" className="text-[10px]">+{rule.additional_timeframes.join(",")}</Badge>
                          )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {rule.entry_conditions.length > 0 && (
                            <div className="space-y-0.5">
                              <p className="text-[10px] font-semibold uppercase text-green-600">Entry ({rule.entry_conditions.length})</p>
                              {rule.entry_conditions.map((c, ci) => (
                                <p key={ci} className="text-xs font-mono text-muted-foreground">
                                  {c.indicator}{c.parameter && c.parameter !== "value" ? `.${c.parameter}` : ""} {c.operator} {String(c.value)}
                                </p>
                              ))}
                            </div>
                          )}
                          {rule.exit_conditions.length > 0 && (
                            <div className="space-y-0.5">
                              <p className="text-[10px] font-semibold uppercase text-red-600">Exit ({rule.exit_conditions.length})</p>
                              {rule.exit_conditions.map((c, ci) => (
                                <p key={ci} className="text-xs font-mono text-muted-foreground">
                                  {c.indicator}{c.parameter && c.parameter !== "value" ? `.${c.parameter}` : ""} {c.operator} {String(c.value)}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Algo status bar (when running) */}
          {algo?.running && (
            <div className="flex flex-wrap gap-x-5 gap-y-1 items-center text-sm border-t pt-3">
              <div>
                <span className="text-muted-foreground">Strategy:</span>{" "}
                <span className="font-medium">{algo.strategy_name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Symbol:</span>{" "}
                <span className="font-mono">{algo.symbol}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Sizing:</span>{" "}
                {algo.trade_state ? (
                  <span className="font-mono">{algo.trade_state.volume} lots (dynamic)</span>
                ) : (
                  <span className="font-mono">{algo.volume} lots</span>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">Trades:</span>{" "}
                <span className="font-semibold">{algo.trades_placed}</span>
              </div>
              {algo.in_position && (
                <Badge variant="default">In Position #{algo.position_ticket}</Badge>
              )}
              {algo.last_check && (
                <span className="text-xs text-muted-foreground">
                  Last: {new Date(algo.last_check).toLocaleTimeString()}
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Price Bar */}
      {price && (
        <div className="grid grid-cols-3 gap-3">
          <Card className="border-green-500/20">
            <CardContent className="py-4 text-center">
              <p className="text-xs text-muted-foreground">BID</p>
              <p className="text-2xl font-mono font-bold text-green-500 mt-1">
                {price.bid.toFixed(isBigPrice ? 2 : 5)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-center">
              <p className="text-xs text-muted-foreground">SPREAD</p>
              <p className="text-2xl font-mono font-bold mt-1">{spread}</p>
              <p className="text-xs text-muted-foreground">{spreadUnit}</p>
            </CardContent>
          </Card>
          <Card className="border-red-500/20">
            <CardContent className="py-4 text-center">
              <p className="text-xs text-muted-foreground">ASK</p>
              <p className="text-2xl font-mono font-bold text-red-500 mt-1">
                {price.ask.toFixed(isBigPrice ? 2 : 5)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Chart */}
      {historicalCandles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {symbol} — {selectedStrategy?.timeframe ? toUiTimeframe(selectedStrategy.timeframe) : timeframe}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <LiveChart
              historicalCandles={historicalCandles}
              latestCandle={stream.candle}
              tradeMarkers={tradeMarkers}
              positionOverlay={positionOverlay}
              rsiData={rsiData}
              latestRSI={latestRSI}
              className="h-[350px] sm:h-[500px] w-full"
            />
          </CardContent>
        </Card>
      )}

      {/* Active Position P/L */}
      {activePosition && (
        <Card className={`border-2 ${activePosition.profit >= 0 ? "border-green-500/50 bg-green-500/5" : "border-red-500/50 bg-red-500/5"}`}>
          <CardContent className="py-5">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Badge variant={activePosition.type === "buy" ? "default" : "destructive"} className="text-sm px-3 py-1">
                  {activePosition.type.toUpperCase()}
                </Badge>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {activePosition.symbol} — #{activePosition.ticket}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Vol: {activePosition.volume} lots
                  </p>
                </div>
              </div>
              <div className="text-center sm:text-right">
                <p className={`text-3xl font-bold font-mono ${activePosition.profit >= 0 ? "text-green-500" : "text-red-500"}`}>
                  {activePosition.profit >= 0 ? "+" : ""}${activePosition.profit.toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Unrealized P/L</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-border/50">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">Entry</p>
                <p className="text-sm font-mono font-semibold text-blue-500">
                  {activePosition.open_price.toFixed(activePosition.symbol.includes("BTC") ? 2 : 5)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">Current</p>
                <p className="text-sm font-mono font-semibold">
                  {activePosition.current_price.toFixed(activePosition.symbol.includes("BTC") ? 2 : 5)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">Stop Loss</p>
                <p className="text-sm font-mono font-semibold text-red-500">
                  {activePosition.stop_loss ? activePosition.stop_loss.toFixed(activePosition.symbol.includes("BTC") ? 2 : 5) : "---"}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">Take Profit</p>
                <p className="text-sm font-mono font-semibold text-green-500">
                  {activePosition.take_profit ? activePosition.take_profit.toFixed(activePosition.symbol.includes("BTC") ? 2 : 5) : "---"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* TradeState Card — entry/SL/TP with distances and R-progress */}
      {algo?.trade_state && algo.in_position && (() => {
        const ts = algo.trade_state;
        const dec = isBigPrice ? 2 : 5;
        const curPrice = price ? (ts.direction === "buy" ? price.bid : price.ask) : ts.entry_price;
        const slDist = ts.sl_price ? Math.abs(curPrice - ts.sl_price) : null;
        const tpDist = ts.tp_price ? Math.abs(ts.tp_price - curPrice) : null;
        const slPct = ts.sl_price ? ((slDist! / curPrice) * 100) : null;
        const tpPct = ts.tp_price ? ((tpDist! / curPrice) * 100) : null;
        // R-multiple: how far from entry relative to risk (SL distance)
        const riskDist = ts.sl_price ? Math.abs(ts.entry_price - ts.sl_price) : null;
        const pnlDist = ts.direction === "buy" ? curPrice - ts.entry_price : ts.entry_price - curPrice;
        const rMultiple = riskDist && riskDist > 0 ? pnlDist / riskDist : null;
        // Progress: 0% = SL, 50% = entry, 100% = TP
        const totalRange = (ts.sl_price && ts.tp_price) ? Math.abs(ts.tp_price - ts.sl_price) : null;
        const progressPct = (totalRange && ts.sl_price != null)
          ? Math.min(100, Math.max(0, ((ts.direction === "buy" ? curPrice - ts.sl_price : ts.sl_price - curPrice) / totalRange) * 100))
          : null;
        const entryPct = (totalRange && ts.sl_price != null)
          ? ((ts.direction === "buy" ? ts.entry_price - ts.sl_price : ts.sl_price - ts.entry_price) / totalRange) * 100
          : null;

        return (
          <Card className="border border-blue-500/30 bg-blue-500/5">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm text-blue-500">Trade State</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant={ts.direction === "buy" ? "default" : "destructive"}>
                    {ts.direction.toUpperCase()}
                  </Badge>
                  {rMultiple != null && (
                    <span className={`text-sm font-mono font-bold ${rMultiple >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {rMultiple >= 0 ? "+" : ""}{rMultiple.toFixed(2)}R
                    </span>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* SL → Entry → TP progress bar */}
              {progressPct != null && entryPct != null && (
                <div className="space-y-1">
                  <div className="relative h-3 rounded-full bg-muted overflow-hidden">
                    {/* Progress fill */}
                    <div
                      className={`absolute inset-y-0 left-0 rounded-full transition-all ${pnlDist >= 0 ? "bg-green-500/60" : "bg-red-500/60"}`}
                      style={{ width: `${progressPct}%` }}
                    />
                    {/* Entry marker */}
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-blue-500"
                      style={{ left: `${entryPct}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[9px] text-muted-foreground font-mono">
                    <span className="text-red-500">SL</span>
                    <span className="text-blue-500">Entry</span>
                    <span className="text-green-500">TP</span>
                  </div>
                </div>
              )}

              {/* Price levels grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase">Entry</p>
                  <p className="text-sm font-mono font-semibold text-blue-500">
                    {ts.entry_price.toFixed(dec)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase">
                    SL {ts.sl_atr_mult ? `(${ts.sl_atr_mult}x ATR)` : ""}
                  </p>
                  <p className="text-sm font-mono font-semibold text-red-500">
                    {ts.sl_price ? ts.sl_price.toFixed(dec) : "---"}
                  </p>
                  {slDist != null && (
                    <p className="text-[10px] text-muted-foreground font-mono">
                      -{slDist.toFixed(dec)} ({slPct!.toFixed(2)}%)
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase">
                    TP {ts.tp_atr_mult ? `(${ts.tp_atr_mult}x ATR)` : ""}
                  </p>
                  <p className="text-sm font-mono font-semibold text-green-500">
                    {ts.tp_price ? ts.tp_price.toFixed(dec) : "---"}
                  </p>
                  {tpDist != null && (
                    <p className="text-[10px] text-muted-foreground font-mono">
                      +{tpDist.toFixed(dec)} ({tpPct!.toFixed(2)}%)
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase">Bars Held</p>
                  <p className="text-sm font-mono font-semibold">{ts.bars_since_entry}</p>
                  {ts.atr_at_entry != null && (
                    <p className="text-[10px] text-muted-foreground font-mono">ATR: {ts.atr_at_entry.toFixed(dec)}</p>
                  )}
                </div>
              </div>

              {/* Meta line */}
              <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                <span>Vol: {ts.volume}</span>
                <span>#{ts.ticket}</span>
                <span>{new Date(ts.entry_time).toLocaleTimeString()}</span>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Account Info */}
      {account && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Balance", value: `$${account.balance.toFixed(2)}`, color: "" },
            { label: "Equity", value: `$${account.equity.toFixed(2)}`, color: account.equity >= account.balance ? "text-green-500" : "text-red-500" },
            { label: "Free Margin", value: `$${account.free_margin.toFixed(2)}`, color: "" },
            { label: "Floating P/L", value: `${account.profit >= 0 ? "+" : ""}$${account.profit.toFixed(2)}`, color: account.profit >= 0 ? "text-green-500" : "text-red-500" },
          ].map((m) => (
            <Card key={m.label} className="py-4">
              <CardContent className="px-4">
                <p className="text-xs text-muted-foreground">{m.label}</p>
                <p className={`text-xl font-semibold mt-1 ${m.color}`}>{m.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Positions */}
      {positions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Open Positions
              <Badge variant="secondary" className="ml-2 text-xs">{positions.length} active</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticket</TableHead>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Volume</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                    <TableHead className="text-right">Current</TableHead>
                    <TableHead className="text-right">SL</TableHead>
                    <TableHead className="text-right">TP</TableHead>
                    <TableHead className="text-right">P/L</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.map((pos) => (
                    <TableRow key={pos.ticket}>
                      <TableCell className="font-mono text-xs">{pos.ticket}</TableCell>
                      <TableCell className="font-medium">{pos.symbol}</TableCell>
                      <TableCell>
                        <Badge variant={pos.type === "buy" ? "default" : "destructive"} className="text-xs">
                          {pos.type.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{pos.volume}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{pos.open_price.toFixed(5)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{pos.current_price.toFixed(5)}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {pos.stop_loss ? pos.stop_loss.toFixed(5) : "---"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {pos.take_profit ? pos.take_profit.toFixed(5) : "---"}
                      </TableCell>
                      <TableCell className={`text-right font-semibold ${pos.profit >= 0 ? "text-green-500" : "text-red-500"}`}>
                        {pos.profit >= 0 ? "+" : ""}${pos.profit.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* What Happens Next + Strategy Monitor */}
      {algo?.running && (() => {
        const rules = fullStrategy?.rules ?? [];
        const activeIdx = algo.active_rule_index ?? 0;
        const activeRule = rules[activeIdx] as FullRule | undefined;
        const inPos = algo.in_position;

        // "What happens next" logic
        const failingEntry = (algo.entry_conditions ?? []).filter(c => !c.passed);
        const failingExit = (algo.exit_conditions ?? []).filter(c => !c.passed);
        const minBars = activeRule?.min_bars_in_trade ?? 0;
        const barsHeld = algo.trade_state?.bars_since_entry ?? 0;
        const barsNeeded = minBars > 0 ? Math.max(0, minBars - barsHeld) : 0;
        const dec = isBigPrice ? 2 : 5;

        return (
          <>
            {/* What Happens Next */}
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="py-4 space-y-2">
                <p className="text-xs font-semibold uppercase text-amber-600 dark:text-amber-400">What Happens Next</p>
                {!inPos ? (
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">
                      Waiting for <Badge variant="default" className="text-[10px] mx-1">ENTRY</Badge>
                      {failingEntry.length > 0
                        ? <span className="text-muted-foreground"> — need {failingEntry.length} more condition{failingEntry.length > 1 ? "s" : ""}</span>
                        : <span className="text-green-500"> — all conditions met, entering on next tick</span>
                      }
                    </p>
                    {failingEntry.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {failingEntry.map((c, i) => (
                          <span key={i} className="inline-flex items-center gap-1 rounded-md border border-red-500/20 bg-red-500/5 px-2 py-0.5 text-[11px] font-mono text-red-500">
                            <span className="text-red-500">{"\u2717"}</span>
                            {c.indicator}{c.parameter && c.parameter !== "value" ? `.${c.parameter}` : ""} {c.operator} {String(c.value)}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* Show dormant rules as "also watching for" */}
                    {rules.length > 1 && rules.filter((_, i) => i !== activeIdx).map((r, i) => (
                      <p key={i} className="text-[11px] text-muted-foreground">
                        <Badge variant="outline" className="text-[9px] mr-1">{(r.direction || "buy").toUpperCase()}</Badge>
                        rule not monitored (dormant) — {r.entry_conditions.length} entry conditions
                      </p>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">
                      Waiting for <Badge variant="secondary" className="text-[10px] mx-1">EXIT</Badge>
                      {barsNeeded > 0
                        ? <span className="text-yellow-500"> — gated for {barsNeeded} more bar{barsNeeded > 1 ? "s" : ""}</span>
                        : failingExit.length > 0
                          ? <span className="text-muted-foreground"> — need {failingExit.length} condition{failingExit.length > 1 ? "s" : ""} OR SL/TP hit</span>
                          : <span className="text-green-500"> — all exit conditions met, closing on next tick</span>
                      }
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {barsNeeded > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-yellow-500/20 bg-yellow-500/5 px-2 py-0.5 text-[11px] font-mono text-yellow-500">
                          min_bars: {barsHeld}/{minBars}
                        </span>
                      )}
                      {failingExit.map((c, i) => (
                        <span key={i} className="inline-flex items-center gap-1 rounded-md border border-red-500/20 bg-red-500/5 px-2 py-0.5 text-[11px] font-mono text-red-500">
                          <span>{"\u2717"}</span>
                          {c.indicator}{c.parameter && c.parameter !== "value" ? `.${c.parameter}` : ""} {c.operator} {String(c.value)}
                        </span>
                      ))}
                      {algo.trade_state?.sl_price != null && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-red-500/20 bg-red-500/5 px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
                          SL @ {algo.trade_state.sl_price.toFixed(dec)}
                        </span>
                      )}
                      {algo.trade_state?.tp_price != null && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-green-500/20 bg-green-500/5 px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
                          TP @ {algo.trade_state.tp_price.toFixed(dec)}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Strategy Monitor — all rules */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Strategy Monitor</CardTitle>
                <CardDescription>
                  {rules.length > 1
                    ? `${rules.length} rules — active rule highlighted with live evaluation`
                    : "Live condition evaluation and trade signals"
                  }
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Rules */}
                {rules.length > 0 ? (
                  <div className="space-y-3">
                    {rules.map((rule, ri) => {
                      const isActive = ri === activeIdx;
                      const dir = rule.direction || "buy";
                      const ruleEntryConditions = isActive ? (algo.entry_conditions ?? []) : [];
                      const ruleExitConditions = isActive ? (algo.exit_conditions ?? []) : [];

                      return (
                        <div
                          key={ri}
                          className={`rounded-lg border p-3 space-y-3 ${
                            isActive
                              ? "border-blue-500/40 bg-blue-500/5"
                              : "border-border/50 opacity-60"
                          }`}
                        >
                          {/* Rule header */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant={dir === "buy" ? "default" : "destructive"} className="text-[10px]">
                              {dir.toUpperCase()}
                            </Badge>
                            {isActive ? (
                              <Badge variant="outline" className="text-[10px] border-blue-500/50 text-blue-500 animate-pulse">
                                ACTIVE
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                                DORMANT
                              </Badge>
                            )}
                            {rule.name && <span className="text-xs text-muted-foreground">{rule.name}</span>}
                            <Badge variant="outline" className="text-[10px]">{rule.timeframe}</Badge>
                            {rule.stop_loss_atr_multiplier != null && (
                              <Badge variant="destructive" className="text-[9px]">SL {rule.stop_loss_atr_multiplier}x ATR</Badge>
                            )}
                            {rule.take_profit_atr_multiplier != null && (
                              <Badge className="bg-green-600 text-white text-[9px]">TP {rule.take_profit_atr_multiplier}x ATR</Badge>
                            )}
                            {rule.min_bars_in_trade != null && (
                              <Badge variant="outline" className="text-[9px]">Min {rule.min_bars_in_trade} bars</Badge>
                            )}
                          </div>

                          {/* Conditions */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {/* Entry conditions */}
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-2">
                                <p className="text-[10px] font-semibold uppercase text-muted-foreground">Entry</p>
                                {isActive && ruleEntryConditions.length > 0 && (
                                  <Badge
                                    variant={ruleEntryConditions.every(c => c.passed) ? "default" : "secondary"}
                                    className="text-[9px]"
                                  >
                                    {ruleEntryConditions.filter(c => c.passed).length}/{ruleEntryConditions.length}
                                  </Badge>
                                )}
                              </div>
                              {isActive && ruleEntryConditions.length > 0
                                ? ruleEntryConditions.map((c, ci) => (
                                    <div key={ci} className="flex items-center gap-2 text-xs">
                                      <span className={`shrink-0 text-base ${c.passed ? "text-green-500" : "text-red-500"}`}>
                                        {c.passed ? "\u2713" : "\u2717"}
                                      </span>
                                      <span className="font-mono">
                                        {c.indicator}{c.parameter && c.parameter !== "value" ? `.${c.parameter}` : ""}{" "}
                                        {c.operator} {String(c.value)}
                                      </span>
                                    </div>
                                  ))
                                : rule.entry_conditions.map((c, ci) => (
                                    <p key={ci} className="text-xs font-mono text-muted-foreground">
                                      {c.indicator}{c.parameter && c.parameter !== "value" ? `.${c.parameter}` : ""} {c.operator} {String(c.value)}
                                    </p>
                                  ))
                              }
                            </div>

                            {/* Exit conditions */}
                            <div className="space-y-1.5">
                              <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                                Exit {isActive ? "(all types)" : ""}
                              </p>
                              {/* SL/TP virtual conditions — only for active rule when in position */}
                              {isActive && algo.trade_state?.sl_price != null && (() => {
                                const curP = price ? (algo.trade_state!.direction === "buy" ? price.bid : price.ask) : 0;
                                const slHit = algo.trade_state!.direction === "buy"
                                  ? curP <= algo.trade_state!.sl_price!
                                  : curP >= algo.trade_state!.sl_price!;
                                return (
                                  <div className="flex items-center gap-2 text-xs">
                                    <span className={`shrink-0 text-base ${slHit ? "text-red-500" : "text-muted-foreground"}`}>
                                      {slHit ? "\u2717" : "\u2713"}
                                    </span>
                                    <span className="font-mono">
                                      Price {algo.trade_state!.direction === "buy" ? "<=" : ">="} {algo.trade_state!.sl_price!.toFixed(dec)}
                                    </span>
                                    <Badge variant="destructive" className="text-[9px] h-4">SL</Badge>
                                  </div>
                                );
                              })()}
                              {isActive && algo.trade_state?.tp_price != null && (() => {
                                const curP = price ? (algo.trade_state!.direction === "buy" ? price.bid : price.ask) : 0;
                                const tpHit = algo.trade_state!.direction === "buy"
                                  ? curP >= algo.trade_state!.tp_price!
                                  : curP <= algo.trade_state!.tp_price!;
                                return (
                                  <div className="flex items-center gap-2 text-xs">
                                    <span className={`shrink-0 text-base ${tpHit ? "text-green-500" : "text-muted-foreground"}`}>
                                      {tpHit ? "\u2713" : "\u2717"}
                                    </span>
                                    <span className="font-mono">
                                      Price {algo.trade_state!.direction === "buy" ? ">=" : "<="} {algo.trade_state!.tp_price!.toFixed(dec)}
                                    </span>
                                    <Badge className="bg-green-600 text-white text-[9px] h-4">TP</Badge>
                                  </div>
                                );
                              })()}
                              {/* Strategy exit conditions */}
                              {isActive && ruleExitConditions.length > 0
                                ? ruleExitConditions.map((c, ci) => {
                                    const gated = algo.trade_state && rule.min_bars_in_trade
                                      ? algo.trade_state.bars_since_entry < rule.min_bars_in_trade
                                      : false;
                                    return (
                                      <div key={ci} className="flex items-center gap-2 text-xs">
                                        <span className={`shrink-0 text-base ${c.passed ? "text-green-500" : "text-red-500"}`}>
                                          {c.passed ? "\u2713" : "\u2717"}
                                        </span>
                                        <span className="font-mono">
                                          {c.indicator}{c.parameter && c.parameter !== "value" ? `.${c.parameter}` : ""}{" "}
                                          {c.operator} {String(c.value)}
                                        </span>
                                        {gated && (
                                          <span className="text-[9px] text-yellow-500">(gated: {algo.trade_state!.bars_since_entry}/{rule.min_bars_in_trade} bars)</span>
                                        )}
                                      </div>
                                    );
                                  })
                                : rule.exit_conditions.map((c, ci) => (
                                    <p key={ci} className="text-xs font-mono text-muted-foreground">
                                      {c.indicator}{c.parameter && c.parameter !== "value" ? `.${c.parameter}` : ""} {c.operator} {String(c.value)}
                                    </p>
                                  ))
                              }
                              {rule.exit_conditions.length === 0 && !isActive && (
                                <p className="text-xs text-muted-foreground">No exit conditions</p>
                              )}
                              {isActive && ruleExitConditions.length === 0 && !algo.trade_state?.sl_price && !algo.trade_state?.tp_price && rule.exit_conditions.length === 0 && (
                                <p className="text-xs text-muted-foreground">No exit conditions defined</p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Fallback: no full strategy loaded, show flat conditions like before */
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {(algo.entry_conditions?.length ?? 0) > 0 && (
                      <div className="rounded-lg border p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-semibold uppercase text-muted-foreground">Entry Conditions</p>
                          <Badge
                            variant={algo.entry_conditions!.every(c => c.passed) ? "default" : "secondary"}
                            className="text-[10px]"
                          >
                            {algo.entry_conditions!.filter(c => c.passed).length}/{algo.entry_conditions!.length}
                          </Badge>
                        </div>
                        {algo.entry_conditions!.map((c, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <span className={`shrink-0 text-base ${c.passed ? "text-green-500" : "text-red-500"}`}>
                              {c.passed ? "\u2713" : "\u2717"}
                            </span>
                            <span className="font-mono">
                              {c.indicator}{c.parameter && c.parameter !== "value" ? `.${c.parameter}` : ""}{" "}
                              {c.operator} {String(c.value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {(algo.exit_conditions?.length ?? 0) > 0 && (
                      <div className="rounded-lg border p-3 space-y-2">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">Exit Conditions</p>
                        {algo.exit_conditions!.map((c, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <span className={`shrink-0 text-base ${c.passed ? "text-green-500" : "text-red-500"}`}>
                              {c.passed ? "\u2713" : "\u2717"}
                            </span>
                            <span className="font-mono">
                              {c.indicator}{c.parameter && c.parameter !== "value" ? `.${c.parameter}` : ""}{" "}
                              {c.operator} {String(c.value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Signal Log */}
                {algo.signals.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">Signal Log</p>
                    <div className="rounded-md border max-h-64 overflow-y-auto">
                      <div className="p-3 space-y-1.5">
                        {[...algo.signals].reverse().map((sig, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs">
                            <span className="text-muted-foreground font-mono shrink-0 w-16">
                              {new Date(sig.time).toLocaleTimeString()}
                            </span>
                            <Badge
                              variant={
                                sig.action === "buy" || sig.action === "sell"
                                  ? "default"
                                  : sig.action === "close" || sig.action === "closed"
                                    ? "secondary"
                                    : sig.action === "error"
                                      ? "destructive"
                                      : sig.action === "flip"
                                        ? "default"
                                        : sig.action === "warn"
                                          ? "outline"
                                          : "outline"
                              }
                              className={`text-[10px] shrink-0 w-14 justify-center ${
                                sig.action === "warn" ? "border-yellow-500/50 text-yellow-500" :
                                sig.action === "flip" ? "bg-blue-600" : ""
                              }`}
                            >
                              {sig.action.toUpperCase()}
                            </Badge>
                            <span className="text-muted-foreground font-mono break-all">
                              {sig.detail.split(" | ").map((part, pi) => {
                                const hasPass = part.endsWith("+");
                                const hasFail = part.endsWith("-");
                                return (
                                  <span key={pi}>
                                    {pi > 0 && <span className="text-border mx-0.5">|</span>}
                                    <span className={hasPass ? "text-green-500" : hasFail ? "text-red-500" : ""}>
                                      {part}
                                    </span>
                                  </span>
                                );
                              })}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        );
      })()}

      {/* Indicators */}
      {indicators && Object.keys(indicators).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Technical Indicators</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {Object.entries(indicators).map(([key, val]) => {
                const display = typeof val === "number" ? val.toFixed(4) : val == null ? "---" : String(val);
                return (
                  <div key={key} className="rounded-lg border p-2 min-w-0">
                    <p className="text-[10px] text-muted-foreground font-mono truncate" title={key}>{key}</p>
                    <p className="text-sm font-semibold font-mono truncate" title={display}>{display}</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Algo Trade History (enriched with strategy context) */}
      {algoTrades.length > 0 ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Algo Trade History</CardTitle>
                <CardDescription>
                  {algoTrades.length} algo trade{algoTrades.length !== 1 ? "s" : ""} on {symbol}
                </CardDescription>
              </div>
              {algoTradeStats && algoTradeStats.total_trades > 0 && (
                <div className="flex items-center gap-3 text-sm">
                  <div className="text-right">
                    <p className="text-[10px] text-muted-foreground uppercase">Net P&L</p>
                    <p className={`font-mono font-bold ${algoTradeStats.total_pnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {algoTradeStats.total_pnl >= 0 ? "+" : ""}${algoTradeStats.total_pnl.toFixed(2)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-muted-foreground uppercase">Win Rate</p>
                    <p className="font-mono font-bold">{algoTradeStats.win_rate}%</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-muted-foreground uppercase">Avg Bars</p>
                    <p className="font-mono font-bold">{algoTradeStats.avg_bars_held}</p>
                  </div>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {/* Stats summary */}
            {algoTradeStats && algoTradeStats.total_trades > 0 && (
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-4">
                {[
                  { label: "Trades", value: String(algoTradeStats.total_trades) },
                  { label: "Wins", value: String(algoTradeStats.winning_trades), color: "text-green-500" },
                  { label: "Losses", value: String(algoTradeStats.losing_trades), color: "text-red-500" },
                  { label: "Avg P&L", value: `$${algoTradeStats.avg_pnl.toFixed(2)}`, color: algoTradeStats.avg_pnl >= 0 ? "text-green-500" : "text-red-500" },
                  { label: "Best", value: `$${algoTradeStats.best_trade.toFixed(2)}`, color: "text-green-500" },
                  { label: "Worst", value: `$${algoTradeStats.worst_trade.toFixed(2)}`, color: "text-red-500" },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border p-2 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">{s.label}</p>
                    <p className={`text-sm font-semibold font-mono ${s.color || ""}`}>{s.value}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] w-16">Dir</TableHead>
                    <TableHead className="text-[10px]">Strategy</TableHead>
                    <TableHead className="text-[10px]">Entry</TableHead>
                    <TableHead className="text-[10px]">Exit</TableHead>
                    <TableHead className="text-[10px]">Reason</TableHead>
                    <TableHead className="text-[10px] text-right">Bars</TableHead>
                    <TableHead className="text-[10px] text-right">Net</TableHead>
                    <TableHead className="text-[10px]">Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {algoTrades.map((t) => {
                    const dec = isBigPrice ? 2 : 5;
                    const exitReasonColors: Record<string, string> = {
                      strategy_exit: "bg-blue-500/10 text-blue-500 border-blue-500/30",
                      stop_loss: "bg-red-500/10 text-red-500 border-red-500/30",
                      take_profit: "bg-green-500/10 text-green-500 border-green-500/30",
                      external: "bg-yellow-500/10 text-yellow-500 border-yellow-500/30",
                      algo_stopped: "bg-gray-500/10 text-gray-400 border-gray-500/30",
                    };
                    const exitReasonLabels: Record<string, string> = {
                      strategy_exit: "SIGNAL", stop_loss: "SL", take_profit: "TP",
                      external: "EXTERNAL", algo_stopped: "STOPPED",
                    };
                    return (
                      <React.Fragment key={t.id}>
                        <TableRow
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setExpandedTradeId(expandedTradeId === t.id ? null : t.id)}
                        >
                          <TableCell>
                            <Badge variant={t.direction === "buy" ? "default" : "destructive"} className="text-[10px]">
                              {t.direction.toUpperCase()}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs max-w-[120px]">
                            <p className="truncate font-medium" title={t.strategy_name}>{t.strategy_name}</p>
                            {t.rule_name && <p className="text-[10px] text-muted-foreground truncate">{t.rule_name}</p>}
                          </TableCell>
                          <TableCell className="text-xs font-mono">{t.entry_price.toFixed(dec)}</TableCell>
                          <TableCell className="text-xs font-mono">
                            {t.exit_price != null ? t.exit_price.toFixed(dec) : (
                              <Badge variant="outline" className="text-[9px]">OPEN</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {t.exit_reason ? (
                              <Badge variant="outline" className={`text-[9px] ${exitReasonColors[t.exit_reason] || ""}`}>
                                {exitReasonLabels[t.exit_reason] || t.exit_reason.toUpperCase()}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[9px]">OPEN</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs font-mono text-right">{t.bars_held ?? "---"}</TableCell>
                          <TableCell className={`text-xs font-mono text-right ${
                            t.net_pnl == null ? "" : t.net_pnl >= 0 ? "text-green-500" : "text-red-500"
                          }`}>
                            {t.net_pnl != null ? `${t.net_pnl >= 0 ? "+" : ""}$${t.net_pnl.toFixed(2)}` : "---"}
                          </TableCell>
                          <TableCell className="text-[10px] text-muted-foreground whitespace-nowrap">
                            <div>{new Date(t.entry_time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                            {t.exit_time && (
                              <div className="text-[9px]">
                                → {new Date(t.exit_time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                        {/* Expanded detail row */}
                        {expandedTradeId === t.id && (
                          <TableRow>
                            <TableCell colSpan={8} className="bg-muted/30 p-4">
                              <div className="space-y-3">
                                {/* Trade details */}
                                <div className="flex flex-wrap gap-3 text-xs font-mono text-muted-foreground">
                                  {t.sl_price != null && <span>SL: {t.sl_price.toFixed(dec)}</span>}
                                  {t.tp_price != null && <span>TP: {t.tp_price.toFixed(dec)}</span>}
                                  {t.atr_at_entry != null && <span>ATR: {t.atr_at_entry.toFixed(dec)}</span>}
                                  {t.sl_atr_mult != null && <span>SL mult: {t.sl_atr_mult}x</span>}
                                  {t.tp_atr_mult != null && <span>TP mult: {t.tp_atr_mult}x</span>}
                                  <span>Vol: {t.volume}</span>
                                  {t.mt5_ticket && <span>Ticket: #{t.mt5_ticket}</span>}
                                  {t.profit != null && <span>Gross: ${t.profit.toFixed(2)}</span>}
                                  {t.commission != null && <span>Comm: ${t.commission.toFixed(2)}</span>}
                                  {t.swap != null && t.swap !== 0 && <span>Swap: ${t.swap.toFixed(2)}</span>}
                                </div>
                                {/* Entry conditions */}
                                {t.entry_conditions.length > 0 && (
                                  <div>
                                    <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-1">Entry Conditions</p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {t.entry_conditions.map((c, i) => (
                                        <span key={i} className={`text-[11px] font-mono px-2 py-0.5 rounded border ${c.passed ? "border-green-500/30 text-green-500" : "border-red-500/30 text-red-500"}`}>
                                          {c.passed ? "\u2713" : "\u2717"} {c.indicator}{c.parameter && c.parameter !== "value" ? `.${c.parameter}` : ""} {c.operator} {String(c.value)}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {/* Indicator snapshots */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  {Object.keys(t.entry_indicators).length > 0 && (
                                    <div>
                                      <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-1">Entry Indicators</p>
                                      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                                        {Object.entries(t.entry_indicators).map(([k, v]) => (
                                          <div key={k} className="text-[11px] font-mono flex justify-between">
                                            <span className="text-muted-foreground">{k}</span>
                                            <span>{typeof v === "number" ? v.toFixed(4) : String(v ?? "---")}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {t.exit_indicators && Object.keys(t.exit_indicators).length > 0 && (
                                    <div>
                                      <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-1">Exit Indicators</p>
                                      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                                        {Object.entries(t.exit_indicators).map(([k, v]) => (
                                          <div key={k} className="text-[11px] font-mono flex justify-between">
                                            <span className="text-muted-foreground">{k}</span>
                                            <span>{typeof v === "number" ? v.toFixed(4) : String(v ?? "---")}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : tradeHistory.length > 0 ? (
        /* Fallback: show old MT5 trade history if no algo trades recorded yet */
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Trade History (MT5)</CardTitle>
                <CardDescription>
                  {tradeHistory.length} trade{tradeHistory.length !== 1 ? "s" : ""} on {symbol} (last 30 days)
                </CardDescription>
              </div>
              {(() => {
                const closed = tradeHistory.filter(t => t.closed && t.net_pnl != null);
                const totalPnl = closed.reduce((s, t) => s + (t.net_pnl ?? 0), 0);
                const wins = closed.filter(t => (t.net_pnl ?? 0) > 0).length;
                const winRate = closed.length > 0 ? ((wins / closed.length) * 100).toFixed(0) : "0";
                return (
                  <div className="flex items-center gap-3 text-sm">
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground uppercase">Net P&L</p>
                      <p className={`font-mono font-bold ${totalPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                        {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground uppercase">Win Rate</p>
                      <p className="font-mono font-bold">{winRate}%</p>
                    </div>
                  </div>
                );
              })()}
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] w-16">Dir</TableHead>
                    <TableHead className="text-[10px]">Entry</TableHead>
                    <TableHead className="text-[10px]">Exit</TableHead>
                    <TableHead className="text-[10px] text-right">Vol</TableHead>
                    <TableHead className="text-[10px] text-right">Net</TableHead>
                    <TableHead className="text-[10px]">Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tradeHistory.map((t) => {
                    const dec = isBigPrice ? 2 : 5;
                    return (
                      <TableRow key={t.position_id}>
                        <TableCell>
                          <Badge variant={t.direction === "buy" ? "default" : "destructive"} className="text-[10px]">
                            {t.direction.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-mono">{t.entry_price.toFixed(dec)}</TableCell>
                        <TableCell className="text-xs font-mono">
                          {t.exit_price != null ? t.exit_price.toFixed(dec) : (
                            <Badge variant="outline" className="text-[9px]">OPEN</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-right">{t.volume}</TableCell>
                        <TableCell className={`text-xs font-mono text-right ${
                          t.net_pnl == null ? "" : t.net_pnl >= 0 ? "text-green-500" : "text-red-500"
                        }`}>
                          {t.net_pnl != null ? `${t.net_pnl >= 0 ? "+" : ""}$${t.net_pnl.toFixed(2)}` : "---"}
                        </TableCell>
                        <TableCell className="text-[10px] text-muted-foreground whitespace-nowrap">
                          <div>{t.entry_time ? new Date(t.entry_time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}</div>
                          {t.exit_time && (
                            <div className="text-[9px]">
                              → {new Date(t.exit_time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
