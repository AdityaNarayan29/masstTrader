"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import ReactMarkdown from "react-markdown";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  XAxis,
  YAxis,
} from "recharts";
import {
  createChart,
  CandlestickSeries,
  createSeriesMarkers,
  type IChartApi,
  type CandlestickData,
  type Time,
} from "lightweight-charts";
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
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

interface BacktestStats {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_profit: number;
  profit_factor: number;
  max_drawdown: number;
  sharpe_ratio: number;
  avg_win: number;
  avg_loss: number;
  best_trade: number;
  worst_trade: number;
  final_balance: number;
}

interface Trade {
  entry_price: number;
  exit_price: number;
  entry_time: string;
  exit_time: string;
  pnl_pips: number;
  profit: number;
  exit_reason: string;
}

interface BacktestCandle {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export default function BacktestPage() {
  const [strategies, setStrategies] = useState<Array<{ id: string; name: string; symbol: string }>>([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState("__current__");
  const [balance, setBalance] = useState(10000);
  const [risk, setRisk] = useState(1);
  const [timeframe, setTimeframe] = useState("1h");
  const [bars, setBars] = useState(2000);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.strategies.list().then(setStrategies).catch(() => {});
  }, []);
  const [stats, setStats] = useState<BacktestStats | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [equityCurve, setEquityCurve] = useState<number[]>([]);
  const [candles, setCandles] = useState<BacktestCandle[]>([]);
  const [error, setError] = useState("");
  const [explanation, setExplanation] = useState("");
  const [explaining, setExplaining] = useState(false);

  // Candlestick chart refs
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const handleRun = async () => {
    setLoading(true);
    setError("");
    setExplanation("");
    try {
      const stratId = selectedStrategyId !== "__current__" ? selectedStrategyId : undefined;
      const result = await api.backtest.run(balance, risk, stratId, timeframe, bars);
      setStats(result.stats);
      setTrades(result.trades);
      setEquityCurve(result.equity_curve);
      setCandles(result.candles || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Backtest failed");
    } finally {
      setLoading(false);
    }
  };

  // Render candlestick chart with trade markers
  useEffect(() => {
    if (!chartContainerRef.current || candles.length === 0) return;

    // Clean up previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: "transparent" },
        textColor: "#a1a1aa",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.05)" },
        horzLines: { color: "rgba(255,255,255,0.05)" },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.1)" },
      timeScale: { borderColor: "rgba(255,255,255,0.1)", timeVisible: true },
    });
    chartRef.current = chart;

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    const chartData: CandlestickData<Time>[] = candles.map((c) => ({
      time: (Math.floor(new Date(c.datetime).getTime() / 1000)) as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    series.setData(chartData);

    // Add trade markers
    if (trades.length > 0) {
      const markers = trades.flatMap((t) => {
        const entryTime = (Math.floor(new Date(t.entry_time).getTime() / 1000)) as Time;
        const exitTime = (Math.floor(new Date(t.exit_time).getTime() / 1000)) as Time;
        return [
          {
            time: entryTime,
            position: "belowBar" as const,
            color: "#22c55e",
            shape: "arrowUp" as const,
            text: `BUY ${t.entry_price.toFixed(5)}`,
          },
          {
            time: exitTime,
            position: "aboveBar" as const,
            color: t.profit >= 0 ? "#22c55e" : "#ef4444",
            shape: "arrowDown" as const,
            text: `${t.exit_reason} ${t.profit >= 0 ? "+" : ""}$${t.profit.toFixed(2)}`,
          },
        ];
      });
      // Sort markers by time (required by lightweight-charts)
      markers.sort((a, b) => (a.time as number) - (b.time as number));
      createSeriesMarkers(series, markers);
    }

    chart.timeScale().fitContent();

    // Responsive resize
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      chart.applyOptions({ width, height });
    });
    ro.observe(chartContainerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, trades]);

  const handleExplain = async () => {
    setExplaining(true);
    try {
      const res = await api.backtest.explain();
      setExplanation(res.explanation);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Explain failed");
    } finally {
      setExplaining(false);
    }
  };

  // Chart configs
  const equityChartConfig = {
    equity: { label: "Equity", color: "var(--chart-1)" },
  } satisfies ChartConfig;

  const equityData = equityCurve.map((v, i) => ({ trade: i, equity: v }));
  const trending =
    equityCurve.length >= 2 &&
    equityCurve[equityCurve.length - 1] >= equityCurve[0];
  const equityColor = trending ? "#22c55e" : "#ef4444";

  const winLossConfig = {
    wins: { label: "Wins", color: "#22c55e" },
    losses: { label: "Losses", color: "#ef4444" },
  } satisfies ChartConfig;

  const tradePnlConfig = {
    profit: { label: "Profit", color: "var(--chart-1)" },
  } satisfies ChartConfig;

  const tradePnlData = trades.map((t, i) => ({
    trade: i + 1,
    profit: t.profit,
  }));

  const statItems = stats
    ? [
        {
          label: "Total Trades",
          value: stats.total_trades.toString(),
          color: "",
        },
        {
          label: "Win Rate",
          value: `${stats.win_rate.toFixed(1)}%`,
          color: stats.win_rate >= 50 ? "text-green-500" : "text-red-500",
        },
        {
          label: "Total Profit",
          value: `$${stats.total_profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          color: stats.total_profit >= 0 ? "text-green-500" : "text-red-500",
        },
        {
          label: "Profit Factor",
          value: stats.profit_factor.toFixed(2),
          color: stats.profit_factor >= 1 ? "text-green-500" : "text-red-500",
        },
        {
          label: "Max Drawdown",
          value: `${stats.max_drawdown.toFixed(2)}%`,
          color: "text-red-500",
        },
        {
          label: "Sharpe Ratio",
          value: stats.sharpe_ratio.toFixed(2),
          color: stats.sharpe_ratio >= 1 ? "text-green-500" : stats.sharpe_ratio >= 0 ? "text-muted-foreground" : "text-red-500",
        },
        {
          label: "Avg Win",
          value: `$${stats.avg_win.toFixed(2)}`,
          color: "text-green-500",
        },
        {
          label: "Avg Loss",
          value: `$${stats.avg_loss.toFixed(2)}`,
          color: "text-red-500",
        },
      ]
    : [];

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Strategy Backtester</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Test your parsed strategy against historical data
        </p>
      </div>

      {/* Error */}
      {error && (
        <Card className="border-destructive/50 bg-destructive/10">
          <CardContent className="py-3 text-sm text-red-500">
            {error}
          </CardContent>
        </Card>
      )}

      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Backtest Parameters</CardTitle>
          <CardDescription>
            Configure initial capital and risk settings before running the backtest.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-6 items-end">
            {strategies.length > 0 && (
              <div className="space-y-2">
                <Label>Strategy</Label>
                <Select value={selectedStrategyId} onValueChange={setSelectedStrategyId}>
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder="Use current strategy" />
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
              <Label htmlFor="balance">Initial Balance ($)</Label>
              <Input
                id="balance"
                type="number"
                value={balance}
                onChange={(e) => setBalance(parseFloat(e.target.value) || 0)}
                className="w-40"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="risk">Risk per Trade (%)</Label>
              <Input
                id="risk"
                type="number"
                value={risk}
                onChange={(e) => setRisk(parseFloat(e.target.value) || 0)}
                className="w-32"
                step="0.5"
              />
            </div>
            <div className="space-y-2">
              <Label>Timeframe</Label>
              <Select value={timeframe} onValueChange={setTimeframe}>
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5m">5m</SelectItem>
                  <SelectItem value="15m">15m</SelectItem>
                  <SelectItem value="30m">30m</SelectItem>
                  <SelectItem value="1h">1h</SelectItem>
                  <SelectItem value="4h">4h</SelectItem>
                  <SelectItem value="1d">1d</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bars">Bars</Label>
              <Input
                id="bars"
                type="number"
                value={bars}
                onChange={(e) => setBars(parseInt(e.target.value) || 500)}
                className="w-24"
              />
            </div>
            <Button onClick={handleRun} disabled={loading}>
              {loading ? "Running..." : "Run Backtest"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {stats && (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {statItems.map((item) => (
              <Card key={item.label} className="py-4">
                <CardContent className="py-0">
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className={`text-xl font-semibold mt-1 ${item.color}`}>
                    {item.value}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Summary badges */}
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">
              Wins: {stats.winning_trades}
            </Badge>
            <Badge variant="outline">
              Losses: {stats.losing_trades}
            </Badge>
            <Badge variant={stats.best_trade >= 0 ? "default" : "destructive"}>
              Best: ${stats.best_trade.toFixed(2)}
            </Badge>
            <Badge variant="destructive">
              Worst: ${stats.worst_trade.toFixed(2)}
            </Badge>
            <Badge variant={stats.final_balance >= balance ? "default" : "destructive"}>
              Final Balance: ${stats.final_balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Badge>
          </div>

          {/* Price Chart with Trade Markers */}
          {candles.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Price Chart
                  {trades.length > 0 && (
                    <Badge variant="secondary" className="ml-2 text-xs">
                      {trades.length} trades marked
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  Historical candles used for backtesting — green arrows = entries, red arrows = exits
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div ref={chartContainerRef} className="h-[400px] w-full" />
              </CardContent>
            </Card>
          )}

          <Separator />

          {/* Equity Curve */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Equity Curve</CardTitle>
              <CardDescription>
                Portfolio value over the duration of the backtest
              </CardDescription>
            </CardHeader>
            <CardContent>
              {equityData.length >= 2 && (
                <ChartContainer config={equityChartConfig} className="h-64 w-full">
                  <AreaChart data={equityData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={equityColor} stopOpacity={0.25} />
                        <stop offset="100%" stopColor={equityColor} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="trade"
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `#${v}`}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `$${v.toLocaleString()}`}
                      width={80}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(value) => `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                        />
                      }
                    />
                    <Area
                      dataKey="equity"
                      type="monotone"
                      stroke={equityColor}
                      strokeWidth={2}
                      fill="url(#equityGradient)"
                    />
                  </AreaChart>
                </ChartContainer>
              )}
              <div className="flex justify-between text-xs text-muted-foreground mt-2">
                <span>Start: ${balance.toLocaleString()}</span>
                <span>End: ${stats.final_balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </CardContent>
          </Card>

          {/* Win/Loss Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Win / Loss Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={winLossConfig} className="h-32 w-full">
                <BarChart
                  layout="vertical"
                  data={[
                    { name: "Result", wins: stats.winning_trades, losses: stats.losing_trades },
                  ]}
                  margin={{ top: 0, right: 4, bottom: 0, left: 0 }}
                >
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" hide />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="wins" stackId="a" fill="#22c55e" radius={[4, 0, 0, 4]} />
                  <Bar dataKey="losses" stackId="a" fill="#ef4444" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ChartContainer>
              <div className="flex justify-center gap-6 text-xs text-muted-foreground mt-2">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-green-500" />
                  Wins: {stats.winning_trades}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-red-500" />
                  Losses: {stats.losing_trades}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Trade P/L Chart */}
          {tradePnlData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Trade Profit / Loss</CardTitle>
                <CardDescription>
                  Per-trade profit — green for wins, red for losses
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={tradePnlConfig} className="h-48 w-full">
                  <BarChart data={tradePnlData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="trade"
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `#${v}`}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `$${v}`}
                      width={60}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(value) => `$${Number(value).toFixed(2)}`}
                        />
                      }
                    />
                    <Bar dataKey="profit" radius={[3, 3, 0, 0]}>
                      {tradePnlData.map((entry, index) => (
                        <Cell
                          key={index}
                          fill={entry.profit >= 0 ? "#22c55e" : "#ef4444"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          )}

          {/* Trade History */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Trade History
                <Badge variant="secondary" className="ml-2 text-xs">
                  {trades.length} trades
                </Badge>
              </CardTitle>
              <CardDescription>
                Full list of trades executed during the backtest
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-h-96 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Entry Time</TableHead>
                      <TableHead className="text-right">Entry</TableHead>
                      <TableHead className="text-right">Exit</TableHead>
                      <TableHead className="text-right">Pips</TableHead>
                      <TableHead className="text-right">Profit</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trades.map((t, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="text-xs">{t.entry_time}</TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {t.entry_price.toFixed(5)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {t.exit_price.toFixed(5)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-medium ${
                            t.pnl_pips >= 0 ? "text-green-500" : "text-red-500"
                          }`}
                        >
                          {t.pnl_pips >= 0 ? "+" : ""}
                          {t.pnl_pips.toFixed(1)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-semibold ${
                            t.profit >= 0 ? "text-green-500" : "text-red-500"
                          }`}
                        >
                          {t.profit >= 0 ? "+" : ""}${t.profit.toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs font-normal">
                            {t.exit_reason}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Separator />

          {/* AI Analysis */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">AI Analysis</CardTitle>
                <CardDescription>
                  Get an AI-powered breakdown of your backtest results
                </CardDescription>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleExplain}
                disabled={explaining}
              >
                {explaining ? "Analyzing..." : "Get AI Explanation"}
              </Button>
            </CardHeader>
            {explanation && (
              <CardContent>
                <div className="prose prose-sm prose-lesson max-w-none text-sm">
                  <ReactMarkdown>{explanation}</ReactMarkdown>
                </div>
              </CardContent>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
