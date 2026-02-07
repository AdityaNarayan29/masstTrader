"use client";

import { useState } from "react";
import { api } from "@/lib/api";
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface Condition {
  indicator: string;
  parameter: string;
  operator: string;
  value: number | string;
  description: string;
}

interface Rule {
  name: string;
  timeframe: string;
  description: string;
  entry_conditions: Condition[];
  exit_conditions: Condition[];
  stop_loss_pips: number | null;
  take_profit_pips: number | null;
}

interface Strategy {
  name: string;
  rules: Rule[];
  ai_explanation: string;
  symbol: string;
  raw_description: string;
}

const AVAILABLE_INDICATORS = [
  { name: "RSI", label: "Relative Strength Index" },
  { name: "MACD", label: "Line, Signal, Histogram" },
  { name: "EMA", label: "Exponential Moving Avg" },
  { name: "SMA", label: "Simple Moving Avg" },
  { name: "Bollinger Bands", label: "Upper, Mid, Lower" },
  { name: "ATR", label: "Average True Range" },
  { name: "Stochastic", label: "K, D" },
  { name: "ADX", label: "Trend Strength" },
  { name: "Volume", label: "OBV, Ratio" },
];

export default function StrategyPage() {
  const [description, setDescription] = useState("");
  const [symbol, setSymbol] = useState("EURUSD");
  const [loading, setLoading] = useState(false);
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [error, setError] = useState("");
  const [showJson, setShowJson] = useState(false);

  const handleParse = async () => {
    if (!description.trim()) return;
    setLoading(true);
    setError("");
    try {
      const result = await api.strategy.parse(description, symbol);
      setStrategy(result as Strategy);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to parse strategy");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold mb-1">AI Strategy Builder</h1>
      <p className="text-muted-foreground text-sm mb-6">
        Describe your trading strategy in plain English. AI converts it to
        executable rules.
      </p>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded-lg mb-4 text-sm">
          {error}
        </div>
      )}

      {/* Input Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Strategy Description & Controls */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Strategy Description</CardTitle>
            <CardDescription>
              Describe your entry logic, exit logic, timeframe, and risk
              management in natural language.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="strategy-description">Your Strategy</Label>
              <Textarea
                id="strategy-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Example: Buy when RSI crosses below 30 and MACD histogram turns positive. Exit when RSI goes above 70 or price hits 50 pip take profit. Use 1H timeframe with 30 pip stop loss."
                className="min-h-[140px] resize-none"
              />
            </div>
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-2">
                <Label htmlFor="symbol-input">Symbol</Label>
                <Input
                  id="symbol-input"
                  type="text"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  className="w-40"
                />
              </div>
              <Button
                onClick={handleParse}
                disabled={loading || !description.trim()}
              >
                {loading ? "AI is parsing..." : "Parse Strategy with AI"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Available Indicators Sidebar */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Available Indicators</CardTitle>
            <CardDescription>
              Reference these in your strategy description.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {AVAILABLE_INDICATORS.map((ind) => (
                <li key={ind.name} className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">{ind.name}</span>
                  <span className="text-xs text-muted-foreground">
                    ({ind.label})
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Parsed Strategy Results */}
      {strategy && (
        <div className="space-y-4">
          {/* Strategy Overview */}
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <CardTitle className="text-xl">{strategy.name}</CardTitle>
                  <CardDescription>{strategy.ai_explanation}</CardDescription>
                </div>
                <Badge variant="secondary">{strategy.symbol}</Badge>
              </div>
            </CardHeader>
          </Card>

          {/* Rules */}
          {strategy.rules.map((rule, i) => (
            <Card key={i}>
              <CardHeader>
                <div className="flex items-center justify-between gap-4">
                  <CardTitle className="text-base">{rule.name}</CardTitle>
                  <Badge variant="outline">{rule.timeframe}</Badge>
                </div>
                <CardDescription>{rule.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Entry Conditions */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-green-500">
                      Entry Conditions
                    </h4>
                    <div className="space-y-2">
                      {rule.entry_conditions.map((c, j) => (
                        <div
                          key={j}
                          className="flex items-start gap-2 rounded-md border border-green-500/20 bg-green-500/5 px-3 py-2"
                        >
                          <span className="text-green-500 font-bold text-sm leading-5 shrink-0">
                            +
                          </span>
                          <div>
                            <p className="text-sm">{c.description}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {c.indicator} {c.parameter} {c.operator}{" "}
                              {c.value}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Exit Conditions */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-red-500">
                      Exit Conditions
                    </h4>
                    <div className="space-y-2">
                      {rule.exit_conditions.map((c, j) => (
                        <div
                          key={j}
                          className="flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2"
                        >
                          <span className="text-red-500 font-bold text-sm leading-5 shrink-0">
                            -
                          </span>
                          <div>
                            <p className="text-sm">{c.description}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {c.indicator} {c.parameter} {c.operator}{" "}
                              {c.value}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Stop Loss / Take Profit */}
                {(rule.stop_loss_pips !== null ||
                  rule.take_profit_pips !== null) && (
                  <>
                    <Separator />
                    <div className="flex gap-4 items-center">
                      {rule.stop_loss_pips !== null && (
                        <div className="flex items-center gap-2">
                          <Badge variant="destructive">SL</Badge>
                          <span className="text-sm">
                            {rule.stop_loss_pips} pips
                          </span>
                        </div>
                      )}
                      {rule.take_profit_pips !== null && (
                        <div className="flex items-center gap-2">
                          <Badge className="bg-green-600 hover:bg-green-600/90 text-white">
                            TP
                          </Badge>
                          <span className="text-sm">
                            {rule.take_profit_pips} pips
                          </span>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ))}

          {/* Raw JSON Toggle */}
          <Card>
            <CardContent className="pt-6">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowJson(!showJson)}
              >
                {showJson ? "Hide" : "Show"} Raw JSON
              </Button>
              {showJson && (
                <pre className="mt-3 rounded-md border bg-muted/50 p-4 text-xs overflow-x-auto max-h-80 overflow-y-auto">
                  {JSON.stringify(strategy, null, 2)}
                </pre>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
