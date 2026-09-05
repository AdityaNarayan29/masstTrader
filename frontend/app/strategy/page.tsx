"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { Loader2, Save, Trash2, Download } from "lucide-react";
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
  direction?: string;
  entry_conditions: Condition[];
  exit_conditions: Condition[];
  stop_loss_pips: number | null;
  take_profit_pips: number | null;
  stop_loss_atr_multiplier?: number | null;
  take_profit_atr_multiplier?: number | null;
  min_bars_in_trade?: number | null;
  additional_timeframes?: string[] | null;
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

interface ValidationResult {
  errors: string[];
  warnings: string[];
  valid: boolean;
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
  { name: "close/open/high/low", label: "Price columns" },
  { name: "RSI", label: "Relative Strength Index" },
  { name: "MACD", label: "Line, Signal, Histogram" },
  { name: "EMA_{period}", label: "Exponential Moving Avg" },
  { name: "SMA_{period}", label: "Simple Moving Avg" },
  { name: "Bollinger", label: "Upper, Mid, Lower, Width" },
  { name: "ATR", label: "Average True Range" },
  { name: "Stochastic", label: "K, D" },
  { name: "ADX", label: "Trend Strength, DI+/DI-" },
  { name: "Volume", label: "OBV, Ratio" },
];

const INDICATOR_OPTIONS = [
  "close", "open", "high", "low",
  "RSI", "MACD", "EMA_50", "EMA_20", "EMA_200", "SMA_20", "SMA_50",
  "Bollinger", "ATR", "Stochastic", "ADX", "Volume",
];

const OPERATOR_OPTIONS = [
  { value: ">", label: ">" },
  { value: "<", label: "<" },
  { value: "==", label: "==" },
  { value: ">=", label: ">=" },
  { value: "<=", label: "<=" },
  { value: "crosses_above", label: "crosses above" },
  { value: "crosses_below", label: "crosses below" },
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
  const [strategyFilter, setStrategyFilter] = useState("");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);

  useEffect(() => {
    api.strategies.list().then(setSavedStrategies).catch((e) => {
      console.error("Failed to load strategies:", e.message);
    });
  }, []);

  const refreshList = () => {
    api.strategies.list().then(setSavedStrategies).catch((e) => {
      console.error("Failed to refresh strategies:", e.message);
    });
  };

  const handleParse = async () => {
    if (!description.trim()) return;
    setLoading(true);
    setError("");
    try {
      const result = await api.strategy.parse(description, symbol);
      setStrategy(result as Strategy);
      // Auto-validate the parsed strategy
      try {
        const v = await api.strategy.validate();
        setValidation(v);
      } catch { setValidation(null); }
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
    setValidation(null);
  };

  // Condition editing helpers
  const updateCondition = (
    ruleIdx: number,
    type: "entry_conditions" | "exit_conditions",
    condIdx: number,
    field: keyof Condition,
    value: string | number,
  ) => {
    if (!strategy) return;
    const updated = { ...strategy, rules: strategy.rules.map((r, ri) => {
      if (ri !== ruleIdx) return r;
      return { ...r, [type]: r[type].map((c, ci) => {
        if (ci !== condIdx) return c;
        const newVal = field === "value" ? (isNaN(Number(value)) ? value : Number(value)) : value;
        return { ...c, [field]: newVal };
      })};
    })};
    setStrategy(updated);
  };

  const removeCondition = (ruleIdx: number, type: "entry_conditions" | "exit_conditions", condIdx: number) => {
    if (!strategy) return;
    setStrategy({ ...strategy, rules: strategy.rules.map((r, ri) => {
      if (ri !== ruleIdx) return r;
      return { ...r, [type]: r[type].filter((_, ci) => ci !== condIdx) };
    })});
  };

  const addCondition = (ruleIdx: number, type: "entry_conditions" | "exit_conditions") => {
    if (!strategy) return;
    const newCond: Condition = { indicator: "close", parameter: "value", operator: ">", value: 0, description: "" };
    setStrategy({ ...strategy, rules: strategy.rules.map((r, ri) => {
      if (ri !== ruleIdx) return r;
      return { ...r, [type]: [...r[type], newCond] };
    })});
  };

  return (
    <div className="w-full">
      <h1 className="text-lg font-semibold tracking-tight mb-0.5">AI Strategy Builder</h1>
      <p className="text-muted-foreground text-sm mb-6">
        Describe your trading strategy in plain English. AI converts it to
        executable rules.
      </p>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded-lg mb-4 text-sm">
          {error}
        </div>
      )}

      {/* Saved Strategies — dense scannable table.
          Was a stack of ~70px bordered cards: 29 strategies meant a scroll
          marathon to find one name. Now ~32px rows, grouped by symbol, with
          a filter, so the list is scannable at a glance. */}
      {savedStrategies.length > 0 && (
        <div className="mb-4 overflow-hidden rounded-lg border border-border bg-surface-1">
          <div className="flex h-10 items-center justify-between gap-2 border-b border-border px-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Saved strategies ({savedStrategies.length})
            </h2>
            <div className="flex items-center gap-2">
              <input
                value={strategyFilter}
                onChange={(e) => setStrategyFilter(e.target.value)}
                placeholder="Filter…"
                className="h-7 w-40 rounded border border-input bg-transparent px-2 text-xs outline-none focus:border-ring"
              />
              {editingId && (
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleNew}>
                  + New
                </Button>
              )}
            </div>
          </div>

          <div className="max-h-[280px] overflow-auto">
            <table className="w-full text-xs">
              <tbody>
                {savedStrategies
                  .filter(
                    (s) =>
                      !strategyFilter ||
                      s.name.toLowerCase().includes(strategyFilter.toLowerCase()) ||
                      (s.symbol ?? "").toLowerCase().includes(strategyFilter.toLowerCase())
                  )
                  .map((s) => (
                    <tr
                      key={s.id}
                      className={`border-b border-grid-line last:border-0 hover:bg-surface-2 ${
                        editingId === s.id ? "bg-primary/10" : ""
                      }`}
                    >
                      <td className="max-w-0 px-3 py-1.5">
                        <span className="block truncate font-medium">{s.name}</span>
                      </td>
                      <td className="w-24 px-3 py-1.5">
                        <span className="price text-muted-foreground">{s.symbol}</span>
                      </td>
                      <td className="w-16 px-3 py-1.5 text-right">
                        <span className="price text-muted-foreground">
                          {s.rule_count} rule{s.rule_count !== 1 ? "s" : ""}
                        </span>
                      </td>
                      <td className="w-24 px-2 py-1 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => handleLoad(s.id)}
                            disabled={loadingId === s.id || deletingId === s.id}
                          >
                            {loadingId === s.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              "Load"
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                            onClick={() => handleDelete(s.id)}
                            disabled={deletingId === s.id || loadingId === s.id}
                            aria-label={`Delete ${s.name}`}
                          >
                            {deletingId === s.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
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
                <Label>Symbol</Label>
                <SymbolCombobox
                  value={symbol}
                  onChange={setSymbol}
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
          {/* Validation Banner */}
          {validation && (
            <div className="space-y-2">
              {validation.errors.length > 0 && (
                <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded-lg text-sm space-y-1">
                  <p className="font-semibold">Errors (must fix)</p>
                  {validation.errors.map((e, i) => <p key={i}>- {e}</p>)}
                </div>
              )}
              {validation.warnings.length > 0 && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-600 dark:text-yellow-400 px-4 py-3 rounded-lg text-sm space-y-1">
                  <p className="font-semibold">Warnings</p>
                  {validation.warnings.map((w, i) => <p key={i}>- {w}</p>)}
                </div>
              )}
              {validation.valid && validation.warnings.length === 0 && (
                <div className="bg-up/10 border border-up/30 text-green-600 dark:text-up px-4 py-3 rounded-lg text-sm">
                  Strategy validated successfully
                </div>
              )}
            </div>
          )}

          {/* Strategy Overview */}
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row items-start justify-between gap-3 sm:gap-4">
                <div className="space-y-1">
                  <CardTitle className="text-xl">{strategy.name}</CardTitle>
                  <CardDescription>{strategy.ai_explanation}</CardDescription>
                </div>
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
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
                  <select
                    className="h-7 rounded border bg-background px-1.5 text-xs font-medium"
                    value={rule.timeframe}
                    onChange={(e) => {
                      const updated = { ...strategy!, rules: strategy!.rules.map((r, ri) =>
                        ri === i ? { ...r, timeframe: e.target.value } : r
                      )};
                      setStrategy(updated);
                    }}
                  >
                    {["M1","M5","M15","M30","H1","H4","D1","W1"].map((tf) => (
                      <option key={tf} value={tf}>{tf}</option>
                    ))}
                    {!["M1","M5","M15","M30","H1","H4","D1","W1"].includes(rule.timeframe) && (
                      <option value={rule.timeframe}>{rule.timeframe}</option>
                    )}
                  </select>
                </div>
                <CardDescription>{rule.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Entry Conditions — Editable */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-up">
                      Entry Conditions
                    </h4>
                    <div className="space-y-2">
                      {rule.entry_conditions.map((c, j) => (
                        <div key={j} className="rounded-md border border-up/20 bg-up/5 px-3 py-2 space-y-1.5">
                          <p className="text-xs text-muted-foreground">{c.description}</p>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <select
                              className="h-7 rounded border bg-background px-1.5 text-xs"
                              value={c.indicator}
                              onChange={(e) => updateCondition(i, "entry_conditions", j, "indicator", e.target.value)}
                            >
                              {INDICATOR_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                              {!INDICATOR_OPTIONS.includes(c.indicator) && (
                                <option value={c.indicator}>{c.indicator}</option>
                              )}
                            </select>
                            <Input
                              className="h-7 w-16 text-xs px-1.5"
                              value={c.parameter}
                              onChange={(e) => updateCondition(i, "entry_conditions", j, "parameter", e.target.value)}
                            />
                            <select
                              className="h-7 rounded border bg-background px-1.5 text-xs"
                              value={c.operator}
                              onChange={(e) => updateCondition(i, "entry_conditions", j, "operator", e.target.value)}
                            >
                              {OPERATOR_OPTIONS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
                            </select>
                            <Input
                              className="h-7 w-20 text-xs px-1.5"
                              value={String(c.value)}
                              onChange={(e) => updateCondition(i, "entry_conditions", j, "value", e.target.value)}
                            />
                            <button
                              className="text-destructive/60 hover:text-destructive text-xs px-1"
                              onClick={() => removeCondition(i, "entry_conditions", j)}
                              title="Remove condition"
                            >x</button>
                          </div>
                        </div>
                      ))}
                      <button
                        className="text-xs text-up hover:text-up"
                        onClick={() => addCondition(i, "entry_conditions")}
                      >+ Add entry condition</button>
                    </div>
                  </div>

                  {/* Exit Conditions — Editable */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-down">
                      Exit Conditions
                    </h4>
                    <div className="space-y-2">
                      {rule.exit_conditions.map((c, j) => (
                        <div key={j} className="rounded-md border border-down/20 bg-down/5 px-3 py-2 space-y-1.5">
                          <p className="text-xs text-muted-foreground">{c.description}</p>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <select
                              className="h-7 rounded border bg-background px-1.5 text-xs"
                              value={c.indicator}
                              onChange={(e) => updateCondition(i, "exit_conditions", j, "indicator", e.target.value)}
                            >
                              {INDICATOR_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                              {!INDICATOR_OPTIONS.includes(c.indicator) && (
                                <option value={c.indicator}>{c.indicator}</option>
                              )}
                            </select>
                            <Input
                              className="h-7 w-16 text-xs px-1.5"
                              value={c.parameter}
                              onChange={(e) => updateCondition(i, "exit_conditions", j, "parameter", e.target.value)}
                            />
                            <select
                              className="h-7 rounded border bg-background px-1.5 text-xs"
                              value={c.operator}
                              onChange={(e) => updateCondition(i, "exit_conditions", j, "operator", e.target.value)}
                            >
                              {OPERATOR_OPTIONS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
                            </select>
                            <Input
                              className="h-7 w-20 text-xs px-1.5"
                              value={String(c.value)}
                              onChange={(e) => updateCondition(i, "exit_conditions", j, "value", e.target.value)}
                            />
                            <button
                              className="text-destructive/60 hover:text-destructive text-xs px-1"
                              onClick={() => removeCondition(i, "exit_conditions", j)}
                              title="Remove condition"
                            >x</button>
                          </div>
                        </div>
                      ))}
                      <button
                        className="text-xs text-down hover:text-down"
                        onClick={() => addCondition(i, "exit_conditions")}
                      >+ Add exit condition</button>
                    </div>
                  </div>
                </div>

                {/* Risk Management — SL/TP/min_bars/TF */}
                <Separator />
                <div className="flex flex-wrap gap-4 items-center">
                  {rule.stop_loss_atr_multiplier != null && (
                    <div className="flex items-center gap-2">
                      <Badge variant="destructive">SL</Badge>
                      <span className="text-sm">{rule.stop_loss_atr_multiplier}x ATR</span>
                    </div>
                  )}
                  {rule.stop_loss_pips != null && !rule.stop_loss_atr_multiplier && (
                    <div className="flex items-center gap-2">
                      <Badge variant="destructive">SL</Badge>
                      <span className="text-sm">{rule.stop_loss_pips} pips</span>
                    </div>
                  )}
                  {rule.take_profit_atr_multiplier != null && (
                    <div className="flex items-center gap-2">
                      <Badge className="bg-green-600 hover:bg-green-600/90 text-white">TP</Badge>
                      <span className="text-sm">{rule.take_profit_atr_multiplier}x ATR</span>
                    </div>
                  )}
                  {rule.take_profit_pips != null && !rule.take_profit_atr_multiplier && (
                    <div className="flex items-center gap-2">
                      <Badge className="bg-green-600 hover:bg-green-600/90 text-white">TP</Badge>
                      <span className="text-sm">{rule.take_profit_pips} pips</span>
                    </div>
                  )}
                  {rule.min_bars_in_trade != null && (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">Min Hold</Badge>
                      <span className="text-sm">{rule.min_bars_in_trade} bars</span>
                    </div>
                  )}
                  {rule.additional_timeframes && rule.additional_timeframes.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">Multi-TF</Badge>
                      <span className="text-sm">{rule.additional_timeframes.join(", ")}</span>
                    </div>
                  )}
                  {rule.direction && (
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{rule.direction.toUpperCase()}</Badge>
                    </div>
                  )}
                  {!rule.stop_loss_pips && !rule.stop_loss_atr_multiplier && !rule.take_profit_pips && !rule.take_profit_atr_multiplier && (
                    <span className="text-xs text-muted-foreground">No SL/TP defined</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}

        </div>
      )}
    </div>
  );
}
