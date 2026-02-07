"use client";

import { useState, useEffect } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Eye, EyeOff, LogOut } from "lucide-react";

interface AccountInfo {
  login: number;
  name: string;
  server: string;
  balance: number;
  equity: number;
  margin: number;
  free_margin: number;
  leverage: number;
  currency: string;
  profit: number;
}

interface Position {
  ticket: number;
  symbol: string;
  type: string;
  volume: number;
  open_price: number;
  current_price: number;
  profit: number;
  stop_loss: number;
  take_profit: number;
  open_time: string;
}

interface Trade {
  [key: string]: unknown;
  ticket?: number;
  symbol?: string;
  type?: string;
  volume?: number;
  profit?: number;
  open_time?: string;
  close_time?: string;
  open_price?: number;
  close_price?: number;
}

export default function ConnectionPage() {
  // Login form state
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [server, setServer] = useState("");
  const [mt5Path, setMt5Path] = useState("");

  // Password visibility
  const [showPassword, setShowPassword] = useState(false);

  // General state
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);

  // Fetch data state
  const [symbol, setSymbol] = useState("EURUSDm");
  const [timeframe, setTimeframe] = useState("1h");
  const [bars, setBars] = useState("500");
  const [fetchResult, setFetchResult] = useState("");

  // Positions & history state
  const [positions, setPositions] = useState<Position[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [historyDays, setHistoryDays] = useState("7");

  // Sync with backend on mount — if MT5 is already connected, show it
  useEffect(() => {
    api.health().then((h) => {
      if (h.mt5_connected) {
        setConnected(true);
        if (h.has_data) setDataLoaded(true);
        api.mt5.account().then(setAccount).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  const handleConnect = async () => {
    setLoading(true);
    setError("");
    try {
      await api.mt5.connect(
        parseInt(login),
        password,
        server,
        mt5Path || undefined
      );
      const info = await api.mt5.account();
      setAccount(info);
      setConnected(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    setError("");
    try {
      await api.mt5.disconnect();
      setConnected(false);
      setAccount(null);
      setDataLoaded(false);
      setFetchResult("");
      setPositions([]);
      setTrades([]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setLoading(false);
    }
  };

  const handleLoadDemo = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.data.demo();
      setDataLoaded(true);
      setConnected(true);
      setAccount({
        balance: 10000,
        equity: 10000,
        margin: 0,
        free_margin: 10000,
        leverage: 100,
        currency: "USD",
        server: "Demo",
        login: 0,
        name: "Demo Account",
        profit: 0,
      });
      setFetchResult(`Loaded ${res.count} demo candles with indicators`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load demo");
    } finally {
      setLoading(false);
    }
  };

  const handleFetchData = async () => {
    setLoading(true);
    setError("");
    setFetchResult("");
    try {
      const res = await api.data.fetch(symbol, timeframe, parseInt(bars));
      setDataLoaded(true);
      setFetchResult(
        `Loaded ${res.count} candles with ${res.columns.length} columns`
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setLoading(false);
    }
  };

  const handleFetchPositions = async () => {
    setPositionsLoading(true);
    setError("");
    try {
      const res = await api.mt5.positions();
      setPositions(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to fetch positions");
    } finally {
      setPositionsLoading(false);
    }
  };

  const handleFetchHistory = async () => {
    setTradesLoading(true);
    setError("");
    try {
      const res = await api.data.history(parseInt(historyDays));
      setTrades(res as Trade[]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to fetch history");
    } finally {
      setTradesLoading(false);
    }
  };

  return (
    <div className="max-w-5xl space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">MT5 Connection</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Connect to your MetaTrader 5 terminal or use demo data
        </p>
      </div>

      {/* Connection Status */}
      <div className="flex items-center gap-3">
        <Badge variant={connected ? "default" : "outline"}>
          {connected ? "Connected" : "Disconnected"}
        </Badge>
        {dataLoaded && (
          <Badge variant="secondary">Data Loaded</Badge>
        )}
      </div>

      {/* Error Alert */}
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Login Form Card — only show when disconnected */}
      {!connected && (
        <Card>
          <CardHeader>
            <CardTitle>MT5 Account Login</CardTitle>
            <CardDescription>
              Enter your MetaTrader 5 credentials to connect to your trading
              account
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="login">Login / Account Number</Label>
                <Input
                  id="login"
                  type="text"
                  placeholder="e.g. 12345678"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Your MT5 password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="server">Server</Label>
                <Input
                  id="server"
                  type="text"
                  placeholder="e.g. Deriv-Demo"
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mt5path">MT5 Path (optional)</Label>
                <Input
                  id="mt5path"
                  type="text"
                  placeholder="C:\Program Files\MetaTrader 5\terminal64.exe"
                  value={mt5Path}
                  onChange={(e) => setMt5Path(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-6 flex items-center gap-3">
              <Button
                onClick={handleConnect}
                disabled={loading || !login || !password || !server}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {loading ? "Connecting..." : "Connect to MT5"}
              </Button>
              <Button
                variant="outline"
                disabled={loading}
                onClick={() => {
                  setLogin("260210496");
                  setPassword("Password@123");
                  setServer("Exness-MT5Trial15");
                }}
              >
                Fill Demo Credentials
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Account Info Card */}
      {connected && account && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Account Information</CardTitle>
                <CardDescription>
                  {account.name} &mdash; {account.server}
                  {account.login > 0 && ` (${account.login})`}
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisconnect}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <LogOut className="h-4 w-4" />
                )}
                Disconnect
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                {
                  label: "Balance",
                  value: `${account.currency === "USD" ? "$" : account.currency + " "}${account.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                },
                {
                  label: "Equity",
                  value: `${account.currency === "USD" ? "$" : account.currency + " "}${account.equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                },
                {
                  label: "Free Margin",
                  value: `${account.currency === "USD" ? "$" : account.currency + " "}${account.free_margin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                },
                {
                  label: "Leverage",
                  value: `1:${account.leverage}`,
                },
              ].map((metric) => (
                <Card key={metric.label} className="py-4">
                  <CardContent className="px-4">
                    <p className="text-xs text-muted-foreground">
                      {metric.label}
                    </p>
                    <p className="text-xl font-semibold mt-1">
                      {metric.value}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {account.profit !== 0 && (
              <div className="mt-4 flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  Floating P/L:
                </span>
                <Badge
                  variant={account.profit >= 0 ? "default" : "destructive"}
                >
                  {account.profit >= 0 ? "+" : ""}
                  {account.profit.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Historical Data Fetch Card */}
      {connected && (
        <Card>
          <CardHeader>
            <CardTitle>Load Historical Data</CardTitle>
            <CardDescription>
              Fetch OHLCV candle data with technical indicators for backtesting
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-2">
                <Label htmlFor="symbol">Symbol</Label>
                <Input
                  id="symbol"
                  type="text"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  className="w-32"
                />
              </div>
              <div className="space-y-2">
                <Label>Timeframe</Label>
                <Select value={timeframe} onValueChange={setTimeframe}>
                  <SelectTrigger className="w-28">
                    <SelectValue placeholder="Timeframe" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1m">1m</SelectItem>
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
                  onChange={(e) => setBars(e.target.value)}
                  className="w-24"
                />
              </div>
              <Button onClick={handleFetchData} disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {loading ? "Fetching..." : "Fetch Data"}
              </Button>
            </div>
            {fetchResult && (
              <p className="mt-3 text-sm text-green-500">{fetchResult}</p>
            )}
            {dataLoaded && (
              <p className="mt-1 text-xs text-muted-foreground">
                Data loaded and ready for backtesting
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Open Positions Section */}
      {connected && (
        <Card>
          <CardHeader>
            <CardTitle>Open Positions</CardTitle>
            <CardDescription>
              View currently open trades on your MT5 account
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={handleFetchPositions}
              disabled={positionsLoading}
            >
              {positionsLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {positionsLoading ? "Loading..." : "Refresh Positions"}
            </Button>

            {positions.length > 0 && (
              <div className="mt-4 space-y-3">
                {positions.map((pos) => (
                  <div
                    key={pos.ticket}
                    className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4"
                  >
                    <div className="flex items-center gap-3">
                      <Badge
                        variant={
                          pos.type.toLowerCase().includes("buy")
                            ? "default"
                            : "destructive"
                        }
                      >
                        {pos.type}
                      </Badge>
                      <div>
                        <p className="font-medium text-sm">{pos.symbol}</p>
                        <p className="text-xs text-muted-foreground">
                          Ticket #{pos.ticket}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-6 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Volume</p>
                        <p className="font-medium">{pos.volume}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Open</p>
                        <p className="font-medium">{pos.open_price}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Current
                        </p>
                        <p className="font-medium">{pos.current_price}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">SL</p>
                        <p className="font-medium">
                          {pos.stop_loss || "---"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">TP</p>
                        <p className="font-medium">
                          {pos.take_profit || "---"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">P/L</p>
                        <p
                          className={`font-semibold ${
                            pos.profit >= 0
                              ? "text-green-500"
                              : "text-red-500"
                          }`}
                        >
                          {pos.profit >= 0 ? "+" : ""}
                          {pos.profit.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {positions.length === 0 && !positionsLoading && (
              <p className="mt-3 text-sm text-muted-foreground">
                No open positions. Click &quot;Refresh Positions&quot; to load.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Trade History Section */}
      {connected && (
        <Card>
          <CardHeader>
            <CardTitle>Trade History</CardTitle>
            <CardDescription>
              Review closed trades from your account history
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-4">
              <div className="space-y-2">
                <Label htmlFor="historyDays">Days</Label>
                <Input
                  id="historyDays"
                  type="number"
                  value={historyDays}
                  onChange={(e) => setHistoryDays(e.target.value)}
                  className="w-24"
                />
              </div>
              <Button
                variant="outline"
                onClick={handleFetchHistory}
                disabled={tradesLoading}
              >
                {tradesLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {tradesLoading ? "Loading..." : "Load History"}
              </Button>
            </div>

            {trades.length > 0 && (
              <div className="mt-4 space-y-3">
                <div className="space-y-2">
                  {trades.map((trade, index) => (
                    <div
                      key={trade.ticket ? Number(trade.ticket) : index}
                      className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4"
                    >
                      <div className="flex items-center gap-3">
                        {trade.type && (
                          <Badge
                            variant={
                              String(trade.type)
                                .toLowerCase()
                                .includes("buy")
                                ? "default"
                                : "destructive"
                            }
                          >
                            {String(trade.type)}
                          </Badge>
                        )}
                        <div>
                          <p className="font-medium text-sm">
                            {trade.symbol
                              ? String(trade.symbol)
                              : "Unknown"}
                          </p>
                          {trade.ticket && (
                            <p className="text-xs text-muted-foreground">
                              Ticket #{Number(trade.ticket)}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-6 text-sm">
                        {trade.volume !== undefined && (
                          <div>
                            <p className="text-xs text-muted-foreground">
                              Volume
                            </p>
                            <p className="font-medium">
                              {Number(trade.volume)}
                            </p>
                          </div>
                        )}
                        {trade.open_price !== undefined && (
                          <div>
                            <p className="text-xs text-muted-foreground">
                              Open
                            </p>
                            <p className="font-medium">
                              {Number(trade.open_price)}
                            </p>
                          </div>
                        )}
                        {trade.close_price !== undefined && (
                          <div>
                            <p className="text-xs text-muted-foreground">
                              Close
                            </p>
                            <p className="font-medium">
                              {Number(trade.close_price)}
                            </p>
                          </div>
                        )}
                        {trade.profit !== undefined && (
                          <div>
                            <p className="text-xs text-muted-foreground">
                              P/L
                            </p>
                            <p
                              className={`font-semibold ${
                                Number(trade.profit) >= 0
                                  ? "text-green-500"
                                  : "text-red-500"
                              }`}
                            >
                              {Number(trade.profit) >= 0 ? "+" : ""}
                              {Number(trade.profit).toFixed(2)}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {trades.length === 0 && !tradesLoading && (
              <p className="mt-3 text-sm text-muted-foreground">
                No trade history loaded. Select a time range and click
                &quot;Load History&quot;.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Demo Mode Card */}
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Demo Mode
            <Badge variant="secondary">No MT5 Required</Badge>
          </CardTitle>
          <CardDescription>
            No MetaTrader 5 terminal? Load synthetic demo data to explore all
            platform features including strategy building, backtesting, and
            analysis.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="secondary"
            onClick={handleLoadDemo}
            disabled={loading}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? "Loading..." : "Load Demo Data"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
