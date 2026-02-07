"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { Loader2, Save, Trash2, Download } from "lucide-react";
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
  id?: string;
  name: string;
  rules: Rule[];
  ai_explanation: string;
  symbol: string;
  raw_description: string;
  created_at?: string;
  updated_at?: string;
}

interface StrategySummary {
  id: string;
  name: string;
  symbol: string;
  rule_count: number;
  created_at: string;
  updated_at: string;
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

  // Persistence state
  const [savedStrategies, setSavedStrategies] = useState<StrategySummary[]>([]);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    api.strategies.list().then(setSavedStrategies).catch(() => {});
  }, []);

  const refreshList = () => {
    api.strategies.list().then(setSavedStrategies).catch(() => {});
  };

  const handleParse = async () => {
    if (!description.trim()) return;
    setLoading(true);
    setError("");
    try {
      const result = await api.strategy.parse(description, symbol);
      setStrategy(result as Strategy);
      // If we were editing a saved strategy, keep the editingId so "Update" shows
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to parse strategy");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!strategy) return;
    setSaving(true);
    setError("");
    try {
      if (editingId) {
        await api.strategies.update(editingId);
      } else {
        const saved = await api.strategies.save();
        setEditingId(saved.id);
      }
      refreshList();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save strategy");
    } finally {
      setSaving(false);
    }
  };

  const handleLoad = async (id: string) => {
    setError("");
    setLoadingId(id);
    try {
      const s = await api.strategies.load(id);
      const loaded = s as unknown as Strategy;
      setStrategy(loaded);
      setDescription(loaded.raw_description || "");
      setSymbol(loaded.symbol || "EURUSD");
      setEditingId(loaded.id || id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load strategy");
    } finally {
      setLoadingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setError("");
    setDeletingId(id);
    try {
      await api.strategies.delete(id);
      if (editingId === id) {
        setEditingId(null);
        setStrategy(null);
      }
      refreshList();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete strategy");
    } finally {
      setDeletingId(null);
    }
  };

  const handleNew = () => {
    setEditingId(null);
    setStrategy(null);
    setDescription("");
    setSymbol("EURUSD");
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

      {/* Saved Strategies */}
      {savedStrategies.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Saved Strategies</CardTitle>
              {editingId && (
                <Button variant="outline" size="sm" onClick={handleNew}>
                  + New Strategy
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {savedStrategies.map((s) => (
                <div
                  key={s.id}
                  className={`flex items-center justify-between rounded-lg border px-4 py-3 ${
                    editingId === s.id
                      ? "border-primary bg-primary/5"
                      : "border-border"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{s.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.symbol} &middot; {s.rule_count} rule{s.rule_count !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleLoad(s.id)}
                      disabled={loadingId === s.id || deletingId === s.id}
                    >
                      {loadingId === s.id ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5 mr-1" />
                      )}
                      {loadingId === s.id ? "Loading..." : "Load"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDelete(s.id)}
                      disabled={deletingId === s.id || loadingId === s.id}
                    >
                      {deletingId === s.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
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
                {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
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
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="secondary">{strategy.symbol}</Badge>
                  <Button size="sm" onClick={handleSave} disabled={saving}>
                    {saving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    ) : (
                      <Save className="h-3.5 w-3.5 mr-1" />
                    )}
                    {editingId ? "Update" : "Save"}
                  </Button>
                </div>
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

        </div>
      )}
    </div>
  );
}
