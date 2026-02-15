"use client";
import { useEffect, useRef, useState, useCallback } from "react";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "";

export interface PriceData {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  time: string;
}

export interface PositionData {
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

export interface AccountData {
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

export interface CandleData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  indicators: Record<string, number>;
}

export interface AlgoCondition {
  description: string;
  indicator: string;
  parameter: string;
  operator: string;
  value: number | string;
  passed: boolean;
}

export interface AlgoStatusData {
  running: boolean;
  symbol: string | null;
  timeframe: string;
  strategy_name: string | null;
  volume: number;
  in_position: boolean;
  position_ticket: number | null;
  trades_placed: number;
  signals: Array<{ time: string; action: string; detail: string }>;
  current_price: { bid: number; ask: number; spread: number } | null;
  indicators: Record<string, number | string | null>;
  entry_conditions: AlgoCondition[];
  exit_conditions: AlgoCondition[];
  last_check: string | null;
  trade_state: {
    ticket: number; entry_price: number;
    sl_price: number | null; tp_price: number | null;
    direction: string; volume: number; entry_time: string;
    bars_since_entry: number; atr_at_entry: number | null;
    sl_atr_mult: number | null; tp_atr_mult: number | null;
  } | null;
  active_rule_index: number;
}

export type StreamStatus = "disconnected" | "connecting" | "connected" | "error";

export function useLiveStream(symbol: string, timeframe: string = "1m") {
  const esRef = useRef<EventSource | null>(null);
  const [status, setStatus] = useState<StreamStatus>("disconnected");
  const [price, setPrice] = useState<PriceData | null>(null);
  const [positions, setPositions] = useState<PositionData[]>([]);
  const [account, setAccount] = useState<AccountData | null>(null);
  const [candle, setCandle] = useState<CandleData | null>(null);
  const [algo, setAlgo] = useState<AlgoStatusData | null>(null);
  const [error, setError] = useState("");

  const paramsRef = useRef({ symbol, timeframe });
  useEffect(() => {
    paramsRef.current = { symbol, timeframe };
  }, [symbol, timeframe]);

  const disconnect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setStatus("disconnected");
  }, []);

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    setStatus("connecting");
    setError("");

    const { symbol: sym, timeframe: tf } = paramsRef.current;
    const params = new URLSearchParams({ symbol: sym, timeframe: tf });
    if (API_KEY) params.set("api_key", API_KEY);
    const url = `${API_BASE}/api/sse/live?${params.toString()}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      setStatus("connected");
    };

    es.addEventListener("price", (e: MessageEvent) => {
      setPrice(JSON.parse(e.data) as PriceData);
    });

    es.addEventListener("positions", (e: MessageEvent) => {
      const msg = JSON.parse(e.data);
      setPositions(msg.data as PositionData[]);
    });

    es.addEventListener("account", (e: MessageEvent) => {
      setAccount(JSON.parse(e.data) as AccountData);
    });

    es.addEventListener("candle", (e: MessageEvent) => {
      setCandle(JSON.parse(e.data) as CandleData);
    });

    es.addEventListener("algo", (e: MessageEvent) => {
      setAlgo(JSON.parse(e.data) as AlgoStatusData);
    });

    es.addEventListener("error", (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data);
        setError(msg.message || "Stream error");
      } catch {
        setError("Stream error");
      }
      setStatus("error");
    });

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setError("SSE connection closed — using HTTP polling instead.");
        setStatus("error");
        esRef.current = null;
      } else if (es.readyState === EventSource.CONNECTING) {
        setStatus("connecting");
      }
    };
  }, []);

  const changeSymbol = useCallback(
    (newSymbol: string, newTimeframe?: string) => {
      paramsRef.current = {
        symbol: newSymbol,
        timeframe: newTimeframe || paramsRef.current.timeframe,
      };
      if (esRef.current) {
        connect();
      }
    },
    [connect]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      esRef.current?.close();
    };
  }, []);

  return {
    status,
    price,
    positions,
    account,
    candle,
    algo,
    error,
    connect,
    disconnect,
    changeSymbol,
  };
}
