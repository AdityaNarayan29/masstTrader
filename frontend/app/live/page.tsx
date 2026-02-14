"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { api } from "@/lib/api";
import { useLiveStream } from "@/hooks/use-live-stream";
import { LiveChart } from "@/components/live-chart";
import { Loader2 } from "lucide-react";
import { SymbolCombobox } from "@/components/symbol-combobox";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

export default function LivePage() {
  const [symbol, setSymbol] = useState("EURUSDm");
  const [timeframe, setTimeframe] = useState("1m");
  const [historicalCandles, setHistoricalCandles] = useState<HistoricalCandle[]>([]);
  const [loadingChart, setLoadingChart] = useState(false);
  const [liveStarted, setLiveStarted] = useState(false);

  const stream = useLiveStream(symbol, timeframe);
  const liveInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const [polledPrice, setPolledPrice] = useState<{ bid: number; ask: number; symbol: string } | null>(null);
  const [polledAccount, setPolledAccount] = useState<typeof stream.account>(null);
  const [polledPositions, setPolledPositions] = useState<typeof stream.positions>([]);

  // Merge SSE + HTTP data
  const price = stream.price ?? (polledPrice ? { ...polledPrice, last: 0, volume: 0, time: "" } : null);
  const account = stream.account ?? polledAccount;
  const positions = stream.positions.length > 0 ? stream.positions : polledPositions;

  // RSI data for the subplot
  const rsiData = useMemo(() => {
    return historicalCandles
      .filter((c) => c.RSI_14 != null && !isNaN(Number(c.RSI_14)))
      .map((c) => ({
        time: Math.floor(new Date(c.datetime).getTime() / 1000),
        value: Number(c.RSI_14),
      }));
  }, [historicalCandles]);

  const latestRSI = stream.candle?.indicators?.RSI_14 ?? null;

  // HTTP poll fallback when SSE is not connected
  useEffect(() => {
    if (stream.status === "connected" || !liveStarted) {
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
  }, [stream.status, liveStarted, symbol]);

  const handleStart = async () => {
    setLoadingChart(true);
    setLiveStarted(true);
    try {
      const data = await api.data.fetch(symbol, timeframe, 200);
      setHistoricalCandles(data.candles as unknown as HistoricalCandle[]);
      stream.connect();
    } catch {
      stream.connect();
    } finally {
      setLoadingChart(false);
    }
  };

  const handleStop = () => {
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

  const indicators = stream.candle?.indicators ?? null;

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Market Watch</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Real-time market data, charts, and positions
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
        </CardHeader>
        <CardContent className="space-y-4">
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
            {!liveStarted ? (
              <Button
                onClick={handleStart}
                disabled={loadingChart || stream.status === "connecting" || !symbol}
              >
                {(loadingChart || stream.status === "connecting") && (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                )}
                Watch Market
              </Button>
            ) : (
              <Button variant="outline" onClick={handleStop}>
                Stop
              </Button>
            )}
          </div>
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
              rsiData={rsiData}
              latestRSI={latestRSI}
              className="h-[350px] sm:h-[500px] w-full"
            />
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
    </div>
  );
}
