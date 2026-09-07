"use client";

import { useState, useEffect } from "react";
import { fmtMoney, Signed } from "@/components/trade/num";
import { api } from "@/lib/api";
import { useDemoMode, setDemoMode, isDemoMode } from "@/lib/demo";
import { demoAccount } from "@/lib/demo/demo-data";
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
  const isDemo = useDemoMode();

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
  const [hasEnvCreds, setHasEnvCreds] = useState(false);

  // Positions & history state
  const [positions, setPositions] = useState<Position[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [historyDays, setHistoryDays] = useState("7");

  // Sync with backend on mount — if MT5 is already connected, show it
  useEffect(() => {
    if (isDemo) {
      setConnected(true);
      setDataLoaded(true);
      setAccount(demoAccount() as AccountInfo);
      setError("");
      return;
    }
    api.health().then((h) => {
      // api.ts auto-enables demo on network errors, so check if we switched
      if (isDemoMode()) {
        setConnected(true);
        setDataLoaded(true);
        setAccount(demoAccount() as AccountInfo);
        return;
      }
      if (h.mt5_connected) {
        setConnected(true);
        if (h.has_data) setDataLoaded(true);
        api.mt5.account().then(setAccount).catch((e: Error) => console.error(e.message));
      }
      if (h.has_env_creds) setHasEnvCreds(true);
      // Connected means the data is already available — fetch it rather than
      // rendering a panel whose only content is "click to load".
      if (h.mt5_connected) {
        api.mt5.positions().then(setPositions).catch(() => {});
        api.data.history(Number(historyDays) || 7).then(setTrades).catch(() => {});
      }
    }).catch((e: Error) => console.error(e.message));
  }, [isDemo]);

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

  const handleQuickConnect = async () => {
    setLoading(true);
    setError("");
    try {
      await api.mt5.connect();
      const info = await api.mt5.account();
      setAccount(info);
      setConnected(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Quick connect failed");
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
      await api.data.demo();
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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load demo");
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
    <div className="w-full space-y-4">
      {/* Page Header */}
      <div>
        <h1 className="text-lg font-semibold tracking-tight">MT5 Connection</h1>
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
              {hasEnvCreds && (
                <Button
                  onClick={handleQuickConnect}
                  disabled={loading}
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {loading ? "Connecting..." : "Quick Connect"}
                </Button>
              )}
              <Button
                onClick={handleConnect}
                disabled={loading || !login || !password || !server}
                variant={hasEnvCreds ? "outline" : "default"}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {loading ? "Connecting..." : "Connect to MT5"}
              </Button>
              <Button
                variant="outline"
                disabled={loading}
                onClick={handleLoadDemo}
              >
                Use Demo Data Instead
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Account summary — a compact divided strip rather than four ~200x80px
          cards for four numbers. Boxing each figure separately adds chrome
          without adding meaning. */}
      {connected && account && (
        <div className="overflow-hidden rounded-lg border border-border bg-surface-1">
          <div className="flex h-10 items-center justify-between gap-2 border-b border-border px-3">
            <div className="flex min-w-0 items-baseline gap-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Account
              </h2>
              <span className="price truncate text-xs text-muted-foreground">
                {account.name} · {account.server}
                {account.login > 0 && ` · ${account.login}`}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={handleDisconnect}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <LogOut className="h-3 w-3" />
              )}
              Disconnect
            </Button>
          </div>

          <div className="grid grid-cols-2 divide-x divide-border sm:grid-cols-5">
            {[
              { label: "Balance", value: fmtMoney(account.balance) },
              { label: "Equity", value: fmtMoney(account.equity) },
              { label: "Free margin", value: fmtMoney(account.free_margin) },
              { label: "Margin", value: fmtMoney(account.margin) },
            ].map((m) => (
              <div key={m.label} className="px-3 py-2">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {m.label}
                </div>
                <div className="price mt-0.5 text-base font-semibold">{m.value}</div>
              </div>
            ))}
            <div className="px-3 py-2">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Floating P&amp;L
              </div>
              <div className="mt-0.5 text-base font-semibold">
                <Signed value={account.profit} format={(v) => fmtMoney(v)} />
              </div>
              <div className="text-[10px] text-muted-foreground">1:{account.leverage}</div>
            </div>
          </div>
        </div>
      )}

      {/* Open Positions Section */}
      {connected && (
        <Card>
          <CardHeader>
            <CardTitle>Open Positions</CardTitle>
            <CardDescription>
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

                    <div className="grid grid-cols-3 sm:flex items-center gap-3 sm:gap-6 text-sm">
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
                              ? "text-up"
                              : "text-down"
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
                No open positions on this account.
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
              <div className="mt-3 overflow-hidden rounded-lg border border-border">
                <div className="max-h-[320px] overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-surface-2">
                      <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-3 py-2 text-left font-medium">Symbol</th>
                        <th className="px-3 py-2 text-left font-medium">Type</th>
                        <th className="px-3 py-2 text-right font-medium">Volume</th>
                        <th className="px-3 py-2 text-right font-medium">Open</th>
                        <th className="px-3 py-2 text-right font-medium">Close</th>
                        <th className="px-3 py-2 text-right font-medium">Ticket</th>
                        <th className="px-3 py-2 text-right font-medium">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trades.map((trade, index) => {
                        // MT5 history includes balance operations (deposits,
                        // withdrawals, credits) alongside trades. They have no
                        // symbol and no volume. Rendering a $5,000 deposit as
                        // "P/L +5000.00" in profit-green is actively misleading —
                        // it is money you put in, not money you made.
                        const rawType = String(trade.type ?? "").toLowerCase();
                        const hasSymbol = Boolean(trade.symbol);
                        const isBalanceOp =
                          !hasSymbol ||
                          rawType.includes("balance") ||
                          rawType.includes("credit") ||
                          Number(trade.volume ?? 0) === 0;
                        const profit = Number(trade.profit ?? 0);
                        const isBuy = rawType.includes("buy");

                        return (
                          <tr
                            key={trade.ticket ? Number(trade.ticket) : index}
                            className="border-b border-grid-line last:border-0 hover:bg-surface-2"
                          >
                            <td className="px-3 py-1.5 font-medium">
                              {hasSymbol ? String(trade.symbol) : (
                                <span className="text-muted-foreground">
                                  {profit >= 0 ? "Deposit" : "Withdrawal"}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-1.5">
                              {isBalanceOp ? (
                                <span className="text-muted-foreground">balance</span>
                              ) : (
                                <span className={isBuy ? "text-up" : "text-down"}>
                                  {isBuy ? "buy" : "sell"}
                                </span>
                              )}
                            </td>
                            <td className="price px-3 py-1.5 text-right">
                              {isBalanceOp ? "—" : Number(trade.volume ?? 0)}
                            </td>
                            <td className="price px-3 py-1.5 text-right text-muted-foreground">
                              {isBalanceOp || trade.open_price === undefined
                                ? "—"
                                : Number(trade.open_price)}
                            </td>
                            <td className="price px-3 py-1.5 text-right text-muted-foreground">
                              {isBalanceOp || trade.close_price === undefined
                                ? "—"
                                : Number(trade.close_price)}
                            </td>
                            <td className="price px-3 py-1.5 text-right text-muted-foreground">
                              {trade.ticket ? Number(trade.ticket) : "—"}
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              {isBalanceOp ? (
                                // Neutral, not green: a deposit is not a gain.
                                <span className="price text-muted-foreground">
                                  {fmtMoney(profit)}
                                </span>
                              ) : (
                                <Signed value={profit} format={(v) => fmtMoney(v)} />
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {trades.length === 0 && !tradesLoading && (
              <p className="mt-3 text-sm text-muted-foreground">
                No closed trades in the last {historyDays} days.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Demo Mode Card */}
      <Card className={`border-dashed ${isDemo ? "border-amber-500/50 bg-amber-500/5" : ""}`}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Frontend Demo Mode
            <Badge variant={isDemo ? "default" : "secondary"}>
              {isDemo ? "Active" : "No Backend Required"}
            </Badge>
          </CardTitle>
          <CardDescription>
            {isDemo
              ? "All data is simulated locally in your browser. AI features work fully — demo mode reduces server costs by running everything client-side. Disable to connect to the real backend."
              : "Enable demo mode to explore all platform features with simulated data — no MT5 or server needed. AI features work fully; demo mode just reduces server costs."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          {isDemo ? (
            <Button
              variant="outline"
              onClick={() => {
                setDemoMode(false);
                setConnected(false);
                setAccount(null);
                setDataLoaded(false);
              }}
            >
              Disable Demo Mode
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setDemoMode(true);
                  setConnected(true);
                  setAccount(demoAccount() as AccountInfo);
                  setDataLoaded(true);
                }}
              >
                Enable Demo Mode
              </Button>
              <Button
                variant="outline"
                onClick={handleLoadDemo}
                disabled={loading}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {loading ? "Loading..." : "Load Demo Data (Backend)"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
