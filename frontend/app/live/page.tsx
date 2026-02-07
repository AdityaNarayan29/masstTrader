"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useLiveStream } from "@/hooks/use-live-stream";
import { LiveChart } from "@/components/live-chart";
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
}

interface AlgoCondition {
  description: string;
  indicator: string;
  parameter: string;
  operator: string;
  value: number | string;
  passed: boolean;
}

interface AlgoStatus {
  running: boolean;
  symbol: string | null;
  timeframe: string;
  strategy_name: string | null;
  volume: number;
  in_position: boolean;
  position_ticket: number | null;
  trades_placed: number;
  signals: Array<{ time: string; action: string; detail: string }>;
  current_price: { bid: number; ask: number; spread: number } | null;
  indicators: Record<string, number | string | null>;
  entry_conditions: AlgoCondition[];
  exit_conditions: AlgoCondition[];
  last_check: string | null;
}

export default function LivePage() {
  const [symbol, setSymbol] = useState("EURUSDm");
  const [timeframe, setTimeframe] = useState("1m");
  const [historicalCandles, setHistoricalCandles] = useState<HistoricalCandle[]>(
    []
  );
  const [loadingChart, setLoadingChart] = useState(false);

  // Algo trading state
  const [strategies, setStrategies] = useState<Array<{ id: string; name: string; symbol: string }>>([]);
  const [algoStrategyId, setAlgoStrategyId] = useState("__current__");
  const [algoVolume, setAlgoVolume] = useState(0.01);
  const [algo, setAlgo] = useState<AlgoStatus | null>(null);
  const [algoLoading, setAlgoLoading] = useState(false);
  const [algoStopping, setAlgoStopping] = useState(false);
  const algoInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const stream = useLiveStream(symbol, timeframe);

  // Load saved strategies for algo picker
  useEffect(() => {
    api.strategies.list().then(setStrategies).catch(() => {});
  }, []);

  // Poll algo status when running
  useEffect(() => {
    const poll = () => api.algo.status().then(setAlgo).catch(() => {});
    poll();
    algoInterval.current = setInterval(poll, 3000);
    return () => { if (algoInterval.current) clearInterval(algoInterval.current); };
  }, []);

  const handleAlgoStart = async () => {
    setAlgoLoading(true);
    try {
      const stratId = algoStrategyId !== "__current__" ? algoStrategyId : undefined;
      await api.algo.start(symbol, timeframe, algoVolume, stratId);
      const status = await api.algo.status();
      setAlgo(status);
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
      setAlgo(status);
    } catch {
      // ignore
    } finally {
      setAlgoStopping(false);
    }
  };

  const handleStart = async () => {
    setLoadingChart(true);
    try {
      const data = await api.data.fetch(symbol, timeframe, 200);
      setHistoricalCandles(data.candles as unknown as HistoricalCandle[]);
      stream.connect();
    } catch {
      // If data fetch fails (no MT5), still try connecting the stream
      stream.connect();
    } finally {
      setLoadingChart(false);
    }
  };

  const handleStop = () => {
    stream.disconnect();
  };

  const spread = stream.price
    ? ((stream.price.ask - stream.price.bid) * 100000).toFixed(1)
    : "---";

  const statusColor =
    stream.status === "connected"
      ? "default"
      : stream.status === "error"
        ? "destructive"
        : ("secondary" as const);

  const statusLabel =
    stream.status === "connected"
      ? "LIVE"
      : stream.status === "connecting"
        ? "CONNECTING..."
        : stream.status === "error"
          ? "ERROR"
          : "OFFLINE";

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Live Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Real-time market data, positions, and indicators
          </p>
        </div>
        <Badge variant={statusColor} className="text-xs">
          {statusLabel}
        </Badge>
      </div>

      {/* Error */}
      {stream.error && (
        <Card className="border-destructive/50 bg-destructive/10">
          <CardContent className="py-3 text-sm text-red-500">
            {stream.error}
          </CardContent>
        </Card>
      )}

      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stream Controls</CardTitle>
          <CardDescription>
            Select a symbol and timeframe, then start the live stream.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label>Symbol</Label>
              <SymbolCombobox
                value={symbol}
                onChange={setSymbol}
                disabled={stream.status === "connected"}
              />
            </div>
            <div className="space-y-2">
              <Label>Timeframe</Label>
              <Select
                value={timeframe}
                onValueChange={setTimeframe}
                disabled={stream.status === "connected"}
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
            {stream.status !== "connected" ? (
              <Button
                onClick={handleStart}
                disabled={
                  loadingChart || stream.status === "connecting" || !symbol
                }
              >
                {(loadingChart || stream.status === "connecting") && (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                )}
                {loadingChart || stream.status === "connecting"
                  ? "Connecting..."
                  : "Start Live Stream"}
              </Button>
            ) : (
              <Button variant="destructive" onClick={handleStop}>
                Stop
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Price Bar */}
      {stream.price && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card className="border-green-500/20">
            <CardContent className="py-4 text-center">
              <p className="text-xs text-muted-foreground">BID</p>
              <p className="text-2xl font-mono font-bold text-green-500 mt-1">
                {stream.price.bid.toFixed(5)}
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
                {stream.price.ask.toFixed(5)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* TradingView Chart */}
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
              className="h-[280px] sm:h-[400px] w-full"
            />
          </CardContent>
        </Card>
      )}

      {/* Account Info */}
      {stream.account && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            {
              label: "Balance",
              value: `$${stream.account.balance.toFixed(2)}`,
              color: "",
            },
            {
              label: "Equity",
              value: `$${stream.account.equity.toFixed(2)}`,
              color:
                stream.account.equity >= stream.account.balance
                  ? "text-green-500"
                  : "text-red-500",
            },
            {
              label: "Free Margin",
              value: `$${stream.account.free_margin.toFixed(2)}`,
              color: "",
            },
            {
              label: "Floating P/L",
              value: `${stream.account.profit >= 0 ? "+" : ""}$${stream.account.profit.toFixed(2)}`,
              color:
                stream.account.profit >= 0 ? "text-green-500" : "text-red-500",
            },
          ].map((m) => (
            <Card key={m.label} className="py-4">
              <CardContent className="px-4">
                <p className="text-xs text-muted-foreground">{m.label}</p>
                <p className={`text-xl font-semibold mt-1 ${m.color}`}>
                  {m.value}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Positions */}
      {stream.positions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Open Positions
              <Badge variant="secondary" className="ml-2 text-xs">
                {stream.positions.length} active
              </Badge>
            </CardTitle>
            <CardDescription>
              Live P/L updates every second
            </CardDescription>
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
                  {stream.positions.map((pos) => (
                    <TableRow key={pos.ticket}>
                      <TableCell className="font-mono text-xs">
                        {pos.ticket}
                      </TableCell>
                      <TableCell className="font-medium">{pos.symbol}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            pos.type === "buy" ? "default" : "destructive"
                          }
                          className="text-xs"
                        >
                          {pos.type.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {pos.volume}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {pos.open_price.toFixed(5)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {pos.current_price.toFixed(5)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {pos.stop_loss ? pos.stop_loss.toFixed(5) : "---"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {pos.take_profit ? pos.take_profit.toFixed(5) : "---"}
                      </TableCell>
                      <TableCell
                        className={`text-right font-semibold ${
                          pos.profit >= 0 ? "text-green-500" : "text-red-500"
                        }`}
                      >
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



      {/* Indicators */}
      {stream.candle?.indicators && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Technical Indicators</CardTitle>
            <CardDescription>Updated every ~5 seconds</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(stream.candle.indicators).map(([key, value]) => {
                const display = typeof value === "number" ? value.toFixed(4) : String(value);
                return (
                  <div key={key} className="rounded-lg border p-3 min-w-0">
                    <p className="text-xs text-muted-foreground font-mono truncate" title={key}>
                      {key}
                    </p>
                    <p className="text-lg font-semibold font-mono mt-1 truncate" title={display}>
                      {display}
                    </p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}



      {/* Algo Trading */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Algo Trading</CardTitle>
              <CardDescription>
                Automatically trade using your strategy rules
              </CardDescription>
            </div>
            {algo?.running && (
              <Badge className="bg-primary text-primary-foreground animate-pulse">
                RUNNING
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!algo?.running ? (
            <div className="flex flex-wrap items-end gap-4">
              {strategies.length > 0 && (
                <div className="space-y-2">
                  <Label>Strategy</Label>
                  <Select value={algoStrategyId} onValueChange={setAlgoStrategyId}>
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
              <div className="space-y-2">
                <Label>Volume (lots)</Label>
                <Input
                  type="number"
                  value={algoVolume}
                  onChange={(e) => setAlgoVolume(parseFloat(e.target.value) || 0.01)}
                  className="w-28"
                  step="0.01"
                  min="0.01"
                />
              </div>
              <Button
                onClick={handleAlgoStart}
                disabled={algoLoading}
              >
                {algoLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {algoLoading ? "Starting..." : "Start Algo Trading"}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Status bar */}
              <div className="flex flex-wrap gap-4 items-center">
                <div className="text-sm">
                  <span className="text-muted-foreground">Strategy:</span>{" "}
                  <span className="font-medium">{algo.strategy_name}</span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Symbol:</span>{" "}
                  <span className="font-mono">{algo.symbol}</span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Volume:</span>{" "}
                  <span className="font-mono">{algo.volume}</span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Trades:</span>{" "}
                  <span className="font-semibold">{algo.trades_placed}</span>
                </div>
                {algo.in_position && (
                  <Badge variant="default">In Position #{algo.position_ticket}</Badge>
                )}
                {algo.last_check && (
                  <span className="text-xs text-muted-foreground">
                    Last check: {new Date(algo.last_check).toLocaleTimeString()}
                  </span>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleAlgoStop}
                  disabled={algoStopping}
                >
                  {algoStopping && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                  {algoStopping ? "Stopping..." : "Stop Algo"}
                </Button>
              </div>

              {/* Current Price */}
              {algo.current_price && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="rounded-lg border border-green-500/20 p-3 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">Bid</p>
                    <p className="text-lg font-mono font-bold text-green-500">
                      {algo.current_price.bid.toFixed(5)}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">Spread</p>
                    <p className="text-lg font-mono font-bold">
                      {(algo.current_price.spread * 100000).toFixed(1)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-red-500/20 p-3 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">Ask</p>
                    <p className="text-lg font-mono font-bold text-red-500">
                      {algo.current_price.ask.toFixed(5)}
                    </p>
                  </div>
                </div>
              )}

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

              {/* Live Indicators */}
              {algo.indicators && Object.keys(algo.indicators).length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Live Indicators</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {Object.entries(algo.indicators).map(([key, val]) => {
                      const display = typeof val === "number" ? val.toFixed(4) : val == null ? "---" : String(val);
                      return (
                        <div key={key} className="rounded-lg border p-2 min-w-0">
                          <p className="text-[10px] text-muted-foreground font-mono truncate" title={key}>{key}</p>
                          <p className="text-sm font-semibold font-mono truncate" title={display}>
                            {display}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

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
                              sig.action === "buy"
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
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
