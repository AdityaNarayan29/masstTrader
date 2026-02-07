"use client";
import { useEffect, useRef, useState, useCallback } from "react";

const WS_BASE = (process.env.NEXT_PUBLIC_WS_URL || "").replace(/\/$/, "");

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

export type StreamStatus = "disconnected" | "connecting" | "connected" | "error";

export function useLiveStream(symbol: string, timeframe: string = "1m") {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<StreamStatus>("disconnected");
  const [price, setPrice] = useState<PriceData | null>(null);
  const [positions, setPositions] = useState<PositionData[]>([]);
  const [account, setAccount] = useState<AccountData | null>(null);
  const [candle, setCandle] = useState<CandleData | null>(null);
  const [error, setError] = useState("");

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (!WS_BASE) {
      setError("NEXT_PUBLIC_WS_URL not configured");
      setStatus("error");
      return;
    }

    setStatus("connecting");
    setError("");

    const ws = new WebSocket(`${WS_BASE}/api/ws/live`);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      ws.send(JSON.stringify({ symbol, timeframe }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case "price":
          setPrice(msg as PriceData);
          break;
        case "positions":
          setPositions(msg.data as PositionData[]);
          break;
        case "account":
          setAccount(msg as AccountData);
          break;
        case "candle":
          setCandle(msg as CandleData);
          break;
        case "error":
          setError(msg.message);
          setStatus("error");
          break;
      }
    };

    ws.onerror = () => {
      setError(
        `WebSocket connection failed — cannot reach ${WS_BASE}/api/ws/live. ` +
        `Make sure the backend is running and the WS endpoint is deployed.`
      );
      setStatus("error");
    };

    ws.onclose = () => {
      setStatus("disconnected");
      wsRef.current = null;
    };
  }, [symbol, timeframe]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const changeSymbol = useCallback(
    (newSymbol: string, newTimeframe?: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            symbol: newSymbol,
            ...(newTimeframe ? { timeframe: newTimeframe } : {}),
          })
        );
      }
    },
    []
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  return {
    status,
    price,
    positions,
    account,
    candle,
    error,
    connect,
    disconnect,
    changeSymbol,
  };
}
