"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { api } from "@/lib/api";
import { useLiveStream } from "@/hooks/use-live-stream";
import { LiveChart, type TradeMarkerData, type PositionOverlay } from "@/components/live-chart";
import { Loader2 } from "lucide-react";
import { SymbolCombobox } from "@/components/symbol-combobox";
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

// Convert MT5 timeframe format ("M5", "H1") → frontend format ("5m", "1h")
const MT5_TO_UI_TF: Record<string, string> = {
  M1: "1m", M5: "5m", M15: "15m", M30: "30m",
  H1: "1h", H4: "4h", D1: "1d", W1: "1w",
};
function toUiTimeframe(mt5tf: string): string {
  return MT5_TO_UI_TF[mt5tf] || mt5tf.toLowerCase();
}

export default function LivePage() {
  const [symbol, setSymbol] = useState("EURUSDm");
  const [timeframe, setTimeframe] = useState("1m");
  const [historicalCandles, setHistoricalCandles] = useState<HistoricalCandle[]>(
    []
  );
  const [loadingChart, setLoadingChart] = useState(false);

  // Algo trading state
  type StrategyItem = Awaited<ReturnType<typeof api.strategies.list>>[number];
  const [strategies, setStrategies] = useState<StrategyItem[]>([]);
  const [algoStrategyId, setAlgoStrategyId] = useState("__current__");
  const [algoVolume, setAlgoVolume] = useState(0.01);
  const [polledAlgo, setPolledAlgo] = useState<AlgoStatus | null>(null);
  const [algoLoading, setAlgoLoading] = useState(false);
  const [algoStopping, setAlgoStopping] = useState(false);
  const algoInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const stream = useLiveStream(symbol, timeframe);
  const liveInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const [polledPrice, setPolledPrice] = useState<{ bid: number; ask: number; symbol: string } | null>(null);
  const [polledAccount, setPolledAccount] = useState<typeof stream.account>(null);
  const [polledPositions, setPolledPositions] = useState<typeof stream.positions>([]);
  const [liveStarted, setLiveStarted] = useState(false);

  // Merge WS + HTTP data: WS wins when connected, HTTP poll fills in otherwise
  const price = stream.price ?? (polledPrice ? { ...polledPrice, last: 0, volume: 0, time: "" } : null);
  const account = stream.account ?? polledAccount;
  const positions = stream.positions.length > 0 ? stream.positions : polledPositions;

  // WS provides real-time updates; HTTP poll is authoritative for state
  const algo: AlgoStatus | null = polledAlgo?.running && stream.algo
    ? stream.algo
    : polledAlgo;

  // ── Derived data for chart visualization ──

  // Parse trade markers from algo signals (buy/sell/close events → chart arrows)
  const tradeMarkers = useMemo<TradeMarkerData[]>(() => {
    if (!algo?.signals || algo.signals.length === 0) return [];
    const markers: TradeMarkerData[] = [];
    for (const sig of algo.signals) {
      if (!["buy", "sell", "close", "closed"].includes(sig.action)) continue;
      // Parse price from detail string, e.g. "Opened BUY at 97543.21" or "Closed position … at 97600.00"
      const priceMatch = sig.detail.match(/at\s+([\d.]+)/i);
      const price = priceMatch ? parseFloat(priceMatch[1]) : 0;
      if (price === 0) continue;
      markers.push({
        time: Math.floor(new Date(sig.time).getTime() / 1000),
        type: sig.action === "buy" || sig.action === "sell" ? "entry" : "exit",
        direction: sig.action as "buy" | "sell" | "close",
        price,
        label: sig.action.toUpperCase(),
      });
    }
    return markers;
  }, [algo?.signals]);

  // Position overlay: entry/SL/TP lines for the active algo position
  const positionOverlay = useMemo<PositionOverlay | null>(() => {
    if (!algo?.in_position || !algo.position_ticket) return null;
    const pos = positions.find((p) => p.ticket === algo.position_ticket);
    if (!pos) return null;
    return {
      entryPrice: pos.open_price,
      stopLoss: pos.stop_loss || null,
      takeProfit: pos.take_profit || null,
      type: pos.type as "buy" | "sell",
    };
  }, [algo?.in_position, algo?.position_ticket, positions]);

  // RSI data from historical candles for the RSI subplot
  const rsiData = useMemo(() => {
    return historicalCandles
      .filter((c) => c.RSI_14 != null && !isNaN(Number(c.RSI_14)))
      .map((c) => ({
        time: Math.floor(new Date(c.datetime).getTime() / 1000),
        value: Number(c.RSI_14),
      }));
  }, [historicalCandles]);

  // Live RSI from streaming candle indicators
  const latestRSI = stream.candle?.indicators?.RSI_14 ?? null;

  // Active position for P/L card
  const activePosition = useMemo(() => {
    if (!algo?.in_position || !algo.position_ticket) return null;
    return positions.find((p) => p.ticket === algo.position_ticket) ?? null;
  }, [algo?.in_position, algo?.position_ticket, positions]);

  // Currently selected strategy (full details for preview)
  const selectedStrategy = useMemo(() => {
    if (algoStrategyId === "__current__") return null;
    return strategies.find((s) => s.id === algoStrategyId) ?? null;
  }, [algoStrategyId, strategies]);

  // Load saved strategies for algo picker — auto-select first and sync fields
  useEffect(() => {
    api.strategies.list().then((list) => {
      setStrategies(list);
      if (list.length > 0 && algoStrategyId === "__current__") {
        const first = list[0];
        setAlgoStrategyId(first.id);
        if (first.symbol) setSymbol(first.symbol);
        if (first.timeframe) {
          const uiTf = toUiTimeframe(first.timeframe);
          if (["1m","5m","15m","30m","1h","4h"].includes(uiTf)) setTimeframe(uiTf);
        }
      }
    }).catch(() => {});
  }, []);

  // HTTP poll for live data when SSE is not connected
  useEffect(() => {
    if (stream.status === "connected" || !liveStarted) {
      if (liveInterval.current) { clearInterval(liveInterval.current); liveInterval.current = null; }
      return;
    }
    // SSE failed or disconnected — poll via HTTP every 1s
    const poll = () => {
      api.mt5.price(symbol).then(setPolledPrice).catch(() => {});
      api.mt5.account().then(setPolledAccount).catch(() => {});
      api.mt5.positions().then(setPolledPositions).catch(() => {});
    };
    poll();
    liveInterval.current = setInterval(poll, 1000);
    return () => { if (liveInterval.current) clearInterval(liveInterval.current); };
  }, [stream.status, liveStarted, symbol]);

  // HTTP poll as baseline (1s) for algo; SSE overlays real-time when connected
  useEffect(() => {
    const poll = () => api.algo.status().then(setPolledAlgo).catch(() => {});
    poll();
    algoInterval.current = setInterval(poll, 1000);
    return () => { if (algoInterval.current) clearInterval(algoInterval.current); };
  }, []);

  // Start the live stream (fetch historical data + connect SSE)
  const startStream = async (sym?: string) => {
    const s = sym || symbol;
    setLoadingChart(true);
    setLiveStarted(true);
    try {
      const data = await api.data.fetch(s, timeframe, 200);
      setHistoricalCandles(data.candles as unknown as HistoricalCandle[]);
      stream.connect();
    } catch {
      stream.connect();
    } finally {
      setLoadingChart(false);
    }
  };

  const handleWatch = () => startStream();

  const handleAlgoStart = async () => {
    setAlgoLoading(true);
    try {
      const stratId = algoStrategyId !== "__current__" ? algoStrategyId : undefined;
      const selectedStrat = strategies.find((s) => s.id === algoStrategyId);
      const algoSymbol = selectedStrat?.symbol || symbol;
      // Auto-start stream if not already live
      if (!liveStarted) await startStream(algoSymbol);
      await api.algo.start(algoSymbol, timeframe, algoVolume, stratId);
      const status = await api.algo.status();
      setPolledAlgo(status);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to start algo");
    } finally {
      setAlgoLoading(false);
    }
  };

  const handleAlgoStop = async () => {
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

  const handleStopAll = () => {
    if (algo?.running) handleAlgoStop();
    stream.disconnect();
    setLiveStarted(false);
  };

  const spread = price
    ? ((price.ask - price.bid) * 100000).toFixed(1)
    : "---";

  const statusColor =
    stream.status === "connected"
      ? "default"
      : liveStarted
        ? ("secondary" as const)
        : stream.status === "error"
          ? "destructive"
          : ("secondary" as const);

  const statusLabel =
    stream.status === "connected"
      ? "LIVE (SSE)"
      : liveStarted
        ? "LIVE (HTTP)"
        : stream.status === "connecting"
          ? "CONNECTING..."
          : "OFFLINE";

  // Merge indicators: prefer algo indicators when running, fall back to stream
  const indicators = algo?.running && algo.indicators && Object.keys(algo.indicators).length > 0
    ? algo.indicators
    : stream.candle?.indicators ?? null;

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Live Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Real-time market data, algo trading, and positions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusColor} className="text-xs">
            {statusLabel}
          </Badge>
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

      {/* ── Unified Controls ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Controls</CardTitle>
          <CardDescription>
            Watch the market live or start algo trading with a strategy.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Row 1: Symbol + Timeframe */}
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label>Symbol</Label>
              <SymbolCombobox
                value={symbol}
                onChange={setSymbol}
                disabled={liveStarted}
              />
            </div>
            <div className="space-y-2">
              <Label>Timeframe</Label>
              <Select
                value={timeframe}
                onValueChange={setTimeframe}
                disabled={liveStarted}
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
            {strategies.length > 0 && !algo?.running && (
              <div className="space-y-2">
                <Label>Strategy</Label>
                <Select value={algoStrategyId} onValueChange={(id) => {
                  setAlgoStrategyId(id);
                  const strat = strategies.find((s) => s.id === id);
                  if (strat && !liveStarted) {
                    if (strat.symbol) setSymbol(strat.symbol);
                    if (strat.timeframe) {
                      const uiTf = toUiTimeframe(strat.timeframe);
                      if (["1m","5m","15m","30m","1h","4h"].includes(uiTf)) setTimeframe(uiTf);
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
            {!algo?.running && (
              <div className="space-y-2">
                <Label>Volume</Label>
                <Input
                  type="number"
                  value={algoVolume}
                  onChange={(e) => setAlgoVolume(parseFloat(e.target.value) || 0.01)}
                  className="w-24"
                  step="0.01"
                  min="0.01"
                />
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-3">
            {!liveStarted ? (
              <>
                <Button
                  variant="outline"
                  onClick={handleWatch}
                  disabled={loadingChart || stream.status === "connecting" || !symbol}
                >
                  {(loadingChart || stream.status === "connecting") && (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  )}
                  Watch Market
                </Button>
                <Button
                  onClick={handleAlgoStart}
                  disabled={algoLoading || (algoStrategyId === "__current__" && strategies.length > 0) || !symbol}
                >
                  {algoLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {algoLoading ? "Starting..." : "Start Algo"}
                </Button>
              </>
            ) : !algo?.running ? (
              <>
                <Button
                  onClick={handleAlgoStart}
                  disabled={algoLoading || (algoStrategyId === "__current__" && strategies.length > 0)}
                >
                  {algoLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {algoLoading ? "Starting..." : "Start Algo"}
                </Button>
                <Button variant="outline" onClick={handleStopAll}>
                  Stop Stream
                </Button>
              </>
            ) : (
              <Button
                variant="destructive"
                onClick={handleAlgoStop}
                disabled={algoStopping}
              >
                {algoStopping && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {algoStopping ? "Stopping..." : "Stop Algo"}
              </Button>
            )}
          </div>

          {/* Strategy preview (before starting) */}
          {selectedStrategy && !algo?.running && (
            <div className="border-t pt-3 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{selectedStrategy.name}</span>
                <Badge variant="outline" className="text-[10px]">{selectedStrategy.timeframe}</Badge>
                <Badge variant="outline" className="text-[10px]">{selectedStrategy.direction.toUpperCase()}</Badge>
                {selectedStrategy.stop_loss_pips != null && (
                  <Badge variant="destructive" className="text-[10px]">SL {selectedStrategy.stop_loss_pips} pips</Badge>
                )}
                {selectedStrategy.take_profit_pips != null && (
                  <Badge className="bg-green-600 hover:bg-green-600/90 text-white text-[10px]">TP {selectedStrategy.take_profit_pips} pips</Badge>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {selectedStrategy.entry_conditions.length > 0 && (
                  <div className="rounded-md border border-green-500/20 bg-green-500/5 p-2.5 space-y-1">
                    <p className="text-[10px] font-semibold uppercase text-green-600">Entry ({selectedStrategy.entry_conditions.length})</p>
                    {selectedStrategy.entry_conditions.map((c, i) => (
                      <p key={i} className="text-xs font-mono text-muted-foreground">
                        {c.indicator}{c.parameter && c.parameter !== "value" ? `.${c.parameter}` : ""} {c.operator} {String(c.value)}
                      </p>
                    ))}
                  </div>
                )}
                {selectedStrategy.exit_conditions.length > 0 && (
                  <div className="rounded-md border border-red-500/20 bg-red-500/5 p-2.5 space-y-1">
                    <p className="text-[10px] font-semibold uppercase text-red-600">Exit ({selectedStrategy.exit_conditions.length})</p>
                    {selectedStrategy.exit_conditions.map((c, i) => (
                      <p key={i} className="text-xs font-mono text-muted-foreground">
                        {c.indicator}{c.parameter && c.parameter !== "value" ? `.${c.parameter}` : ""} {c.operator} {String(c.value)}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Algo status bar (compact, inline when running) */}
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
                <span className="text-muted-foreground">Vol:</span>{" "}
                <span className="font-mono">{algo.volume}</span>
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
                {price.bid.toFixed(5)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-center">
              <p className="text-xs text-muted-foreground">SPREAD</p>
              <p className="text-2xl font-mono font-bold mt-1">{spread}</p>
              <p className="text-xs text-muted-foreground">points</p>
            </CardContent>
          </Card>
          <Card className="border-red-500/20">
            <CardContent className="py-4 text-center">
              <p className="text-xs text-muted-foreground">ASK</p>
              <p className="text-2xl font-mono font-bold text-red-500 mt-1">
                {price.ask.toFixed(5)}
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
              {symbol} — {timeframe}
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

      {/* Algo Conditions + Signals (when running) */}
      {algo?.running && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Strategy Monitor</CardTitle>
            <CardDescription>Live condition evaluation and trade signals</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Entry & Exit Conditions */}
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
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Exit Conditions</p>
                    <Badge
                      variant={algo.exit_conditions!.every(c => c.passed) ? "default" : "secondary"}
                      className={`text-[10px] ${algo.exit_conditions!.every(c => c.passed) ? "bg-red-600" : ""}`}
                    >
                      {algo.exit_conditions!.filter(c => c.passed).length}/{algo.exit_conditions!.length}
                    </Badge>
                  </div>
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

            {/* Signal Log */}
            {algo.signals.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">Signal Log</p>
                <div className="rounded-md border max-h-48 overflow-y-auto">
                  <div className="p-3 space-y-1">
                    {[...algo.signals].reverse().map((sig, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <span className="text-muted-foreground font-mono shrink-0">
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
                                  : "outline"
                          }
                          className="text-[10px] shrink-0"
                        >
                          {sig.action.toUpperCase()}
                        </Badge>
                        <span className="text-muted-foreground">{sig.detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Indicators (single unified section) */}
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
    </div>
  );
}
