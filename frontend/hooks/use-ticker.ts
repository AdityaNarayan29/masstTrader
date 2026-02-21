"use client";
import { useEffect, useRef, useState } from "react";
import { isDemoMode } from "@/lib/demo";
import { tickPrice, demoAccount } from "@/lib/demo/demo-data";
import { demoAlgo } from "@/lib/demo/demo-algo";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "";

interface TickerPrice {
  symbol: string;
  bid: number;
  ask: number;
  market_open?: boolean;
}

interface AlgoTicker {
  running: boolean;
  symbol: string | null;
  strategy_name: string | null;
  trades_placed: number;
  in_position: boolean;
}

export function useTicker(symbol: string) {
  const esRef = useRef<EventSource | null>(null);
  const [connected, setConnected] = useState(false);
  const [price, setPrice] = useState<TickerPrice | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [equity, setEquity] = useState<number | null>(null);
  const [profit, setProfit] = useState<number | null>(null);
  const [algo, setAlgo] = useState<AlgoTicker | null>(null);

  useEffect(() => {
    if (!symbol) return;

    // Demo mode: simulate ticker with setInterval
    if (isDemoMode()) {
      setConnected(true);
      const interval = setInterval(() => {
        const p = tickPrice(symbol);
        setPrice({ symbol: p.symbol, bid: p.bid, ask: p.ask });
        const acc = demoAccount();
        setBalance(acc.balance);
        setEquity(acc.equity);
        setProfit(acc.profit);
        if (demoAlgo.isRunning()) {
          const s = demoAlgo.status();
          setAlgo({
            running: s.running,
            symbol: s.symbol,
            strategy_name: s.strategy_name,
            trades_placed: s.trades_placed,
            in_position: s.in_position,
          });
        } else {
          setAlgo(null);
        }
      }, 500);
      return () => { clearInterval(interval); setConnected(false); };
    }

    const params = new URLSearchParams({ symbol });
    if (API_KEY) params.set("api_key", API_KEY);
    const url = `${API_BASE}/api/sse/ticker?${params.toString()}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.addEventListener("price", (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      setPrice({ symbol: data.symbol, bid: data.bid, ask: data.ask, market_open: data.market_open });
    });

    es.addEventListener("account", (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      setBalance(data.balance);
      setEquity(data.equity);
      setProfit(data.profit);
    });

    es.addEventListener("algo_status", (e: MessageEvent) => {
      setAlgo(JSON.parse(e.data));
    });

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setConnected(false);
        esRef.current = null;
      }
    };

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [symbol]);

  return { connected, price, balance, equity, profit, algo };
}
