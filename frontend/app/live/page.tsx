"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { api } from "@/lib/api";
import { useLiveStream } from "@/hooks/use-live-stream";
import { LiveChart } from "@/components/live-chart";
import { Loader2 } from "lucide-react";
import { MarketBar } from "@/components/trade/market-bar";
import { Panel, Empty } from "@/components/trade/panel";
import { Stat } from "@/components/trade/stat";
import { fmtMoney, fmtPrice, Signed, dirClass, dir } from "@/components/trade/num";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];

export default function LivePage() {
  const [symbol, setSymbol] = useState("EURUSDm");
  const [timeframe, setTimeframe] = useState("15m");
  const [historicalCandles, setHistoricalCandles] = useState<HistoricalCandle[]>([]);
  const [loadingChart, setLoadingChart] = useState(false);
  // True when the chart is showing generated sample data because MT5 is down.
  // Labelled prominently — a chart you might mistake for the real market is
  // worse than no chart at all.
  const [isSample, setIsSample] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const stream = useLiveStream(symbol, timeframe);

  const [polledPositions, setPolledPositions] = useState<typeof stream.positions>([]);
  const liveInterval = useRef<NodeJS.Timeout | null>(null);

  const positions = stream.positions?.length ? stream.positions : polledPositions;
  const account = stream.account;

  // Load chart history whenever the instrument or timeframe changes.
  // The old page waited for a "Watch Market" click, which left a trading
  // screen empty on arrival — the one thing a market view must never be.
  const loadChart = useCallback(async () => {
    setLoadingChart(true);
    setDataError(null);
    try {
      const data = await api.data.fetch(symbol, timeframe, 300);
      setHistoricalCandles(data.candles as unknown as HistoricalCandle[]);
      setIsSample(false);
    } catch (e) {
      // MT5 down: fall back to generated data so the layout, indicators and
      // interactions stay explorable instead of the screen going dead.
      setDataError(e instanceof Error ? e.message : "Failed to load market data");
      try {
        const demo = await api.data.demo();
        setHistoricalCandles(demo.candles as unknown as HistoricalCandle[]);
        setIsSample(true);
      } catch {
        setHistoricalCandles([]);
        setIsSample(false);
      }
    } finally {
      setLoadingChart(false);
    }
  }, [symbol, timeframe]);

  useEffect(() => {
    loadChart();
    stream.connect();
    return () => stream.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe]);

  // HTTP fallback for positions when SSE is unavailable.
  useEffect(() => {
    const poll = () => {
      api.mt5.positions().then(setPolledPositions).catch(() => {});
    };
    poll();
    liveInterval.current = setInterval(poll, 3000);
    return () => {
      if (liveInterval.current) clearInterval(liveInterval.current);
    };
  }, [symbol]);

  const indicators = stream.candle?.indicators ?? null;
  const digits = useMemo(
    () =>
      symbol.toUpperCase().includes("JPY") ? 3
        : symbol.toUpperCase().includes("XAU") ? 2
        : symbol.toUpperCase().includes("BTC") ? 1
        : 5,
    [symbol]
  );

  const totalPnl = positions.reduce((a, p) => a + (p.profit || 0), 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <MarketBar symbol={symbol} onSymbolChange={setSymbol} />

      {isSample && (
        <div className="flex shrink-0 items-center gap-2 border-b border-warn/30 bg-warn/10 px-3 py-1.5 text-xs">
          <span className="rounded bg-warn px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-background">
            Sample data
          </span>
          <span className="text-muted-foreground">
            {dataError ?? "MT5 is not connected"} — showing generated candles so the
            interface stays usable. Prices are not real.
          </span>
        </div>
      )}

      {/* Chart + right rail. Chart takes the space; everything else is
          secondary and sized to its content. */}
      <div className="flex min-h-0 flex-1 gap-2 p-2">
        <Panel
          className="min-w-0 flex-1"
          flush
          title={
            <span className="flex items-center gap-2">
              {symbol}
              <span className="text-muted-foreground/60">·</span>
              <span className="normal-case tracking-normal">{timeframe}</span>
            </span>
          }
          actions={
            <>
              <Select value={timeframe} onValueChange={setTimeframe}>
                <SelectTrigger size="sm" className="h-7 w-[74px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEFRAMES.map((tf) => (
                    <SelectItem key={tf} value={tf} className="text-xs">
                      {tf}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={loadChart}
                disabled={loadingChart}
              >
                {loadingChart ? <Loader2 className="size-3 animate-spin" /> : "Reload"}
              </Button>
            </>
          }
        >
          <div className="relative h-full min-h-[320px]">
            {loadingChart && historicalCandles.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : historicalCandles.length === 0 ? (
              <Empty>
                No chart data. Connect MT5 from the Connection page, then reload.
              </Empty>
            ) : (
              <LiveChart
                historicalCandles={historicalCandles}
                latestCandle={stream.candle ?? null}
                className="h-full"
              />
            )}
          </div>
        </Panel>

        {/* Right rail */}
        <div className="flex w-[280px] shrink-0 flex-col gap-2 overflow-y-auto">
          <Panel title="Account">
            {account ? (
              <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                <Stat label="Balance" value={fmtMoney(account.balance)} tone="none" size="sm" />
                <Stat label="Equity" value={fmtMoney(account.equity)} tone="none" size="sm" />
                <Stat
                  label="Free margin"
                  value={fmtMoney(account.free_margin)}
                  tone="none"
                  size="sm"
                />
                <Stat label="Margin" value={fmtMoney(account.margin)} tone="none" size="sm" />
                <Stat
                  label="Open P&L"
                  value={<Signed value={totalPnl} format={(v) => fmtMoney(v)} />}
                  tone="none"
                  size="sm"
                  className="col-span-2"
                  sub={`${positions.length} position${positions.length === 1 ? "" : "s"}`}
                />
              </div>
            ) : (
              <Empty>Not connected to MT5.</Empty>
            )}
          </Panel>

          <Panel title="Indicators">
            {indicators ? (
              <dl className="space-y-1.5 text-xs">
                {Object.entries(indicators)
                  .filter(([, v]) => typeof v === "number" && Number.isFinite(v))
                  .slice(0, 12)
                  .map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between gap-2">
                      <dt className="truncate text-muted-foreground">{k}</dt>
                      <dd className="price shrink-0 font-medium">
                        {fmtPrice(v as number, Math.abs(v as number) > 100 ? 2 : 5)}
                      </dd>
                    </div>
                  ))}
              </dl>
            ) : (
              <Empty>Waiting for the first candle.</Empty>
            )}
          </Panel>
        </div>
      </div>

      {/* Positions — the thing you check most often, so it gets a
          permanent home rather than living below the fold. */}
      <div className="min-h-0 shrink-0 px-2 pb-2">
        <Panel
          title={`Open positions${positions.length ? ` (${positions.length})` : ""}`}
          flush
          className="max-h-[220px]"
          actions={
            positions.length > 0 && (
              <span className="text-xs">
                <Signed value={totalPnl} format={(v) => fmtMoney(v)} />
              </span>
            )
          }
        >
          {positions.length === 0 ? (
            <Empty>No open positions.</Empty>
          ) : (
            <div className="max-h-[180px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface-1">
                  <tr className="border-b border-grid-line text-[10px] uppercase tracking-wider text-muted-foreground">
                    <Th className="text-left">Symbol</Th>
                    <Th className="text-left">Side</Th>
                    <Th>Volume</Th>
                    <Th>Open</Th>
                    <Th>Current</Th>
                    <Th>SL</Th>
                    <Th>TP</Th>
                    <Th>P&L</Th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => {
                    const isBuy = p.type?.toLowerCase().includes("buy");
                    return (
                      <tr
                        key={p.ticket}
                        className="border-b border-grid-line/60 last:border-0 hover:bg-surface-2"
                      >
                        <Td className="text-left font-medium">{p.symbol}</Td>
                        <Td className="text-left">
                          <span className={isBuy ? "text-up" : "text-down"}>
                            {isBuy ? "BUY" : "SELL"}
                          </span>
                        </Td>
                        <Td>{p.volume}</Td>
                        <Td>{fmtPrice(p.open_price, digits)}</Td>
                        <Td>{fmtPrice(p.current_price, digits)}</Td>
                        <Td className="text-muted-foreground">
                          {p.stop_loss ? fmtPrice(p.stop_loss, digits) : "—"}
                        </Td>
                        <Td className="text-muted-foreground">
                          {p.take_profit ? fmtPrice(p.take_profit, digits) : "—"}
                        </Td>
                        <Td className={cn("font-medium", dirClass[dir(p.profit)])}>
                          {fmtMoney(p.profit)}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn("px-3 py-2 text-right font-medium", className)}>{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("price px-3 py-1.5 text-right", className)}>{children}</td>;
}
