"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import ReactMarkdown from "react-markdown";
import { RadialBar, RadialBarChart, PolarAngleAxis } from "recharts";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  ChartContainer,
  type ChartConfig,
} from "@/components/ui/chart";

export default function AnalyzerPage() {
  const [form, setForm] = useState({
    symbol: "EURUSD",
    trade_type: "buy",
    entry_price: 1.1,
    exit_price: 1.105,
    profit: 50,
    open_time: "2024-01-15 10:00:00",
    close_time: "2024-01-15 14:00:00",
    rsi: 45,
    macd_hist: 0.0005,
    ema50: 1.098,
    vol_ratio: 1.2,
  });
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState("");
  const [score, setScore] = useState<number | null>(null);
  const [error, setError] = useState("");

  const handleAnalyze = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.analyze.trade({
        symbol: form.symbol,
        trade_type: form.trade_type,
        entry_price: form.entry_price,
        exit_price: form.exit_price,
        profit: form.profit,
        open_time: form.open_time,
        close_time: form.close_time,
        indicators_at_entry: {
          RSI_14: form.rsi,
          MACD_histogram: form.macd_hist,
          EMA_50: form.ema50,
          Volume_ratio: form.vol_ratio,
        },
      });
      setAnalysis(result.analysis);
      setScore(result.alignment_score);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  };

  const update = (key: string, value: unknown) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const scoreColor =
    score !== null
      ? score >= 70
        ? "border-green-500/40 bg-green-500/10 text-green-400"
        : score >= 40
          ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-400"
          : "border-red-500/40 bg-red-500/10 text-red-400"
      : "";

  const scoreLabel =
    score !== null
      ? score >= 70
        ? "Strong Alignment"
        : score >= 40
          ? "Partial Alignment"
          : "Weak Alignment"
      : "";

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI Trade Analyzer</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Enter a trade you took. AI compares it against your strategy and tells
          you what went right or wrong.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Trade Details Form */}
      <Card>
        <CardHeader>
          <CardTitle>Trade Details</CardTitle>
          <CardDescription>
            Provide the specifics of your executed trade for analysis.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="symbol">Symbol</Label>
              <Input
                id="symbol"
                type="text"
                value={form.symbol}
                onChange={(e) => update("symbol", e.target.value)}
                placeholder="e.g. EURUSD"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="trade_type">Trade Type</Label>
              <Select
                value={form.trade_type}
                onValueChange={(value) => update("trade_type", value)}
              >
                <SelectTrigger id="trade_type" className="w-full">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="buy">Buy</SelectItem>
                  <SelectItem value="sell">Sell</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="entry_price">Entry Price</Label>
              <Input
                id="entry_price"
                type="number"
                value={form.entry_price}
                onChange={(e) =>
                  update("entry_price", parseFloat(e.target.value))
                }
                step="0.00001"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="exit_price">Exit Price</Label>
              <Input
                id="exit_price"
                type="number"
                value={form.exit_price}
                onChange={(e) =>
                  update("exit_price", parseFloat(e.target.value))
                }
                step="0.00001"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="profit">Profit / Loss ($)</Label>
              <Input
                id="profit"
                type="number"
                value={form.profit}
                onChange={(e) => update("profit", parseFloat(e.target.value))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="open_time">Open Time</Label>
              <Input
                id="open_time"
                type="text"
                value={form.open_time}
                onChange={(e) => update("open_time", e.target.value)}
                placeholder="YYYY-MM-DD HH:MM:SS"
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="close_time">Close Time</Label>
              <Input
                id="close_time"
                type="text"
                value={form.close_time}
                onChange={(e) => update("close_time", e.target.value)}
                placeholder="YYYY-MM-DD HH:MM:SS"
              />
            </div>
          </div>

          <Separator />

          {/* Indicator Values */}
          <div>
            <h3 className="text-sm font-semibold mb-4">
              Indicator Values at Entry
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="rsi">RSI (14)</Label>
                <Input
                  id="rsi"
                  type="number"
                  value={form.rsi}
                  onChange={(e) => update("rsi", parseFloat(e.target.value))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="macd_hist">MACD Histogram</Label>
                <Input
                  id="macd_hist"
                  type="number"
                  value={form.macd_hist}
                  onChange={(e) =>
                    update("macd_hist", parseFloat(e.target.value))
                  }
                  step="0.00001"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ema50">EMA 50</Label>
                <Input
                  id="ema50"
                  type="number"
                  value={form.ema50}
                  onChange={(e) => update("ema50", parseFloat(e.target.value))}
                  step="0.00001"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="vol_ratio">Volume Ratio</Label>
                <Input
                  id="vol_ratio"
                  type="number"
                  value={form.vol_ratio}
                  onChange={(e) =>
                    update("vol_ratio", parseFloat(e.target.value))
                  }
                  step="0.1"
                />
              </div>
            </div>
          </div>

          <Button onClick={handleAnalyze} disabled={loading} size="lg">
            {loading ? "AI is analyzing..." : "Analyze Trade with AI"}
          </Button>
        </CardContent>
      </Card>

      {/* Strategy Alignment Score — Radial Gauge */}
      {score !== null && (() => {
        const gaugeColor = score >= 70 ? "#22c55e" : score >= 40 ? "#eab308" : "#ef4444";
        const gaugeConfig = {
          score: { label: "Score", color: gaugeColor },
        } satisfies ChartConfig;

        return (
          <Card className={scoreColor}>
            <CardContent className="flex flex-col items-center justify-center py-6">
              <p className="text-xs font-medium uppercase tracking-widest opacity-80 mb-2">
                Strategy Alignment Score
              </p>
              <ChartContainer config={gaugeConfig} className="h-44 w-44">
                <RadialBarChart
                  innerRadius="75%"
                  outerRadius="100%"
                  data={[{ score, fill: gaugeColor }]}
                  startAngle={90}
                  endAngle={-270}
                >
                  <PolarAngleAxis
                    type="number"
                    domain={[0, 100]}
                    angleAxisId={0}
                    tick={false}
                  />
                  <RadialBar
                    dataKey="score"
                    background={{ fill: "hsl(var(--muted))" }}
                    cornerRadius={8}
                    angleAxisId={0}
                  />
                  <text
                    x="50%"
                    y="50%"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="fill-foreground"
                  >
                    <tspan className="text-3xl font-bold" x="50%" dy="-4">
                      {score}
                    </tspan>
                    <tspan className="text-xs fill-muted-foreground" x="50%" dy="18">
                      / 100
                    </tspan>
                  </text>
                </RadialBarChart>
              </ChartContainer>
              <p className="text-sm mt-1 opacity-70">{scoreLabel}</p>
            </CardContent>
          </Card>
        );
      })()}

      {/* AI Analysis */}
      {analysis && (
        <Card>
          <CardHeader>
            <CardTitle>AI Analysis</CardTitle>
            <CardDescription>
              Detailed breakdown of how this trade aligns with your strategy.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm prose-invert max-w-none text-sm text-muted-foreground">
              <ReactMarkdown>{analysis}</ReactMarkdown>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
