"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import ReactMarkdown from "react-markdown";
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

export default function BacktestPage() {
  const [balance, setBalance] = useState(10000);
  const [risk, setRisk] = useState(1);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<BacktestStats | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [equityCurve, setEquityCurve] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [explanation, setExplanation] = useState("");
  const [explaining, setExplaining] = useState(false);

  const handleRun = async () => {
    setLoading(true);
    setError("");
    setExplanation("");
    try {
      const result = await api.backtest.run(balance, risk);
      setStats(result.stats);
      setTrades(result.trades);
      setEquityCurve(result.equity_curve);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Backtest failed");
    } finally {
      setLoading(false);
    }
  };

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

  const renderEquityCurve = () => {
    if (equityCurve.length < 2) return null;
    const min = Math.min(...equityCurve);
    const max = Math.max(...equityCurve);
    const range = max - min || 1;
    const w = 800;
    const h = 200;
    const padding = 4;
    const points = equityCurve
      .map((v, i) => {
        const x = (i / (equityCurve.length - 1)) * w;
        const y = padding + (h - 2 * padding) - ((v - min) / range) * (h - 2 * padding);
        return `${x},${y}`;
      })
      .join(" ");
    const trending = equityCurve[equityCurve.length - 1] >= equityCurve[0];
    const lineColor = trending ? "#22c55e" : "#ef4444";
    const fillColor = trending ? "#22c55e" : "#ef4444";

    // Build area fill path
    const firstPoint = points.split(" ")[0];
    const lastPoint = points.split(" ")[points.split(" ").length - 1];
    const firstX = firstPoint.split(",")[0];
    const lastX = lastPoint.split(",")[0];
    const areaPath = `M${firstX},${h} L${points.replace(/ /g, " L")} L${lastX},${h} Z`;

    return (
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-48" preserveAspectRatio="none">
        <defs>
          <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fillColor} stopOpacity="0.2" />
            <stop offset="100%" stopColor={fillColor} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#equityFill)" />
        <polyline fill="none" stroke={lineColor} strokeWidth="2" points={points} />
        {/* Baseline */}
        <line
          x1="0" y1={h - 1} x2={w} y2={h - 1}
          stroke="currentColor" strokeOpacity="0.1" strokeWidth="1"
        />
      </svg>
    );
  };

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
              {renderEquityCurve()}
              <div className="flex justify-between text-xs text-muted-foreground mt-2">
                <span>Start: ${balance.toLocaleString()}</span>
                <span>End: ${stats.final_balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </CardContent>
          </Card>

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
                <div className="prose prose-sm prose-invert dark:prose-invert max-w-none text-sm text-muted-foreground">
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
