"use client";

import React, { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { Loader2 } from "lucide-react";
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
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";

// ── Types ──

interface ModelStatus {
  model_exists: boolean;
  model_loaded: boolean;
  model_path: string;
  threshold?: number;
  feature_count: number;
  features: string[];
  model_file_size_kb?: number;
  model_trained_at?: string;
  sequence_length?: number;
}

interface TrainResult {
  success: boolean;
  error?: string;
  accuracy?: number;
  precision?: number;
  recall?: number;
  f1_score?: number;
  val_loss?: number;
  epochs_trained?: number;
  total_samples?: number;
  train_size?: number;
  test_size?: number;
  features_used?: number;
  feature_importance?: Record<string, number>;
  model_type?: string;
  up_rate_in_data?: number;
  trained_at?: string;
}

interface TrainingRun {
  id: string;
  model_type: string;
  trained_at: string;
  total_samples: number;
  accuracy: number | null;
  precision_score: number | null;
  recall: number | null;
  f1_score: number | null;
  val_loss: number | null;
  epochs: number | null;
}

interface TradeAnalysis {
  total_trades: number;
  ml_trades: number;
  overall_win_rate: number;
  ml_win_rate: number;
  confidence_buckets: Array<{
    label: string;
    count: number;
    wins: number;
    win_rate: number;
  }>;
  lstm_trades: number;
  lstm_accuracy: number | null;
  avg_ml_confidence: number | null;
}

interface LSTMPrediction {
  direction: string;
  confidence: number;
  model_loaded: boolean;
}

// ── Chart configs ──

const accuracyChartConfig: ChartConfig = {
  accuracy: { label: "Accuracy", color: "hsl(var(--chart-1))" },
  f1_score: { label: "F1 Score", color: "hsl(var(--chart-2))" },
  precision: { label: "Precision", color: "hsl(var(--chart-3))" },
};

const tradeChartConfig: ChartConfig = {
  win_rate: { label: "Win Rate %", color: "hsl(var(--chart-1))" },
  count: { label: "Trade Count", color: "hsl(var(--chart-4))" },
};

const confidenceChartConfig: ChartConfig = {
  count: { label: "Trades", color: "hsl(var(--chart-4))" },
  win_rate: { label: "Win Rate %", color: "hsl(var(--chart-1))" },
};

// ── Page ──

export default function MLDashboardPage() {
  // Model status
  const [xgbStatus, setXgbStatus] = useState<ModelStatus | null>(null);
  const [lstmStatus, setLstmStatus] = useState<ModelStatus | null>(null);

  // Training
  const [xgbTraining, setXgbTraining] = useState(false);
  const [xgbResult, setXgbResult] = useState<TrainResult | null>(null);
  const [lstmTraining, setLstmTraining] = useState(false);
  const [lstmResult, setLstmResult] = useState<TrainResult | null>(null);
  const [lstmSymbol, setLstmSymbol] = useState("EURUSDm");
  const [lstmTimeframe, setLstmTimeframe] = useState("1h");
  const [lstmBars, setLstmBars] = useState(5000);

  // LSTM prediction
  const [predicting, setPredicting] = useState(false);
  const [prediction, setPrediction] = useState<LSTMPrediction | null>(null);

  // Dashboard data
  const [trainingHistory, setTrainingHistory] = useState<TrainingRun[]>([]);
  const [tradeAnalysis, setTradeAnalysis] = useState<TradeAnalysis | null>(null);

  // Threshold
  const [threshold, setThreshold] = useState(0.55);

  const loadAll = useCallback(async () => {
    try {
      const [xgb, lstm, history, analysis] = await Promise.all([
        api.ml.status().catch(() => null),
        api.ml.lstmStatus().catch(() => null),
        api.ml.trainingHistory().catch(() => []),
        api.ml.tradeAnalysis().catch(() => null),
      ]);
      if (xgb) {
        setXgbStatus(xgb);
        if (xgb.threshold) setThreshold(xgb.threshold);
      }
      if (lstm) setLstmStatus(lstm);
      setTrainingHistory(history);
      if (analysis) setTradeAnalysis(analysis);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ── Training handlers ──

  const handleTrainXGB = async () => {
    setXgbTraining(true);
    setXgbResult(null);
    try {
      const result = await api.ml.train();
      setXgbResult(result);
      loadAll();
    } catch (e) {
      setXgbResult({ success: false, error: String(e) });
    } finally {
      setXgbTraining(false);
    }
  };

  const handleTrainLSTM = async () => {
    setLstmTraining(true);
    setLstmResult(null);
    try {
      const result = await api.ml.trainLstm(lstmSymbol, lstmTimeframe, lstmBars);
      setLstmResult(result);
      loadAll();
    } catch (e) {
      setLstmResult({ success: false, error: String(e) });
    } finally {
      setLstmTraining(false);
    }
  };

  const handlePredict = async () => {
    setPredicting(true);
    setPrediction(null);
    try {
      const result = await api.ml.lstmPredict(lstmSymbol, lstmTimeframe);
      setPrediction(result);
    } catch {
      setPrediction({ direction: "error", confidence: 0, model_loaded: false });
    } finally {
      setPredicting(false);
    }
  };

  const handleSetThreshold = async (val: number) => {
    setThreshold(val);
    try {
      await api.ml.setThreshold(val);
    } catch {
      // ignore
    }
  };

  // ── Chart data ──

  const historyChartData = trainingHistory
    .slice()
    .reverse()
    .map((run, i) => ({
      index: i + 1,
      label: `#${i + 1} ${run.model_type}`,
      accuracy: run.accuracy != null ? +(run.accuracy * 100).toFixed(1) : null,
      f1_score: run.f1_score != null ? +(run.f1_score * 100).toFixed(1) : null,
      precision: run.precision_score != null ? +(run.precision_score * 100).toFixed(1) : null,
    }));

  const bucketChartData = (tradeAnalysis?.confidence_buckets || []).map((b) => ({
    label: b.label,
    count: b.count,
    win_rate: b.win_rate,
  }));

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">ML Performance Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Monitor, train, and analyze your machine learning models
        </p>
      </div>

      {/* Model Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* XGBoost Status */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">XGBoost Confidence Filter</CardTitle>
              <Badge variant={xgbStatus?.model_loaded ? "default" : "secondary"}>
                {xgbStatus?.model_loaded ? "Loaded" : xgbStatus?.model_exists ? "On Disk" : "Not Trained"}
              </Badge>
            </div>
            <CardDescription>
              Scores trade signals 0-1, blocks low-probability entries
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="text-muted-foreground">Features</div>
              <div className="font-mono">{xgbStatus?.feature_count || 13}</div>
              <div className="text-muted-foreground">Threshold</div>
              <div className="font-mono">{(threshold * 100).toFixed(0)}%</div>
              {xgbStatus?.model_file_size_kb && (
                <>
                  <div className="text-muted-foreground">Size</div>
                  <div className="font-mono">{xgbStatus.model_file_size_kb} KB</div>
                </>
              )}
              {xgbStatus?.model_trained_at && (
                <>
                  <div className="text-muted-foreground">Trained</div>
                  <div className="font-mono text-xs">{new Date(xgbStatus.model_trained_at).toLocaleString()}</div>
                </>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleTrainXGB} disabled={xgbTraining}>
                {xgbTraining && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                {xgbTraining ? "Training..." : "Train XGBoost"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => api.ml.reload().then(loadAll)}>
                Reload
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* LSTM Status */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">LSTM Price Predictor</CardTitle>
              <Badge variant={lstmStatus?.model_loaded ? "default" : "secondary"}>
                {lstmStatus?.model_loaded ? "Loaded" : lstmStatus?.model_exists ? "On Disk" : "Not Trained"}
              </Badge>
            </div>
            <CardDescription>
              Deep learning model predicting next-candle direction
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="text-muted-foreground">Features</div>
              <div className="font-mono">{lstmStatus?.feature_count || 24}</div>
              <div className="text-muted-foreground">Sequence</div>
              <div className="font-mono">{lstmStatus?.sequence_length || 50} candles</div>
              {lstmStatus?.model_file_size_kb && (
                <>
                  <div className="text-muted-foreground">Size</div>
                  <div className="font-mono">{lstmStatus.model_file_size_kb} KB</div>
                </>
              )}
              {lstmStatus?.model_trained_at && (
                <>
                  <div className="text-muted-foreground">Trained</div>
                  <div className="font-mono text-xs">{new Date(lstmStatus.model_trained_at).toLocaleString()}</div>
                </>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleTrainLSTM} disabled={lstmTraining}>
                {lstmTraining && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                {lstmTraining ? "Training..." : "Train LSTM"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => api.ml.lstmReload().then(loadAll)}>
                Reload
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* XGBoost Training Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">XGBoost Training</CardTitle>
          <CardDescription>
            Configure threshold and view latest training results
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Confidence Threshold</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={threshold}
                  onChange={(e) => handleSetThreshold(parseFloat(e.target.value) || 0.55)}
                  className="w-24 h-8 text-sm"
                />
                <span className="text-xs text-muted-foreground">
                  ({(threshold * 100).toFixed(0)}%)
                </span>
              </div>
            </div>
          </div>

          {xgbResult && (
            <div className={`p-3 rounded-lg border ${xgbResult.success ? "bg-green-500/5 border-green-500/20" : "bg-red-500/5 border-red-500/20"}`}>
              {xgbResult.success ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="default">Training Complete</Badge>
                    <span className="text-xs text-muted-foreground">{xgbResult.model_type}</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div>
                      <div className="text-muted-foreground text-xs">Accuracy</div>
                      <div className="font-mono font-bold">{((xgbResult.accuracy || 0) * 100).toFixed(1)}%</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Precision</div>
                      <div className="font-mono font-bold">{((xgbResult.precision || 0) * 100).toFixed(1)}%</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Recall</div>
                      <div className="font-mono font-bold">{((xgbResult.recall || 0) * 100).toFixed(1)}%</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">F1 Score</div>
                      <div className="font-mono font-bold">{((xgbResult.f1_score || 0) * 100).toFixed(1)}%</div>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {xgbResult.total_samples} samples ({xgbResult.train_size} train, {xgbResult.test_size} test)
                  </div>

                  {/* Feature Importance */}
                  {xgbResult.feature_importance && Object.keys(xgbResult.feature_importance).length > 0 && (
                    <div className="mt-3">
                      <div className="text-xs font-medium mb-2">Feature Importance</div>
                      <div className="space-y-1">
                        {Object.entries(xgbResult.feature_importance)
                          .sort(([, a], [, b]) => b - a)
                          .slice(0, 8)
                          .map(([name, val]) => (
                            <div key={name} className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground w-28 truncate">{name}</span>
                              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-primary rounded-full"
                                  style={{ width: `${Math.min(val * 400, 100)}%` }}
                                />
                              </div>
                              <span className="text-xs font-mono w-10 text-right">{(val * 100).toFixed(1)}%</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-red-500">{xgbResult.error}</div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* LSTM Training + Prediction */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* LSTM Training Controls */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">LSTM Training</CardTitle>
            <CardDescription>Train on historical candle data</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Symbol</Label>
                <Input
                  value={lstmSymbol}
                  onChange={(e) => setLstmSymbol(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Timeframe</Label>
                <Select value={lstmTimeframe} onValueChange={setLstmTimeframe}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["5m", "15m", "30m", "1h", "4h", "1d"].map((tf) => (
                      <SelectItem key={tf} value={tf}>{tf}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Bars</Label>
                <Input
                  type="number"
                  value={lstmBars}
                  onChange={(e) => setLstmBars(parseInt(e.target.value) || 5000)}
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <Button size="sm" onClick={handleTrainLSTM} disabled={lstmTraining} className="w-full">
              {lstmTraining && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
              {lstmTraining ? "Training LSTM..." : "Train LSTM Model"}
            </Button>

            {lstmResult && (
              <div className={`p-3 rounded-lg border text-sm ${lstmResult.success ? "bg-green-500/5 border-green-500/20" : "bg-red-500/5 border-red-500/20"}`}>
                {lstmResult.success ? (
                  <div className="space-y-2">
                    <Badge variant="default">Training Complete</Badge>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-xs text-muted-foreground">Accuracy</span>
                        <div className="font-mono font-bold">{((lstmResult.accuracy || 0) * 100).toFixed(1)}%</div>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">F1 Score</span>
                        <div className="font-mono font-bold">{((lstmResult.f1_score || 0) * 100).toFixed(1)}%</div>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">Val Loss</span>
                        <div className="font-mono font-bold">{lstmResult.val_loss?.toFixed(4)}</div>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">Epochs</span>
                        <div className="font-mono font-bold">{lstmResult.epochs_trained}</div>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {lstmResult.total_samples} sequences, {lstmResult.features_used} features, up rate: {lstmResult.up_rate_in_data}%
                    </div>
                  </div>
                ) : (
                  <div className="text-red-500">{lstmResult.error}</div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* LSTM Live Prediction */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">LSTM Live Prediction</CardTitle>
            <CardDescription>Predict next-candle price direction</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Symbol</Label>
                <Input
                  value={lstmSymbol}
                  onChange={(e) => setLstmSymbol(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Timeframe</Label>
                <Select value={lstmTimeframe} onValueChange={setLstmTimeframe}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["5m", "15m", "30m", "1h", "4h", "1d"].map((tf) => (
                      <SelectItem key={tf} value={tf}>{tf}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button size="sm" onClick={handlePredict} disabled={predicting} className="w-full">
              {predicting && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
              {predicting ? "Predicting..." : "Run Prediction"}
            </Button>

            {prediction && (
              <div className="p-4 rounded-lg border bg-card text-center space-y-2">
                {prediction.model_loaded ? (
                  <>
                    <div className="text-4xl">
                      {prediction.direction === "up" ? (
                        <span className="text-green-500">&#x25B2;</span>
                      ) : prediction.direction === "down" ? (
                        <span className="text-red-500">&#x25BC;</span>
                      ) : (
                        <span className="text-muted-foreground">&#x25C6;</span>
                      )}
                    </div>
                    <div className="text-lg font-bold capitalize">{prediction.direction}</div>
                    <div className="text-sm text-muted-foreground">
                      Confidence: <span className="font-mono font-bold">{(prediction.confidence * 100).toFixed(1)}%</span>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    No LSTM model loaded. Train one first.
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Accuracy Over Time Chart */}
      {historyChartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Model Accuracy Over Time</CardTitle>
            <CardDescription>Training run metrics across all models</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={accuracyChartConfig} className="h-[250px] w-full">
              <LineChart data={historyChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line
                  type="monotone"
                  dataKey="accuracy"
                  stroke="var(--color-accuracy)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="f1_score"
                  stroke="var(--color-f1_score)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="precision"
                  stroke="var(--color-precision)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

      {/* Trade Outcome Analysis */}
      {tradeAnalysis && tradeAnalysis.total_trades > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Trade Outcome Analysis</CardTitle>
            <CardDescription>How ML models affect trading performance</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-3 rounded-lg bg-muted/50">
                <div className="text-xs text-muted-foreground">Total Trades</div>
                <div className="text-2xl font-bold font-mono">{tradeAnalysis.total_trades}</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <div className="text-xs text-muted-foreground">Overall Win Rate</div>
                <div className="text-2xl font-bold font-mono">{tradeAnalysis.overall_win_rate}%</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <div className="text-xs text-muted-foreground">ML-Scored Trades</div>
                <div className="text-2xl font-bold font-mono">{tradeAnalysis.ml_trades}</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <div className="text-xs text-muted-foreground">ML Win Rate</div>
                <div className="text-2xl font-bold font-mono text-green-500">{tradeAnalysis.ml_win_rate}%</div>
              </div>
            </div>

            {tradeAnalysis.lstm_accuracy != null && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="p-3 rounded-lg bg-muted/50">
                  <div className="text-xs text-muted-foreground">LSTM Trades</div>
                  <div className="text-2xl font-bold font-mono">{tradeAnalysis.lstm_trades}</div>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <div className="text-xs text-muted-foreground">LSTM Accuracy</div>
                  <div className="text-2xl font-bold font-mono">{tradeAnalysis.lstm_accuracy}%</div>
                </div>
                {tradeAnalysis.avg_ml_confidence != null && (
                  <div className="p-3 rounded-lg bg-muted/50">
                    <div className="text-xs text-muted-foreground">Avg ML Confidence</div>
                    <div className="text-2xl font-bold font-mono">{(tradeAnalysis.avg_ml_confidence * 100).toFixed(1)}%</div>
                  </div>
                )}
              </div>
            )}

            {/* Win Rate by Confidence Bucket */}
            {bucketChartData.length > 0 && bucketChartData.some((b) => b.count > 0) && (
              <div>
                <div className="text-sm font-medium mb-2">Win Rate by Confidence Bucket</div>
                <ChartContainer config={confidenceChartConfig} className="h-[200px] w-full">
                  <BarChart data={bucketChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="win_rate" fill="var(--color-win_rate)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Training History Table */}
      {trainingHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Training History</CardTitle>
            <CardDescription>Recent model training runs</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto max-h-[300px]">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b sticky top-0 bg-card">
                  <tr>
                    <th className="text-left py-2 px-2">Model</th>
                    <th className="text-left py-2 px-2">Date</th>
                    <th className="text-right py-2 px-2">Samples</th>
                    <th className="text-right py-2 px-2">Accuracy</th>
                    <th className="text-right py-2 px-2">F1</th>
                    <th className="text-right py-2 px-2">Val Loss</th>
                    <th className="text-right py-2 px-2">Epochs</th>
                  </tr>
                </thead>
                <tbody>
                  {trainingHistory.map((run) => (
                    <tr key={run.id} className="border-b border-border/50">
                      <td className="py-2 px-2">
                        <Badge variant="outline" className="text-[10px]">{run.model_type}</Badge>
                      </td>
                      <td className="py-2 px-2 font-mono text-xs">
                        {new Date(run.trained_at).toLocaleDateString()}
                      </td>
                      <td className="py-2 px-2 text-right font-mono">{run.total_samples}</td>
                      <td className="py-2 px-2 text-right font-mono">
                        {run.accuracy != null ? `${(run.accuracy * 100).toFixed(1)}%` : "-"}
                      </td>
                      <td className="py-2 px-2 text-right font-mono">
                        {run.f1_score != null ? `${(run.f1_score * 100).toFixed(1)}%` : "-"}
                      </td>
                      <td className="py-2 px-2 text-right font-mono">
                        {run.val_loss != null ? run.val_loss.toFixed(4) : "-"}
                      </td>
                      <td className="py-2 px-2 text-right font-mono">
                        {run.epochs ?? "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!xgbStatus?.model_exists && !lstmStatus?.model_exists && trainingHistory.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="text-4xl mb-4">&#x1F9E0;</div>
            <h3 className="text-lg font-medium mb-2">No ML Models Trained Yet</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Train the XGBoost confidence filter with backtest data, or train the LSTM predictor
              on historical candles. Connect to MT5 first to access market data.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
